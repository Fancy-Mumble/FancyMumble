import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AclData } from "../../types";

/**
 * Subscribe to the `acl` event and request the ACL for the given channel.
 *
 * The hook keeps the latest ACL snapshot in state and tracks a `dirty` flag
 * so callers can mutate the snapshot locally and persist it via `save`.
 */
export function useChannelAcl(channelId: number | null) {
  const [acl, setAcl] = useState<AclData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // The listener must be registered before the request goes out: `listen()`
  // is an async IPC round-trip, and a fast (local) server can answer before
  // an un-awaited registration commits. Tauri does not replay events, so
  // losing that race left the pane on "Loading ACL..." forever.
  useEffect(() => {
    if (channelId === null) {
      setAcl(null);
      return;
    }
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    (async () => {
      const un = await listen<AclData>("acl", (event) => {
        if (event.payload.channel_id === channelId) {
          setAcl(event.payload);
          setDirty(false);
          setLoading(false);
        }
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      setLoading(true);
      invoke("request_acl", { channelId }).catch(() => setLoading(false));
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [channelId]);

  const update = useCallback((next: AclData) => {
    setAcl(next);
    setDirty(true);
  }, []);

  // Accepts an explicit ACL to persist so a caller that just mutated the
  // snapshot via `setAcl` (update) can save that value immediately, without
  // waiting for a re-render: `save` is a callback memoized on `acl`, so a
  // same-handler `setAcl(next); save()` would otherwise still close over the
  // *previous* render's `acl` and silently persist stale data.
  const save = useCallback(
    async (next?: AclData) => {
      const payload = next ?? acl;
      if (!payload) return;
      setSaving(true);
      try {
        await invoke("update_acl", { acl: payload });
        setDirty(false);
      } finally {
        setSaving(false);
      }
    },
    [acl],
  );

  const refresh = useCallback(() => {
    if (channelId === null) return;
    setLoading(true);
    invoke("request_acl", { channelId }).catch(() => setLoading(false));
  }, [channelId]);

  return { acl, loading, dirty, saving, setAcl: update, save, refresh } as const;
}
