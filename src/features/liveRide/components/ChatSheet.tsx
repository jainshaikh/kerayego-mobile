import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Modal, View } from 'react-native';
import * as Crypto from 'expo-crypto';

import { AppButton, AppInput, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useAuth } from '../../../auth/auth-context';
import { tripInquiriesApi, type ChatMessage } from '../../../api/trip-inquiries.api';
import { normalizeApiError } from '../../../api/errors';
import { useRideSocket, type ChatReadPayload } from '../socket';

interface ChatSheetProps {
  visible: boolean;
  onClose: () => void;
  tripInquiryId: string;
  otherPartyName: string;
}

// Local-only display state layered on top of the server's ChatMessage shape —
// `pending` marks an optimistically-appended message still awaiting its
// `chat.message` ack, `failed` marks one whose ack came back {ok:false}.
interface LocalChatMessage extends ChatMessage {
  pending?: boolean;
  failed?: boolean;
}

// How often sendTyping is allowed to fire while the user is actively
// typing — a simple cooldown timestamp is all this needs per the spec.
const TYPING_THROTTLE_MS = 2500;
// How long the "typing…" indicator stays up after the other party's last
// typing event, absent a further one.
const TYPING_INDICATOR_TIMEOUT_MS = 4000;

function upsertMessage(list: LocalChatMessage[], incoming: ChatMessage): LocalChatMessage[] {
  const index = list.findIndex((m) => m.id === incoming.id);
  if (index === -1) return [...list, incoming];
  const next = [...list];
  next[index] = { ...incoming };
  return next;
}

/**
 * One rider↔driver chat thread, scoped to a single TripInquiry — matches this
 * app's existing bottom-sheet Modal convention (see TripInquiryFormSheet /
 * LocationMapSheet). Both the driver's my-trips screen and the rider's
 * trip-request screen mount exactly one of these at a time, driven by a
 * single "which inquiry's sheet is open" piece of state — see those screens
 * for how they guarantee only one thread is ever open/joined at once.
 */
export function ChatSheet({ visible, onClose, tripInquiryId, otherPartyName }: ChatSheetProps) {
  const { colors, spacing } = useTheme();
  const { user } = useAuth();
  const currentUserId = user?.id;
  const {
    isReady,
    joinInquiry,
    leaveInquiry,
    sendMessage,
    sendTyping,
    markRead,
    onChatMessage,
    onTyping,
    onReadReceipt,
  } = useRideSocket();

  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [otherTyping, setOtherTyping] = useState(false);

  const lastMarkedReadIdRef = useRef<string | null>(null);
  const lastTypingSentAtRef = useRef(0);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<LocalChatMessage>>(null);

  // --- initial history fetch, reset every time the sheet opens --------------
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    lastMarkedReadIdRef.current = null;

    // Wrapped in an async IIFE (rather than setState calls directly in the
    // effect body) — same convention this app already uses for its other
    // fetch-on-mount effects (e.g. the driver/rider screens' location-watch
    // setup) — a bare synchronous setState at the top of an effect body
    // triggers this project's react-hooks/set-state-in-effect lint rule.
    (async () => {
      setMessages([]);
      setLoadError(null);
      setSendError(null);
      setLoading(true);
      try {
        const result = await tripInquiriesApi.getMessages(tripInquiryId);
        if (cancelled) return;
        setMessages(result.data);
      } catch (error) {
        if (cancelled) return;
        setLoadError(normalizeApiError(error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, tripInquiryId]);

  // --- join/leave this inquiry's chat room -----------------------------------
  // Mirrors the driver/rider screens' own trip-room join/leave effects
  // exactly: joins once the shared socket is ready (which may not be the case
  // yet on first mount), leaves again as soon as the sheet closes/unmounts.
  useEffect(() => {
    if (!visible || !isReady) return;
    let cancelled = false;
    joinInquiry(tripInquiryId).then((result) => {
      if (!cancelled && !result.ok) {
        console.warn('[ChatSheet] joinInquiry failed:', result.error);
      }
    });
    return () => {
      cancelled = true;
      leaveInquiry(tripInquiryId);
    };
    // joinInquiry/leaveInquiry omitted deliberately: useRideSocket() returns a
    // new function identity every render (it reads live module state, not a
    // stale closure), so including them would tear down/rejoin the room on
    // every render instead of only when visible/isReady/tripInquiryId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isReady, tripInquiryId]);

  // --- incoming chat messages -------------------------------------------------
  useEffect(() => {
    if (!visible) return;
    const unsubscribe = onChatMessage((payload) => {
      // The underlying socket connection is a shared singleton (see
      // socket.ts) — this listener fires for EVERY inquiry's chat.message
      // event app-wide, so every incoming message must be filtered to THIS
      // sheet's own thread before being touched, mirroring the tripId-filter
      // already used by the rider's location-update subscription in
      // trip-request/[id].tsx.
      if (payload.tripInquiryId !== tripInquiryId) return;
      setMessages((prev) => upsertMessage(prev, payload));
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tripInquiryId]);

  // --- typing indicator ---------------------------------------------------------
  useEffect(() => {
    if (!visible) return;
    const unsubscribe = onTyping((payload) => {
      if (payload.tripInquiryId !== tripInquiryId || payload.userId === currentUserId) return;
      setOtherTyping(true);
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
      typingClearTimerRef.current = setTimeout(() => setOtherTyping(false), TYPING_INDICATOR_TIMEOUT_MS);
    });
    return () => {
      unsubscribe();
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
      typingClearTimerRef.current = null;
      setOtherTyping(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tripInquiryId, currentUserId]);

  // --- read receipts for my own sent messages ------------------------------------
  useEffect(() => {
    if (!visible) return;
    const unsubscribe = onReadReceipt((payload: ChatReadPayload) => {
      if (payload.tripInquiryId !== tripInquiryId) return;
      setMessages((prev) => {
        const reference = prev.find((m) => m.id === payload.lastReadMessageId);
        const cutoff = reference ? reference.createdAt : null;
        return prev.map((m) =>
          m.senderId === currentUserId && !m.readAt && (cutoff === null || m.createdAt <= cutoff)
            ? { ...m, readAt: new Date().toISOString() }
            : m,
        );
      });
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tripInquiryId, currentUserId]);

  // --- mark-as-read: whenever the latest message is a NEW one from the other party ---
  useEffect(() => {
    if (!visible || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.senderId === currentUserId) return;
    if (lastMarkedReadIdRef.current === last.id) return;
    lastMarkedReadIdRef.current = last.id;
    markRead(tripInquiryId, last.id);
    // markRead omitted deliberately — same reasoning as joinInquiry/leaveInquiry above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, messages, currentUserId, tripInquiryId]);

  const handleChangeDraft = (text: string) => {
    setDraft(text);
    const now = Date.now();
    if (text.trim().length > 0 && now - lastTypingSentAtRef.current > TYPING_THROTTLE_MS) {
      lastTypingSentAtRef.current = now;
      sendTyping(tripInquiryId);
    }
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !currentUserId) return;
    setSendError(null);
    setDraft('');

    // Client-generated id doubles as the reconciliation key: the optimistic
    // entry below and the server-confirmed one from the ack share this same
    // id, so "reconcile on ack" is just an in-place replace, not an id-swap.
    const id = Crypto.randomUUID();
    const optimisticMessage: LocalChatMessage = {
      id,
      tripInquiryId,
      senderId: currentUserId,
      body,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      pending: true,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    const result = await sendMessage({ id, tripInquiryId, body });
    if (result.ok && result.message) {
      const confirmed = result.message;
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...confirmed } : m)));
    } else {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pending: false, failed: true } : m)));
      setSendError(result.error ?? 'Message failed to send.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              height: '82%',
              padding: spacing.lg,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: spacing.xs,
              }}
            >
              <AppText variant="subtitle" numberOfLines={1} style={{ flex: 1, marginRight: spacing.md }}>
                {otherPartyName}
              </AppText>
              <AppButton title="Close" variant="ghost" fullWidth={false} onPress={onClose} />
            </View>

            <View style={{ minHeight: 16, marginBottom: spacing.xs }}>
              {otherTyping ? (
                <AppText muted variant="caption">
                  {otherPartyName} is typing…
                </AppText>
              ) : null}
            </View>

            <View style={{ flex: 1 }}>
              {loading ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : loadError ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <AppText color={colors.danger}>{loadError}</AppText>
                </View>
              ) : messages.length === 0 ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <AppText muted variant="caption">
                    No messages yet — say hello.
                  </AppText>
                </View>
              ) : (
                <FlatList
                  ref={listRef}
                  data={messages}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ paddingVertical: spacing.sm }}
                  onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                  renderItem={({ item }) => <ChatBubble message={item} isOwn={item.senderId === currentUserId} />}
                />
              )}
            </View>

            {sendError ? (
              <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.xs }}>
                {sendError}
              </AppText>
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <AppInput
                  placeholder="Message…"
                  value={draft}
                  onChangeText={handleChangeDraft}
                  multiline
                  style={{ maxHeight: 100 }}
                />
              </View>
              <View style={{ width: 88, marginBottom: spacing.md }}>
                <AppButton title="Send" onPress={handleSend} disabled={!draft.trim()} />
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ChatBubble({ message, isOwn }: { message: LocalChatMessage; isOwn: boolean }) {
  const { colors, spacing, radii } = useTheme();
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const statusLabel = !isOwn
    ? null
    : message.failed
      ? 'Failed to send'
      : message.pending
        ? 'Sending…'
        : message.readAt
          ? 'Read'
          : message.deliveredAt
            ? 'Delivered'
            : 'Sent';

  return (
    <View style={{ alignItems: isOwn ? 'flex-end' : 'flex-start', marginBottom: spacing.sm }}>
      <View
        style={{
          maxWidth: '80%',
          backgroundColor: isOwn ? colors.primary : colors.surfaceAlt,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          opacity: message.pending ? 0.6 : 1,
        }}
      >
        <AppText variant="body" color={isOwn ? colors.primaryText : colors.text}>
          {message.body}
        </AppText>
      </View>
      <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
        {time}
        {statusLabel ? ` · ${statusLabel}` : ''}
      </AppText>
    </View>
  );
}
