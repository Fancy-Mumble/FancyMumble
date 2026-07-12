/**
 * Unit tests for the "Stats for Nerds" panel's pure stats logic:
 * reducing a WebRTC getStats() report to a snapshot, and deriving
 * per-interval rates (bitrate, packet loss, buffer delay) from two
 * consecutive snapshots.
 */
import { describe, it, expect } from "vitest";

import {
  parseStatsReports,
  deriveIntervalStats,
  type StatsSample,
} from "../chat/stream/StreamStatsPanel";

function makeReports() {
  return [
    { id: "t1", type: "transport", selectedCandidatePairId: "cp1" },
    {
      id: "cp1",
      type: "candidate-pair",
      state: "succeeded",
      nominated: true,
      currentRoundTripTime: 0.023,
      localCandidateId: "lc",
      remoteCandidateId: "rc",
    },
    { id: "lc", type: "local-candidate", candidateType: "host" },
    { id: "rc", type: "remote-candidate", candidateType: "srflx" },
    {
      id: "v1",
      type: "inbound-rtp",
      kind: "video",
      codecId: "c1",
      bytesReceived: 1_000_000,
      packetsReceived: 900,
      packetsLost: 10,
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 25,
      framesDecoded: 2022,
      framesDropped: 3,
      freezeCount: 2,
      totalFreezesDuration: 1.25,
      jitter: 0.004,
      jitterBufferDelay: 12.5,
      jitterBufferEmittedCount: 500,
    },
    {
      id: "c1",
      type: "codec",
      mimeType: "video/H264",
      sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    },
    { id: "a1", type: "inbound-rtp", kind: "audio", codecId: "c2", bytesReceived: 50_000 },
    { id: "c2", type: "codec", mimeType: "audio/opus" },
  ];
}

describe("parseStatsReports", () => {
  it("extracts video, codec, and ICE-pair fields from a stats report", () => {
    const sample = parseStatsReports(makeReports(), 1000);
    expect(sample.frameWidth).toBe(1920);
    expect(sample.frameHeight).toBe(1080);
    expect(sample.framesPerSecond).toBe(25);
    expect(sample.framesDecoded).toBe(2022);
    expect(sample.framesDropped).toBe(3);
    expect(sample.freezeCount).toBe(2);
    expect(sample.totalFreezesDurationS).toBeCloseTo(1.25);
    expect(sample.packetsReceived).toBe(900);
    expect(sample.packetsLost).toBe(10);
    expect(sample.jitterMs).toBeCloseTo(4);
    expect(sample.rttMs).toBeCloseTo(23);
    expect(sample.icePath).toBe("host / srflx");
    expect(sample.videoCodec).toBe("H264 (42e01f)");
    expect(sample.audioCodec).toBe("opus");
    // Video + audio bytes are combined for the bandwidth rows.
    expect(sample.bytesReceived).toBe(1_050_000);
  });

  it("falls back to the nominated succeeded pair without a transport report", () => {
    const reports = makeReports().filter((r) => r.type !== "transport");
    const sample = parseStatsReports(reports, 1000);
    expect(sample.rttMs).toBeCloseTo(23);
  });

  it("returns defaults for an empty report", () => {
    const sample = parseStatsReports([], 1000);
    expect(sample.frameWidth).toBeNull();
    expect(sample.rttMs).toBeNull();
    expect(sample.bytesReceived).toBe(0);
  });
});

function sampleAt(timestampMs: number, overrides: Partial<StatsSample>): StatsSample {
  return {
    timestampMs,
    frameWidth: 1920,
    frameHeight: 1080,
    framesPerSecond: null,
    framesDecoded: 0,
    framesDropped: 0,
    freezeCount: 0,
    totalFreezesDurationS: 0,
    bytesReceived: 0,
    packetsReceived: 0,
    packetsLost: 0,
    jitterMs: null,
    jitterBufferDelay: 0,
    jitterBufferEmittedCount: 0,
    videoCodec: null,
    audioCodec: null,
    rttMs: null,
    icePath: null,
    ...overrides,
  };
}

describe("deriveIntervalStats", () => {
  it("derives rates from two snapshots one second apart", () => {
    const prev = sampleAt(0, {
      bytesReceived: 0,
      packetsReceived: 0,
      packetsLost: 0,
      framesDecoded: 0,
      jitterBufferDelay: 0,
      jitterBufferEmittedCount: 0,
    });
    const curr = sampleAt(1000, {
      bytesReceived: 125_000,
      packetsReceived: 99,
      packetsLost: 1,
      framesDecoded: 30,
      jitterBufferDelay: 0.05,
      jitterBufferEmittedCount: 25,
    });
    const d = deriveIntervalStats(prev, curr);
    expect(d.bitrateKbps).toBeCloseTo(1000); // 125000 B * 8 / 1 s / 1000
    expect(d.networkKBps).toBeCloseTo(125_000 / 1024);
    expect(d.fps).toBeCloseTo(30); // derived from the decode delta
    expect(d.lossPct).toBeCloseTo(1); // 1 of 100 expected packets
    expect(d.bufferMs).toBeCloseTo(2); // 0.05 s / 25 emitted * 1000
  });

  it("prefers the reported framesPerSecond over the decode delta", () => {
    const prev = sampleAt(0, { framesDecoded: 0 });
    const curr = sampleAt(1000, { framesDecoded: 30, framesPerSecond: 25 });
    expect(deriveIntervalStats(prev, curr).fps).toBe(25);
  });

  it("returns nulls without a previous snapshot", () => {
    const d = deriveIntervalStats(null, sampleAt(1000, { framesPerSecond: 60 }));
    expect(d.bitrateKbps).toBeNull();
    expect(d.lossPct).toBeNull();
    expect(d.bufferMs).toBeNull();
    expect(d.fps).toBe(60); // reported FPS needs no delta
  });

  it("clamps a decreasing loss counter (RTX recovery) to zero", () => {
    const prev = sampleAt(0, { packetsLost: 50, packetsReceived: 5000 });
    const curr = sampleAt(1000, { packetsLost: 45, packetsReceived: 5100 });
    expect(deriveIntervalStats(prev, curr).lossPct).toBe(0);
  });

  it("reports no rates after a full counter reset (viewer reconnect)", () => {
    const prev = sampleAt(0, { bytesReceived: 9_999_999, packetsLost: 50, packetsReceived: 5000 });
    const curr = sampleAt(1000, { bytesReceived: 1000, packetsLost: 0, packetsReceived: 10 });
    const d = deriveIntervalStats(prev, curr);
    expect(d.bitrateKbps).toBe(0); // byte delta clamps to 0
    expect(d.lossPct).toBeNull(); // both packet deltas clamp to 0 - no data
  });

  it("returns nulls for a non-positive time delta", () => {
    const prev = sampleAt(1000, { bytesReceived: 0 });
    const curr = sampleAt(1000, { bytesReceived: 1000 });
    const d = deriveIntervalStats(prev, curr);
    expect(d.bitrateKbps).toBeNull();
    expect(d.networkKBps).toBeNull();
  });
});
