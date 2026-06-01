/**
 * Zustand store for the Live Doc sidebar tree.
 *
 * The tree is persisted in the file-server's per-user *private storage*
 * (registered users only) under a fixed key.  The file-server treats it
 * as an opaque blob - it has no knowledge of live-docs - so the sidebar
 * stays fully decoupled.  When the user is a guest or no file-server is
 * configured, the sidebar still works in-memory for the session but is
 * not persisted (`available === false`), and the UI shows a hint.
 */

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { LiveDocDocLink, LiveDocIndex } from "../../../types";
import { useAppStore } from "../../../store";
import {
  addDocLink,
  addFolder,
  addSection,
  emptyIndex,
  moveDoc,
  moveNode,
  normaliseIndex,
  removeDocLink,
  removeNode,
  renameDocLink,
  renameNode,
} from "./sidebarModel";

/** Fixed private-storage key the sidebar is stored under. */
const SIDEBAR_KEY = "livedoc-sidebar";
/** Debounce window for persisting sidebar edits. */
const PERSIST_DEBOUNCE_MS = 800;

interface SidebarState {
  index: LiveDocIndex;
  /** True once an initial load attempt has completed. */
  loaded: boolean;
  /** True when the sidebar can be persisted (registered user + file server). */
  available: boolean;
  load: () => Promise<void>;
  addSection: (name: string) => void;
  addFolder: (parentId: string, name: string) => void;
  renameNode: (id: string, name: string) => void;
  removeNode: (id: string) => void;
  saveDocLink: (parentId: string, link: LiveDocDocLink) => void;
  removeDocLink: (parentId: string, slug: string) => void;
  /** Rename every saved link with the given slug (e.g. after an open
   *  document is renamed). */
  renameDocLink: (slug: string, title: string) => void;
  /** Save a document into the first section, creating a default section
   *  named `defaultSectionName` if none exists yet.  Returns the id of
   *  the section the link was saved into. */
  saveDocToDefault: (link: LiveDocDocLink, defaultSectionName: string) => string;
  /** Move a folder/section under a new parent (`null` = top-level). */
  moveNode: (nodeId: string, targetParentId: string | null) => void;
  /** Move a document link from one folder/section to another. */
  moveDoc: (link: LiveDocDocLink, fromParentId: string, targetParentId: string) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Resolve the file-server credentials needed for private storage, or
 *  `null` when the user is a guest / no file-server is available. */
function privateStorageCreds(): { baseUrl: string; sessionJwt: string } | null {
  const cfg = useAppStore.getState().fileServerConfig;
  if (!cfg || !cfg.registered || !cfg.sessionJwt) return null;
  return { baseUrl: cfg.baseUrl, sessionJwt: cfg.sessionJwt };
}

function schedulePersist(index: LiveDocIndex): void {
  const creds = privateStorageCreds();
  if (!creds) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void invoke("fileserver_put_private", {
      request: { ...creds, key: SIDEBAR_KEY, value: JSON.stringify(index) },
    }).catch((e) => console.warn("[liveDocSidebar] persist failed:", e));
  }, PERSIST_DEBOUNCE_MS);
}

export const useLiveDocSidebarStore = create<SidebarState>((set, get) => {
  /** Apply a reducer to the current index, then persist. */
  const mutate = (next: LiveDocIndex) => {
    set({ index: next });
    schedulePersist(next);
  };

  return {
    index: emptyIndex(),
    loaded: false,
    available: false,

    load: async () => {
      const creds = privateStorageCreds();
      if (!creds) {
        set({ index: emptyIndex(), loaded: true, available: false });
        return;
      }
      try {
        const raw = await invoke<string | null>("fileserver_get_private", {
          request: { ...creds, key: SIDEBAR_KEY },
        });
        const index = raw ? normaliseIndex(JSON.parse(raw)) : emptyIndex();
        set({ index, loaded: true, available: true });
      } catch (e) {
        console.warn("[liveDocSidebar] load failed:", e);
        // A failed read means we do NOT know the stored contents, so we must
        // never mark the sidebar persistable - otherwise the next edit would
        // overwrite the real stored index with an empty one.  Keep the
        // current in-memory index untouched and leave persistence disabled.
        set({ loaded: true, available: false });
      }
    },

    addSection: (name) => mutate(addSection(get().index, name)[0]),
    addFolder: (parentId, name) => mutate(addFolder(get().index, parentId, name)[0]),
    renameNode: (id, name) => mutate(renameNode(get().index, id, name)),
    removeNode: (id) => mutate(removeNode(get().index, id)),
    saveDocLink: (parentId, link) => mutate(addDocLink(get().index, parentId, link)),
    removeDocLink: (parentId, slug) => mutate(removeDocLink(get().index, parentId, slug)),
    renameDocLink: (slug, title) => mutate(renameDocLink(get().index, slug, title)),
    saveDocToDefault: (link, defaultSectionName) => {
      let index = get().index;
      let sectionId = index.sections[0]?.id;
      if (!sectionId) {
        [index, sectionId] = addSection(index, defaultSectionName);
      }
      mutate(addDocLink(index, sectionId, link));
      return sectionId;
    },
    moveNode: (nodeId, targetParentId) => mutate(moveNode(get().index, nodeId, targetParentId)),
    moveDoc: (link, fromParentId, targetParentId) =>
      mutate(moveDoc(get().index, link, fromParentId, targetParentId)),
  };
});
