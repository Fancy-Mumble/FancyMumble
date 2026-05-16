import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AclData, AclGroup } from "../types";
import { useAppStore } from "../store";
import { rootChannelId } from "../pages/admin/rootChannel";

/**
 * Subscribe to the root-channel ACL groups (a.k.a. roles).
 *
 * Re-fetches lazily on mount and updates whenever the backend
 * emits a fresh `acl` event for the root channel.  Multiple consumers
 * can call this hook concurrently; each instance keeps its own
 * snapshot but shares the underlying backend request.
 */
/**
 * Process-wide cache of the most recent ACL groups per root channel.
 * Persists across component mount/unmount cycles (e.g. sidebar tab
 * switches) so we don't refetch and flash an empty list each time.
 */
const aclCache = new Map<number, readonly AclGroup[]>();

export function useAclGroups(): readonly AclGroup[] {
  const channels = useAppStore((s) => s.channels);
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  const [groups, setGroups] = useState<readonly AclGroup[]>(() => aclCache.get(rootId) ?? []);

  useEffect(() => {
    let cancelled = false;
    const cached = aclCache.get(rootId);
    if (cached) setGroups(cached);
    const unlisten = listen<AclData>("acl", (event) => {
      if (cancelled || event.payload.channel_id !== rootId) return;
      aclCache.set(rootId, event.payload.groups);
      setGroups(event.payload.groups);
    });
    if (!cached) {
      invoke("request_acl", { channelId: rootId }).catch(() => {});
    }
    return () => {
      cancelled = true;
      unlisten.then((f) => f());
    };
  }, [rootId]);

  return groups;
}
