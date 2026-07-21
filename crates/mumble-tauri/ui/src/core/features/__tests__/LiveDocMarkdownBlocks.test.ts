/**
 * Tests for the block-offset mapping used to place collaborators' carets in
 * the markdown view: `editorHtmlToMarkdown({ markBlocks })` marks each
 * top-level block, and `stripBlockSentinels` removes the markers while
 * recording where each block lands.
 */

import { describe, expect, it } from "vitest";
import { editorHtmlToMarkdown, stripBlockSentinels } from "../chat/livedoc/liveDocMarkdown";

describe("block sentinels", () => {
  it("stripping the marked output reproduces the un-marked output", () => {
    const html = "<p>Alpha</p><h1>Title</h1><blockquote><p>Quote</p></blockquote><p>End</p>";
    const plain = editorHtmlToMarkdown(html);
    const { text } = stripBlockSentinels(editorHtmlToMarkdown(html, { markBlocks: true }));
    expect(text).toBe(plain);
  });

  it("records the offset where each top-level block starts", () => {
    const html = "<p>Alpha</p><h1>Title</h1><p>Beta gamma</p>";
    const { text, blockStarts } = stripBlockSentinels(
      editorHtmlToMarkdown(html, { markBlocks: true }),
    );
    expect(blockStarts[0]).toBe(0);
    expect(text.slice(blockStarts[1])).toMatch(/^# Title/);
    expect(text.slice(blockStarts[2])).toMatch(/^Beta gamma/);
  });

  it("emits no sentinels (and leaves text intact) without markBlocks", () => {
    const html = "<p>Alpha</p><p>Beta</p>";
    const plain = editorHtmlToMarkdown(html);
    const { text, blockStarts } = stripBlockSentinels(plain);
    expect(text).toBe(plain);
    expect(blockStarts.length).toBe(0);
  });
});
