import { HashIcon, HeadphonesOffIcon, ListenBadgeIcon, LockIcon, MicOffSmallIcon, ScreenShareIcon } from "../../../icons";
/**
 * ChannelIconList - a "Modern" channel viewer.
 *
 * - Depth-first traversal: each parent is immediately followed by its
 *   recursively expanded children, in server `position` order at every level.
 * - Round channel icon on the left: first <img> from description, or initials fallback.
 * - Channel name and member count on the right.
 * - Inline member avatars below on expand.
 * - Current channel shows a sticky clone at the top or bottom edge
 *   of the scroll container when it has scrolled out of view.
 */

import { useState, useMemo, useCallback, useContext, useRef, useLayoutEffect, memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChannelEntry, UserEntry } from "../../../types";
import { colorFor, useHoverCardPosition, UserHoverCardPortal, RoleColorsContext } from "../user/UserListItem";
import { useUserAvatar, useUserComment, useChannelDescription } from "../../../lazyBlobs";
import { parseComment } from "../../../profileFormat";
import { useUserStats } from "../../../hooks/useUserStats";
import { useStreamThumbnail } from "../../chat/stream/useStreamPreview";
import SwipeableCard from "../../elements/SwipeableCard";
import { isMobile } from "../../../utils/platform";
import { useUserDrag, useChannelDropTarget } from "../../../utils/userMoveDnd";
import { PERM_MOVE, PERM_ENTER } from "../../../utils/permissions";
import { useAppStore } from "../../../store";
import { PchatBadge } from "../PchatBadge";
import {
  ChannelReorderWrapper,
  useChannelReorderHandler,
} from "../channel/channelReorder";
import styles from "./ChannelIconList.module.css";

/** Extract the src of the first <img> tag in an HTML string. */
function extractDescriptionImage(html: string): string | null {
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return match ? match[1] : null;
}

export interface ChannelIconListProps {
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

// -- Channel icon (description image or initials fallback) ---------

interface ChannelIconProps {
  readonly channel: ChannelEntry;
  readonly isCurrent: boolean;
}

function ChannelIcon({ channel, isCurrent }: ChannelIconProps) {
  const description = useChannelDescription(channel.id, channel.description_size);
  const imgSrc = useMemo(
    () => (description ? extractDescriptionImage(description) : null),
    [description],
  );

  if (imgSrc) {
    return (
      <div className={`${styles.channelIcon} ${isCurrent ? styles.channelIconCurrent : ""}`}>
        <img src={imgSrc} alt="" className={styles.channelIconImg} />
      </div>
    );
  }

  const initial = (channel.name || "#").charAt(0).toUpperCase();
  const color = colorFor(channel.name);

  return (
    <div
      className={`${styles.channelIcon} ${styles.channelIconFallback} ${isCurrent ? styles.channelIconCurrent : ""}`}
      style={{ background: color }}
    >
      {initial === "#" ? (
        <HashIcon width={16} height={16} className={styles.channelIconHash} />
      ) : (
        <span className={styles.channelIconInitial}>{initial}</span>
      )}
    </div>
  );
}

// -- Member row inside expanded channel ---------------------------

interface MemberRowProps {
  readonly user: UserEntry;
  readonly isTalking: boolean;
  readonly isBroadcasting: boolean;
  readonly isActive?: boolean;
  readonly onContextMenu?: (e: React.MouseEvent, user: UserEntry) => void;
  readonly onClick?: (session: number) => void;
}

function MemberRowImpl({ user, isTalking, isBroadcasting, isActive, onContextMenu, onClick }: MemberRowProps) {
  const { t } = useTranslation("sidebar");
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
  // Defer FancyProfile parsing (and the bio fetch) until the card is shown.
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
    // Self can always drag to join another channel; others require PERM_MOVE.
    isMobile || (!isSelf && !canMoveUser),
  );

  return (
    <>
      {dragOverlay}
      <button
        ref={itemRef}
        type="button"
        className={`${styles.memberRow} ${active ? styles.memberRowActive : ""} ${isTalking ? styles.memberTalking : ""}`}
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
          <span className={styles.liveBadge} title={t("channelIconList.liveBadgeTitle")}>
            <ScreenShareIcon width={10} height={10} />
            {t("channelIconList.liveBadgeLabel")}
          </span>
        )}
        {dmUnread > 0 && (
          <span className={styles.dmUnreadBadge} title={`${dmUnread} unread direct message${dmUnread === 1 ? "" : "s"}`}>
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

const MemberRow = memo(MemberRowImpl);

// -- Main component ------------------------------------------------

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

function ChannelIconListImpl({
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
}: ChannelIconListProps) {
  const { t } = useTranslation("sidebar");
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

  const usersByChannel = useMemo(() => {
    const map = new Map<number, UserEntry[]>();
    for (const u of users) {
      const list = map.get(u.channel_id) ?? [];
      list.push(u);
      map.set(u.channel_id, list);
    }
    return map;
  }, [users]);

  // Depth-first flattening of the channel tree, preserving server
  // `position` order at every level so each parent is immediately
  // followed by its (recursively expanded) children.  The root channel is
  // always shown (matching the classic tree viewer) so it stays selectable
  // and right-clickable even when empty.
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
    visit(-1);

    return result;
  }, [channels]);

  const currentEntry = useMemo(
    () => (currentChannel == null ? undefined : flatChannels.find((c) => c.id === currentChannel)),
    [flatChannels, currentChannel],
  );

  // -- Smart sticky current-channel detection --------------------------

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

  const scrollCurrentIntoView = useCallback(() => {
    currentCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  useLayoutEffect(() => {
    selectedCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedChannel, highlightChannelId]);

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
        className={[
          styles.channelRow,
          isSelected ? styles.selected : "",
          isCurrent ? styles.current : "",
          isShaking ? styles.shaking : "",
          isHighlighted ? styles.highlighted : "",
          isLocked ? styles.locked : "",
        ].filter(Boolean).join(" ")}
      >
        <div className={styles.channelMain}>
          <ChannelIcon channel={channel} isCurrent={isCurrent} />

          <button
            type="button"
            className={styles.channelBtn}
            onClick={() => onSelectChannel(channel.id)}
            onDoubleClick={() => onJoinChannel(channel.id)}
            onContextMenu={(e) => onContextMenu(e, channel.id)}
          >
            <span className={styles.channelName}>
              {channel.name || t("channelIconList.rootFallback")}
              {isLocked && (
                <span className={styles.lockBadge} title={t("channelIconList.lockBadgeTitle")}>
                  <LockIcon width={11} height={11} />
                </span>
              )}
              {isListened && (
                <span className={styles.listenBadge} title={t("channelIconList.listenBadgeTitle")}>
                  <ListenBadgeIcon width={11} height={11} />
                </span>
              )}
              <PchatBadge protocol={channel.pchat_protocol} />
            </span>
          </button>

          <div className={styles.channelMeta}>
            {unread > 0 && (
              <span className={styles.unreadBadge}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            {hasUsers && (
              <button
                type="button"
                className={styles.memberCountBtn}
                onClick={() => toggleCollapsed(channel.id)}
                title={isCollapsed ? "Show members" : "Hide members"}
              >
                {chUsers.length}
              </button>
            )}
          </div>
        </div>

        {!isCollapsed && hasUsers && (
          <div className={styles.memberList} data-no-channel-drag="true">
            {chUsers.map((u) => (
              <div key={u.session} className={u.session === highlightUserSession ? styles.highlighted : undefined}>
                <MemberRow
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
      {currentEntry && stickyState === "top" && (
        <div className={styles.stickyTop} onClick={scrollCurrentIntoView}>
          {renderChannel(currentEntry)}
        </div>
      )}

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

      {currentEntry && stickyState === "bottom" && (
        <div className={styles.stickyBottom} onClick={scrollCurrentIntoView}>
          {renderChannel(currentEntry)}
        </div>
      )}
    </div>
  );
}

const ChannelIconList = memo(ChannelIconListImpl);
export default ChannelIconList;

