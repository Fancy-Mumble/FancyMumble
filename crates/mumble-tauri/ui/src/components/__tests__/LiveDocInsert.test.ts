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
