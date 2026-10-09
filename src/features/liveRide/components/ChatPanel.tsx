import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import * as Crypto from 'expo-crypto';

import { AppButton, AppInput, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useAuth } from '../../../auth/auth-context';
import { tripInquiriesApi, type ChatMessage } from '../../../api/trip-inquiries.api';
import { normalizeApiError } from '../../../api/errors';
import { useAppInForeground } from '../../../hooks/useAppInForeground';
import { useRideSocket, type ChatReadPayload } from '../socket';
import { fetchChatHistory, mergeChatMessages, newestServerCreatedAt } from '../chatHistory';

interface ChatPanelProps {
  active: boolean;
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

type ThreadLoad = { ok: true; messages: ChatMessage[] | null } | { ok: false; error: unknown };

// The thread's history (from `after` on), following the server's cursor —
// see fetchChatHistory. Resolves with the failure instead of rejecting, so
// the effects below need no try block (the React Compiler won't compile a
// component whose code has one with conditionals inside it).
function loadThread(tripInquiryId: string, options: { after?: string; isCancelled: () => boolean }): Promise<ThreadLoad> {
  return fetchChatHistory((cursor) => tripInquiriesApi.getMessages(tripInquiryId, cursor), options).then(
    (messages): ThreadLoad => ({ ok: true, messages }),
    (error: unknown): ThreadLoad => ({ ok: false, error }),
  );
}

// The newest message the other party sent — what a read receipt points at
// (it covers everything before it too). Messages are kept in createdAt order.
function newestFromOtherParty(list: LocalChatMessage[], currentUserId: string | undefined): LocalChatMessage | null {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].senderId !== currentUserId) return list[i];
  }
  return null;
}

/**
 * One rider↔driver chat thread, scoped to a single TripInquiry — meant to be
 * embedded as a tab's content (flex:1) inside the driver's my-trips screen and
 * the rider's trip-request screen, rather than presented as a modal. Both
 * screens mount exactly one of these at a time per open trip, driven by a
 * single "which tab is active" piece of state — `active` mirrors what used to
 * be this component's `visible` prop (see ChatSheet, its since-removed
 * modal-based predecessor) but now just means "this tab is the selected one",
 * not "a modal is open".
 */
export function ChatPanel({ active, tripInquiryId, otherPartyName }: ChatPanelProps) {
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

  const inForeground = useAppInForeground();

  const lastMarkedReadIdRef = useRef<string | null>(null);
  const lastTypingSentAtRef = useRef(0);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<LocalChatMessage>>(null);
  // The current open's full history load — a catch-up waits for it, so the
  // two can't race each other. Settles, never rejects.
  const historyLoadRef = useRef<Promise<void> | null>(null);
  // The thread as last rendered, for a catch-up to resume from after an await.
  const messagesRef = useRef<LocalChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  });

  // --- full history, reloaded every time this panel becomes active -----------
  // Follows the server's cursor to the end: it pages oldest-first, so one
  // page alone would be a long thread's FIRST 50 messages, not its newest.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    lastMarkedReadIdRef.current = null;

    // Wrapped in an async IIFE (rather than setState calls directly in the
    // effect body) — same convention this app already uses for its other
    // fetch-on-mount effects (e.g. the driver/rider screens' location-watch
    // setup) — a bare synchronous setState at the top of an effect body
    // triggers this project's react-hooks/set-state-in-effect lint rule.
    historyLoadRef.current = (async () => {
      setMessages([]);
      setLoadError(null);
      setSendError(null);
      setLoading(true);
      const outcome = await loadThread(tripInquiryId, { isCancelled: () => cancelled });
      if (cancelled) return;
      if (!outcome.ok) {
        setLoadError(normalizeApiError(outcome.error).message);
      } else if (outcome.messages) {
        // Merged, not replaced: anything that arrived over the socket (or
        // was sent from here) while the pages loaded stays.
        const history = outcome.messages;
        setMessages((prev) => mergeChatMessages(prev, history));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      historyLoadRef.current = null;
    };
  }, [active, tripInquiryId]);

  // --- join/leave this inquiry's chat room -----------------------------------
  // Joins once the shared socket is ready (which may not be the case yet on
  // first mount) and the app is in the foreground; leaves as soon as this
  // panel goes inactive/unmounts or the app goes to the background. Being in
  // the room is what tells the server this user is reading the thread — it
  // sends a push only while they aren't, so a backgrounded app must leave or
  // its user would never be notified.
  //
  // While out of the room, new messages reach this device only as pushes,
  // never over the socket — so each (re)join catches up from the server.
  useEffect(() => {
    if (!active || !isReady || !inForeground) return;
    let cancelled = false;

    const catchUp = async () => {
      // After the full load, so a message sent between its last page and
      // this join is still picked up.
      await historyLoadRef.current;
      if (cancelled) return;
      const after = newestServerCreatedAt(messagesRef.current) ?? undefined;
      const outcome = await loadThread(tripInquiryId, { after, isCancelled: () => cancelled });
      if (cancelled) return;
      if (!outcome.ok) {
        console.warn('[ChatPanel] chat catch-up failed:', normalizeApiError(outcome.error).message);
        return;
      }
      const missed = outcome.messages;
      if (!missed) return;
      setMessages((prev) => mergeChatMessages(prev, missed));
      // A full load that had failed counts as recovered once this works.
      setLoadError(null);
    };

    joinInquiry(tripInquiryId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        console.warn('[ChatPanel] joinInquiry failed:', result.error);
        return;
      }
      void catchUp();
    });
    return () => {
      cancelled = true;
      leaveInquiry(tripInquiryId);
    };
  }, [active, isReady, inForeground, tripInquiryId, joinInquiry, leaveInquiry]);

  // --- incoming chat messages -------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const unsubscribe = onChatMessage((payload) => {
      // The underlying socket connection is a shared singleton (see
      // socket.ts) — this listener fires for EVERY inquiry's chat.message
      // event app-wide, so every incoming message must be filtered to THIS
      // panel's own thread before being touched, mirroring the tripId-filter
      // already used by the rider's location-update subscription in
      // trip-request/[id].tsx.
      if (payload.tripInquiryId !== tripInquiryId) return;
      setMessages((prev) => mergeChatMessages(prev, [payload]));
    });
    return unsubscribe;
  }, [active, tripInquiryId, onChatMessage]);

  // --- typing indicator ---------------------------------------------------------
  useEffect(() => {
    if (!active) return;
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
  }, [active, tripInquiryId, currentUserId, onTyping]);

  // --- read receipts for my own sent messages ------------------------------------
  useEffect(() => {
    if (!active) return;
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
  }, [active, tripInquiryId, currentUserId, onReadReceipt]);

  // --- mark-as-read: the newest message from the other party, once seen ------
  // Only while it can reach the server (socket ready — chat.read isn't held
  // back while it isn't) and the app is in the foreground (the user is
  // looking), so a message that arrived meanwhile is marked as soon as both
  // are true again.
  useEffect(() => {
    if (!active || !isReady || !inForeground) return;
    const lastFromOther = newestFromOtherParty(messages, currentUserId);
    if (!lastFromOther || lastMarkedReadIdRef.current === lastFromOther.id) return;
    lastMarkedReadIdRef.current = lastFromOther.id;
    markRead(tripInquiryId, lastFromOther.id);
  }, [active, isReady, inForeground, messages, currentUserId, tripInquiryId, markRead]);

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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <View style={{ marginBottom: spacing.xs }}>
          <AppText variant="subtitle" numberOfLines={1}>
            {otherPartyName}
          </AppText>
          <View style={{ minHeight: 16, marginTop: spacing.xs }}>
            {otherTyping ? (
              <AppText muted variant="caption">
                {otherPartyName} is typing…
              </AppText>
            ) : null}
          </View>
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
    </KeyboardAvoidingView>
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
