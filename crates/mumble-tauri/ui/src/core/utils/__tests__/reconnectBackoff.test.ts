import { describe, it, expect } from "vitest";
import { reconnectDelayMs, shouldAutoReconnect, RECONNECT_BACKOFF_CAP_MS } from "../reconnectBackoff";

/** A lost link on a server we have somewhere to go back to. */
const DROPPED = {
  manualDisconnect: false,
  serverRejected: false,
  passwordRequired: false,
  hasTarget: true,
  enabled: true,
};

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

describe("shouldAutoReconnect", () => {
  it("retries a link that simply dropped", () => {
    expect(shouldAutoReconnect(DROPPED)).toBe(true);
  });

  it("does not retry what the server refused", () => {
    // The case this was written for: being evicted because the same account
    // signed in from another device. Reconnecting kicks that device, which
    // reconnects and kicks this one, and neither user keeps a connection.
    expect(shouldAutoReconnect({ ...DROPPED, serverRejected: true })).toBe(false);
  });

  it("does not retry a disconnect the user asked for", () => {
    expect(shouldAutoReconnect({ ...DROPPED, manualDisconnect: true })).toBe(false);
  });

  it("waits for the user while a credential prompt is open", () => {
    expect(shouldAutoReconnect({ ...DROPPED, passwordRequired: true })).toBe(false);
  });

  it("needs somewhere to go and a preference that allows it", () => {
    expect(shouldAutoReconnect({ ...DROPPED, hasTarget: false })).toBe(false);
    expect(shouldAutoReconnect({ ...DROPPED, enabled: false })).toBe(false);
  });
});
