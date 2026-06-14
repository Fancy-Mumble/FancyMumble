/**
 * Auto-reconnect backoff schedule.
 *
 * The client retries a lost connection indefinitely (while auto-reconnect is
 * enabled), waiting a growing Fibonacci interval between attempts so a server
 * that is briefly down recovers quickly while an unreachable one is not
 * hammered.  The delay is capped so the wait never grows without bound.
 */

/** Upper bound on the backoff so attempts never wait longer than this. */
export const RECONNECT_BACKOFF_CAP_MS = 30_000;

/**
 * Delay (ms) before the next auto-reconnect attempt.
 *
 * `attemptIndex` is the number of attempts already made: `0` yields the first
 * retry delay. The sequence is Fibonacci seconds 2, 3, 5, 8, 13, 21, 34, ...
 * capped at {@link RECONNECT_BACKOFF_CAP_MS}.
 */
export function reconnectDelayMs(attemptIndex: number): number {
  let a = 2;
  let b = 3;
  for (let i = 0; i < attemptIndex; i++) {
    [a, b] = [b, a + b];
  }
  return Math.min(a * 1000, RECONNECT_BACKOFF_CAP_MS);
}
