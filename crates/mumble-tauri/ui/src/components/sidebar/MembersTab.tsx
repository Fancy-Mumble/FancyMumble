import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { AclGroup, ChannelEntry, RegisteredUser, UserCommentPayload, UserEntry } from "../../types";
import { useAclGroups } from "../../hooks/useAclGroups";
import { useAppStore } from "../../store";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "../../registeredTextureLease";
import {
  getCachedRegisteredUsers,
  saveCachedRegisteredUsers,
} from "../../preferencesStorage";
import { UserListItem } from "./user/UserListItem";
import { TID } from "../../testids";
import styles from "./channel/ChannelSidebar.module.css";

/**
 * Process-wide cache of the registered-user list per server.  Persists
 * across MembersTab mount/unmount cycles (sidebar tab switches) so we
 * don't refetch and flash a skeleton every time.  The fingerprint is a
 * cheap content hash used to skip state updates when the server returns
 * an identical payload.
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

interface MembersTabProps {
  readonly users: readonly UserEntry[];
  readonly channels: readonly ChannelEntry[];
  readonly ownSession: number | null;
  readonly selectedDmUser: number | null;
  readonly talkingSessions: ReadonlySet<number>;
  readonly onSelectDm: (session: number) => void;
  readonly onUserContextMenu: (e: React.MouseEvent, user: UserEntry) => void;
}

interface MemberRow {
  readonly entry: UserEntry;
  readonly offline: boolean;
}

interface MemberGroup {
  readonly key: string;
  readonly label: string;
  readonly color: string | null;
  readonly rows: readonly MemberRow[];
}

/** Sentinel keys for the catch-all buckets at the end of the list. */
const KEY_NO_GROUP = "__no_group__";
const KEY_GUESTS = "__guests__";

/**
 * Build a synthetic `UserEntry` for an offline registered user so the
 * shared `UserListItem` component can render them without special-casing.
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
 *  per-user_id stable cache used inside the component. */
export function regsToOfflineEntries(
  registered: readonly RegisteredUser[],
  fetchedComments: ReadonlyMap<number, string> = new Map(),
): readonly UserEntry[] {
  return registered.map((r) => synthesiseOfflineEntry(r, fetchedComments));
}

/**
 * Build a `user_id -> first-non-system-group-name` mapping in ACL order.
 * Returns the mapping plus the ordered list of distinct group names that
 * actually have at least one assigned member.
 */
function buildUserGroupMap(aclGroups: readonly AclGroup[]): {
  readonly userIdToGroup: ReadonlyMap<number, string>;
  readonly groupOrder: readonly string[];
  readonly groupColors: ReadonlyMap<string, string>;
} {
  const userIdToGroup = new Map<number, string>();
  const groupOrder: string[] = [];
  const groupColors = new Map<string, string>();
  for (const g of aclGroups) {
    if (g.name.startsWith("~")) continue;
    if (g.color && !groupColors.has(g.name)) {
      groupColors.set(g.name, g.color);
    }
    const removeSet = new Set(g.remove);
    let assignedAny = false;
    for (const uid of [...g.add, ...g.inherited_members]) {
      if (removeSet.has(uid)) continue;
      if (!userIdToGroup.has(uid)) {
        userIdToGroup.set(uid, g.name);
        assignedAny = true;
      }
    }
    if (assignedAny && !groupOrder.includes(g.name)) {
      groupOrder.push(g.name);
    }
  }
  return { userIdToGroup, groupOrder, groupColors };
}

/** Order rows online-first, then alphabetical within each tier. */
function compareRows(a: MemberRow, b: MemberRow): number {
  if (a.offline !== b.offline) return a.offline ? 1 : -1;
  return a.entry.name.localeCompare(b.entry.name);
}

/**
 * Bucket member rows into groups according to `userIdToGroup`.  Rows whose
 * user has no group go into `KEY_NO_GROUP`; unregistered (anonymous)
 * online users go into `KEY_GUESTS`.
 */
function bucketRows(
  rows: readonly MemberRow[],
  userIdToGroup: ReadonlyMap<number, string>,
): Map<string, MemberRow[]> {
  const buckets = new Map<string, MemberRow[]>();
  const push = (key: string, row: MemberRow) => {
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  };
  for (const row of rows) {
    const uid = row.entry.user_id;
    if (uid == null || uid <= 0) {
      push(KEY_GUESTS, row);
      continue;
    }
    const groupName = userIdToGroup.get(uid);
    push(groupName ?? KEY_NO_GROUP, row);
  }
  return buckets;
}

/**
 * Combine online + offline registered users, group them by ACL role
 * and produce the final ordered list of `MemberGroup` sections.
 *
 * `offlineEntries` are precomputed (and cached for stable references)
 * by the caller so we don't allocate fresh `UserEntry` objects on every
 * call - that would defeat the `memo` wrapping `UserListItem`.
 */
export function buildMemberGroups(
  users: readonly UserEntry[],
  offlineEntries: readonly UserEntry[],
  ownSession: number | null,
  aclGroups: readonly AclGroup[],
  membersLabel = "Members",
  guestsLabel = "Guests",
): readonly MemberGroup[] {
  const onlineUserIds = new Set<number>();
  const onlineRows: MemberRow[] = [];
  for (const u of users) {
    if (u.session === ownSession) continue;
    if (u.user_id != null && u.user_id > 0) onlineUserIds.add(u.user_id);
    onlineRows.push({ entry: u, offline: false });
  }
  const offlineRows: MemberRow[] = [];
  for (const entry of offlineEntries) {
    if (entry.user_id != null && onlineUserIds.has(entry.user_id)) continue;
    offlineRows.push({ entry, offline: true });
  }

  const { userIdToGroup, groupOrder, groupColors } = buildUserGroupMap(aclGroups);
  const buckets = bucketRows([...onlineRows, ...offlineRows], userIdToGroup);

  const result: MemberGroup[] = [];
  for (const name of groupOrder) {
    const rows = buckets.get(name);
    if (!rows || rows.length === 0) continue;
    rows.sort(compareRows);
    result.push({
      key: name,
      label: name,
      color: groupColors.get(name) ?? null,
      rows,
    });
  }
  const noGroupRows = buckets.get(KEY_NO_GROUP);
  if (noGroupRows && noGroupRows.length > 0) {
    noGroupRows.sort(compareRows);
    result.push({ key: KEY_NO_GROUP, label: membersLabel, color: null, rows: noGroupRows });
  }
  const guestRows = buckets.get(KEY_GUESTS);
  if (guestRows && guestRows.length > 0) {
    guestRows.sort(compareRows);
    result.push({ key: KEY_GUESTS, label: guestsLabel, color: null, rows: guestRows });
  }
  return result;
}

/** Skeleton placeholder shown while the registered-user list loads.
 *  Renders a couple of faux groups so the layout matches the real
 *  content and avoids a noticeable jump when data arrives. */
function MembersSkeleton() {
  const sections: ReadonlyArray<{ key: string; rows: number; titleWidth: number }> = [
    { key: "s1", rows: 4, titleWidth: 64 },
    { key: "s2", rows: 3, titleWidth: 92 },
  ];
  return (
    <>
      {sections.map((section) => (
        <section key={section.key} className={styles.memberGroup}>
          <div className={styles.membersGroupTitle}>
            <span
              className={styles.skeletonShimmer}
              style={{ display: "inline-block", width: section.titleWidth, height: 10, borderRadius: 4 }}
              aria-hidden="true"
            />
          </div>
          <div className={styles.memberGroupBody}>
            {Array.from({ length: section.rows }).map((_, i) => (
              <div key={`${section.key}-${i}`} className={styles.skeletonRow} aria-hidden="true">
                <span className={`${styles.skeletonShimmer} ${styles.skeletonAvatar}`} />
                <span className={`${styles.skeletonShimmer} ${styles.skeletonName}`} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/**
 * Memoized row wrapper.  Owns stable click/context-menu callbacks so
 * the inner `UserListItem` (also memoized) can short-circuit re-renders
 * when the row's user data and flags are unchanged.  Without this, the
 * arrow functions created in the parent map would change identity on
 * every MembersTab render and defeat the inner memoization, causing the
 * entire member list to re-render whenever any store slice updated.
 */
interface MemberRowItemProps {
  readonly user: UserEntry;
  readonly offline: boolean;
  readonly channelName: string | undefined;
  readonly active: boolean;
  readonly isTalking: boolean;
  readonly onSelectDm: (session: number) => void;
  readonly onUserContextMenu: (e: React.MouseEvent, user: UserEntry) => void;
  readonly onRequestComment: (userId: number) => void;
}
const MemberRowItem = memo(function MemberRowItem({
  user,
  offline,
  channelName,
  active,
  isTalking,
  onSelectDm,
  onUserContextMenu,
  onRequestComment,
}: MemberRowItemProps) {
  const handleClick = useCallback(() => onSelectDm(user.session), [onSelectDm, user.session]);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => onUserContextMenu(e, user),
    [onUserContextMenu, user],
  );
  return (
    <UserListItem
      user={user}
      channelName={offline ? undefined : channelName}
      active={!offline && active}
      isTalking={!offline && isTalking}
      offline={offline}
      onClick={offline ? undefined : handleClick}
      onContextMenu={offline ? undefined : handleContextMenu}
      onRequestComment={offline ? onRequestComment : undefined}
    />
  );
});

/**
 * Members tab for the sidebar.  Lists every user (online + offline
 * registered) grouped by their primary ACL role.  The whole tab scrolls
 * as a single non-nested list so groups flow consecutively.
 */
function MembersTabImpl({
  users,
  channels,
  ownSession,
  selectedDmUser,
  talkingSessions,
  onSelectDm,
  onUserContextMenu,
}: MembersTabProps) {
  const { t } = useTranslation("sidebar");
  const pendingConnect = useAppStore((s) => s.pendingConnect);
  const serverKey = pendingConnect ? `${pendingConnect.host}:${pendingConnect.port}` : null;
  const initialCache = serverKey ? registeredMemCache.get(serverKey) : undefined;
  const [registered, setRegistered] = useState<readonly RegisteredUser[]>(
    () => initialCache?.users ?? [],
  );
  const [fetchedComments, setFetchedComments] = useState<ReadonlyMap<number, string>>(new Map());
  const [loading, setLoading] = useState<boolean>(() => !initialCache);
  /** Tracks user_ids for which a blob request has already been sent
   * to avoid redundant requests if the hover card is opened repeatedly. */
  const requestedRef = useRef<Set<number>>(new Set());
  const aclGroups = useAclGroups();

  useEffect(() => {
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
        // (offlineEntries, groups, UserListItem) do not re-render.
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

    const unlistenList = listen<RegisteredUser[]>("user-list", (event) => {
      pendingPayload = event.payload;
      if (serverKey) {
        saveCachedRegisteredUsers(serverKey, event.payload).catch(() => {});
      }
      if (minElapsed || Date.now() - startedAt >= MIN_SPINNER_MS) {
        flush();
      } else {
        scheduleFlush();
      }
    });
    const unlistenComment = listen<UserCommentPayload>("user-comment", (event) => {
      const { user_id, comment } = event.payload;
      setFetchedComments((prev) => {
        if (prev.get(user_id) === comment) return prev;
        const next = new Map(prev);
        next.set(user_id, comment);
        return next;
      });
    });
    // If the server denies the user-list request (user lacks the Register
    // permission), the `user-list` event never fires and the skeleton
    // would spin forever.  Dismiss it immediately on any permission-denied.
    const unlistenPermDenied = listen("permission-denied", () => {
      flush();
    });
    acquireRegisteredTextures();
    invoke("request_user_list").catch(() => {
      scheduleFlush();
    });
    return () => {
      cancelled = true;
      if (minTimer !== null) window.clearTimeout(minTimer);
      unlistenList.then((f) => f());
      unlistenComment.then((f) => f());
      unlistenPermDenied.then((f) => f());
      releaseRegisteredTextures();
    };
  }, [serverKey]);

  const handleRequestComment = useCallback((userId: number) => {
    if (requestedRef.current.has(userId)) return;
    requestedRef.current.add(userId);
    invoke("request_user_comment", { userId }).catch(() => {});
  }, []);

  // O(1) channel-id -> name lookup, built once per `channels` change.
  const channelNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const ch of channels) map.set(ch.id, ch.name || "Root");
    return map;
  }, [channels]);
  const channelName = useCallback(
    (channelId: number): string => channelNameById.get(channelId) ?? "Root",
    [channelNameById],
  );

  // Build offline `UserEntry` objects with stable per-user_id references
  // so the `memo`-wrapped `UserListItem` skips re-renders when nothing
  // about a particular user actually changed.
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
        existing
        && existing.name === fresh.name
        && existing.channel_id === fresh.channel_id
        && existing.comment === fresh.comment
        && existing.texture_size === fresh.texture_size
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

  const groups = useMemo(
    () => buildMemberGroups(users, offlineEntries, ownSession, aclGroups, t("membersTab.groupMembers"), t("membersTab.groupGuests")),
    [users, offlineEntries, ownSession, aclGroups, t],
  );

  const totalMembers = useMemo(
    () => groups.reduce((sum, g) => sum + g.rows.length, 0),
    [groups],
  );

  if (loading && totalMembers === 0) {
    return (
      <div
        className={styles.membersTab}
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label={t("membersTab.loading")}
      >
        <MembersSkeleton />
      </div>
    );
  }

  if (totalMembers === 0) {
    return (
      <div className={styles.membersTab}>
        <div className={styles.membersEmpty}>{t("membersTab.empty")}</div>
      </div>
    );
  }

  return (
    <div className={styles.membersTab} data-testid={TID.memberList}>
      {groups.map((group) => (
        <section key={group.key} className={styles.memberGroup}>
          <div
            className={styles.membersGroupTitle}
            style={group.color ? { color: group.color } : undefined}
          >
            {group.label} - {group.rows.length}
          </div>
          <div className={styles.memberGroupBody}>
            {group.rows.map((row) => (
              <MemberRowItem
                key={row.entry.session}
                user={row.entry}
                offline={row.offline}
                channelName={row.offline ? undefined : channelName(row.entry.channel_id)}
                active={selectedDmUser === row.entry.session}
                isTalking={talkingSessions.has(row.entry.session)}
                onSelectDm={onSelectDm}
                onUserContextMenu={onUserContextMenu}
                onRequestComment={handleRequestComment}
              />
            ))}
          </div>
        </section>
      ))}
      {loading && (
        <section
          className={styles.memberGroup}
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t("membersTab.loadingOffline")}
        >
          <div className={styles.membersGroupTitle}>
            <span
              className={styles.skeletonShimmer}
              style={{ display: "inline-block", width: 110, height: 10, borderRadius: 4 }}
              aria-hidden="true"
            />
          </div>
          <div className={styles.memberGroupBody}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`offline-skel-${i}`} className={styles.skeletonRow} aria-hidden="true">
                <span className={`${styles.skeletonShimmer} ${styles.skeletonAvatar}`} />
                <span className={`${styles.skeletonShimmer} ${styles.skeletonName}`} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Memoized so a parent re-render (e.g., sidebar tab switch where this
 * pane is kept mounted via CSS) skips the heavy render body when the
 * props are unchanged by reference.
 */
export const MembersTab = memo(MembersTabImpl);

