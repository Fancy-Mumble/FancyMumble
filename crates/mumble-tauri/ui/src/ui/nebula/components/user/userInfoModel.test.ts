import { describe, expect, it } from "vitest";
import type { BanEntry, ChannelEntry, UserStats } from "@core/types";
import {
  appendSample,
  certificateLabel,
  codecLabel,
  describeBans,
  joinedAt,
  lossPercent,
  osLabel,
  sampleOf,
  SAMPLE_WINDOW,
  viewerIsAdmin,
} from "./userInfoModel";

const STATS: UserStats = {
  session: 26,
  tcp_packets: 191,
  udp_packets: 346,
  tcp_ping_avg: 23.5,
  tcp_ping_var: 5.1,
  udp_ping_avg: 19.2,
  udp_ping_var: 3.2,
  bandwidth: 6625,
  onlinesecs: 2719,
  idlesecs: 1,
  strong_certificate: false,
  opus: true,
  from_client: { good: 346, late: 0, lost: 2, resync: 0 },
  from_server: { good: 8006, late: 1, lost: 0, resync: 0 },
};

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-29T12:00:00Z");

function ban(overrides: Partial<BanEntry>): BanEntry {
  return { address: "", mask: 128, name: "", hash: "", reason: "", start: "", duration: 0, ...overrides };
}

describe("lossPercent", () => {
  it("counts late and lost packets against everything sent", () => {
    expect(lossPercent(STATS)).toBeCloseTo((2 / 348) * 100, 5);
  });

  it("prefers the rolling window to the lifetime totals", () => {
    const rolling = {
      ...STATS,
      rolling_stats: {
        time_window: 30,
        from_client: { good: 99, late: 1, lost: 0, resync: 0 },
        from_server: { good: 0, late: 0, lost: 0, resync: 0 },
      },
    };
    expect(lossPercent(rolling)).toBeCloseTo(1, 5);
  });

  it("says nothing without figures, and zero for a window with no traffic", () => {
    expect(lossPercent({ ...STATS, from_client: null })).toBeNull();
    expect(lossPercent({ ...STATS, from_client: { good: 0, late: 0, lost: 0, resync: 0 } })).toBe(0);
  });
});

describe("samples", () => {
  it("keeps the last 45 readings, oldest first", () => {
    let samples = appendSample([], sampleOf(STATS, 0));
    for (let at = 1; at <= SAMPLE_WINDOW + 5; at++) samples = appendSample(samples, sampleOf(STATS, at));
    expect(samples).toHaveLength(SAMPLE_WINDOW);
    expect(samples[0].at).toBe(6);
    expect(samples[samples.length - 1].at).toBe(SAMPLE_WINDOW + 5);
  });

  it("takes the reading's pings, bandwidth and loss", () => {
    expect(sampleOf(STATS, 7)).toEqual({
      at: 7,
      udpPing: 19.2,
      tcpPing: 23.5,
      bandwidth: 6625,
      loss: lossPercent(STATS),
    });
  });
});

describe("labels", () => {
  it("names the certificate in the mock's words", () => {
    expect(certificateLabel(true)).toEqual({ label: "Strong", tone: "ok" });
    expect(certificateLabel(false)).toEqual({ label: "Weak / none", tone: "warn" });
  });

  it("names the codec", () => {
    expect(codecLabel(true)).toBe("Opus 48 kHz");
    expect(codecLabel(false)).toBe("CELT");
  });

  it("joins the OS and its version, or says nothing", () => {
    expect(osLabel("Linux", "6.9")).toBe("Linux 6.9");
    expect(osLabel("Linux", null)).toBe("Linux");
    expect(osLabel(null, null)).toBeNull();
  });

  it("counts back to when the session began", () => {
    expect(joinedAt(NOW, 60)).toBe(NOW - 60_000);
  });
});

describe("viewerIsAdmin", () => {
  const root = (permissions: number | null): ChannelEntry =>
    ({ id: 0, parent_id: null, name: "Root", permissions }) as ChannelEntry;

  it("is Write on the root, and nothing less", () => {
    expect(viewerIsAdmin([root(0x1 | 0x4)])).toBe(true);
    expect(viewerIsAdmin([root(0x4)])).toBe(false);
    expect(viewerIsAdmin([root(null)])).toBe(false);
    expect(viewerIsAdmin([])).toBe(false);
  });
});

describe("describeBans", () => {
  it("finds nothing for a person with no bans", () => {
    expect(describeBans([ban({ hash: "other" })], { hash: "abc" }, "203.0.113.9", NOW)).toBeNull();
  });

  it("matches on the certificate hash, and says when the ban ran out", () => {
    const start = new Date(NOW - 10 * DAY).toISOString();
    const result = describeBans(
      [ban({ hash: "abc", start, duration: (3 * DAY) / 1000 })],
      { hash: "abc" },
      null,
      NOW,
    );
    expect(result?.count).toBe(1);
    expect(result?.note).toMatch(/^expired /);
  });

  it("matches on the address too, and says when a ban still runs", () => {
    const start = new Date(NOW - DAY).toISOString();
    const result = describeBans(
      [ban({ address: "203.0.113.9", start, duration: (7 * DAY) / 1000 })],
      { hash: "abc" },
      "203.0.113.9",
      NOW,
    );
    expect(result?.note).toMatch(/^expires /);
  });

  it("counts every match and describes the latest", () => {
    const old = new Date(NOW - 30 * DAY).toISOString();
    const recent = new Date(NOW - 2 * DAY).toISOString();
    const result = describeBans(
      [ban({ hash: "abc", start: old, duration: 60 }), ban({ hash: "abc", start: recent, duration: 0 })],
      { hash: "abc" },
      null,
      NOW,
    );
    expect(result).toEqual({ count: 2, note: "permanent" });
  });

  it("still counts a ban whose start it cannot read", () => {
    expect(
      describeBans([ban({ hash: "abc", start: "?", duration: 60 })], { hash: "abc" }, null, NOW),
    ).toEqual({
      count: 1,
      note: "on record",
    });
  });
});
