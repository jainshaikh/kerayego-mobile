import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { getAccessToken, refreshAccessToken } from '../../api/client';
import type { ChatMessage } from '../../api/trip-inquiries.api';
import { API_BASE_URL } from '../../constants/config';

// Fire-and-forget acknowledgement shape the gateway returns for every
// `@SubscribeMessage` handler (see ride-realtime.gateway.ts).
export interface AckResult {
  ok: boolean;
  error?: string;
}

export interface LocationUpdatePayload {
  tripId: string;
  lat: number;
  lng: number;
  headingDeg?: number;
  speedKmh?: number;
  accuracyM?: number;
  isMockLocation?: boolean;
  ts: number;
}

// `id` is client-generated (expo-crypto's Crypto.randomUUID(), same
// convention as RecordTripEventPayload.id) — the server upserts by this id,
// so resending the same id after a dropped connection is a safe no-op
// re-affirmation rather than a duplicate message.
export interface SendMessagePayload {
  id: string;
  tripInquiryId: string;
  body: string;
}

export interface SendMessageResult {
  ok: boolean;
  error?: string;
  message?: ChatMessage;
}

export interface ChatTypingPayload {
  tripInquiryId: string;
  userId: string;
}

export interface ChatReadPayload {
  tripInquiryId: string;
  readerId: string;
  lastReadMessageId: string;
}

interface ServerToClientEvents {
  ready: () => void;
  'location.update': (payload: LocationUpdatePayload) => void;
  'chat.message': (payload: ChatMessage) => void;
  'chat.typing': (payload: ChatTypingPayload) => void;
  'chat.read': (payload: ChatReadPayload) => void;
}

interface ClientToServerEvents {
  'trip.join': (dto: { tripId: string }, ack: (result: AckResult) => void) => void;
  'trip.leave': (dto: { tripId: string }, ack: (result: { ok: boolean }) => void) => void;
  'location.update': (payload: LocationUpdatePayload, ack?: (result: AckResult) => void) => void;
  'inquiry.join': (dto: { tripInquiryId: string }, ack: (result: AckResult) => void) => void;
  'inquiry.leave': (dto: { tripInquiryId: string }, ack: (result: { ok: boolean }) => void) => void;
  'chat.message': (payload: SendMessagePayload, ack: (result: SendMessageResult) => void) => void;
  'chat.typing': (dto: { tripInquiryId: string }) => void;
  'chat.read': (dto: { tripInquiryId: string; lastReadMessageId: string }) => void;
}

type RideSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// How long an emitted 'trip.join'/'trip.leave' waits for the server's ack
// before giving up — protects a caller from hanging forever if the
// connection drops between the emit and the ack (e.g. mid-flight disconnect).
const ACK_TIMEOUT_MS = 8000;

// --- module-level singleton state ---------------------------------------
// One shared connection for the app's lifetime, mirroring the
// activeAutocomplete.ts module-level pub-sub pattern used elsewhere in this
// app: lazily created on first use, reused across every consumer of
// useRideSocket() rather than a socket per screen/hook-instance.
let socket: RideSocket | null = null;
let isConnected = false;
let isReady = false;

type StateListener = () => void;
const stateListeners = new Set<StateListener>();

function notifyStateListeners(): void {
  stateListeners.forEach((fn) => fn());
}

// API_BASE_URL includes a "/v1" REST path suffix (e.g. ".../v1"); the
// Socket.IO gateway's namespace lives at the bare server origin, not under
// /v1, so that suffix must be stripped before appending "/ride".
function getSocketOrigin(): string {
  return API_BASE_URL.replace(/\/v1\/?$/, '');
}

function getSocket(): RideSocket {
  if (socket) return socket;

  // `io()` itself always returns the untyped `Socket` (DefaultEventsMap) —
  // the cast below is what actually pins this connection to our event maps.
  const instance = io(`${getSocketOrigin()}/ride`, {
    transports: ['websocket'],
    // `reconnection` stays at its default (true, with Socket.IO's default
    // backoff) — a long-lived ride session needs automatic reconnection,
    // unlike a one-off test script.
    //
    // Passing `auth` as a FUNCTION (not a plain object) means Socket.IO
    // re-invokes it on every (re)connection attempt, so a reconnect after a
    // token refresh automatically picks up the fresh token without us having
    // to manually recreate the socket.
    auth: (cb) => cb({ token: getAccessToken() }),
  }) as RideSocket;

  instance.on('connect', () => {
    isConnected = true;
    notifyStateListeners();
  });

  instance.on('disconnect', () => {
    isConnected = false;
    // A fresh connection needs its own fresh 'ready' — the server only emits
    // it once per successful handshake.
    isReady = false;
    notifyStateListeners();
  });

  instance.on('ready', () => {
    isReady = true;
    notifyStateListeners();
  });

  instance.on('connect_error', () => {
    // Best-effort: by the time Socket.IO's own reconnection timer fires the
    // next attempt, maximize the odds the new handshake's auth succeeds by
    // refreshing the token now. This is NOT a manual retry loop — we never
    // call `instance.connect()` ourselves; Socket.IO's built-in reconnection
    // continues to drive attempts, we're just improving what token is
    // available by the time it does.
    refreshAccessToken().catch(() => {
      // Swallow — if refresh fails, the next reconnection attempt will just
      // fail again and surface as another connect_error, which is fine.
    });
  });

  socket = instance;
  return instance;
}

function withAckTimeout<T extends { ok: boolean; error?: string }>(
  executor: (resolve: (value: T) => void) => void,
  timeoutResult: T,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(timeoutResult);
    }, ACK_TIMEOUT_MS);

    executor((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/**
 * Shared live-ride socket connection to the backend's `/ride` namespace.
 *
 * The underlying Socket.IO connection is a module-level singleton reused
 * across every component that calls this hook — it is NOT torn down when an
 * individual consumer unmounts, since other screens may still need it for
 * the lifetime of the app. Only the React-state listener this hook itself
 * registers is cleaned up on unmount.
 */
export function useRideSocket() {
  // Ensures the socket exists synchronously the first time this hook runs,
  // so joinTrip/leaveTrip/emitLocation are usable immediately rather than
  // waiting for an effect to fire.
  getSocket();

  const [, setTick] = useState(0);

  useEffect(() => {
    // `isConnected`/`isReady` are read live from module scope on every
    // render (not captured in a stale closure), so this render already saw
    // their current values — this subscription only needs to trigger a
    // re-render for changes that happen *after* mount.
    const listener: StateListener = () => setTick((n) => n + 1);
    stateListeners.add(listener);
    return () => {
      stateListeners.delete(listener);
    };
  }, []);

  const joinTrip = (tripId: string): Promise<AckResult> => {
    if (!isReady) return Promise.resolve({ ok: false, error: 'not ready' });
    const activeSocket = getSocket();
    return withAckTimeout<AckResult>(
      (resolve) => activeSocket.emit('trip.join', { tripId }, resolve),
      { ok: false, error: 'timeout' },
    );
  };

  const leaveTrip = (tripId: string): Promise<{ ok: boolean }> => {
    if (!isReady) return Promise.resolve({ ok: false });
    const activeSocket = getSocket();
    return withAckTimeout<{ ok: boolean }>(
      (resolve) => activeSocket.emit('trip.leave', { tripId }, resolve),
      { ok: false },
    );
  };

  const emitLocation = (payload: LocationUpdatePayload): void => {
    // Fire-and-forget: only meaningful for the trip's driver, but nothing
    // stops a non-driver from calling it client-side — the server already
    // rejects it if the caller isn't the trip's driver (or the trip isn't
    // IN_PROGRESS), so there's no need to duplicate that check here. Just
    // log if the ack comes back negative.
    getSocket().emit('location.update', payload, (result) => {
      if (!result?.ok) {
        console.warn('[useRideSocket] location.update rejected:', result?.error);
      }
    });
  };

  const onLocationUpdate = (callback: (payload: LocationUpdatePayload) => void): (() => void) => {
    const activeSocket = getSocket();
    activeSocket.on('location.update', callback);
    return () => {
      activeSocket.off('location.update', callback);
    };
  };

  // --- chat -----------------------------------------------------------
  // joinInquiry/leaveInquiry mirror joinTrip/leaveTrip exactly (same
  // not-ready-yet guard, same ack-timeout wrapper) — just a different room,
  // scoped to one TripInquiry's chat thread instead of a whole trip.

  const joinInquiry = (tripInquiryId: string): Promise<AckResult> => {
    if (!isReady) return Promise.resolve({ ok: false, error: 'not ready' });
    const activeSocket = getSocket();
    return withAckTimeout<AckResult>(
      (resolve) => activeSocket.emit('inquiry.join', { tripInquiryId }, resolve),
      { ok: false, error: 'timeout' },
    );
  };

  const leaveInquiry = (tripInquiryId: string): Promise<{ ok: boolean }> => {
    if (!isReady) return Promise.resolve({ ok: false });
    const activeSocket = getSocket();
    return withAckTimeout<{ ok: boolean }>(
      (resolve) => activeSocket.emit('inquiry.leave', { tripInquiryId }, resolve),
      { ok: false },
    );
  };

  // Unlike emitLocation, the ack here is NOT swallowed — the caller (ChatPanel)
  // needs the real result to reconcile its optimistic local message (replace
  // the optimistic entry with the server-confirmed one, or surface a failure).
  const sendMessage = (payload: SendMessagePayload): Promise<SendMessageResult> => {
    if (!isReady) return Promise.resolve({ ok: false, error: 'not ready' });
    const activeSocket = getSocket();
    return withAckTimeout<SendMessageResult>(
      (resolve) => activeSocket.emit('chat.message', payload, resolve),
      { ok: false, error: 'timeout' },
    );
  };

  // Fire-and-forget, same convention as emitLocation — no ack callback is
  // passed, and nothing here needs to react to the server's {ok,error} return.
  const sendTyping = (tripInquiryId: string): void => {
    getSocket().emit('chat.typing', { tripInquiryId });
  };

  const markRead = (tripInquiryId: string, lastReadMessageId: string): void => {
    getSocket().emit('chat.read', { tripInquiryId, lastReadMessageId });
  };

  const onChatMessage = (callback: (payload: ChatMessage) => void): (() => void) => {
    const activeSocket = getSocket();
    activeSocket.on('chat.message', callback);
    return () => {
      activeSocket.off('chat.message', callback);
    };
  };

  const onTyping = (callback: (payload: ChatTypingPayload) => void): (() => void) => {
    const activeSocket = getSocket();
    activeSocket.on('chat.typing', callback);
    return () => {
      activeSocket.off('chat.typing', callback);
    };
  };

  const onReadReceipt = (callback: (payload: ChatReadPayload) => void): (() => void) => {
    const activeSocket = getSocket();
    activeSocket.on('chat.read', callback);
    return () => {
      activeSocket.off('chat.read', callback);
    };
  };

  return {
    isConnected,
    isReady,
    joinTrip,
    leaveTrip,
    emitLocation,
    onLocationUpdate,
    joinInquiry,
    leaveInquiry,
    sendMessage,
    sendTyping,
    markRead,
    onChatMessage,
    onTyping,
    onReadReceipt,
  };
}
