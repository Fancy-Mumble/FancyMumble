/**
 * What the User Information sheet shows, derived from what the server sent.
 *
 * Pure functions, so the sheet's facts - the certificate line, the ban note,
 * the loss figure, the chart window - are testable without a session behind
 * them. The sheet draws; this decides.
 */
import type { BanEntry, ChannelEntry, UserStats } from "@core/types";
import { PERM_WRITE } from "@core/utils/permissions";

/** How many samples the live charts keep: one a second, the last 45 seconds. */
export const SAMPLE_WINDOW = 45;

/** One reading of the connection, taken each time the server answers. */
export interface StatsSample {
  at: number;
  udpPing: number;
  tcpPing: number;
  /** Bytes per second the server reports, or null when it does not. */
  bandwidth: number | null;
  /** Packets late or lost as a share of packets sent, or null without figures. */
  loss: number | null;
}

/**
 * Late and lost packets as a percentage of everything the client sent.
 *
 * The rolling window is preferred over the lifetime totals: a connection that
 * dropped a burst an hour ago is not losing packets now, and "now" is what a
 * live figure claims to be.
 */
export function lossPercent(stats: UserStats): number | null {
  const window = stats.rolling_stats?.from_client ?? stats.from_client;
  if (!window) return null;
  const total = window.good + window.late + window.lost;
  if (total === 0) return 0;
  return ((window.late + window.lost) / total) * 100;
}

export function sampleOf(stats: UserStats, at: number): StatsSample {
  return {
    at,
    udpPing: stats.udp_ping_avg,
    tcpPing: stats.tcp_ping_avg,
    bandwidth: stats.bandwidth,
    loss: lossPercent(stats),
  };
}

/** The window with one more reading in it, and the oldest gone if it is full. */
export function appendSample(
  samples: readonly StatsSample[],
  sample: StatsSample,
  limit = SAMPLE_WINDOW,
): StatsSample[] {
  const next = [...samples, sample];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Strong or weak certificate, as a translation key and its warning colour.
 *
 * Keys rather than sentences, so this stays a pure function the sheet's facts
 * can be tested through.  The literal union is what lets `t()` still check them
 * at the call site.
 */
export function certificateLabel(strong: boolean): {
  labelKey: "sidebar:userInfo.certStrong" | "sidebar:userInfo.certWeak";
  tone: "ok" | "warn";
} {
  return strong
    ? { labelKey: "sidebar:userInfo.certStrong", tone: "ok" }
    : { labelKey: "sidebar:userInfo.certWeak", tone: "warn" };
}

/** Mumble speaks Opus at 48 kHz or the legacy CELT codecs; the flag says which. */
export function codecLabel(opus: boolean): "nebulaUser:info.codecOpus" | "nebulaUser:info.codecCelt" {
  return opus ? "nebulaUser:info.codecOpus" : "nebulaUser:info.codecCelt";
}

export function osLabel(os: string | null | undefined, version: string | null | undefined): string | null {
  const label = [os, version].filter(Boolean).join(" ");
  return label || null;
}

/** When the session started, counted back from how long it has been online. */
export function joinedAt(now: number, onlinesecs: number): number {
  return now - onlinesecs * 1000;
}

/** Whether the viewer has Write on the root - what makes them an admin here. */
export function viewerIsAdmin(channels: readonly ChannelEntry[]): boolean {
  const root = channels.find((channel) => channel.id === 0);
  return ((root?.permissions ?? 0) & PERM_WRITE) !== 0;
}

/** "12 Jun" - a date the mock writes without a year, since bans are recent news.
 *  `undefined` for the locale means the browser's, which is the user's. */
function shortDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** What became of a ban, as a `nebulaUser` key and whatever it interpolates. */
export type BanNote =
  | { key: "nebulaUser:info.bansOnRecord" | "nebulaUser:info.bansPermanent" }
  | { key: "nebulaUser:info.bansExpired" | "nebulaUser:info.bansExpires"; date: string };

/**
 * The bans on record against this person: how many, and what became of the
 * latest one.
 *
 * Matched on the certificate hash where the ban has one and on the address
 * otherwise, which is how the server itself matches them. A ban with no
 * parsable start is still counted - the count is the fact that matters - and
 * described as simply on record.
 */
export function describeBans(
  bans: readonly BanEntry[],
  user: Readonly<{ hash?: string | null }>,
  address: string | null | undefined,
  now: number,
): { count: number; note: BanNote } | null {
  const matching = bans.filter(
    (ban) => (!!user.hash && ban.hash === user.hash) || (!!address && ban.address === address),
  );
  if (matching.length === 0) return null;

  const latest = matching
    .map((ban) => ({ ban, start: Date.parse(ban.start) }))
    .sort((left, right) => (right.start || 0) - (left.start || 0))[0];

  let note: BanNote = { key: "nebulaUser:info.bansOnRecord" };
  if (latest.ban.duration === 0) note = { key: "nebulaUser:info.bansPermanent" };
  else if (!Number.isNaN(latest.start)) {
    const end = latest.start + latest.ban.duration * 1000;
    note = end <= now
      ? { key: "nebulaUser:info.bansExpired", date: shortDate(end) }
      : { key: "nebulaUser:info.bansExpires", date: shortDate(end) };
  }
  return { count: matching.length, note };
}
