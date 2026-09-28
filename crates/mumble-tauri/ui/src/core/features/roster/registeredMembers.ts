/**
 * The registered-user half of a roster.
 *
 * A Mumble server only announces the people who are connected; everyone else
 * exists solely in its registration table.  A member list that wants to show
 * "and these people are usually here too" has to ask for that table, keep it
 * across mounts (it is answered by an event, not a return value), and turn its
 * rows into something a user row can render.
 *
 * All three UI packs need exactly that, so it lives here rather than inside
 * one pack's member list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RegisteredUser, UserCommentPayload, UserEntry } from "@core/types";
import { useAppStore } from "@core/store";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "@core/registeredTextureLease";
import { getCachedRegisteredUsers, saveCachedRegisteredUsers } from "@core/preferencesStorage";

/**
 * Process-wide cache of the registered-user list per server.  Persists
 * across mount/unmount cycles (sidebar tab switches, a roster panel that
 * opens and closes) so we don't refetch and flash a skeleton every time.
 * The fingerprint is a cheap content hash used to skip state updates when
 * the server returns an identical payload.
 */
interface RegisteredCacheEntry {
  readonly users: readonly RegisteredUser[];
  readonly fingerprint: string;
}
const registeredMemCache = new Map<string, RegisteredCacheEntry>();

function fingerprintRegistered(users: readonly RegisteredUser[]): string {
  let hash = 5381 ^ users.length;
  for (const u of users) {
    hash = ((hash * 33) ^ u.user_id) | 0;
    const name = u.name;
    for (let i = 0; i < name.length; i += 7) {
      hash = ((hash * 33) ^ name.charCodeAt(i)) | 0;
    }
    hash = ((hash * 33) ^ (u.last_channel ?? 0)) | 0;
    hash = ((hash * 33) ^ (u.texture_size ?? 0)) | 0;
    const ch = u.comment_hash;
    if (ch && ch.length > 0) {
      hash = ((hash * 33) ^ ch.length) | 0;
      hash = ((hash * 33) ^ ch[0]) | 0;
      hash = ((hash * 33) ^ ch[ch.length - 1]!) | 0;
    }
  }
  return hash.toString(36) + ":" + users.length;
}

/**
 * Build a synthetic `UserEntry` for an offline registered user so a normal
 * user row can render them without special-casing.
 *
 * The session id is set to a negative number derived from the user_id
 * to keep it unique and to ensure no DM/talking lookups ever match.
 * The avatar itself is fetched lazily by `useUserAvatar` for this negative
 * session (which routes to `get_registered_user_texture`); only the
 * `texture_size` marker travels in the bulk payload.
 */
export function synthesiseOfflineEntry(
  reg: RegisteredUser,
  fetchedComments: ReadonlyMap<number, string> = new Map(),
): UserEntry {
  const comment = fetchedComments.get(reg.user_id) ?? reg.comment ?? null;
  const session = -(reg.user_id + 1);
  return {
    session,
    name: reg.name,
    channel_id: reg.last_channel ?? 0,
    user_id: reg.user_id,
    texture_size: reg.texture_size && reg.texture_size > 0 ? reg.texture_size : null,
    comment,
    mute: false,
    deaf: false,
    suppress: false,
    self_mute: false,
    self_deaf: false,
    priority_speaker: false,
    hash: undefined,
  };
}

/** Convert a list of registered users to offline `UserEntry` objects.
 *  Convenience helper for tests and callers that don't need the
 *  per-user_id stable cache used inside the hook. */
export function regsToOfflineEntries(
  registered: readonly RegisteredUser[],
  fetchedComments: ReadonlyMap<number, string> = new Map(),
): readonly UserEntry[] {
  return registered.map((r) => synthesiseOfflineEntry(r, fetchedComments));
}

export interface RegisteredMembers {
  /** Every registered user as an offline `UserEntry`, connected ones included:
   *  which of them are actually offline is the caller's join to make, since
   *  only it knows who it is already showing. */
  readonly offlineEntries: readonly UserEntry[];
  /** True while the list is still on its way and nothing cached stands in. */
  readonly loading: boolean;
  /** Ask the server for a long comment; answers arrive as new entries. */
  readonly requestComment: (userId: number) => void;
}

const NO_MEMBERS: RegisteredMembers = {
  offlineEntries: [],
  loading: false,
  requestComment: () => undefined,
};

/**
 * The current server's registration table, as rows a member list can draw.
 *
 * `enabled` is for the panels that only sometimes show offline people: while
 * it is false nothing is requested and no avatar lease is held, so a roster
 * scoped to one channel costs the server nothing.
 */
export function useRegisteredMembers(enabled = true): RegisteredMembers {
  const pendingConnect = useAppStore((s) => s.pendingConnect);
  const serverKey = pendingConnect ? `${pendingConnect.host}:${pendingConnect.port}` : null;
  const initialCache = serverKey ? registeredMemCache.get(serverKey) : undefined;
  const [registered, setRegistered] = useState<readonly RegisteredUser[]>(() => initialCache?.users ?? []);
  const [fetchedComments, setFetchedComments] = useState<ReadonlyMap<number, string>>(new Map());
  const [loading, setLoading] = useState<boolean>(() => enabled && !initialCache);
  /** Tracks user_ids for which a blob request has already been sent
   * to avoid redundant requests if the hover card is opened repeatedly. */
  const requestedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    /** Minimum visible time for the spinner so it doesn't flash on
     *  fast LAN responses.  Skipped entirely when we already have
     *  cached data to display. */
    const MIN_SPINNER_MS = 450;
    const startedAt = Date.now();
    const memEntry = serverKey ? registeredMemCache.get(serverKey) : undefined;
    let cancelled = false;
    let pendingPayload: readonly RegisteredUser[] | null = null;
    let cacheEntryUsers: readonly RegisteredUser[] | null = memEntry?.users ?? null;
    let minTimer: number | null = null;
    let minElapsed = !!memEntry;

    if (memEntry) {
      setRegistered(memEntry.users);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const applyPayload = (payload: readonly RegisteredUser[]) => {
      if (!serverKey) {
        setRegistered(payload);
        return;
      }
      const fp = fingerprintRegistered(payload);
      const cached = registeredMemCache.get(serverKey);
      if (cached && cached.fingerprint === fp) {
        // Identical payload: skip the state update so memoized children
        // (offlineEntries, the rows) do not re-render.
        return;
      }
      registeredMemCache.set(serverKey, { users: payload, fingerprint: fp });
      setRegistered(payload);
    };

    const flush = () => {
      if (cancelled) return;
      const next = pendingPayload ?? cacheEntryUsers;
      if (next) applyPayload(next);
      setLoading(false);
    };

    const scheduleFlush = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= MIN_SPINNER_MS) {
        flush();
      } else if (minTimer === null) {
        minTimer = window.setTimeout(() => {
          minElapsed = true;
          flush();
        }, MIN_SPINNER_MS - elapsed);
      }
    };

    // Persistent (disk) cache fallback: only consult when no in-memory
    // entry is available, since the in-memory copy is always at least as
    // fresh as what's on disk.
    if (serverKey && !memEntry) {
      getCachedRegisteredUsers(serverKey)
        .then((entry) => {
          if (cancelled || !entry) return;
          cacheEntryUsers = entry.users;
          if (pendingPayload === null) scheduleFlush();
        })
        .catch(() => {});
    }

    // Register all listeners BEFORE sending the request: `listen()` is an
    // async IPC round-trip, and a fast (local) server can answer before an
    // un-awaited registration commits. Tauri does not replay events to late
    // subscribers, so losing that race would leave the skeleton up until the
    // next refresh.
    const unlisteners: (() => void)[] = [];
    acquireRegisteredTextures();
    (async () => {
      const [unList, unComment, unPermDenied] = await Promise.all([
        listen<RegisteredUser[]>("user-list", (event) => {
          pendingPayload = event.payload;
          if (serverKey) {
            saveCachedRegisteredUsers(serverKey, event.payload).catch(() => {});
          }
          if (minElapsed || Date.now() - startedAt >= MIN_SPINNER_MS) {
            flush();
          } else {
            scheduleFlush();
          }
        }),
        listen<UserCommentPayload>("user-comment", (event) => {
          const { user_id, comment } = event.payload;
          setFetchedComments((prev) => {
            if (prev.get(user_id) === comment) return prev;
            const next = new Map(prev);
            next.set(user_id, comment);
            return next;
          });
        }),
        // If the server denies the user-list request (user lacks the Register
        // permission), the `user-list` event never fires and the skeleton
        // would spin forever.  Dismiss it immediately on any permission-denied.
        listen("permission-denied", () => {
          flush();
        }),
      ]);
      if (cancelled) {
        unList();
        unComment();
        unPermDenied();
        return;
      }
      unlisteners.push(unList, unComment, unPermDenied);
      invoke("request_user_list").catch(() => {
        scheduleFlush();
      });
    })().catch(() => {
      // No Tauri IPC (tests, a plain browser preview): there is no
      // registration table to wait for, so drop the skeleton rather than
      // letting the rejected `listen()` surface as an unhandled rejection.
      scheduleFlush();
    });
    return () => {
      cancelled = true;
      if (minTimer !== null) window.clearTimeout(minTimer);
      for (const un of unlisteners) un();
      releaseRegisteredTextures();
    };
  }, [serverKey, enabled]);

  const requestComment = useCallback((userId: number) => {
    if (requestedRef.current.has(userId)) return;
    requestedRef.current.add(userId);
    invoke("request_user_comment", { userId }).catch(() => {});
  }, []);

  // Build offline `UserEntry` objects with stable per-user_id references
  // so a `memo`-wrapped row skips re-renders when nothing about a
  // particular user actually changed.
  const offlineEntryCacheRef = useRef<Map<number, UserEntry>>(new Map());
  const offlineEntries = useMemo<readonly UserEntry[]>(() => {
    const cache = offlineEntryCacheRef.current;
    const next: UserEntry[] = [];
    const seen = new Set<number>();
    for (const reg of registered) {
      seen.add(reg.user_id);
      const fresh = synthesiseOfflineEntry(reg, fetchedComments);
      const existing = cache.get(reg.user_id);
      if (
        existing &&
        existing.name === fresh.name &&
        existing.channel_id === fresh.channel_id &&
        existing.comment === fresh.comment &&
        existing.texture_size === fresh.texture_size
      ) {
        next.push(existing);
        continue;
      }
      cache.set(reg.user_id, fresh);
      next.push(fresh);
    }
    for (const key of cache.keys()) {
      if (!seen.has(key)) cache.delete(key);
    }
    return next;
  }, [registered, fetchedComments]);

  const members = useMemo<RegisteredMembers>(
    () => ({ offlineEntries, loading, requestComment }),
    [offlineEntries, loading, requestComment],
  );

  return enabled ? members : NO_MEMBERS;
}
