/**
 * Lifetime / expiry helpers for file-server items.
 *
 * The file server stamps uploaded files with an optional `expires_at`
 * (Unix **seconds**) when a TTL is configured.  This turns that into a
 * human "expires in 3 days" phrase (via Day.js relative time) plus the
 * flags the dashboard needs for urgency colouring.
 */

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

/** Lifetime info derived from an optional Unix-seconds expiry. */
export interface ExpiryInfo {
  /** True when the item has a finite lifetime (a TTL is set). */
  readonly hasExpiry: boolean;
  /** Day.js relative phrase: "in 3 days" (future) or "5 minutes ago"
   *  (past), or `null` when the item never expires. */
  readonly relative: string | null;
  /** Absolute local timestamp for tooltips, or `null` when no expiry. */
  readonly absolute: string | null;
  /** True once the expiry time has passed. */
  readonly expired: boolean;
  /** True when expiry is imminent (< 1 hour away) - for an urgency colour. */
  readonly soon: boolean;
  /** True when expiry is comfortably far off (> 1 month away) - rendered in a
   *  reassuring colour rather than the default "amber" lifetime tag. */
  readonly far: boolean;
}

/** Days threshold beyond which a file's remaining lifetime is considered
 *  "far off" (more than a month). */
const FAR_EXPIRY_DAYS = 30;

/**
 * Compute lifetime info from a Unix-**seconds** expiry (the file-server's
 * `expires_at`).  `null` / `undefined` means the item never expires.
 */
export function expiryInfo(expiresAtSeconds: number | null | undefined): ExpiryInfo {
  if (expiresAtSeconds == null) {
    return { hasExpiry: false, relative: null, absolute: null, expired: false, soon: false, far: false };
  }
  const exp = dayjs.unix(expiresAtSeconds);
  const now = dayjs();
  const expired = exp.isBefore(now);
  return {
    hasExpiry: true,
    relative: exp.fromNow(),
    absolute: exp.format("YYYY-MM-DD HH:mm"),
    expired,
    soon: !expired && exp.diff(now, "minute") < 60,
    far: !expired && exp.diff(now, "day") > FAR_EXPIRY_DAYS,
  };
}
