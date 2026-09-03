import { describe, expect, it } from "vitest";
import { LATENCY_TICKS, latencyCeiling, latencyStep, withAlpha } from "./LatencyChart";
import { latencyGrade, summariseLatency, type LatencySample } from "./model";

const at = (index: number, rtt: number): LatencySample => ({ at: index * 500, rtt });

describe("summariseLatency", () => {
  it("has nothing to say about an empty window", () => {
    const summary = summariseLatency([]);
    expect(summary.latest).toBeNull();
    expect(summary.count).toBe(0);
  });

  it("reports the newest reading, not the largest", () => {
    // The figure beside the chart is what the link is doing now; a spike a
    // minute ago belongs to `max` and nowhere else.
    const summary = summariseLatency([at(0, 12), at(1, 300), at(2, 14)]);
    expect(summary.latest).toBe(14);
    expect(summary.min).toBe(12);
    expect(summary.max).toBe(300);
    expect(summary.avg).toBeCloseTo(108.67, 1);
    expect(summary.count).toBe(3);
  });
});

describe("latencyGrade", () => {
  it("names the three bands at their boundaries", () => {
    expect(latencyGrade(49)).toBe("good");
    expect(latencyGrade(50)).toBe("fair");
    expect(latencyGrade(119)).toBe("fair");
    expect(latencyGrade(120)).toBe("poor");
  });
});

describe("latencyStep", () => {
  it("counts in numbers a reader counts in", () => {
    // The bug this exists for: rounding the *ceiling* and dividing by four
    // labelled a 328 ms peak's axis 0, 113, 225, 338, 450.
    for (const peak of [3, 21, 24, 60, 90, 328, 900, 4000]) {
      const step = latencyStep(peak);
      expect(step * LATENCY_TICKS).toBe(latencyCeiling(peak));
      expect(Number.isInteger(step)).toBe(true);
    }
  });

  it("clears the peak with headroom, and never collapses on a quiet link", () => {
    expect(latencyCeiling(328)).toBe(400);
    expect(latencyCeiling(24)).toBe(40);
    expect(latencyCeiling(0)).toBe(20);
    expect(latencyCeiling(3)).toBe(20);
  });
});

describe("withAlpha", () => {
  it("reads the notations a pack's tokens arrive in", () => {
    expect(withAlpha("#468cdc", 0.2)).toBe("rgba(70, 140, 220, 0.2)");
    expect(withAlpha("#abc", 1)).toBe("rgba(170, 187, 204, 1)");
    expect(withAlpha("rgb(1, 2, 3)", 0.5)).toBe("rgba(1, 2, 3, 0.5)");
  });

  it("keeps a translucent token translucent", () => {
    // Nebula's accents are alphas over the window; a wash that dropped the
    // token's own alpha would be a solid slab where the mock has glass.
    expect(withAlpha("rgba(130, 178, 255, 0.5)", 0.2)).toBe("rgba(130, 178, 255, 0.1)");
  });
});
