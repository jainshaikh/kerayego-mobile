import { useEffect, useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';
import { io, type Socket } from 'socket.io-client';

import { getAccessToken, refreshAccessToken } from '../../api/client';
import type { ChatMessage } from '../../api/trip-inquiries.api';
import { API_BASE_URL } from '../../constants/config';
import { isLocationEmitDue } from './locationEmit';
import { computeReconnectDelayMs } from './reconnectBackoff';

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

export interface RideSocketState {
  isConnected: boolean;
  isReady: boolean;
}

// How long an emitted 'trip.join'/'trip.leave' waits for the server's ack
// before giving up — protects a caller from hanging forever if the
// connection drops between the emit and the ack (e.g. mid-flight disconnect).
const ACK_TIMEOUT_MS = 8000;

// --- module-level singleton state ---------------------------------------
// One shared connection per signed-in session, mirroring the
// activeAutocomplete.ts module-level pub-sub pattern used elsewhere in this
// app: lazily created on first use and reused across every consumer of
// useRideSocket() rather than a socket per screen/hook-instance. The server
// binds a connection to the user whose token it presented at the handshake,
// so AuthProvider.clearSession tears it down (disconnectRideSocket) on logout
// AND on session expiry — the next account on this device gets a fresh one.
let socket: RideSocket | null = null;

const DISCONNECTED: RideSocketState = { isConnected: false, isReady: false };

// Immutable snapshot read through useSyncExternalStore — replaced, never
// mutated, so React (and the React Compiler's memoization of every consumer)
// sees each change. `isReady` is the server's own 'ready' (handshake auth
// done), which arrives after the transport-level `isConnected`.
let state: RideSocketState = DISCONNECTED;

const stateListeners = new Set<() => void>();

function setState(next: Partial<RideSocketState>): void {
  const merged = { ...state, ...next };
  if (merged.isConnected === state.isConnected && merged.isReady === state.isReady) return;
  state = merged;
  stateListeners.forEach((fn) => fn());
}

function subscribeState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function getRideSocketState(): RideSocketState {
  return state;
}

// App-level handlers for server events, kept outside the Socket.IO instance:
// each instance just relays into these, so a subscription made by a mounted
// component survives the instance being replaced (session teardown, then a
// fresh connection) instead of silently staying attached to a dead one.
// Their owners remove them on unmount.
const locationHandlers = new Set<(payload: LocationUpdatePayload) => void>();
const chatMessageHandlers = new Set<(payload: ChatMessage) => void>();
const typingHandlers = new Set<(payload: ChatTypingPayload) => void>();
const readReceiptHandlers = new Set<(payload: ChatReadPayload) => void>();

function subscribeHandler<T>(handlers: Set<(payload: T) => void>, handler: (payload: T) => void): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

// --- reconnect after a server-side close -----------------------------------
// Socket.IO reconnects by itself after a network drop, but never after the
// server closes the connection ('io server disconnect') — which is exactly
// what the gateway does when the handshake's access token fails verification
// (it lives 15 min and is otherwise only refreshed by a REST 401). This loop
// covers that case: get a valid token through the shared single-flight
// refresher (api/client.ts), then connect() again, with capped backoff
// (reconnectBackoff.ts). It stops once there is no session left.
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectInFlightFor: RideSocket | null = null;
let reconnectAttempt = 0;
// The access token the latest handshake presented. If it has been replaced
// since (the REST interceptor refreshed meanwhile), a retry can use the
// current token as-is instead of rotating the refresh token again.
let handshakeToken: string | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

// The last location.update actually emitted — the per-trip emit throttle.
let lastLocationEmit: { tripId: string; ts: number } | null = null;

// API_BASE_URL includes a "/v1" REST path suffix (e.g. ".../v1"); the
// Socket.IO gateway's namespace lives at the bare server origin, not under
// /v1, so that suffix must be stripped before appending "/ride".
function getSocketOrigin(): string {
  return API_BASE_URL.replace(/\/v1\/?$/, '');
}

function createSocket(): RideSocket {
  // `io()` itself always returns the untyped `Socket` (DefaultEventsMap) —
  // the cast below is what actually pins this connection to our event maps.
  const instance = io(`${getSocketOrigin()}/ride`, {
    transports: ['websocket'],
    // `reconnection` stays at its default (true, with Socket.IO's default
    // backoff) for network drops. Connecting is explicit (connectIfSignedIn),
    // so an instance created without an access token — e.g. by a screen
    // re-rendering just after logout — never handshakes as nobody.
    autoConnect: false,
    // A Manager of its own, so an instance torn down at logout can't hand
    // its connection state to the next session's.
    forceNew: true,
    // Passing `auth` as a FUNCTION (not a plain object) means Socket.IO
    // re-invokes it on every (re)connection attempt, so a reconnect after a
    // token refresh automatically picks up the fresh token without us having
    // to manually recreate the socket.
    auth: (cb) => {
      handshakeToken = getAccessToken();
      cb({ token: handshakeToken });
    },
  }) as RideSocket;

  instance.on('connect', () => {
    setState({ isConnected: true });
  });

  instance.on('ready', () => {
    reconnectAttempt = 0;
    setState({ isReady: true });
  });

  instance.on('disconnect', () => {
    // A fresh connection needs its own fresh 'ready' — the server only emits
    // it once per successful handshake.
    setState({ isConnected: false, isReady: false });
    // `active` is false only when Socket.IO will NOT retry by itself: the
    // server closed the connection (e.g. a rejected handshake).
    if (!instance.active) scheduleReconnect(instance);
  });

  instance.on('connect_error', () => {
    // While `active`, Socket.IO's own backoff is retrying a network-level
    // failure — the token was never even looked at, so there is nothing to
    // refresh. Inactive means the server refused the namespace connection
    // itself: same recovery as a server-side close.
    if (!instance.active) scheduleReconnect(instance);
  });

  instance.on('location.update', (payload) => locationHandlers.forEach((fn) => fn(payload)));
  instance.on('chat.message', (payload) => chatMessageHandlers.forEach((fn) => fn(payload)));
  instance.on('chat.typing', (payload) => typingHandlers.forEach((fn) => fn(payload)));
  instance.on('chat.read', (payload) => readReceiptHandlers.forEach((fn) => fn(payload)));

  // Back in the foreground: don't sit out a backoff delay that may have grown
  // to 30 s while the app was in the background.
  appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active' && socket === instance) resumeConnection(instance);
  });

  return instance;
}

function getSocket(): RideSocket {
  if (!socket) socket = createSocket();
  return socket;
}

// Starts (or restarts) the connection when nothing else is driving it: not
// connected, Socket.IO isn't retrying by itself (`active`), and no
// server-close reconnect is pending. Never without an access token — there is
// no session to authenticate as.
function connectIfSignedIn(instance: RideSocket): void {
  if (instance.connected || instance.active) return;
  if (reconnectTimer !== null || reconnectInFlightFor === instance) return;
  if (!getAccessToken()) return;
  reconnectAttempt = 0;
  instance.connect();
}

function resumeConnection(instance: RideSocket): void {
  if (reconnectTimer === null) {
    connectIfSignedIn(instance);
    return;
  }
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
  void reconnectAfterServerClose(instance);
}

function scheduleReconnect(instance: RideSocket): void {
  if (instance !== socket || reconnectTimer !== null || reconnectInFlightFor === instance) return;
  const delay = computeReconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void reconnectAfterServerClose(instance);
  }, delay);
}

async function reconnectAfterServerClose(instance: RideSocket): Promise<void> {
  if (instance !== socket || instance.active) return;

  reconnectInFlightFor = instance;
  let token: string | null;
  try {
    const current = getAccessToken();
    token = current !== null && current !== handshakeToken ? current : await refreshAccessToken();
  } catch {
    // Transient refresh failure (offline, 5xx, 429) — the session is intact;
    // back off and try again.
    if (reconnectInFlightFor === instance) reconnectInFlightFor = null;
    scheduleReconnect(instance);
    return;
  }
  if (reconnectInFlightFor === instance) reconnectInFlightFor = null;

  // Torn down (logout/expiry) while the refresh was in flight, or already
  // reconnecting by some other path.
  if (instance !== socket || instance.active) return;
  // No session left: give up. (A rejected refresh has already expired the
  // session, and AuthProvider's clearSession tears this socket down.)
  if (!token) return;
  instance.connect();
}

/**
 * Fully tears down the shared ride socket: removes the instance's listeners,
 * closes the connection (the server drops the identity it bound at the
 * handshake), cancels any pending reconnect and resets the connection state
 * and the location-emit throttle. Called by AuthProvider.clearSession on
 * logout and on session expiry; the next account's first live screen builds a
 * fresh instance authenticated as that account.
 *
 * Subscriptions made through onLocationUpdate/onChatMessage/onTyping/
 * onReadReceipt belong to their components and are removed by them on
 * unmount — they are relayed from whichever instance is current. Room
 * membership is consumer-driven too (useTripRoomPresence/ChatPanel join on
 * `isReady` and leave in their cleanup), so this module keeps no room list.
 */
export function disconnectRideSocket(): void {
  const instance = socket;
  socket = null;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectInFlightFor = null;
  reconnectAttempt = 0;
  handshakeToken = null;
  lastLocationEmit = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  if (instance) {
    instance.removeAllListeners();
    instance.disconnect();
  }
  setState(DISCONNECTED);
}

/** Creates the shared socket if needed and connects it when signed in — what every useRideSocket() consumer does on mount. */
export function connectRideSocket(): void {
  connectIfSignedIn(getSocket());
}

// The instance, only while the server has authenticated it ('ready'). Every
// emit is gated on this: Socket.IO would otherwise buffer it and replay it on
// (re)connect — stale, possibly before the server has authenticated the
// connection, or on an instance the next account connects.
function readySocket(): RideSocket | null {
  return state.isReady ? socket : null;
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

function joinTrip(tripId: string): Promise<AckResult> {
  const activeSocket = readySocket();
  if (!activeSocket) return Promise.resolve({ ok: false, error: 'not ready' });
  return withAckTimeout<AckResult>(
    (resolve) => activeSocket.emit('trip.join', { tripId }, resolve),
    { ok: false, error: 'timeout' },
  );
}

function leaveTrip(tripId: string): Promise<{ ok: boolean }> {
  const activeSocket = readySocket();
  if (!activeSocket) return Promise.resolve({ ok: false });
  return withAckTimeout<{ ok: boolean }>(
    (resolve) => activeSocket.emit('trip.leave', { tripId }, resolve),
    { ok: false },
  );
}

/**
 * Sends one driver GPS fix to the trip room. Only meaningful for the trip's
 * driver, but the server already rejects anyone else (and any trip that isn't
 * IN_PROGRESS), so that isn't re-checked here. A fix is dropped, never
 * queued, while the socket isn't ready, and when it comes less than ~4 s (by
 * fix time) after the last one emitted for the same trip (locationEmit.ts) —
 * the caller's geofence/UI still uses every fix.
 */
function emitLocation(payload: LocationUpdatePayload): void {
  const activeSocket = readySocket();
  if (!activeSocket) return;

  const lastTs = lastLocationEmit?.tripId === payload.tripId ? lastLocationEmit.ts : null;
  if (!isLocationEmitDue(lastTs, payload.ts)) return;
  lastLocationEmit = { tripId: payload.tripId, ts: payload.ts };

  // volatile: if the transport can't take it right now, drop it instead of
  // buffering it for a stale replay — the next fix supersedes it anyway.
  activeSocket.volatile.emit('location.update', payload, (result) => {
    if (!result?.ok) {
      console.warn('[useRideSocket] location.update rejected:', result?.error);
    }
  });
}

function onLocationUpdate(callback: (payload: LocationUpdatePayload) => void): () => void {
  return subscribeHandler(locationHandlers, callback);
}

// --- chat -----------------------------------------------------------
// joinInquiry/leaveInquiry mirror joinTrip/leaveTrip exactly (same
// not-ready-yet guard, same ack-timeout wrapper) — just a different room,
// scoped to one TripInquiry's chat thread instead of a whole trip.

function joinInquiry(tripInquiryId: string): Promise<AckResult> {
  const activeSocket = readySocket();
  if (!activeSocket) return Promise.resolve({ ok: false, error: 'not ready' });
  return withAckTimeout<AckResult>(
    (resolve) => activeSocket.emit('inquiry.join', { tripInquiryId }, resolve),
    { ok: false, error: 'timeout' },
  );
}

function leaveInquiry(tripInquiryId: string): Promise<{ ok: boolean }> {
  const activeSocket = readySocket();
  if (!activeSocket) return Promise.resolve({ ok: false });
  return withAckTimeout<{ ok: boolean }>(
    (resolve) => activeSocket.emit('inquiry.leave', { tripInquiryId }, resolve),
    { ok: false },
  );
}

// Unlike emitLocation, the ack here is NOT swallowed — the caller (ChatPanel)
// needs the real result to reconcile its optimistic local message (replace
// the optimistic entry with the server-confirmed one, or surface a failure).
function sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
  const activeSocket = readySocket();
  if (!activeSocket) return Promise.resolve({ ok: false, error: 'not ready' });
  return withAckTimeout<SendMessageResult>(
    (resolve) => activeSocket.emit('chat.message', payload, resolve),
    { ok: false, error: 'timeout' },
  );
}

// Fire-and-forget, same convention as emitLocation — no ack callback is
// passed, and nothing here needs to react to the server's {ok,error} return.
// A typing ping is only worth anything live, so it's volatile too.
function sendTyping(tripInquiryId: string): void {
  readySocket()?.volatile.emit('chat.typing', { tripInquiryId });
}

function markRead(tripInquiryId: string, lastReadMessageId: string): void {
  readySocket()?.emit('chat.read', { tripInquiryId, lastReadMessageId });
}

function onChatMessage(callback: (payload: ChatMessage) => void): () => void {
  return subscribeHandler(chatMessageHandlers, callback);
}

function onTyping(callback: (payload: ChatTypingPayload) => void): () => void {
  return subscribeHandler(typingHandlers, callback);
}

function onReadReceipt(callback: (payload: ChatReadPayload) => void): () => void {
  return subscribeHandler(readReceiptHandlers, callback);
}

// Everything a consumer can do over the shared socket. Module-level, so the
// identities are stable across renders (and usable outside React); components
// get them through useRideSocket().
export const rideSocketActions = {
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

/**
 * Shared live-ride socket connection to the backend's `/ride` namespace.
 *
 * The underlying Socket.IO connection is a module-level singleton reused
 * across every component that calls this hook — it is NOT torn down when an
 * individual consumer unmounts, since other screens may still need it; only
 * the end of the session does that (disconnectRideSocket).
 */
export function useRideSocket() {
  const { isConnected, isReady } = useSyncExternalStore(subscribeState, getRideSocketState, getRideSocketState);

  useEffect(() => {
    connectRideSocket();
  }, []);

  return { isConnected, isReady, ...rideSocketActions };
}
