/**
 * Pure, framework-free helpers for manipulating the Live Doc sidebar
 * tree (`LiveDocIndex`).  Kept separate from the Zustand store and React
 * so the tree logic is trivially unit-testable.
 *
 * All operations are immutable: they return a new index and never mutate
 * their input, so they compose cleanly with `setState`.
 */

import type {
  LiveDocDocLink,
  LiveDocFolder,
  LiveDocIndex,
  LiveDocSection,
} from "../../../types";

/** Current sidebar schema version. */
export const SIDEBAR_VERSION = 1;

/** An empty sidebar with no sections. */
export function emptyIndex(): LiveDocIndex {
  return { v: SIDEBAR_VERSION, sections: [] };
}

/** Generate a stable-ish unique id for a section/folder node. */
export function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
}

/** Normalise an arbitrary parsed value into a valid `LiveDocIndex`,
 *  tolerating older/partial shapes from storage. */
export function normaliseIndex(raw: unknown): LiveDocIndex {
  if (!raw || typeof raw !== "object") return emptyIndex();
  const obj = raw as Partial<LiveDocIndex>;
  const sections = Array.isArray(obj.sections) ? obj.sections.map(normaliseFolder) : [];
  return { v: SIDEBAR_VERSION, sections };
}

function normaliseFolder(raw: unknown): LiveDocFolder {
  const obj = (raw ?? {}) as Partial<LiveDocFolder>;
  return {
    id: typeof obj.id === "string" ? obj.id : newId(),
    name: typeof obj.name === "string" ? obj.name : "Untitled",
    folders: Array.isArray(obj.folders) ? obj.folders.map(normaliseFolder) : [],
    docs: Array.isArray(obj.docs) ? obj.docs.filter(isDocLink) : [],
  };
}

function isDocLink(raw: unknown): raw is LiveDocDocLink {
  const o = raw as Partial<LiveDocDocLink> | null;
  return !!o && typeof o.slug === "string" && typeof o.title === "string";
}

/** Add a new top-level section.  Returns `[index, newSectionId]`. */
export function addSection(index: LiveDocIndex, name: string): [LiveDocIndex, string] {
  const id = newId();
  const section: LiveDocSection = { id, name: name.trim() || "New section", folders: [], docs: [] };
  return [{ ...index, sections: [...index.sections, section] }, id];
}

/** Add a folder under the section/folder identified by `parentId`.
 *  Returns `[index, newFolderId]` (id empty if parent not found). */
export function addFolder(index: LiveDocIndex, parentId: string, name: string): [LiveDocIndex, string] {
  const id = newId();
  const folder: LiveDocFolder = { id, name: name.trim() || "New folder", folders: [], docs: [] };
  let added = false;
  const sections = index.sections.map((s) =>
    mapNode(s, parentId, (node) => {
      added = true;
      return { ...node, folders: [...node.folders, folder] };
    }),
  );
  return [{ ...index, sections }, added ? id : ""];
}

/** Rename a section/folder by id. */
export function renameNode(index: LiveDocIndex, id: string, name: string): LiveDocIndex {
  const trimmed = name.trim();
  if (!trimmed) return index;
  return {
    ...index,
    sections: index.sections.map((s) => mapNode(s, id, (node) => ({ ...node, name: trimmed }))),
  };
}

/** Remove a section/folder (and everything under it) by id. */
export function removeNode(index: LiveDocIndex, id: string): LiveDocIndex {
  return {
    ...index,
    sections: index.sections.filter((s) => s.id !== id).map((s) => removeChildNode(s, id)),
  };
}

/** Add (or update) a document link under the given section/folder.
 *  De-duplicates by slug within that node. */
export function addDocLink(index: LiveDocIndex, parentId: string, link: LiveDocDocLink): LiveDocIndex {
  return {
    ...index,
    sections: index.sections.map((s) =>
      mapNode(s, parentId, (node) => ({
        ...node,
        docs: [...node.docs.filter((d) => d.slug !== link.slug), link],
      })),
    ),
  };
}

/** Remove a document link (by slug) from the given section/folder. */
export function removeDocLink(index: LiveDocIndex, parentId: string, slug: string): LiveDocIndex {
  return {
    ...index,
    sections: index.sections.map((s) =>
      mapNode(s, parentId, (node) => ({
        ...node,
        docs: node.docs.filter((d) => d.slug !== slug),
      })),
    ),
  };
}

/** Rename every document link matching `slug` anywhere in the tree.
 *  Used to keep the sidebar in sync when a document is renamed while
 *  open (the same slug may be saved under several sections/folders). */
export function renameDocLink(index: LiveDocIndex, slug: string, title: string): LiveDocIndex {
  const trimmed = title.trim();
  if (!trimmed) return index;
  const renameInNode = (node: LiveDocFolder): LiveDocFolder => ({
    ...node,
    folders: node.folders.map(renameInNode),
    docs: node.docs.map((d) => (d.slug === slug ? { ...d, title: trimmed } : d)),
  });
  return { ...index, sections: index.sections.map(renameInNode) };
}

/** Move a folder/section node so it becomes a child of `targetParentId`
 *  (or a top-level section when `targetParentId` is `null`).
 *
 *  No-ops when the node is missing, dropped onto itself, or would be
 *  moved into one of its own descendants (which would detach the subtree
 *  from the tree).  The moved node keeps its id, name and contents. */
export function moveNode(
  index: LiveDocIndex,
  nodeId: string,
  targetParentId: string | null,
): LiveDocIndex {
  if (nodeId === targetParentId) return index;
  const node = findFolder(index.sections, nodeId);
  if (!node) return index;
  // Refuse to move a folder into itself or any of its descendants.
  if (targetParentId !== null && containsFolder(node, targetParentId)) return index;
  const without = removeNode(index, nodeId);
  if (targetParentId === null) {
    return { ...without, sections: [...without.sections, node] };
  }
  let inserted = false;
  const sections = without.sections.map((s) =>
    mapNode(s, targetParentId, (n) => {
      inserted = true;
      return { ...n, folders: [...n.folders, node] };
    }),
  );
  // Target vanished unexpectedly - leave the tree untouched rather than
  // dropping the node.
  return inserted ? { ...without, sections } : index;
}

/** Move a document link from `fromParentId` to `targetParentId`.
 *  De-duplicates by slug in the destination (see [`addDocLink`]). */
export function moveDoc(
  index: LiveDocIndex,
  link: LiveDocDocLink,
  fromParentId: string,
  targetParentId: string,
): LiveDocIndex {
  if (fromParentId === targetParentId) return index;
  const removed = removeDocLink(index, fromParentId, link.slug);
  return addDocLink(removed, targetParentId, link);
}

/** Find a folder/section node by id anywhere in the tree. */
export function findFolder(
  sections: ReadonlyArray<LiveDocFolder>,
  id: string,
): LiveDocFolder | null {
  for (const node of sections) {
    if (node.id === id) return node;
    const found = findFolder(node.folders, id);
    if (found) return found;
  }
  return null;
}

/** True if `id` is `node` itself or any folder nested beneath it. */
export function containsFolder(node: LiveDocFolder, id: string): boolean {
  return node.id === id || node.folders.some((f) => containsFolder(f, id));
}

/** True if any node in the tree contains a doc link with the given slug. */
export function hasDoc(index: LiveDocIndex, slug: string): boolean {
  const walk = (node: LiveDocFolder): boolean =>
    node.docs.some((d) => d.slug === slug) || node.folders.some(walk);
  return index.sections.some(walk);
}

/** Apply `fn` to the node whose id matches `targetId`, recursing into
 *  child folders.  Returns the (possibly) updated node. */
function mapNode(
  node: LiveDocFolder,
  targetId: string,
  fn: (n: LiveDocFolder) => LiveDocFolder,
): LiveDocFolder {
  if (node.id === targetId) return fn(node);
  return { ...node, folders: node.folders.map((f) => mapNode(f, targetId, fn)) };
}

/** Remove a child folder with `id` anywhere beneath `node`. */
function removeChildNode(node: LiveDocFolder, id: string): LiveDocFolder {
  return {
    ...node,
    folders: node.folders.filter((f) => f.id !== id).map((f) => removeChildNode(f, id)),
  };
}
