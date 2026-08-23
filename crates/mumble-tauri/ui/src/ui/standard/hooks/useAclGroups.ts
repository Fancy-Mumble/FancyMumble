import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AclData, AclGroup } from "@core/types";
import { useAppStore } from "@core/store";
import { rootChannelId } from "@core/features/admin/rootChannel";
import { PERM_WRITE } from "@core/utils/permissions";

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

/**
 * Roots with a request already on the wire.  A roster full of cards can mount
 * a dozen consumers in the same frame; they all want the same answer, so only
 * the first one asks for it.
 */
const inFlight = new Set<number>();

export function useAclGroups(): readonly AclGroup[] {
  const channels = useAppStore((s) => s.channels);
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  // Reading an ACL needs Write on the channel, so without it the request can
  // only come back as PermissionDenied. Consumers here are ambient - hover
  // cards, the composer's mention colours - and they mount often enough that
  // asking anyway buried the log in denials for every ordinary (non-admin)
  // user. `null` means the ServerSync permission sweep has not landed yet;
  // the effect re-runs once it does.
  const mayRead = useAppStore((s) => {
    const perms = s.channels.find((c) => c.id === rootChannelId(s.channels))?.permissions;
    return perms != null && (perms & PERM_WRITE) !== 0;
  });
  const [groups, setGroups] = useState<readonly AclGroup[]>(() => aclCache.get(rootId) ?? []);

  // The listener must be registered before the request goes out: `listen()`
  // is an async IPC round-trip, and a fast (local) server can answer before
  // an un-awaited registration commits. Tauri does not replay events, so
  // losing that race left the roles list empty until the next acl broadcast.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const cached = aclCache.get(rootId);
    if (cached) setGroups(cached);
    (async () => {
      const un = await listen<AclData>("acl", (event) => {
        if (cancelled || event.payload.channel_id !== rootId) return;
        inFlight.delete(rootId);
        aclCache.set(rootId, event.payload.groups);
        setGroups(event.payload.groups);
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      if (!cached && mayRead && !inFlight.has(rootId)) {
        inFlight.add(rootId);
        invoke("request_acl", { channelId: rootId }).catch(() => inFlight.delete(rootId));
      }
    })().catch(() => {
      // No Tauri IPC (tests, a plain browser preview): roles simply stay
      // empty. Without this the rejected `listen()` surfaced as an unhandled
      // rejection in every consumer, now including the Aurora composer's
      // mention autocomplete.
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [rootId, mayRead]);

  return groups;
}
