/**
 * liveDocSignature - real cryptographic document signing for the Insert tab's
 * eSignature control, using the user's **real Mumble identity key**.
 *
 * Signing happens in the Rust backend (`sign_document` command) with the
 * identity's TLS client private key (ECDSA P-256) - the private key never
 * reaches JS.  The signature covers `name | timestamp | docHash`, where
 * `docHash` is the SHA-512 of the document's whitespace-normalised text, so
 * the card can re-hash the live document and flag "content changed - re-sign"
 * the moment the signed text no longer matches.
 *
 * Verification runs in the UI with WebCrypto against the embedded raw public
 * key.  Trust model: a verifier confirms the signature + compares the public
 * key fingerprint out of band; it proves the holder of that Mumble key signed
 * this content.
 */

import { invoke } from "@tauri-apps/api/core";

const ALGORITHM = "ECDSA-P256-SHA256";
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const VERIFY_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;

export interface DocumentSignature {
  readonly name: string;
  readonly fingerprint: string;
  readonly signedAt: string;
  readonly signature: string;
  readonly publicKey: string;
  readonly docHash: string;
  readonly algorithm: string;
}

interface RustSignature {
  readonly signature: string;
  readonly publicKey: string;
  readonly algorithm: string;
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short, human-comparable fingerprint of a raw public key (SHA-256). */
async function fingerprintOf(publicKeyB64: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", b64ToBuf(publicKeyB64));
  return bufToHex(hash).slice(0, 32).toUpperCase().replace(/(.{4})(?=.)/g, "$1 ").trim();
}

/** SHA-512 (hex) of the document's whitespace-normalised text.  Normalising
 *  means inserting the (text-free) signature atom doesn't change the hash,
 *  while any real content edit does. */
export async function hashDocument(text: string): Promise<string> {
  const normalised = text.replace(/\s+/g, " ").trim();
  const buf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(normalised));
  return bufToHex(buf);
}

/**
 * Sign `text` on behalf of `name` using the identity `label`'s Mumble key.
 * Throws if no identity/key is available (e.g. not connected).
 */
export async function signDocument(text: string, name: string, label: string): Promise<DocumentSignature> {
  const signedAt = new Date().toISOString();
  const docHash = await hashDocument(text);
  const payload = `${name}\n${signedAt}\n${docHash}`;
  const result = await invoke<RustSignature>("sign_document", { label, payload });
  return {
    name,
    fingerprint: await fingerprintOf(result.publicKey),
    signedAt,
    signature: result.signature,
    publicKey: result.publicKey,
    docHash,
    algorithm: result.algorithm || ALGORITHM,
  };
}

/** Verify a signature against its embedded public key + signed payload. */
export async function verifySignature(sig: DocumentSignature): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey("raw", b64ToBuf(sig.publicKey), ECDSA, true, ["verify"]);
    const payload = new TextEncoder().encode(`${sig.name}\n${sig.signedAt}\n${sig.docHash}`);
    return await crypto.subtle.verify(VERIFY_PARAMS, publicKey, b64ToBuf(sig.signature), payload);
  } catch {
    return false;
  }
}
