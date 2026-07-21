/**
 * Audit-log store (admin "Audit Log" panel).
 *
 * Queries go out through the `query_audit_log` Tauri command; results arrive
 * asynchronously as `audit-response` events (correlated by `queryId` so a
 * stale response can never clobber a newer search), live-tail entries as
 * `audit-event` pushes, and the configuration schema as `audit-config`
 * broadcasts mirrored from the backend cache. The AuditLogTab wires the
 * event listeners into the appliers below.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  AuditConfigSnapshot,
  AuditEntry,
  AuditQueryArgs,
  AuditResponse,
  ServerSetting,
} from "../../types";

/** Page size for queries; the server may cap it lower. */
export const AUDIT_PAGE_LIMIT = 200;

/** Cap on locally-buffered entries so a long live tail can't grow unbounded. */
const MAX_ENTRIES = 2000;

/** Chain verification status shown in the viewer/config halves. */
export interface ChainStatus {
  verifying: boolean;
  ok?: boolean;
  height?: number;
  error?: string;
}

interface AuditStoreState {
  /** Current result set, newest first. */
  entries: AuditEntry[];
  hasMore: boolean;
  nextBeforeId?: number;
  /** True while a (non-append) query is in flight. */
  loading: boolean;
  /** True while a pagination query is in flight. */
  loadingMore: boolean;
  /** Last query error (server rejection or send failure). */
  error: string | null;
  /** Whether the live tail is on (subscribe flag on the last query). */
  live: boolean;
  chain: ChainStatus;
  /** Audit configuration snapshot, or null when not advertised. */
  config: AuditConfigSnapshot | null;
  configBusy: boolean;
  configError: string | null;

  /** The wire args of the most recent query (for pagination / re-subscribe). */
  lastArgs: AuditQueryArgs | null;

  // Appliers driven by the tab's event listeners.
  applyResponse: (res: AuditResponse) => void;
  applyEvent: (entry: AuditEntry) => void;
  applyConfig: (config: AuditConfigSnapshot) => void;

  // Command wrappers.
  runQuery: (args: AuditQueryArgs) => Promise<void>;
  loadMore: () => Promise<void>;
  setLive: (live: boolean) => Promise<void>;
  verifyChain: () => Promise<void>;
  loadConfig: () => Promise<void>;
  saveConfig: (changed: ServerSetting[]) => Promise<void>;

  /** Reset all audit state (disconnect / server switch / tab close). */
  clearAudit: () => void;
}

/** Monotonic correlation ids; module-scoped so HMR keeps them unique-ish. */
let querySeq = 0;
function nextQueryId(): string {
  querySeq += 1;
  return `q${Date.now().toString(36)}-${querySeq}`;
}

async function sendQuery(args: AuditQueryArgs): Promise<void> {
  await invoke("query_audit_log", { args });
}

export const useAuditStore = create<AuditStoreState>((set, get) => ({
  entries: [],
  hasMore: false,
  nextBeforeId: undefined,
  loading: false,
  loadingMore: false,
  error: null,
  live: false,
  chain: { verifying: false },
  config: null,
  configBusy: false,
  configError: null,
  lastArgs: null,

  applyResponse: (res) => {
    const { lastArgs } = get();
    // Correlation: only the response to the most recent query may apply.
    if (!lastArgs || res.queryId !== lastArgs.queryId) return;

    set((prev) => {
      const chain: ChainStatus =
        res.chainOk != null || res.chainError != null
          ? {
              verifying: false,
              ok: res.chainOk ?? false,
              height: res.chainHeight,
              error: res.chainError,
            }
          : { ...prev.chain, verifying: false };

      if (res.error) {
        return {
          loading: false,
          loadingMore: false,
          error: res.error,
          chain,
        };
      }

      const append = lastArgs.beforeId != null;
      const entries = append ? [...prev.entries, ...res.entries] : res.entries;
      return {
        entries: entries.slice(0, MAX_ENTRIES),
        hasMore: res.hasMore,
        nextBeforeId: res.nextBeforeId,
        loading: false,
        loadingMore: false,
        error: null,
        chain,
      };
    });
  },

  applyEvent: (entry) => {
    set((prev) => {
      if (!prev.live) return prev;
      // Dedupe: a tail push may race a page containing the same entry.
      if (prev.entries.some((e) => e.id === entry.id)) return prev;
      return { entries: [entry, ...prev.entries].slice(0, MAX_ENTRIES) };
    });
  },

  applyConfig: (config) => {
    set((prev) => {
      // Only accept newer (or equal) revisions, matching the backend guard.
      if (prev.config && config.revision < prev.config.revision) return prev;
      return { config };
    });
  },

  runQuery: async (args) => {
    const stamped: AuditQueryArgs = {
      ...args,
      queryId: nextQueryId(),
      limit: args.limit ?? AUDIT_PAGE_LIMIT,
      subscribe: get().live,
      beforeId: undefined,
    };
    set({ loading: true, error: null, lastArgs: stamped });
    try {
      await sendQuery(stamped);
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  loadMore: async () => {
    const { lastArgs, nextBeforeId, hasMore, loadingMore } = get();
    if (!lastArgs || !hasMore || nextBeforeId == null || loadingMore) return;
    const stamped: AuditQueryArgs = {
      ...lastArgs,
      queryId: nextQueryId(),
      beforeId: nextBeforeId,
      // A pagination fetch never re-subscribes.
      subscribe: false,
    };
    set({ loadingMore: true, lastArgs: stamped });
    try {
      await sendQuery(stamped);
    } catch (e) {
      set({ loadingMore: false, error: String(e) });
    }
  },

  setLive: async (live) => {
    set({ live });
    const { lastArgs } = get();
    // Re-issue the current query so the server opens/closes the tail.
    if (lastArgs) {
      const stamped: AuditQueryArgs = {
        ...lastArgs,
        queryId: nextQueryId(),
        beforeId: undefined,
        subscribe: live,
      };
      set({ lastArgs: stamped, loading: true });
      try {
        await sendQuery(stamped);
      } catch (e) {
        set({ loading: false, error: String(e) });
      }
    }
  },

  verifyChain: async () => {
    set((prev) => ({ chain: { ...prev.chain, verifying: true } }));
    const stamped: AuditQueryArgs = {
      queryId: nextQueryId(),
      limit: 1,
      verifyChain: true,
    };
    set({ lastArgs: stamped });
    try {
      await sendQuery(stamped);
    } catch (e) {
      set({ chain: { verifying: false, ok: false, error: String(e) } });
    }
  },

  loadConfig: async () => {
    try {
      const config = await invoke<AuditConfigSnapshot | null>("get_audit_config");
      if (config) get().applyConfig(config);
    } catch (e) {
      set({ configError: String(e) });
    }
  },

  saveConfig: async (changed) => {
    set({ configBusy: true, configError: null });
    try {
      await invoke("save_audit_config", { changed });
      // The server re-broadcasts the stamped snapshot; busy clears now.
      set({ configBusy: false });
    } catch (e) {
      set({ configBusy: false, configError: String(e) });
      throw e;
    }
  },

  clearAudit: () =>
    set({
      entries: [],
      hasMore: false,
      nextBeforeId: undefined,
      loading: false,
      loadingMore: false,
      error: null,
      live: false,
      chain: { verifying: false },
      config: null,
      configBusy: false,
      configError: null,
      lastArgs: null,
    }),
}));
