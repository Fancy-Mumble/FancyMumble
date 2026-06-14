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

function schedulePersist(sources: CslItem[]): void {
  const c = creds();
  if (!c) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void invoke("fileserver_put_private", {
      request: { ...c, key: MASTER_KEY, value: JSON.stringify(sources) },
    }).catch((e) => console.warn("[liveDocMasterSources] persist failed:", e));
  }, PERSIST_DEBOUNCE_MS);
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
