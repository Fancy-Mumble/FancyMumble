/**
 * Tests for the Word-style "Insert" tab building blocks: the new nodes'
 * markdown round-trip, the video-URL normaliser, and the SVG generators that
 * back Shapes / Icons / Charts.
 */

import { describe, expect, it } from "vitest";
import {
  editorHtmlToMarkdown,
  markdownToEditorHtml,
} from "../chat/livedoc/liveDocMarkdown";
import { toVideoEmbedUrl } from "../chat/livedoc/liveDocInsert";
import { shapeDataUrl, iconDataUrl, chartDataUrl } from "../chat/livedoc/liveDocInsertSvg";
import { verifySignature, hashDocument } from "../chat/livedoc/liveDocSignature";

const roundtrip = (html: string) => markdownToEditorHtml(editorHtmlToMarkdown(html));

describe("toVideoEmbedUrl", () => {
  it("converts a YouTube watch URL to an embed URL", () => {
    expect(toVideoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  it("converts a youtu.be short URL", () => {
    expect(toVideoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  it("converts a Vimeo URL", () => {
    expect(toVideoEmbedUrl("https://vimeo.com/123456789")).toBe(
      "https://player.vimeo.com/video/123456789",
    );
  });

  it("passes other https URLs through unchanged", () => {
    expect(toVideoEmbedUrl("https://example.com/clip.mp4")).toBe("https://example.com/clip.mp4");
  });

  it("rejects non-URLs", () => {
    expect(toVideoEmbedUrl("just some text")).toBeNull();
  });
});

describe("insert SVG generators", () => {
  it("shapeDataUrl returns an inline SVG data URL with the shape", () => {
    const url = shapeDataUrl("circle");
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(url)).toContain("<circle");
  });

  it("iconDataUrl embeds the chosen icon geometry", () => {
    expect(decodeURIComponent(iconDataUrl("star", "#000000"))).toContain("polygon");
  });

  it("chartDataUrl draws bars for a bar chart", () => {
    expect(decodeURIComponent(chartDataUrl("bar", [1, 2, 3]))).toContain("<rect");
  });

  it("chartDataUrl draws a polyline for a line chart", () => {
    expect(decodeURIComponent(chartDataUrl("line", [1, 2, 3]))).toContain("polyline");
  });

  it("chartDataUrl draws pie slices as paths", () => {
    expect(decodeURIComponent(chartDataUrl("pie", [1, 2, 3]))).toContain("<path");
  });
});

describe("insert nodes round-trip through markdown", () => {
  it("preserves a drop-cap paragraph", () => {
    expect(editorHtmlToMarkdown('<p data-dropcap="true">Hello world</p>')).toContain("data-dropcap");
    expect(roundtrip('<p data-dropcap="true">Hello world</p>')).toContain('data-dropcap="true"');
  });

  it("preserves a text box", () => {
    const html = '<div data-livedoc-box="textbox" class="ld-box ld-box-textbox"><p>Note</p></div>';
    expect(editorHtmlToMarkdown(html)).toContain('data-livedoc-box="textbox"');
    expect(roundtrip(html)).toContain("data-livedoc-box");
  });

  it("preserves a signature-line embed", () => {
    const html =
      '<div data-livedoc-embed="signatureLine" data-name="Jane" class="ld-embed ld-embed-signatureLine"></div>';
    expect(editorHtmlToMarkdown(html)).toContain('data-livedoc-embed="signatureLine"');
    expect(roundtrip(html)).toContain("data-livedoc-embed");
  });

  it("preserves an inline comment annotation", () => {
    const html = '<p><span data-livedoc-comment="check this" class="ld-comment">word</span></p>';
    expect(editorHtmlToMarkdown(html)).toContain("data-livedoc-comment");
    expect(roundtrip(html)).toContain("data-livedoc-comment");
  });

  it("preserves a chart node (type + data)", () => {
    const data = '{&quot;labels&quot;:[&quot;A&quot;,&quot;B&quot;],&quot;datasets&quot;:[{&quot;label&quot;:&quot;S1&quot;,&quot;data&quot;:[3,7]}]}';
    const html = `<div data-livedoc-chart="" data-chart-type="line" data-chart="${data}" class="ld-chart"></div>`;
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("data-livedoc-chart");
    expect(md).toContain('data-chart-type="line"');
    const back = roundtrip(html);
    expect(back).toContain("data-livedoc-chart");
    expect(back).toContain("data-chart");
  });

  it("preserves a digital-signature embed", () => {
    const html =
      '<div data-livedoc-embed="signatureDigital" data-name="Jane" data-fingerprint="ABCD" data-signed-at="2026-06-04T00:00:00Z" data-signature="sig" data-public-key="pk" data-algorithm="ECDSA-P256-SHA256" class="ld-embed ld-embed-signatureDigital"></div>';
    expect(editorHtmlToMarkdown(html)).toContain('data-livedoc-embed="signatureDigital"');
    const back = roundtrip(html);
    expect(back).toContain("data-public-key");
    expect(back).toContain("data-signature");
  });
});

const hasSubtle = typeof globalThis.crypto !== "undefined" && !!globalThis.crypto.subtle;

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe.skipIf(!hasSubtle)("digital signature crypto", () => {
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
