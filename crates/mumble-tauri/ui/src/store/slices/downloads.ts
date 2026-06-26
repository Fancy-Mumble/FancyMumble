/**
 * Downloads slice: the list of files saved during the current session and the
 * unseen-downloads badge count, with add/seen/remove/clear actions.
 *
 * Part of the `store.ts` split. The upload/download *transfer* actions remain
 * in the root store (they touch the file-server config) and add completed
 * downloads here via `get().addDownload(...)`.
 */

import type { StateCreator } from "zustand";
import type { DownloadEntry, NewDownloadInput } from "../../types";
import type { AppState } from "../../store";

export interface DownloadsSlice {
  /** Locally-saved downloads completed during the current session. Most recent first. */
  downloads: DownloadEntry[];
  /** Number of downloads completed since the user last opened the Downloads panel. */
  unseenDownloadCount: number;

  addDownload: (entry: NewDownloadInput) => void;
  markDownloadsSeen: () => void;
  removeDownload: (id: string) => void;
  clearDownloads: () => void;
}

/** State-only portion of {@link DownloadsSlice}. */
type DownloadsState = Pick<DownloadsSlice, "downloads" | "unseenDownloadCount">;

/** Default downloads state (also spread into the root `INITIAL` for resets). */
export const downloadsInitialState: DownloadsState = {
  downloads: [],
  unseenDownloadCount: 0,
};

export const createDownloadsSlice: StateCreator<AppState, [], [], DownloadsSlice> = (set) => ({
  ...downloadsInitialState,

  addDownload: (entry) => {
    const id = (globalThis.crypto?.randomUUID?.() ?? `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const full: DownloadEntry = { ...entry, id, downloadedAt: Date.now() };
    set((s) => ({
      downloads: [full, ...s.downloads].slice(0, 200),
      unseenDownloadCount: s.unseenDownloadCount + 1,
    }));
  },

  markDownloadsSeen: () => {
    set({ unseenDownloadCount: 0 });
  },

  removeDownload: (id) => {
    set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) }));
  },

  clearDownloads: () => {
    set({ downloads: [], unseenDownloadCount: 0 });
  },
});
