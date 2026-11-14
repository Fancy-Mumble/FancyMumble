import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BanEntry, WireBanEntry } from "../../types";
import { banFromWire, banToWire } from "./banMask";

/**
 * What became of a save: `null` when the server took it, else the reason it
 * gave for refusing (empty when it gave none).
 */
export type BanSaveVerdict = string | null;

interface DeniedPayload {
  deny_type: number | null;
  reason: string | null;
}

/**
 * Subscribe to `ban-list` with the masks in the UI's terms; resolves once the
 * listener is registered, so a request sent after it cannot be answered
 * unheard.
 */
export function listenBanList(onList: (bans: BanEntry[]) => void): Promise<UnlistenFn> {
  return listen<WireBanEntry[]>("ban-list", (event) => onList(event.payload.map(banFromWire)));
}

/** Send `bans` (in the UI's terms) to the server as its whole new ban list. */
export function sendBanList(bans: readonly BanEntry[]): Promise<void> {
  return invoke("update_ban_list", { bans: bans.map(banToWire) });
}

/**
 * The server's ban list, kept in the UI's terms, with a save that says
 * whether the server took it.
 *
 * The server does not acknowledge a ban list; it refuses one with a
 * `PermissionDenied` (Starling refuses a list containing an entry that covers
 * everybody, and any server refuses one from somebody without the right). So
 * a save is followed by a fresh request: the server answers in order, and a
 * refusal arriving before that list comes back belongs to the save. Either
 * way the list on screen is then the one the server holds, never a refused
 * edit that looks saved.
 *
 * `onList` runs for every list that arrives, for callers that keep a
 * selection or an edit in progress against it.
 */
export function useBanList(onList?: (bans: BanEntry[]) => void) {
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** The save waiting for its verdict, if one is. */
  const pending = useRef<((verdict: BanSaveVerdict) => void) | null>(null);
  const onListRef = useRef(onList);
  onListRef.current = onList;

  const settle = useCallback((verdict: BanSaveVerdict) => {
    const resolve = pending.current;
    pending.current = null;
    resolve?.(verdict);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const offs: UnlistenFn[] = [];
    void (async () => {
      const registered = await Promise.all([
        listenBanList((next) => {
          setBans(next);
          setLoading(false);
          onListRef.current?.(next);
          settle(null);
        }),
        listen<DeniedPayload>("permission-denied", ({ payload }) => {
          setLoading(false);
          if (!pending.current) return;
          const reason = payload.reason ?? "";
          setRefusal(reason);
          settle(reason);
        }),
      ]);
      if (cancelled) {
        registered.forEach((off) => off());
        return;
      }
      offs.push(...registered);
      setLoading(true);
      invoke("request_ban_list").catch(() => setLoading(false));
    })();
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
      settle(null);
    };
  }, [settle]);

  const refresh = useCallback(() => {
    setLoading(true);
    invoke("request_ban_list").catch(() => setLoading(false));
  }, []);

  /**
   * Send `next` as the whole ban list, then ask for it back. Resolves with
   * the refusal (the server's, or the client's own when the list could not
   * be sent at all, such as an address that is not one), or `null` once the
   * list the server holds has arrived.
   */
  const save = useCallback(
    async (next: readonly BanEntry[]): Promise<BanSaveVerdict> => {
      settle(null);
      setRefusal(null);
      const verdict = new Promise<BanSaveVerdict>((resolve) => {
        pending.current = resolve;
      });
      try {
        await sendBanList(next);
      } catch (error) {
        const reason = String(error);
        setRefusal(reason);
        settle(reason);
        return reason;
      }
      refresh();
      return verdict;
    },
    [refresh, settle],
  );

  const clearRefusal = useCallback(() => setRefusal(null), []);

  return { bans, setBans, loading, refresh, save, refusal, clearRefusal } as const;
}
