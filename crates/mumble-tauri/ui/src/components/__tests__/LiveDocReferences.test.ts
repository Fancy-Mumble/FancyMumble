/**
 * Unit tests for the Live Doc reference logic (bookmarks, captions and
 * cross-references) that powers the cross-reference picker.
 *
 * Extraction is pure (operates on a ProseMirror document), so the tests
 * build a real headless `Editor` in jsdom with the custom Bookmark and
 * Caption nodes registered and assert against `RefTarget[]`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Bookmark } from "../chat/livedoc/liveDocBookmark";
import { Caption } from "../chat/livedoc/liveDocCaption";
import type { CaptionKind } from "../chat/livedoc/liveDocReferences";
import {
  bookmarkTargetId,
  captionTargetId,
  extractReferenceTargets,
  headingTargetId,
  isNumberedTarget,
  refSlug,
  referenceTargetsSignature,
  resolveTarget,
} from "../chat/livedoc/liveDocReferences";

type DocContent = JSONContent;

function heading(level: number, text: string) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function bookmark(bookmarkId: string, label: string) {
  return {
    type: "paragraph",
    content: [{ type: "bookmark", attrs: { bookmarkId, label } }],
  };
}

function caption(kind: CaptionKind, captionId: string, text: string) {
  return {
    type: "caption",
    attrs: { kind, captionId },
    content: [{ type: "text", text }],
  };
}

let editor: Editor | null = null;

function makeEditor(content: DocContent): Editor {
  editor = new Editor({ extensions: [StarterKit, Bookmark, Caption], content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("extractReferenceTargets", () => {
  it("extracts headings, bookmarks and captions in document order", () => {
    const e = makeEditor({
      type: "doc",
      content: [
        heading(1, "Intro"),
        bookmark("bm1", "Key point"),
        caption("figure", "c1", "A diagram"),
      ],
    });
    const targets = extractReferenceTargets(e.state.doc);
    expect(targets.map((x) => x.kind)).toEqual(["heading", "bookmark", "figure"]);
    expect(targets.map((x) => x.id)).toEqual([
      headingTargetId("Intro"),
      bookmarkTargetId("bm1"),
      captionTargetId("c1"),
    ]);
    expect(targets.map((x) => x.pos)).toEqual([...targets.map((x) => x.pos)].sort((a, b) => a - b));
  });

  it("numbers captions per kind, 1-based", () => {
    const e = makeEditor({
      type: "doc",
      content: [
        caption("figure", "f1", "First figure"),
        caption("table", "t1", "First table"),
        caption("figure", "f2", "Second figure"),
        caption("equation", "e1", "First equation"),
        caption("table", "t2", "Second table"),
      ],
    });
    const targets = extractReferenceTargets(e.state.doc);
    const byId = (id: string) => targets.find((x) => x.id === captionTargetId(id));
    expect(byId("f1")?.number).toBe(1);
    expect(byId("f2")?.number).toBe(2);
    expect(byId("t1")?.number).toBe(1);
    expect(byId("t2")?.number).toBe(2);
    expect(byId("e1")?.number).toBe(1);
  });

  it("uses the bookmark label as its target label", () => {
    const e = makeEditor({
      type: "doc",
      content: [bookmark("bm-x", "My anchor")],
    });
    const [target] = extractReferenceTargets(e.state.doc);
    expect(target.kind).toBe("bookmark");
    expect(target.label).toBe("My anchor");
    expect(target.number).toBeUndefined();
  });

  it("skips bookmarks without an id", () => {
    const e = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "bookmark", attrs: { bookmarkId: "", label: "x" } }],
        },
      ],
    });
    expect(extractReferenceTargets(e.state.doc)).toHaveLength(0);
  });
});

describe("resolveTarget", () => {
  it("resolves an id to the first matching target", () => {
    const e = makeEditor({
      type: "doc",
      content: [heading(1, "A"), heading(2, "B")],
    });
    const targets = extractReferenceTargets(e.state.doc);
    expect(resolveTarget(headingTargetId("B"), targets)?.label).toBe("B");
    expect(resolveTarget("missing", targets)).toBeUndefined();
  });
});

describe("isNumberedTarget", () => {
  it("is true only for caption kinds", () => {
    const e = makeEditor({
      type: "doc",
      content: [
        heading(1, "H"),
        bookmark("b", "B"),
        caption("figure", "f", "F"),
      ],
    });
    const targets = extractReferenceTargets(e.state.doc);
    const kind = (k: string) => targets.find((x) => x.kind === k)!;
    expect(isNumberedTarget(kind("heading"))).toBe(false);
    expect(isNumberedTarget(kind("bookmark"))).toBe(false);
    expect(isNumberedTarget(kind("figure"))).toBe(true);
  });
});

describe("refSlug", () => {
  it("lowercases, strips punctuation and hyphenates", () => {
    expect(refSlug("Hello, World!")).toBe("hello-world");
    expect(refSlug("  Multiple   Spaces  ")).toBe("multiple-spaces");
  });

  it("falls back to 'section' for empty input", () => {
    expect(refSlug("")).toBe("section");
    expect(refSlug("!!!")).toBe("section");
  });
});

describe("referenceTargetsSignature", () => {
  it("changes when a label changes", () => {
    const e1 = makeEditor({ type: "doc", content: [heading(1, "A")] });
    const s1 = referenceTargetsSignature(extractReferenceTargets(e1.state.doc));
    e1.destroy();
    const e2 = makeEditor({ type: "doc", content: [heading(1, "B")] });
    const s2 = referenceTargetsSignature(extractReferenceTargets(e2.state.doc));
    expect(s1).not.toBe(s2);
  });

  it("is stable for identical documents", () => {
    const e1 = makeEditor({ type: "doc", content: [heading(1, "A")] });
    const s1 = referenceTargetsSignature(extractReferenceTargets(e1.state.doc));
    e1.destroy();
    const e2 = makeEditor({ type: "doc", content: [heading(1, "A")] });
    const s2 = referenceTargetsSignature(extractReferenceTargets(e2.state.doc));
    expect(s1).toBe(s2);
  });
});
