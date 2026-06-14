import { ChevronRightIcon, HeadphonesOffIcon, ListenBadgeIcon, LockIcon, MicOffSmallIcon, ScreenShareIcon } from "../../../icons";
/**
 * ModernChannelList - a flat, always-visible channel viewer.
 *
 * - No hierarchy: all channels rendered at the same level.
 * - Channels are ordered by server position (then name as tiebreaker).
 * - Each channel shows its members directly below the name.
 * - Channels can be collapsed (shows stacked avatar bubbles instead).
 * - Default state: expanded (members visible as a name list).
 * - Current channel shows a sticky clone at the top or bottom edge
 *   of the scroll container when it has scrolled out of view.
 * - Hovering a member shows their profile card.
 * - Right-clicking a member opens the user context menu.
 */

import { useState, useMemo, useCallback, useContext, useRef, useLayoutEffect, memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChannelEntry, UserEntry } from "../../../types";
import { colorFor, useHoverCardPosition, UserHoverCardPortal, RoleColorsContext } from "../user/UserListItem";
import { useUserAvatar, useUserComment } from "../../../lazyBlobs";
import { parseComment } from "../../../profileFormat";
import { useUserStats } from "../../../hooks/useUserStats";
import { useStreamThumbnail } from "../../chat/stream/useStreamPreview";
import SwipeableCard from "../../elements/SwipeableCard";
import { isMobile } from "../../../utils/platform";
import { PERM_MOVE, PERM_ENTER } from "../../../utils/permissions";
import { useUserDrag, useChannelDropTarget } from "../../../utils/userMoveDnd";
import { useAppStore } from "../../../store";
import { PchatBadge } from "../PchatBadge";
import {
  ChannelReorderWrapper,
  useChannelReorderHandler,
} from "../channel/channelReorder";
import { TID } from "../../../testids";
import styles from "./ModernChannelList.module.css";

const MAX_STACKED = 3;

interface ModernChannelListProps {
  readonly channels: ChannelEntry[];
  readonly users: UserEntry[];
  readonly selectedChannel: number | null;
  readonly currentChannel: number | null;
  readonly listenedChannels: Set<number>;
  readonly unreadCounts: Record<number, number>;
  readonly talkingSessions: Set<number>;
  readonly broadcastingSessions: Set<number>;
  readonly onSelectChannel: (id: number) => void;
  readonly onJoinChannel: (id: number) => void;
  readonly onContextMenu: (e: React.MouseEvent, channelId: number) => void;
  readonly onUserContextMenu?: (e: React.MouseEvent, user: UserEntry) => void;
  readonly onUserClick?: (session: number) => void;
  readonly shakingChannelId?: number;
  readonly highlightChannelId?: number;
  readonly highlightUserSession?: number;
}

// -- Channel drop-target wrapper (drag-to-move users) -------------

function ChannelDropWrapper({
  channelId,
  children,
}: Readonly<{ channelId: number; children: React.ReactNode }>) {
  const { ref, active } = useChannelDropTarget(channelId);
  return (
    <div ref={ref} className={active ? styles.dropTarget : undefined}>
      {children}
    </div>
  );
}

// -- Member item with hover card ----------------------------------

interface MemberItemProps {
  readonly user: UserEntry;
  readonly isTalking: boolean;
  readonly isBroadcasting: boolean;
  readonly isActive?: boolean;
  readonly onContextMenu?: (e: React.MouseEvent, user: UserEntry) => void;
  readonly onClick?: (session: number) => void;
}

function MemberItemImpl({ user, isTalking, isBroadcasting, isActive, onContextMenu, onClick }: MemberItemProps) {
  const { t } = useTranslation(["sidebar", "common"]);
  const ownSession = useAppStore((s) => s.ownSession);
  const selectedDmUser = useAppStore((s) => s.selectedDmUser);
  const dmUnread = useAppStore((s) => s.dmUnreadCounts[user.session] ?? 0);
  const isSelf = ownSession === user.session;
  const active = isActive ?? (!isSelf && selectedDmUser === user.session);
  const canMoveUser = useAppStore((s) => {
    const ch = s.channels.find((c) => c.id === user.channel_id);
    return ch?.permissions != null && (ch.permissions & PERM_MOVE) !== 0;
  });
  const roleColors = useContext(RoleColorsContext);
  const roleColor = user.user_id != null ? (roleColors.get(user.user_id) ?? null) : null;
  const url = useUserAvatar(user.session, user.texture_size);
  const { showCard, cardPos, itemRef, handleEnter, handleLeave } = useHoverCardPosition(isBroadcasting);
  // Defer FancyProfile parsing until the hover card is actually shown.
  // The result is consumed only inside the portal below, and parsing
  // adds measurable mount cost when many members are visible.
  const liveComment = useUserComment(user.session, user.comment_size, showCard);
  const parsed = useMemo(
    () => {
      if (!showCard) return null;
      const c = user.comment ?? liveComment;
      return c ? parseComment(c) : null;
    },
    [showCard, user.comment, liveComment],
  );
  const stats = useUserStats(user.session, showCard);
  const streamThumbnail = useStreamThumbnail(user.session, showCard && isBroadcasting);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu?.(e, user);
    },
    [onContextMenu, user],
  );

  const { handlers: dragHandlers, overlay: dragOverlay } = useUserDrag(
    user.session,
    user.name,
    url,
    // Moving yourself to another channel is always allowed (no PERM_MOVE
    // needed on self). Moving others requires PERM_MOVE on their channel.
    isMobile || (ownSession != null && !isSelf && !canMoveUser),
  );

  return (
    <>
      {dragOverlay}
      <button
        ref={itemRef}
        type="button"
        className={`${styles.memberItem} ${active ? styles.memberItemActive : ""} ${isTalking ? styles.memberTalking : ""}`}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onContextMenu={handleContextMenu}
        onClick={() => onClick?.(user.session)}
        onClickCapture={dragHandlers.onClickCapture}
        onPointerDown={dragHandlers.onPointerDown}
        onPointerMove={dragHandlers.onPointerMove}
        onPointerUp={dragHandlers.onPointerUp}
        onPointerCancel={dragHandlers.onPointerCancel}
        style={dragHandlers.style}
      >
        <div
          className={styles.memberAvatar}
          style={{ background: url ? "transparent" : colorFor(user.name) }}
        >
          {url ? (
            <img src={url} alt={user.name} className={styles.memberAvatarImg} />
          ) : (
            user.name.charAt(0).toUpperCase()
          )}
        </div>
        <span
          className={styles.memberName}
          style={roleColor ? { color: roleColor } : undefined}
        >{user.name}</span>
        {user.self_mute && (
          <MicOffSmallIcon className={styles.statusIcon} width={12} height={12} />
        )}
        {user.self_deaf && (
          <HeadphonesOffIcon className={styles.statusIcon} width={12} height={12} />
        )}
        {isBroadcasting && (
          <span className={styles.liveBadge} title={t("channelList.sharingScreen")}>
            <ScreenShareIcon width={10} height={10} />
            {t("channelList.liveBadge")}
          </span>
        )}
        {dmUnread > 0 && (
          <span className={styles.dmUnreadBadge} title={t("channelList.dmUnread", { count: dmUnread })}>
            {dmUnread > 99 ? "99+" : dmUnread}
          </span>
        )}
      </button>
      {showCard && cardPos && (
        <UserHoverCardPortal
          displayName={user.name}
          cardPos={cardPos}
          avatar={url}
          profile={parsed?.profile ?? {}}
          bio={parsed?.bio ?? ""}
          onlinesecs={stats?.onlinesecs}
          idlesecs={stats?.idlesecs}
          isRegistered={user.user_id != null && user.user_id > 0}
          isBroadcasting={isBroadcasting}
          thumbnail={streamThumbnail}
        />
      )}
    </>
  );
}

const MemberItem = memo(MemberItemImpl);

/** A single collapsed-avatar bubble (separate component so we can use the avatar hook). */
function CollapsedAvatar({ user }: Readonly<{ user: UserEntry }>) {
  const url = useUserAvatar(user.session, user.texture_size);
  return (
    <div
      className={styles.collapsedAvatar}
      style={{ background: url ? "transparent" : colorFor(user.name) }}
      title={user.name}
    >
      {url ? (
        <img src={url} alt={user.name} className={styles.collapsedAvatarImg} />
      ) : (
        user.name.charAt(0).toUpperCase()
      )}
    </div>
  );
}

/** Small inline avatars shown when a channel is collapsed. */
function CollapsedAvatars({ users }: Readonly<{ users: UserEntry[] }>) {
  if (users.length === 0) return null;
  const visible = users.slice(0, MAX_STACKED);
  const overflow = users.length - MAX_STACKED;

  return (
    <div className={styles.collapsedAvatars}>
      {visible.map((u) => (
        <CollapsedAvatar key={u.session} user={u} />
      ))}
      {overflow > 0 && (
        <span className={styles.overflowCount}>+{overflow}</span>
      )}
    </div>
  );
}

function ModernChannelListImpl({
  channels,
  users,
  selectedChannel,
  currentChannel,
  listenedChannels,
  unreadCounts,
  talkingSessions,
  broadcastingSessions,
  shakingChannelId,
  highlightChannelId,
  highlightUserSession,
  onSelectChannel,
  onJoinChannel,
  onContextMenu,
  onUserContextMenu,
  onUserClick,
}: ModernChannelListProps) {
  // Collapsed channels (expanded by default = not in the set).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const handleChannelReorder = useChannelReorderHandler(channels);

  const toggleCollapsed = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { t } = useTranslation(["sidebar", "common"]);

  // Build a map of users per channel.
  const usersByChannel = useMemo(() => {
    const map = new Map<number, UserEntry[]>();
    for (const u of users) {
      const list = map.get(u.channel_id) ?? [];
      list.push(u);
      map.set(u.channel_id, list);
    }
    return map;
  }, [users]);

  // Depth-first flattening of the channel tree, so each parent is
  // immediately followed by its (recursively expanded) children, in
  // server `position` order at every level.  The root channel is always
  // shown (matching the classic tree viewer) so it stays selectable and
  // right-clickable even when empty.
  const flatChannels = useMemo(() => {
    const childrenOf = new Map<number, typeof channels>();
    for (const ch of channels) {
      const parent = ch.parent_id === ch.id ? -1 : ch.parent_id ?? -1;
      const list = childrenOf.get(parent) ?? [];
      list.push(ch);
      childrenOf.set(parent, list);
    }
    const sortLevel = (list: typeof channels) =>
      [...list].sort((a, b) =>
        a.position !== b.position ? a.position - b.position : a.name.localeCompare(b.name),
      );

    const result: typeof channels = [];
    const visit = (parentId: number) => {
      for (const ch of sortLevel(childrenOf.get(parentId) ?? [])) {
        result.push(ch);
        visit(ch.id);
      }
    };
    // Start from synthetic "no parent" bucket; the real root and any
    // top-level channels live there, and the recursion handles descendants.
    visit(-1);

    return result;
  }, [channels]);

  // Find the current channel entry for the sticky clone.
  const currentChannelEntry = useMemo(
    () => (currentChannel == null ? undefined : flatChannels.find((c) => c.id === currentChannel)),
    [flatChannels, currentChannel],
  );

  // -- Sticky current-channel detection --------------------------------
  // Shows a clone at the top when the real card has scrolled above the
  // viewport, or at the bottom when it is below.

  const listRef = useRef<HTMLDivElement>(null);
  const currentCardRef = useRef<HTMLDivElement>(null);
  const selectedCardRef = useRef<HTMLDivElement>(null);
  const [stickyState, setStickyState] = useState<"none" | "top" | "bottom">("none");

  useLayoutEffect(() => {
    const card = currentCardRef.current;
    const scrollEl = listRef.current?.parentElement;
    if (!card || !scrollEl || currentChannel == null) {
      setStickyState("none");
      return;
    }
    const update = () => {
      const cardRect = card.getBoundingClientRect();
      const containerRect = scrollEl.getBoundingClientRect();
      if (cardRect.top < containerRect.top) {
        setStickyState("top");
      } else if (cardRect.bottom > containerRect.bottom) {
        setStickyState("bottom");
      } else {
        setStickyState("none");
      }
    };
    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    return () => scrollEl.removeEventListener("scroll", update);
  }, [currentChannel, flatChannels]);

  // Scroll the real channel card into view when the user clicks the sticky clone.
  const scrollCurrentIntoView = useCallback(() => {
    currentCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  // Scroll the selected channel into view whenever keyboard navigation changes it.
  useLayoutEffect(() => {
    selectedCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedChannel, highlightChannelId]);

  /** Render a single channel card (shared between sticky and list). */
  const renderChannel = useCallback((channel: ChannelEntry) => {
    const chUsers = usersByChannel.get(channel.id) ?? [];
    const unread = unreadCounts[channel.id] ?? 0;
    const isListened = listenedChannels.has(channel.id);
    const isSelected = selectedChannel === channel.id;
    const isCurrent = currentChannel === channel.id;
    const isCollapsed = collapsed.has(channel.id);
    const hasUsers = chUsers.length > 0;
    const isShaking = shakingChannelId === channel.id;
    const isHighlighted = highlightChannelId === channel.id;
    const isLocked = !isCurrent && channel.permissions !== null && (channel.permissions & PERM_ENTER) === 0;

    return (
      <ChannelDropWrapper channelId={channel.id}>
      <div
        className={`${styles.channelCard} ${isSelected ? styles.selected : ""} ${isCurrent ? styles.current : ""} ${isShaking ? styles.shaking : ""} ${isHighlighted ? styles.highlighted : ""} ${isLocked ? styles.locked : ""}`}
      >
        {/* Channel header row */}
        <div className={styles.headerRow}>
          {hasUsers && (
            <button
              type="button"
              className={styles.expandBtn}
              onClick={() => toggleCollapsed(channel.id)}
              aria-label={isCollapsed ? t("channelList.expand") : t("common:actions.collapse")}
            >
              <ChevronRightIcon
                className={`${styles.chevron} ${isCollapsed ? "" : styles.chevronOpen}`}
                width={12}
                height={12}
              />
            </button>
          )}

          <button
            type="button"
            className={styles.channelBtn}
            data-testid={TID.channelItem}
            data-channel-id={channel.id}
            data-channel-name={channel.name || t("channelList.root")}
            onClick={() => onSelectChannel(channel.id)}
            onDoubleClick={() => onJoinChannel(channel.id)}
            onContextMenu={(e) => onContextMenu(e, channel.id)}
          >
            <span className={styles.channelName}>
              {channel.name || t("channelList.root")}
              {isLocked && (
                <span className={styles.lockBadge} title={t("channelList.noPermissionToJoin")}>
                  <LockIcon width={11} height={11} />
                </span>
              )}
              {isListened && (
                <span className={styles.listenBadge} title={t("channelList.listening")}>
                  <ListenBadgeIcon width={12} height={12} />
                </span>
              )}
              <PchatBadge protocol={channel.pchat_protocol} />
            </span>
            {hasUsers && (
              <span className={styles.memberCount}>
                {chUsers.length}
              </span>
            )}
          </button>

          {unread > 0 && (
            <span className={styles.unreadBadge}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}

          {/* Collapsed: show stacked avatar bubbles */}
          {isCollapsed && hasUsers && (
            <CollapsedAvatars users={chUsers} />
          )}
        </div>

        {/* Expanded: show member names */}
        {!isCollapsed && hasUsers && (
          <div className={styles.memberList} data-no-channel-drag="true">
            {chUsers.map((u) => (
              <div key={u.session} className={u.session === highlightUserSession ? styles.highlighted : undefined}>
                <MemberItem
                  user={u}
                  isTalking={talkingSessions.has(u.session)}
                  isBroadcasting={broadcastingSessions.has(u.session)}
                  onContextMenu={onUserContextMenu}
                  onClick={onUserClick}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      </ChannelDropWrapper>
    );
  }, [
    usersByChannel, unreadCounts, listenedChannels, selectedChannel,
    currentChannel, collapsed, talkingSessions, broadcastingSessions,
    shakingChannelId, highlightChannelId, highlightUserSession, toggleCollapsed, onSelectChannel, onJoinChannel, onContextMenu, onUserContextMenu, onUserClick,
  ]);

  return (
    <div ref={listRef} className={styles.list}>
      {/* Sticky clone at top: shown when the current channel has scrolled above the viewport */}
      {currentChannelEntry && stickyState === "top" && (
        <div className={styles.stickyTop} onClick={scrollCurrentIntoView}>
          {renderChannel(currentChannelEntry)}
        </div>
      )}

      {/* All channels in server order */}
      {flatChannels.map((channel) => {
        const isCurrent = channel.id === currentChannel;
        const isSelected = channel.id === selectedChannel;
        const card = renderChannel(channel);
        const setRef = (el: HTMLDivElement | null) => {
          if (isCurrent) currentCardRef.current = el;
          if (isSelected) selectedCardRef.current = el;
        };

        if (isMobile) {
          return (
            <div key={channel.id} ref={setRef}>
              <SwipeableCard
                rightSwipeAction={{
                  label: t("channelIconList.swipeJoinLabel"),
                  color: "var(--color-accent, #2aabee)",
                  onTrigger: () => onJoinChannel(channel.id),
                }}
              >
                {card}
              </SwipeableCard>
            </div>
          );
        }

        return (
          <ChannelReorderWrapper
            key={channel.id}
            channel={channel}
            onReorder={handleChannelReorder}
            innerRef={setRef}
          >
            {card}
          </ChannelReorderWrapper>
        );
      })}

      {/* Sticky clone at bottom: shown when the current channel is below the viewport */}
      {currentChannelEntry && stickyState === "bottom" && (
        <div className={styles.stickyBottom} onClick={scrollCurrentIntoView}>
          {renderChannel(currentChannelEntry)}
        </div>
      )}
    </div>
  );
}

// Memoized so parent re-renders (e.g., sidebar tab switches) don't
// re-execute the heavy render body when props are unchanged.
const ModernChannelList = memo(ModernChannelListImpl);
export default ModernChannelList;
