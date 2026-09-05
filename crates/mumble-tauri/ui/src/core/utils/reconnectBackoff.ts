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

/** What the client knows about a disconnect when deciding whether to retry. */
export interface ReconnectDecision {
  /** The user asked for this disconnect (menu, tab close, quit). */
  manualDisconnect: boolean;
  /** The server ended or refused the session: a kick, a ban, a full server,
   *  or the same account signing in from somewhere else. */
  serverRejected: boolean;
  /** A password or 2FA prompt is waiting on the user. */
  passwordRequired: boolean;
  /** There is somewhere to reconnect *to*. */
  hasTarget: boolean;
  /** The preference is on. */
  enabled: boolean;
}

/**
 * Whether a disconnect should start the auto-reconnect loop.
 *
 * `serverRejected` is the one that is easy to miss and expensive to get wrong.
 * Retrying a refusal is at best rude - a ban gets hammered by the client that
 * was banned - and against the same-account eviction it does not converge at
 * all: two devices signed in as one person evict each other in turn, each
 * one's reconnect kicking the other, and neither user keeps a connection. The
 * server said no; asking again is the user's to do.
 */
export function shouldAutoReconnect(decision: ReconnectDecision): boolean {
  return (
    decision.enabled &&
    decision.hasTarget &&
    !decision.manualDisconnect &&
    !decision.serverRejected &&
    !decision.passwordRequired
  );
}
