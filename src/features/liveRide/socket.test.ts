import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { io } from 'socket.io-client';

import { getAccessToken, refreshAccessToken } from '../../api/client';
import {
  connectRideSocket,
  disconnectRideSocket,
  getRideSocketState,
  rideSocketActions,
  type LocationUpdatePayload,
} from './socket';

// ─── Fakes ───────────────────────────────────────────────────────────────────
// A stand-in for socket.io-client's Socket that records what the module does
// to it and lets a test play the server's side (accept / reject a handshake,
// drop the network). `active` mirrors the real flag: true while Socket.IO
// itself would keep retrying, false after a server-side close.

type Listener = (...args: unknown[]) => void;
type AuthFn = (cb: (data: { token: string | null }) => void) => void;

class MockSocket {
  connected = false;
  active = false;
  connectCalls = 0;
  disconnectCalls = 0;
  handshakeTokens: (string | null)[] = [];
  emitted: { event: string; args: unknown[]; volatile: boolean }[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private volatileNext = false;

  constructor(readonly opts: { auth: AuthFn; autoConnect?: boolean; forceNew?: boolean }) {}

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  listenerCount() {
    let n = 0;
    this.listeners.forEach((set) => (n += set.size));
    return n;
  }

  get volatile() {
    this.volatileNext = true;
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args, volatile: this.volatileNext });
    this.volatileNext = false;
    return this;
  }

  connect() {
    this.connectCalls += 1;
    this.active = true;
    return this;
  }

  disconnect() {
    this.disconnectCalls += 1;
    const wasConnected = this.connected;
    this.active = false;
    this.connected = false;
    if (wasConnected) this.fire('disconnect', 'io client disconnect');
    return this;
  }

  // --- the server's side ---
  fire(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }

  private handshake() {
    this.opts.auth((data) => this.handshakeTokens.push(data.token));
  }

  accept() {
    this.handshake();
    this.connected = true;
    this.fire('connect');
    this.fire('ready');
  }

  // What the gateway does on a bad token: accept the transport, then
  // client.disconnect(true) — the client sees 'io server disconnect' and
  // Socket.IO will not retry by itself.
  reject() {
    this.handshake();
    this.connected = true;
    this.fire('connect');
    this.connected = false;
    this.active = false;
    this.fire('disconnect', 'io server disconnect');
  }

  // A server-side middleware refusing the namespace: CONNECT_ERROR, after
  // which Socket.IO (like after a server close) will not retry by itself.
  refuse() {
    this.handshake();
    this.active = false;
    this.fire('connect_error', new Error('unauthorized'));
  }

  // A network-level drop: Socket.IO keeps `active` and retries on its own.
  dropNetwork() {
    this.connected = false;
    this.fire('disconnect', 'transport close');
  }
}

const mockSockets: MockSocket[] = [];
const appStateListeners = new Set<(state: AppStateStatus) => void>();

jest.mock('socket.io-client', () => ({
  io: jest.fn((_url: string, opts: ConstructorParameters<typeof MockSocket>[0]) => {
    const instance = new MockSocket(opts);
    mockSockets.push(instance);
    return instance;
  }),
}));

jest.mock('../../api/client', () => ({
  getAccessToken: jest.fn(),
  refreshAccessToken: jest.fn(),
}));

const token = jest.mocked(getAccessToken);
const refresh = jest.mocked(refreshAccessToken);

const latest = () => mockSockets[mockSockets.length - 1];

function fix(ts: number, tripId = 'trip-1'): LocationUpdatePayload {
  return { tripId, lat: 24.86, lng: 67.0, ts };
}

const T0 = 1_791_453_600_000;

beforeEach(() => {
  jest.useFakeTimers();
  // Top of the jitter band: the reconnect schedule is exactly 1 s, 2 s, 4 s…
  jest.spyOn(Math, 'random').mockReturnValue(1);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListeners.add(fn);
    return { remove: () => appStateListeners.delete(fn) } as unknown as NativeEventSubscription;
  });
  mockSockets.length = 0;
  token.mockReset().mockReturnValue('at-1');
  refresh.mockReset();
});

afterEach(() => {
  disconnectRideSocket();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ─── Connecting ──────────────────────────────────────────────────────────────

describe('connecting', () => {
  it('never handshakes without an access token, and connects once signed in', () => {
    token.mockReturnValue(null);
    connectRideSocket();
    expect(io).toHaveBeenCalledTimes(1);
    expect(latest().opts).toMatchObject({ autoConnect: false, forceNew: true });
    expect(latest().connectCalls).toBe(0);

    token.mockReturnValue('at-1');
    connectRideSocket();
    expect(mockSockets).toHaveLength(1);
    expect(latest().connectCalls).toBe(1);

    // Already connecting: further consumers mounting don't reconnect it.
    connectRideSocket();
    expect(latest().connectCalls).toBe(1);
  });

  it("reports transport connect and the server's 'ready' separately", () => {
    connectRideSocket();
    expect(getRideSocketState()).toEqual({ isConnected: false, isReady: false });

    latest().accept();
    expect(getRideSocketState()).toEqual({ isConnected: true, isReady: true });
    expect(latest().handshakeTokens).toEqual(['at-1']);

    latest().dropNetwork();
    expect(getRideSocketState()).toEqual({ isConnected: false, isReady: false });
  });
});

// ─── Self-healing after a server-side close ──────────────────────────────────

describe('reconnect after the server closes the connection', () => {
  it('refreshes through the shared refresher, then reconnects with the new token', async () => {
    connectRideSocket();
    const socket = latest();
    refresh.mockImplementation(async () => {
      token.mockReturnValue('at-2');
      return 'at-2';
    });

    socket.reject(); // the handshake's at-1 had expired
    expect(getRideSocketState().isReady).toBe(false);
    expect(refresh).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(999);
    expect(refresh).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connectCalls).toBe(2);

    socket.accept();
    expect(socket.handshakeTokens).toEqual(['at-1', 'at-2']);
    expect(getRideSocketState().isReady).toBe(true);
  });

  it('does not rotate the refresh token again when the token already changed since the rejected handshake', async () => {
    connectRideSocket();
    const socket = latest();
    socket.reject();
    token.mockReturnValue('at-2'); // the REST interceptor refreshed meanwhile

    await jest.advanceTimersByTimeAsync(1000);
    expect(refresh).not.toHaveBeenCalled();
    expect(socket.connectCalls).toBe(2);
  });

  it('backs off 1 s, 2 s, 4 s on transient refresh failures, keeping the session', async () => {
    connectRideSocket();
    const socket = latest();
    refresh
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce('at-2');
    socket.reject();

    await jest.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(4000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(socket.connectCalls).toBe(2);
  });

  it("resets the backoff once the server confirms a connection with 'ready'", async () => {
    connectRideSocket();
    const socket = latest();
    refresh.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue('at-2');
    socket.reject();
    await jest.advanceTimersByTimeAsync(1000 + 2000);
    expect(socket.connectCalls).toBe(2);

    socket.accept();
    socket.reject();
    await jest.advanceTimersByTimeAsync(1000);
    expect(socket.connectCalls).toBe(3);
  });

  it('gives up cleanly when there is no session left', async () => {
    connectRideSocket();
    const socket = latest();
    refresh.mockResolvedValue(null);
    socket.reject();

    await jest.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connectCalls).toBe(1);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('treats a namespace connect_error after the server refused it like a server-side close', async () => {
    connectRideSocket();
    const socket = latest();
    refresh.mockResolvedValue('at-2');
    socket.refuse();

    await jest.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connectCalls).toBe(2);
  });

  it("leaves network drops and transport-level connect errors to Socket.IO's own reconnection", async () => {
    connectRideSocket();
    const socket = latest();
    socket.accept();
    socket.dropNetwork();
    socket.fire('connect_error', new Error('websocket error'));

    await jest.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(socket.connectCalls).toBe(1);
  });

  it('retries right away when the app returns to the foreground mid-backoff', async () => {
    connectRideSocket();
    const socket = latest();
    refresh.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue('at-2');
    socket.reject();
    await jest.advanceTimersByTimeAsync(1000); // first retry fails → next one in 2 s
    expect(refresh).toHaveBeenCalledTimes(1);

    appStateListeners.forEach((fn) => fn('active'));
    await jest.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(socket.connectCalls).toBe(2);
  });
});

// ─── Session teardown ────────────────────────────────────────────────────────

describe('disconnectRideSocket', () => {
  it('closes the connection, drops its listeners and resets the state; the next session gets a fresh instance', () => {
    connectRideSocket();
    const first = latest();
    first.accept();

    disconnectRideSocket();
    expect(first.disconnectCalls).toBe(1);
    expect(first.listenerCount()).toBe(0);
    expect(getRideSocketState()).toEqual({ isConnected: false, isReady: false });
    expect(appStateListeners.size).toBe(0);

    token.mockReturnValue('at-other-user');
    connectRideSocket();
    expect(mockSockets).toHaveLength(2);
    latest().accept();
    expect(latest().handshakeTokens).toEqual(['at-other-user']);
  });

  it('cancels a pending reconnect', async () => {
    connectRideSocket();
    const socket = latest();
    refresh.mockResolvedValue('at-2');
    socket.reject();
    expect(jest.getTimerCount()).toBe(1);

    disconnectRideSocket();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(socket.connectCalls).toBe(1);
  });

  it('never reconnects the old instance when the session ends while a refresh is in flight', async () => {
    connectRideSocket();
    const socket = latest();
    let finishRefresh!: (value: string | null) => void;
    refresh.mockReturnValue(new Promise((resolve) => (finishRefresh = resolve)));
    socket.reject();
    await jest.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(1);

    disconnectRideSocket(); // logout / expiry
    finishRefresh('at-2');
    await jest.advanceTimersByTimeAsync(0);
    expect(socket.connectCalls).toBe(1);
  });

  it('keeps component subscriptions working across the instance being replaced', () => {
    const received: LocationUpdatePayload[] = [];
    const unsubscribe = rideSocketActions.onLocationUpdate((payload) => received.push(payload));

    connectRideSocket();
    latest().fire('location.update', fix(T0));
    disconnectRideSocket();
    connectRideSocket();
    latest().fire('location.update', fix(T0 + 5000));
    expect(received.map((p) => p.ts)).toEqual([T0, T0 + 5000]);

    unsubscribe();
    latest().fire('location.update', fix(T0 + 10_000));
    expect(received).toHaveLength(2);
  });
});

// ─── Emits ───────────────────────────────────────────────────────────────────

describe('emits', () => {
  it('drops a location fix while the socket is not ready instead of buffering it for a stale replay', () => {
    connectRideSocket();
    rideSocketActions.emitLocation(fix(T0));
    latest().accept();
    latest().dropNetwork();
    rideSocketActions.emitLocation(fix(T0 + 5000));
    expect(latest().emitted).toEqual([]);
  });

  it('emits location as volatile, at most once per ~4 s of fix time per trip', () => {
    connectRideSocket();
    latest().accept();
    for (let t = 0; t <= 9000; t += 333) rideSocketActions.emitLocation(fix(T0 + t));
    rideSocketActions.emitLocation(fix(T0 + 9000, 'trip-2'));

    const sent = latest().emitted.filter((e) => e.event === 'location.update');
    expect(sent.map((e) => (e.args[0] as LocationUpdatePayload).ts - T0)).toEqual([0, 3996, 7992, 9000]);
    expect(sent.every((e) => e.volatile)).toBe(true);
  });

  it('restarts the throttle for the next session', () => {
    connectRideSocket();
    latest().accept();
    rideSocketActions.emitLocation(fix(T0));
    disconnectRideSocket();
    connectRideSocket();
    latest().accept();
    rideSocketActions.emitLocation(fix(T0 + 1000));
    expect(latest().emitted.filter((e) => e.event === 'location.update')).toHaveLength(1);
  });

  it('never queues chat or room traffic on a socket that is not ready (it would replay under the next account)', async () => {
    token.mockReturnValue(null);
    connectRideSocket(); // e.g. a screen re-rendering right after logout
    rideSocketActions.sendTyping('inq-1');
    rideSocketActions.markRead('inq-1', 'msg-1');
    await expect(rideSocketActions.joinTrip('trip-1')).resolves.toEqual({ ok: false, error: 'not ready' });
    await expect(rideSocketActions.sendMessage({ id: 'm', tripInquiryId: 'inq-1', body: 'hi' })).resolves.toEqual({
      ok: false,
      error: 'not ready',
    });
    expect(latest().emitted).toEqual([]);
  });

  it('sends room and chat traffic once ready, typing as volatile', () => {
    connectRideSocket();
    latest().accept();
    void rideSocketActions.joinTrip('trip-1');
    rideSocketActions.sendTyping('inq-1');
    rideSocketActions.markRead('inq-1', 'msg-1');
    expect(latest().emitted.map((e) => [e.event, e.volatile])).toEqual([
      ['trip.join', false],
      ['chat.typing', true],
      ['chat.read', false],
    ]);
  });
});
