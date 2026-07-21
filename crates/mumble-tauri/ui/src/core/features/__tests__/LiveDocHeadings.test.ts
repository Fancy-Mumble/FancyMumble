/**
 * Unit tests for the Live Doc heading-extraction logic that powers the
 * outline pane and the in-document table of contents.
 *
 * The extraction is pure (operates on a ProseMirror document), so the
 * tests build a real headless `Editor` in jsdom and assert against the
 * resulting `HeadingItem[]` - no layout or DOM measurement required.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  extractHeadings,
  minHeadingLevel,
  slugifyHeading,
} from "../chat/livedoc/liveDocHeadings";

type DocContent = JSONContent;

function heading(level: number, text: string) {
  return {
    type: "heading",
    attrs: { level },
    content: text ? [{ type: "text", text }] : [],
  };
}

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

let editor: Editor | null = null;

function makeEditor(content: DocContent): Editor {
  editor = new Editor({ extensions: [StarterKit], content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("extractHeadings", () => {
  it("returns headings in document order with level, text and index", () => {
    const e = makeEditor({
      type: "doc",
      content: [
        heading(1, "Title"),
        paragraph("intro"),
        heading(2, "Section A"),
        paragraph("body"),
        heading(3, "Detail"),
      ],
    });

    const headings = extractHeadings(e.state.doc);

    expect(headings.map((h) => h.text)).toEqual(["Title", "Section A", "Detail"]);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3]);
    expect(headings.map((h) => h.index)).toEqual([0, 1, 2]);
  });

  it("ignores non-heading nodes", () => {
    const e = makeEditor({
      type: "doc",
      content: [paragraph("just text"), paragraph("more text")],
    });

    expect(extractHeadings(e.state.doc)).toHaveLength(0);
  });

  it("trims heading text and tolerates empty headings", () => {
    const e = makeEditor({
      type: "doc",
      content: [heading(1, "  Spaced  "), heading(2, "")],
    });

    const headings = extractHeadings(e.state.doc);
    expect(headings[0].text).toBe("Spaced");
    expect(headings[1].text).toBe("");
  });

  it("assigns ascending positions matching document order", () => {
    const e = makeEditor({
      type: "doc",
      content: [heading(1, "First"), heading(1, "Second"), heading(1, "Third")],
    });

    const positions = extractHeadings(e.state.doc).map((h) => h.pos);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("produces unique ids even for duplicate heading text", () => {
    const e = makeEditor({
      type: "doc",
      content: [heading(2, "Notes"), heading(2, "Notes")],
    });

    const ids = extractHeadings(e.state.doc).map((h) => h.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("minHeadingLevel", () => {
  it("returns the smallest level present", () => {
    const e = makeEditor({
      type: "doc",
      content: [heading(2, "A"), heading(4, "B"), heading(3, "C")],
    });
    expect(minHeadingLevel(extractHeadings(e.state.doc))).toBe(2);
  });

  it("defaults to 1 for an empty list", () => {
    expect(minHeadingLevel([])).toBe(1);
  });
});

describe("slugifyHeading", () => {
  it("lowercases, strips punctuation and joins words with hyphens", () => {
    expect(slugifyHeading("Hello, World!", 0)).toBe("hello-world-0");
  });

  it("falls back to a generic slug for empty text", () => {
    expect(slugifyHeading("", 3)).toBe("heading-3");
    expect(slugifyHeading("***", 2)).toBe("heading-2");
  });
});
