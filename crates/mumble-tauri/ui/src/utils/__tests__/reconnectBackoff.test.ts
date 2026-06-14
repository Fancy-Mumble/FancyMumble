import { describe, it, expect } from "vitest";
import {
  reconnectDelayMs,
  RECONNECT_BACKOFF_CAP_MS,
} from "../reconnectBackoff";

describe("reconnectDelayMs", () => {
  it("follows a Fibonacci-seconds sequence for the first attempts", () => {
    // attemptIndex -> seconds: 2, 3, 5, 8, 13, 21
    expect(reconnectDelayMs(0)).toBe(2000);
    expect(reconnectDelayMs(1)).toBe(3000);
    expect(reconnectDelayMs(2)).toBe(5000);
    expect(reconnectDelayMs(3)).toBe(8000);
    expect(reconnectDelayMs(4)).toBe(13000);
    expect(reconnectDelayMs(5)).toBe(21000);
  });

  it("caps the delay so it never grows without bound", () => {
    // 34s would exceed the cap, so it clamps from attempt 6 onward.
    expect(reconnectDelayMs(6)).toBe(RECONNECT_BACKOFF_CAP_MS);
    expect(reconnectDelayMs(20)).toBe(RECONNECT_BACKOFF_CAP_MS);
    expect(reconnectDelayMs(100)).toBe(RECONNECT_BACKOFF_CAP_MS);
  });

  it("is monotonically non-decreasing", () => {
    let prev = 0;
    for (let i = 0; i < 30; i++) {
      const d = reconnectDelayMs(i);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeLessThanOrEqual(RECONNECT_BACKOFF_CAP_MS);
      prev = d;
    }
  });
});
