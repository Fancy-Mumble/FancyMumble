/**
 * Which livery a connect screen should draw, and what to say about it.
 *
 * A livery is fetched, not waited for. The document is available to anybody who
 * can open the control connection - Starling's `ServerConfigService` answers a
 * `LiveryQuery` without consulting `permissions`, and its own docs say a client
 * renders livery "before it has authenticated anything" - so a server's
 * branding is as readable from the connect screen as its user count is. The
 * `probe_livery` command does exactly that: connect, ask, hang up, never
 * authenticate.
 *
 * What is left for this file is the order things are tried in, which is a real
 * decision because the probe costs a TLS handshake and the two cheaper sources
 * usually answer first:
 *
 * 1. the open connection, if this server happens to be the one connected;
 * 2. a stored copy, when the ping's digest vouches for it;
 * 3. the probe.
 *
 * The digest is what makes (2) safe and (3) skippable. It has three states, not
 * two, and the difference drives most of what follows: absent is a server that
 * said nothing (plain Mumble, or a ping that fell back to the legacy format,
 * which is six fixed u32s with nowhere to put one), and empty is a Fancy server
 * saying it deliberately has none.
 */
import type { ServerPingResult } from "@core/types";
import type { ServerLivery } from "./livery";
import type { CachedLivery } from "./liveryCache";

export type LiveryStatus =
  /** The ping is still out; nothing is known yet. */
  | "probing"
  /** Drawn from the open connection - the server is saying it right now. */
  | "live"
  /** Drawn from a copy whose digest the server just confirmed. */
  | "cached"
  /** The server has branding this client does not hold; fetching it. */
  | "fetching"
  /** The fetch did not come back with it. */
  | "failed"
  /** The server says it has none. */
  | "absent"
  /** The server cannot say - plain Mumble, or a legacy ping reply. */
  | "unverified"
  /** The ping did not come back. */
  | "unreachable";

/** Where the out-of-band fetch has got to. */
export type ProbeState = "idle" | "running" | "failed";

export interface ResolvedLivery {
  /** What to draw, or null to draw the server unbranded. */
  livery: ServerLivery | null;
  status: LiveryStatus;
  /**
   * Whether this address's branding should be fetched now.
   *
   * True only when the server says it has one and nothing to hand matches it.
   * A caller that acts on this must not act on it twice for the same digest -
   * see `ConnectScreen`, which keys the attempt on the digest it fetched for.
   */
  fetch: boolean;
  /**
   * Whether the stored copy should be dropped.
   *
   * Only for a server that answered with an explicit "I have none": branding an
   * operator removed must not outlive the removal on a client that saw it.
   */
  forget: boolean;
}

const NOTHING = { fetch: false, forget: false } as const;

export function resolveLivery(input: {
  /** From the open connection, when this server is the one connected. */
  live: ServerLivery | null;
  /** From disk, or null when this address has never been visited. */
  cached: CachedLivery | null;
  /** Null while the ping is in flight. */
  ping: ServerPingResult | null;
  /** Where the out-of-band fetch has got to. Defaults to not started. */
  probe?: ProbeState;
}): ResolvedLivery {
  const { live, cached, ping, probe = "idle" } = input;

  // An open connection outranks everything: it is the server speaking now,
  // it is already keyed to this session, and it cost nothing extra.
  if (live) return { livery: live, status: "live", ...NOTHING };

  const stored = cached?.livery ?? null;

  // Nothing checked yet. Paint the stored copy rather than flashing unbranded
  // and branded a moment apart - the ping that follows will correct it.
  if (!ping) return { livery: stored, status: "probing", ...NOTHING };

  if (!ping.online) return { livery: stored, status: "unreachable", ...NOTHING };

  const digest = ping.livery_digest ?? null;

  // The server cannot speak to branding at all. Leave what is stored alone and
  // keep drawing it: silence is not a retraction, and there is nothing to
  // fetch from a server that does not have the message type.
  if (digest === null) return { livery: stored, status: "unverified", ...NOTHING };

  // An explicit "none". The one case that clears a cache.
  if (digest === "") return { livery: null, status: "absent", fetch: false, forget: cached !== null };

  // The stored copy is the one the server is holding. Nothing to fetch.
  if (cached?.digest === digest) return { livery: stored, status: "cached", ...NOTHING };

  // The server has branding and this client does not hold it - either never
  // did, or holds a copy the server has since replaced. Either way it is one
  // TLS round-trip away, and a stored copy the digest contradicts is not drawn
  // in the meantime: it is provably the wrong picture.
  if (probe === "failed") return { livery: null, status: "failed", ...NOTHING };
  return { livery: null, status: "fetching", fetch: probe === "idle", forget: false };
}

/** How each status is toned. Three readings: working, waiting, wrong. */
export const LIVERY_TONE: Record<LiveryStatus, "ok" | "warn" | "bad" | "muted"> = {
  probing: "muted",
  live: "ok",
  cached: "ok",
  fetching: "muted",
  failed: "bad",
  absent: "muted",
  unverified: "muted",
  unreachable: "bad",
};

/** What the indicator says when pointed at. One sentence, in the user's terms. */
export const LIVERY_TITLE: Record<LiveryStatus, string> = {
  probing: "Checking this server for branding",
  live: "Showing this server's branding, live from the connection",
  cached: "Showing this server's branding, confirmed current",
  fetching: "Loading this server's branding",
  failed: "This server has branding, but it could not be loaded",
  absent: "This server has no branding set",
  unverified: "This server does not report branding",
  unreachable: "Could not reach this server to check its branding",
};

/** Statuses that mean something is still in flight, for a spinner or a pulse. */
export const LIVERY_BUSY: ReadonlySet<LiveryStatus> = new Set<LiveryStatus>(["probing", "fetching"]);
