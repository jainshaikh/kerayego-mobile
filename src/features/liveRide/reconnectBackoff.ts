// Delay schedule for the ride socket's OWN reconnect loop (socket.ts) — the
// one that runs after the server drops the connection ('io server
// disconnect', e.g. an access token that expired before the handshake), a
// case Socket.IO deliberately never retries by itself. Ordinary network drops
// stay on Socket.IO's built-in reconnection and never come through here.
// Pure, so the schedule can be unit-tested.

export const SOCKET_RECONNECT_BASE_DELAY_MS = 1000;
export const SOCKET_RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Delay before reconnect attempt number `attempt` (0-based, reset once the
 * server confirms a connection with 'ready'): exponential from 1 s, capped at
 * 30 s, then scaled into [50 %, 100 %] of that by `random` so a fleet of
 * devices dropped together doesn't come back in lockstep.
 */
export function computeReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  // 2^5 already passes the cap; clamping the exponent keeps a long-running
  // loop from ever computing Infinity.
  const exponent = Number.isNaN(attempt) || attempt < 0 ? 0 : Math.min(Math.floor(attempt), 16);
  const exponential = SOCKET_RECONNECT_BASE_DELAY_MS * 2 ** exponent;
  const capped = Math.min(exponential, SOCKET_RECONNECT_MAX_DELAY_MS);
  const jitter = Math.min(Math.max(random(), 0), 1);
  return Math.round(capped * (0.5 + jitter / 2));
}
