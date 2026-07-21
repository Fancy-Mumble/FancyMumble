import { describe, it, expect } from "vitest";
import {
  addDocLink,
  addFolder,
  addSection,
  emptyIndex,
  findFolder,
  hasDoc,
  moveDoc,
  moveNode,
  normaliseIndex,
  removeDocLink,
  removeNode,
  renameDocLink,
  renameNode,
} from "../chat/livedoc/sidebarModel";
import type { LiveDocDocLink } from "../../types";

const doc = (slug: string, channel: number | null = 7): LiveDocDocLink => ({
  slug,
  title: `Title ${slug}`,
  channel,
  owned: false,
});

describe("liveDoc sidebar model", () => {
  it("adds a section and returns its id", () => {
    const [index, id] = addSection(emptyIndex(), "Work");
    expect(index.sections).toHaveLength(1);
    expect(index.sections[0].name).toBe("Work");
    expect(index.sections[0].id).toBe(id);
  });

  it("adds a nested folder under a section", () => {
    const [a, sectionId] = addSection(emptyIndex(), "Work");
    const [b, folderId] = addFolder(a, sectionId, "Specs");
    expect(folderId).not.toBe("");
    expect(b.sections[0].folders).toHaveLength(1);
    expect(b.sections[0].folders[0].name).toBe("Specs");
  });

  it("adds and de-duplicates a document link by slug", () => {
    const [a, sectionId] = addSection(emptyIndex(), "Work");
    let idx = addDocLink(a, sectionId, doc("plan"));
    idx = addDocLink(idx, sectionId, { ...doc("plan"), title: "Renamed" });
    expect(idx.sections[0].docs).toHaveLength(1);
    expect(idx.sections[0].docs[0].title).toBe("Renamed");
    expect(hasDoc(idx, "plan")).toBe(true);
  });

  it("removes a doc link and a node", () => {
    const [a, sectionId] = addSection(emptyIndex(), "Work");
    let idx = addDocLink(a, sectionId, doc("plan"));
    idx = removeDocLink(idx, sectionId, "plan");
    expect(idx.sections[0].docs).toHaveLength(0);
    idx = removeNode(idx, sectionId);
    expect(idx.sections).toHaveLength(0);
  });

  it("renames a node by id", () => {
    const [a, sectionId] = addSection(emptyIndex(), "Work");
    const b = renameNode(a, sectionId, "Personal");
    expect(b.sections[0].name).toBe("Personal");
  });

  it("renames every doc link matching a slug across the tree", () => {
    const [a, sectionId] = addSection(emptyIndex(), "Work");
    const [b, folderId] = addFolder(a, sectionId, "Specs");
    let idx = addDocLink(b, sectionId, doc("plan"));
    idx = addDocLink(idx, folderId, doc("plan"));
    idx = renameDocLink(idx, "plan", "New Title");
    expect(idx.sections[0].docs[0].title).toBe("New Title");
    expect(idx.sections[0].folders[0].docs[0].title).toBe("New Title");
  });

  it("renameDocLink ignores blank titles and unknown slugs", () => {
    const [a, sectionId] = addSection(emptyIndex(), "Work");
    const withDoc = addDocLink(a, sectionId, doc("plan"));
    expect(renameDocLink(withDoc, "plan", "   ")).toBe(withDoc);
    const unchanged = renameDocLink(withDoc, "missing", "X");
    expect(unchanged.sections[0].docs[0].title).toBe("Title plan");
  });

  it("removes a nested folder without dropping its siblings", () => {
    const [a, sectionId] = addSection(emptyIndex(), "Work");
    const [b, f1] = addFolder(a, sectionId, "One");
    const [c] = addFolder(b, sectionId, "Two");
    const d = removeNode(c, f1);
    expect(d.sections[0].folders.map((f) => f.name)).toEqual(["Two"]);
  });

  it("moves a folder under another folder", () => {
    const [a, work] = addSection(emptyIndex(), "Work");
    const [b, specs] = addFolder(a, work, "Specs");
    const [c, archive] = addFolder(b, work, "Archive");
    const moved = moveNode(c, specs, archive);
    // Specs is now nested under Archive, not directly under Work.
    expect(moved.sections[0].folders.map((f) => f.id)).toEqual([archive]);
    expect(findFolder(moved.sections, archive)?.folders.map((f) => f.id)).toEqual([specs]);
  });

  it("promotes a folder to a top-level section when target is null", () => {
    const [a, work] = addSection(emptyIndex(), "Work");
    const [b, specs] = addFolder(a, work, "Specs");
    const moved = moveNode(b, specs, null);
    expect(moved.sections.map((s) => s.id)).toEqual([work, specs]);
    expect(findFolder([moved.sections[0]], specs)).toBeNull();
  });

  it("refuses to move a folder into its own descendant", () => {
    const [a, work] = addSection(emptyIndex(), "Work");
    const [b, parent] = addFolder(a, work, "Parent");
    const [c, child] = addFolder(b, parent, "Child");
    // Moving Parent into Child would detach the subtree - must no-op.
    expect(moveNode(c, parent, child)).toBe(c);
    // And moving a node onto itself is also a no-op.
    expect(moveNode(c, parent, parent)).toBe(c);
  });

  it("moves a document link between folders", () => {
    const [a, work] = addSection(emptyIndex(), "Work");
    const [b, specs] = addFolder(a, work, "Specs");
    const withDoc = addDocLink(b, work, doc("plan"));
    const moved = moveDoc(withDoc, doc("plan"), work, specs);
    expect(moved.sections[0].docs).toHaveLength(0);
    expect(findFolder(moved.sections, specs)?.docs.map((d) => d.slug)).toEqual(["plan"]);
  });

  it("normalises arbitrary/partial input into a valid index", () => {
    expect(normaliseIndex(null).sections).toEqual([]);
    const messy = { sections: [{ name: "X", docs: [{ slug: "s", title: "t" }, { bad: 1 }] }] };
    const idx = normaliseIndex(messy);
    expect(idx.v).toBe(1);
    expect(idx.sections[0].name).toBe("X");
    expect(idx.sections[0].docs).toHaveLength(1);
    expect(idx.sections[0].folders).toEqual([]);
  });
});
