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
import { RECORD_KEYS, classify, getRecord, putRecord } from "../../accountRecords";
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

/** Fixed private-storage key the sidebar is stored under, on a server whose
 *  storage is the file-server plugin.
 *
 *  Deliberately a different string from `RECORD_KEYS.liveDocSidebar`: a server
 *  that has both stores must not have a write to one land where the other
 *  reads, because nothing keeps the two in step. */
const SIDEBAR_KEY = "livedoc-sidebar";

/** Where this connection's sidebar is kept.
 *
 *  Settled by the first load and read by every persist after it, so an edit
 *  cannot be written to a store the load did not come from. `null` until a
 *  load has run, and while it is null nothing is persisted at all. */
let backend: "records" | "plugin" | null = null;
/** Debounce window for persisting sidebar edits. */
const PERSIST_DEBOUNCE_MS = 800;

interface SidebarState {
  index: LiveDocIndex;
  /** True once an initial load attempt has completed. */
  loaded: boolean;
  /** True when the sidebar can be persisted (registered user + file server). */
  available: boolean;
  /** Why the sidebar is unavailable, so the UI can tell a genuine guest
   *  ("register to keep documents") apart from a server with no private
   *  storage at all ("this server keeps no library") and from a transient
   *  server error ("couldn't load - try again"). `null` while available or
   *  before load. */
  reason: "guest" | "unsupported" | "error" | null;
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

/** Whether this session is a registered account on the server.
 *
 *  Read from the session's own user entry rather than from
 *  `fileServerConfig.registered`: that flag is what the file-server *plugin*
 *  said about this session, and a server without that plugin (canon file
 *  sharing, or no file service at all) has nobody to say it - the config the
 *  client synthesises there reports `false` for everyone.  Telling a
 *  registered user they are not registered is the bug this exists to stop. */
function selfIsRegistered(): boolean {
  const state = useAppStore.getState();
  const me = state.users.find((u) => u.session === state.ownSession);
  return me?.user_id != null;
}

/** What a load settled on, or that this server keeps no records at all. */
type LoadResult = Pick<SidebarState, "index" | "loaded" | "available" | "reason"> | "unsupported";

/** Read the sidebar out of the account record store.
 *
 *  Returns `"unsupported"` - and only that - when the server has no record
 *  store, which is the one case where the caller should go on to try the
 *  plugin. Every other outcome is this store's answer and is final: a refusal
 *  means this account cannot keep records (a guest), and an error means the
 *  read failed, so `current` is kept and persistence stays off - otherwise the
 *  next edit would overwrite a real stored tree with an empty one. */
async function loadFromRecords(current: LiveDocIndex): Promise<LoadResult> {
  try {
    const record = await getRecord(RECORD_KEYS.liveDocSidebar);
    const index = record.found && record.value ? normaliseIndex(JSON.parse(record.value)) : emptyIndex();
    return { index, loaded: true, available: true, reason: null };
  } catch (e) {
    const { failure } = classify(e);
    if (failure === "unsupported") return "unsupported";
    if (failure === "refused") {
      // The account cannot keep records, which for this store means a guest.
      // "guest" rather than "no storage": registering is what fixes it.
      return { index: emptyIndex(), loaded: true, available: false, reason: "guest" };
    }
    console.warn("[liveDocSidebar] record load failed:", e);
    return { index: current, loaded: true, available: false, reason: "error" };
  }
}

function schedulePersist(index: LiveDocIndex): void {
  if (backend === null) return;
  const creds = backend === "plugin" ? privateStorageCreds() : null;
  if (backend === "plugin" && !creds) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const value = JSON.stringify(index);
    const written =
      creds === null
        ? putRecord(RECORD_KEYS.liveDocSidebar, value)
        : invoke("fileserver_put_private", { request: { ...creds, key: SIDEBAR_KEY, value } });
    void Promise.resolve(written).catch((e) => {
      // Shown, not only logged: a persist that fails - the record ceiling,
      // a dropped connection - leaves the user editing a library that is no
      // longer being saved, and the sidebar has an error state and a retry
      // for exactly that. `available` stays false until a reload succeeds,
      // so the next edit cannot write over what the server still holds.
      console.warn("[liveDocSidebar] persist failed:", e);
      useLiveDocSidebarStore.setState({ available: false, reason: "error" });
    });
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
    reason: null,

    load: async () => {
      // The server's own store first. It works without a plugin, so a server
      // that has it needs nothing else; only "no such store" is a reason to
      // go on and look for the plugin.
      const fromServer = await loadFromRecords(get().index);
      if (fromServer !== "unsupported") {
        backend = "records";
        set(fromServer);
        return;
      }
      backend = "plugin";

      const creds = privateStorageCreds();
      if (!creds) {
        // Nowhere to persist to.  Which of the two reasons it is decides what
        // the UI says: a guest can fix it by registering, a registered user on
        // a server with no private storage cannot, and telling them to
        // register is both wrong and unactionable.
        const reason = selfIsRegistered() ? "unsupported" : "guest";
        set({ index: emptyIndex(), loaded: true, available: false, reason });
        return;
      }
      try {
        const raw = await invoke<string | null>("fileserver_get_private", {
          request: { ...creds, key: SIDEBAR_KEY },
        });
        const index = raw ? normaliseIndex(JSON.parse(raw)) : emptyIndex();
        set({ index, loaded: true, available: true, reason: null });
      } catch (e) {
        console.warn("[liveDocSidebar] load failed:", e);
        // A failed read means we do NOT know the stored contents, so we must
        // never mark the sidebar persistable - otherwise the next edit would
        // overwrite the real stored index with an empty one.  Keep the
        // current in-memory index untouched and leave persistence disabled.
        //
        // Distinguish a genuine guest (the server replied 403 - the backend
        // prefixes that error with "forbidden:") from a transient server/network
        // error, so the UI shows the right message instead of always claiming
        // the user isn't registered.  A 403 alone does not prove guest: the
        // file-server answers a rejected session token - an expired one, say -
        // the same way, and that must not read as "you aren't registered"
        // either.
        const forbidden = String(e ?? "").startsWith("forbidden:");
        const isGuest = forbidden && !selfIsRegistered();
        set({ loaded: true, available: false, reason: isGuest ? "guest" : "error" });
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
