import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AclGroup, ChannelEntry, UserEntry } from "@core/types";
import { useAclGroups } from "../../hooks/useAclGroups";
import { primaryRoles } from "@core/features/roster/roles";
import { useRegisteredMembers } from "@core/features/roster/registeredMembers";
import { UserListItem } from "./user/UserListItem";
import { TID } from "@core/testids";
import styles from "./channel/ChannelSidebar.module.css";

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

  const { roleOf, order, colors } = primaryRoles(aclGroups);
  const buckets = bucketRows([...onlineRows, ...offlineRows], roleOf);

  const result: MemberGroup[] = [];
  for (const name of order) {
    const rows = buckets.get(name);
    if (!rows || rows.length === 0) continue;
    rows.sort(compareRows);
    result.push({
      key: name,
      label: name,
      color: colors.get(name) ?? null,
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
  const { offlineEntries, loading, requestComment } = useRegisteredMembers();
  const aclGroups = useAclGroups();

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

  const groups = useMemo(
    () =>
      buildMemberGroups(
        users,
        offlineEntries,
        ownSession,
        aclGroups,
        t("membersTab.groupMembers"),
        t("membersTab.groupGuests"),
      ),
    [users, offlineEntries, ownSession, aclGroups, t],
  );

  const totalMembers = useMemo(() => groups.reduce((sum, g) => sum + g.rows.length, 0), [groups]);

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
          <div className={styles.membersGroupTitle} style={group.color ? { color: group.color } : undefined}>
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
                onRequestComment={requestComment}
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
