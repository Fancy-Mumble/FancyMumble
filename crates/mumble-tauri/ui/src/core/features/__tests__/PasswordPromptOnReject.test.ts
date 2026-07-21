/**
 * Regression: when the server rejects a connection because of a bad
 * password or invalid certificate, the password prompt MUST be shown
 * even if the server's `Reject` message omits the `type` discriminator
 * (some Fancy Mumble server versions do not set it).  The frontend
 * falls back to a reason-string heuristic in that case.
 *
 * If this regresses, the symptom is: user reconnects to a server whose
 * password was changed, sees a generic error, and the auto-reconnect
 * loop silently retries with the wrong credentials.
 */

import { describe, it, expect } from "vitest";

interface RejectPayload {
  reason: string;
  reject_type: number | null;
}

/**
 * Mirrors the password-error detection in store.ts's
 * "connection-rejected" listener.
 */
function isPasswordError(payload: RejectPayload): boolean {
  const rt = payload.reject_type;
  const reasonText = payload.reason ?? "";
  const reasonLooksLikePwError =
    /password|wrong\s+(?:user|server)|certificate/i.test(reasonText);
  return rt === 3 || rt === 4 || (rt == null && reasonLooksLikePwError);
}

describe("connection-rejected password detection", () => {
  it("treats WrongUserPW (type=3) as password error", () => {
    expect(isPasswordError({ reason: "Wrong password", reject_type: 3 })).toBe(
      true,
    );
  });

  it("treats WrongServerPW (type=4) as password error", () => {
    expect(
      isPasswordError({ reason: "Server password required", reject_type: 4 }),
    ).toBe(true);
  });

  it("treats reason-string match as password error when type is missing", () => {
    // The exact reason string emitted by murmur / Fancy Mumble server
    // when an existing user's certificate or password does not match.
    expect(
      isPasswordError({
        reason: "Wrong certificate or password for existing user",
        reject_type: null,
      }),
    ).toBe(true);
  });

  it("treats a plain 'Wrong password' reason as password error when type is missing", () => {
    expect(
      isPasswordError({ reason: "Wrong password", reject_type: null }),
    ).toBe(true);
  });

  it("does NOT misclassify a kick reason as a password error", () => {
    expect(
      isPasswordError({
        reason: "Kicked by administrator",
        reject_type: null,
      }),
    ).toBe(false);
  });

  it("does NOT misclassify a ban reason as a password error", () => {
    expect(
      isPasswordError({ reason: "You are banned", reject_type: null }),
    ).toBe(false);
  });

  it("does NOT misclassify a generic connection-refused reason", () => {
    expect(
      isPasswordError({ reason: "Connection refused", reject_type: null }),
    ).toBe(false);
  });

  it("is case-insensitive on the reason string", () => {
    expect(
      isPasswordError({
        reason: "WRONG SERVER PASSWORD",
        reject_type: null,
      }),
    ).toBe(true);
  });
});
