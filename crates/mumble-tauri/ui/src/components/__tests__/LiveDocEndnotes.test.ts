/**
 * Unit tests for the Live Doc endnote logic (roadmap item 3).
 *
 * Extraction and numbering are pure (operate on a ProseMirror document),
 * so these tests build a real headless `Editor` in jsdom with the custom
 * EndnoteRef and EndnotesSection nodes registered and assert against the
 * derived `EndnoteEntry[]`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EndnoteRef } from "../chat/livedoc/liveDocEndnote";
import { EndnotesSection } from "../chat/livedoc/liveDocEndnotesSection";
import {
  endnoteNumberFor,
  endnotesSignature,
  extractEndnotes,
  findEndnotesSectionPos,
  hasEndnotesSection,
  resolveEndnote,
} from "../chat/livedoc/liveDocEndnotes";

type DocContent = JSONContent;

function marker(noteId: string, text: string) {
  return { type: "endnoteRef", attrs: { noteId, text } };
}

function paragraph(...content: JSONContent[]) {
  return { type: "paragraph", content };
}

let editor: Editor | null = null;

function makeEditor(content: DocContent): Editor {
  editor = new Editor({
    extensions: [StarterKit, EndnoteRef, EndnotesSection],
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("extractEndnotes", () => {
  it("collects markers in document order with 1-based numbers", () => {
    const ed = makeEditor({
      type: "doc",
      content: [
        paragraph({ type: "text", text: "Alpha" }, marker("en-1", "first note")),
        paragraph({ type: "text", text: "Beta" }, marker("en-2", "second note")),
      ],
    });
    const entries = extractEndnotes(ed.state.doc);
    expect(entries.map((e) => e.noteId)).toEqual(["en-1", "en-2"]);
    expect(entries.map((e) => e.number)).toEqual([1, 2]);
    expect(entries.map((e) => e.text)).toEqual(["first note", "second note"]);
  });

  it("reports ascending positions", () => {
    const ed = makeEditor({
      type: "doc",
      content: [
        paragraph({ type: "text", text: "x" }, marker("a", "")),
        paragraph(marker("b", "")),
      ],
    });
    const entries = extractEndnotes(ed.state.doc);
    expect(entries[0].pos).toBeLessThan(entries[1].pos);
  });

  it("skips markers without a noteId", () => {
    const ed = makeEditor({
      type: "doc",
      content: [paragraph(marker("", "orphan"), marker("keep", "kept"))],
    });
    const entries = extractEndnotes(ed.state.doc);
    expect(entries).toHaveLength(1);
    expect(entries[0].noteId).toBe("keep");
    expect(entries[0].number).toBe(1);
  });

  it("renumbers when an earlier marker is removed", () => {
    const ed = makeEditor({
      type: "doc",
      content: [paragraph(marker("a", ""), marker("b", ""), marker("c", ""))],
    });
    const all = extractEndnotes(ed.state.doc);
    expect(endnoteNumberFor("c", all)).toBe(3);

    const without = all.filter((e) => e.noteId !== "a");
    // Simulate the live recompute: numbering is positional, so the pure
    // helper always starts at 1 for the surviving set.
    const renumbered = without.map((e, i) => ({ ...e, number: i + 1 }));
    expect(endnoteNumberFor("c", renumbered)).toBe(2);
  });
});

describe("resolveEndnote / endnoteNumberFor", () => {
  it("resolves by id and returns the number", () => {
    const ed = makeEditor({
      type: "doc",
      content: [paragraph(marker("a", "one"), marker("b", "two"))],
    });
    const entries = extractEndnotes(ed.state.doc);
    expect(resolveEndnote("b", entries)?.text).toBe("two");
    expect(endnoteNumberFor("b", entries)).toBe(2);
    expect(resolveEndnote("missing", entries)).toBeUndefined();
    expect(endnoteNumberFor("missing", entries)).toBeUndefined();
  });
});

describe("endnotes section helpers", () => {
  it("detects an existing section and its position", () => {
    const ed = makeEditor({
      type: "doc",
      content: [
        paragraph({ type: "text", text: "body" }, marker("a", "note")),
        { type: "endnotesSection" },
        paragraph(),
      ],
    });
    expect(hasEndnotesSection(ed.state.doc)).toBe(true);
    expect(findEndnotesSectionPos(ed.state.doc)).toBeGreaterThan(0);
  });

  it("reports no section when absent", () => {
    const ed = makeEditor({
      type: "doc",
      content: [paragraph({ type: "text", text: "body" })],
    });
    expect(hasEndnotesSection(ed.state.doc)).toBe(false);
    expect(findEndnotesSectionPos(ed.state.doc)).toBeUndefined();
  });

  it("insertEndnotesSection adds exactly one section", () => {
    const ed = makeEditor({
      type: "doc",
      content: [paragraph({ type: "text", text: "body" }, marker("a", "note"))],
    });
    ed.chain().insertEndnotesSection().run();
    expect(hasEndnotesSection(ed.state.doc)).toBe(true);

    ed.chain().insertEndnotesSection().run();
    let count = 0;
    ed.state.doc.descendants((node) => {
      if (node.type.name === "endnotesSection") count += 1;
      return undefined;
    });
    expect(count).toBe(1);
  });
});

describe("endnotesSignature", () => {
  it("changes when note text changes", () => {
    const a = makeEditor({
      type: "doc",
      content: [paragraph(marker("a", "before"))],
    });
    const sigBefore = endnotesSignature(extractEndnotes(a.state.doc));
    a.destroy();

    const b = makeEditor({
      type: "doc",
      content: [paragraph(marker("a", "after"))],
    });
    const sigAfter = endnotesSignature(extractEndnotes(b.state.doc));
    expect(sigBefore).not.toBe(sigAfter);
  });

  it("is stable for identical documents", () => {
    const doc: DocContent = {
      type: "doc",
      content: [paragraph(marker("a", "n1"), marker("b", "n2"))],
    };
    const a = makeEditor(doc);
    const sigA = endnotesSignature(extractEndnotes(a.state.doc));
    a.destroy();
    const b = makeEditor(doc);
    const sigB = endnotesSignature(extractEndnotes(b.state.doc));
    expect(sigA).toBe(sigB);
  });
});
