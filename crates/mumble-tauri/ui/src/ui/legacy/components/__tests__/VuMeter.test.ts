import { describe, it, expect } from "vitest";
import {
  linearToVuPercent,
  vuPercentToLinear,
  VU_DB_MIN,
  VU_DB_MAX,
} from "../../pages/settings/VuMeter";

describe("linearToVuPercent (dB scaling)", () => {
  it("returns 0 for non-positive amplitudes", () => {
    expect(linearToVuPercent(0)).toBe(0);
    expect(linearToVuPercent(-0.1)).toBe(0);
  });

  it("returns ~0 at the dB floor (-60 dB ~= 0.001)", () => {
    const pct = linearToVuPercent(0.001);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThan(1);
  });

  it("returns 100 at full scale (0 dB)", () => {
    expect(linearToVuPercent(1)).toBe(100);
  });

  it("clamps above full scale to 100", () => {
    expect(linearToVuPercent(2)).toBe(100);
  });

  it("places -20 dB (0.1) at two-thirds of the bar", () => {
    // -20 dB lives 40 dB above the -60 dB floor on a 60 dB axis, so 40/60 ~= 66.7%.
    expect(linearToVuPercent(0.1)).toBeCloseTo(66.67, 1);
  });

  it("does not saturate at typical speech RMS (0.05 used to clamp to 100%)", () => {
    // Old linear formula was `rms * 500`, so 0.05 -> 25%.  With dB scaling
    // it lands around -26 dB -> 56.7%, which is exactly the point: peaks
    // no longer instantly slam the bar to 100%.
    const pct = linearToVuPercent(0.05);
    expect(pct).toBeGreaterThan(50);
    expect(pct).toBeLessThan(60);
  });

  it("uses a 60 dB-wide axis", () => {
    expect(VU_DB_MAX - VU_DB_MIN).toBe(60);
  });
});

describe("vuPercentToLinear (inverse mapping for manual slider control)", () => {
  it("returns 1 at 100% (0 dB)", () => {
    expect(vuPercentToLinear(100)).toBeCloseTo(1, 5);
  });

  it("clamps below 0% to the dB floor", () => {
    expect(vuPercentToLinear(-10)).toBeCloseTo(vuPercentToLinear(0), 5);
  });

  it("round-trips with linearToVuPercent across the audible range", () => {
    for (const amplitude of [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 0.9]) {
      const pct = linearToVuPercent(amplitude);
      const back = vuPercentToLinear(pct);
      expect(back).toBeCloseTo(amplitude, 4);
    }
  });
});

