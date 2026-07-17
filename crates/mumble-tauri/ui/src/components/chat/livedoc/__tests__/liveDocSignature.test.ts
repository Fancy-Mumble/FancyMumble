// @vitest-environment node
/**
 * Runs under the "node" environment (not jsdom): jsdom's isolated vm context
 * gives ArrayBuffer/Uint8Array instances that fail Node's native WebCrypto
 * `instanceof ArrayBuffer` realm check on importKey, so crypto.subtle calls
 * that work fine in a real single-realm browser spuriously throw under
 * jsdom. These tests don't touch the DOM, so plain node avoids the mismatch.
 */

import { describe, expect, it } from "vitest";
import { verifySignature, hashDocument } from "../liveDocSignature";

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe("digital signature crypto", () => {
  it("hashDocument is whitespace-insensitive but content-sensitive", async () => {
    expect(await hashDocument("a b")).toBe(await hashDocument("a   b\n\n"));
    expect(await hashDocument("a b")).not.toBe(await hashDocument("a c"));
  });

  it("verifies a well-formed P-256 signature and rejects tampering", async () => {
    // Mirror the Rust backend: ECDSA P-256, raw public key, fixed signature.
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const name = "Jane Doe";
    const signedAt = "2026-06-04T00:00:00Z";
    const docHash = await hashDocument("the quick brown fox");
    const payload = new TextEncoder().encode(`${name}\n${signedAt}\n${docHash}`);
    const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, payload);
    const rawPub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const sig = {
      name,
      fingerprint: "",
      signedAt,
      signature: toB64(sigBuf),
      publicKey: toB64(rawPub),
      docHash,
      algorithm: "ECDSA-P256-SHA256",
    };
    expect(await verifySignature(sig)).toBe(true);
    expect(await verifySignature({ ...sig, docHash: "00ff00ff" })).toBe(false);
    expect(await verifySignature({ ...sig, name: "Mallory" })).toBe(false);
  });
});
