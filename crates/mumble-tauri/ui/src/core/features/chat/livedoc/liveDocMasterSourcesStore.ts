/**
 * liveDocMasterSourcesStore - the per-user *master* source library, the
 * Word-style "Master List" that is reused across documents.
 *
 * Like the sidebar tree (see `sidebarStore`), it is persisted in the
 * file-server's per-user private storage under a fixed key; guests / no
 * file-server keep it in memory for the session only.  It is deliberately
 * NOT in the Yjs doc - the master list is personal to each user, while the
 * document's *current* list (see `useLiveDocSources`) is the synced one.
 */

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useAppStore } from "../../../store";
import { RECORD_KEYS, classify, getRecord, putRecord } from "../../accountRecords";
import type { CslItem } from "./liveDocCslTypes";

const MASTER_KEY = "livedoc-sources-master";
const PERSIST_DEBOUNCE_MS = 800;

interface MasterSourcesState {
  sources: CslItem[];
  loaded: boolean;
  available: boolean;
  load: () => Promise<void>;
  upsert: (item: CslItem) => void;
  remove: (id: string) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function creds(): { baseUrl: string; sessionJwt: string } | null {
  const cfg = useAppStore.getState().fileServerConfig;
  if (!cfg || !cfg.registered || !cfg.sessionJwt) return null;
  return { baseUrl: cfg.baseUrl, sessionJwt: cfg.sessionJwt };
}

/** Where this connection's master list is kept.
 *
 *  Settled by the first load and read by every persist after it, so an edit
 *  cannot be written to a store the load did not come from. */
let backend: "records" | "plugin" | null = null;

function schedulePersist(sources: CslItem[]): void {
  if (backend === null) return;
  const c = backend === "plugin" ? creds() : null;
  if (backend === "plugin" && !c) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const value = JSON.stringify(sources);
    const written =
      c === null
        ? putRecord(RECORD_KEYS.liveDocSources, value)
        : invoke("fileserver_put_private", { request: { ...c, key: MASTER_KEY, value } });
    void Promise.resolve(written).catch((e) => console.warn("[liveDocMasterSources] persist failed:", e));
  }, PERSIST_DEBOUNCE_MS);
}

/** Read the master list out of the account record store.
 *
 *  `"unsupported"` - and only that - means the server has no record store and
 *  the caller should try the plugin. Anything else is final. */
async function loadFromRecords(): Promise<{ sources: CslItem[]; available: boolean } | "unsupported"> {
  try {
    const record = await getRecord(RECORD_KEYS.liveDocSources);
    const parsed = record.found && record.value ? (JSON.parse(record.value) as CslItem[]) : [];
    return { sources: Array.isArray(parsed) ? parsed : [], available: true };
  } catch (e) {
    if (classify(e).failure === "unsupported") return "unsupported";
    // A guest, or a read that failed. Either way the list stays in memory for
    // the session and is never written back, because a failed read says
    // nothing about what is stored.
    console.warn("[liveDocMasterSources] record load failed:", e);
    return { sources: [], available: false };
  }
}

export const useLiveDocMasterSourcesStore = create<MasterSourcesState>((set, get) => {
  const mutate = (next: CslItem[]) => {
    set({ sources: next });
    schedulePersist(next);
  };
  return {
    sources: [],
    loaded: false,
    available: false,
    load: async () => {
      const fromServer = await loadFromRecords();
      if (fromServer !== "unsupported") {
        backend = "records";
        set({ ...fromServer, loaded: true });
        return;
      }
      backend = "plugin";

      const c = creds();
      if (!c) {
        set({ loaded: true, available: false });
        return;
      }
      try {
        const raw = await invoke<string | null>("fileserver_get_private", {
          request: { ...c, key: MASTER_KEY },
        });
        const sources = raw ? (JSON.parse(raw) as CslItem[]) : [];
        set({ sources: Array.isArray(sources) ? sources : [], loaded: true, available: true });
      } catch (e) {
        console.warn("[liveDocMasterSources] load failed:", e);
        set({ loaded: true, available: false });
      }
    },
    upsert: (item) => {
      const next = get().sources.filter((s) => s.id !== item.id);
      next.push(item);
      mutate(next);
    },
    remove: (id) => mutate(get().sources.filter((s) => s.id !== id)),
  };
});
