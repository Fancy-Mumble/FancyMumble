import { CheckIcon, CopyIcon, QuoteIcon } from "../../icons";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, TimeFormat, UserEntry } from "../../types";
import MessageItem, { MessageAvatar } from "./message/MessageItem";
import MessageActionBar from "../elements/MessageActionBar";
import ReactionBar from "./reaction/ReactionBar";
import ReadReceiptIndicator from "./readreceipt/ReadReceiptIndicator";
import type { ReactionSummary } from "./reaction/reactionStore";
import { dateKey, formatDateChip } from "../../utils/format";
import { isHeavyContent } from "../../messageOffload";
import { rememberGalleryRefs, getGalleryRef, stripGalleryMarker } from "../../utils/gallery";
import type { PollPayload } from "./poll/PollCreator";
import { isMobile } from "../../utils/platform";
import styles from "./ChatView.module.css";

interface ChatMessageListProps {
  /** The messages to mount - the tail-anchored render window, not
   *  necessarily the whole thread (see chatWindowing.ts). */
  readonly allMessages: ChatMessage[];
  /**
   * Global index of `allMessages[0]` within the full thread.  All
   * index-based logic (unread divider, message keys) works in global
   * index space so it is stable while the window grows.
   */
  readonly indexOffset?: number;
  /**
   * Ordered message IDs of the FULL thread for read-receipt watermark
   * comparison.  Falls back to the rendered slice when omitted.
   */
  readonly fullMessageIds?: string[];
  readonly userBySession: Map<number, UserEntry>;
  readonly avatarBySession: Map<number, string>;
  readonly userByHash: Map<string, UserEntry>;
  readonly avatarByHash: Map<string, string>;
  readonly convertToLocalTime: boolean;
  readonly bubbleStyle: string;
  readonly lastReadIdx: number | null;
  readonly selectionMode: boolean;
  readonly canDelete: boolean;
  readonly selectedMsgIds: Set<string>;
  readonly restoringKeys: Set<string>;
  readonly polls: Map<string, PollPayload>;
  readonly ownSession: number | null;
  readonly timeFormat: TimeFormat;
  readonly systemUses24h: boolean | undefined;
  readonly selectUser: (session: number) => void;
  readonly handleMessageContextMenu: (e: React.MouseEvent, msg: ChatMessage) => void;
  readonly toggleMsgSelection: (msgId: string) => void;
  readonly handleCite: (msg: ChatMessage) => void;
  readonly handleTouchStart: (msg: ChatMessage) => void;
  readonly cancelLongPress: () => void;
  readonly handleReaction: (msg: ChatMessage, emoji: string) => void;
  readonly handleMoreReactions: (msg: ChatMessage, e?: React.MouseEvent) => void;
  readonly handleCopyText: (msg: ChatMessage) => void;
  readonly handleSingleDelete: (msg: ChatMessage) => void;
  readonly handlePollVote: (pollId: string, selected: number[]) => Promise<void>;
  readonly handleScrollToMessage: (messageId: string) => void;
  readonly handleOpenLightbox: (src: string) => void;
  readonly getMessageReactions: (messageId: string) => ReactionSummary[];
  readonly onToggleReaction: (msg: ChatMessage, emoji: string) => void;
  readonly onAddReaction: (msg: ChatMessage, e?: React.MouseEvent) => void;
  /** When true, the per-message MessageActionBar is rendered below every
   *  message instead of being shown only on hover. */
  readonly alwaysShowMessageActions?: boolean;
}

interface MsgGroup {
  senderId: number | null;
  senderHash: string | null;
  isOwn: boolean;
  startIdx: number;
  messages: ChatMessage[];
  day: string;
}

export default function ChatMessageList({
  allMessages,
  indexOffset = 0,
  fullMessageIds,
  userBySession,
  avatarBySession,
  userByHash,
  avatarByHash,
  convertToLocalTime,
  bubbleStyle,
  lastReadIdx,
  selectionMode,
  canDelete,
  selectedMsgIds,
  restoringKeys,
  polls,
  ownSession,
  timeFormat,
  systemUses24h,
  selectUser,
  handleMessageContextMenu,
  toggleMsgSelection,
  handleCite,
  handleTouchStart,
  cancelLongPress,
  handleReaction,
  handleMoreReactions,
  handleCopyText,
  handleSingleDelete,
  handlePollVote,
  handleScrollToMessage,
  handleOpenLightbox,
  getMessageReactions,
  onToggleReaction,
  onAddReaction,
  alwaysShowMessageActions = false,
}: ChatMessageListProps) {
  const { t } = useTranslation("chat");
  // Resolve own cert hash for hash-based reaction tracking.
  const ownHash = ownSession !== null ? userBySession.get(ownSession)?.hash : undefined;

  // Ordered list of all message IDs for read-receipt watermark comparison.
  // Prefer the full-thread list from the parent: the rendered window may
  // start after the watermark message.
  const slicedMessageIds = useMemo(
    () => allMessages.map((m) => m.message_id).filter((id): id is string => id != null),
    [allMessages],
  );
  const allMessageIds = fullMessageIds ?? slicedMessageIds;

  // Channel ID for read receipt queries (all messages belong to the same channel).
  const channelId = allMessages[0]?.channel_id;

  // Refresh the gallery-membership map so each message's group survives even
  // after offload strips the marker from its body (see utils/gallery.ts).
  rememberGalleryRefs(allMessages);

  // Group consecutive messages from the same sender,
  // also breaking on date boundaries so date chips render between groups.
  // `startIdx` is in global (full-thread) index space so the unread
  // divider position stays valid while the render window grows.
  const groups: MsgGroup[] = [];
  for (const [i, msg] of allMessages.entries()) {
    const msgDay = msg.timestamp ? dateKey(msg.timestamp, convertToLocalTime) : "";
    const prev = groups[groups.length - 1];
    const msgHash = msg.sender_hash ?? null;
    if (prev?.senderId === msg.sender_session && prev.isOwn === msg.is_own && prev.day === msgDay) {
      prev.messages.push(msg);
    } else {
      groups.push({ senderId: msg.sender_session, senderHash: msgHash, isOwn: msg.is_own, startIdx: i + indexOffset, messages: [msg], day: msgDay });
    }
  }

  const renderMessage = (msg: ChatMessage, globalIdx: number, j: number, group: MsgGroup, senderUser: UserEntry | undefined, senderAvatar: string | undefined, galleryTile = false) => {
    const hasMsgId = !!msg.message_id;
    const isSelected = hasMsgId && selectedMsgIds.has(msg.message_id!);
    // Inside a gallery grid the marker is stripped so the tile is pure media.
    const itemMsg = galleryTile ? { ...msg, body: stripGalleryMarker(msg.body) } : msg;
    return (
      <React.Fragment key={msg.message_id ?? `${msg.channel_id}-${msg.sender_session ?? "s"}-${msg.body.slice(0, 32)}-${globalIdx}`}>
        <div
          className={[
            styles.actionBarWrapper,
            galleryTile ? styles.galleryTileWrap : "",
            selectionMode && canDelete && hasMsgId ? styles.messageRowSelectable : "",
            selectionMode && canDelete && hasMsgId ? styles.selectableRow : "",
            isSelected ? styles.selectedRow : "",
          ].join(" ")}
          data-msg-id={msg.message_id ?? undefined}
          data-msg-heavy={msg.message_id && isHeavyContent(msg.body) ? "" : undefined}
          onContextMenu={hasMsgId && !selectionMode ? (e) => handleMessageContextMenu(e, msg) : undefined}
          onClick={selectionMode && canDelete && hasMsgId ? () => toggleMsgSelection(msg.message_id!) : undefined}
          onDoubleClick={hasMsgId && !selectionMode && !isMobile ? () => handleCite(msg) : undefined}
          onTouchStart={hasMsgId && !selectionMode ? () => handleTouchStart(msg) : undefined}
          onTouchEnd={selectionMode ? undefined : cancelLongPress}
          onTouchMove={selectionMode ? undefined : cancelLongPress}
        >
          {!selectionMode && !isMobile && (
            <MessageActionBar
              message={msg}
              isOwn={msg.is_own}
              onReaction={handleReaction}
              onMoreReactions={handleMoreReactions}
              onCite={handleCite}
              onCopyText={handleCopyText}
              onDelete={canDelete ? handleSingleDelete : undefined}
              canDelete={canDelete && hasMsgId}
            />
          )}
          <MessageItem
            msg={itemMsg}
            galleryTile={galleryTile}
            index={globalIdx}
            avatarUrl={senderAvatar}
            user={senderUser}
            polls={polls}
            ownSession={ownSession}
            onVote={handlePollVote}
            onAvatarClick={selectUser}
            timeFormat={timeFormat}
            convertToLocalTime={convertToLocalTime}
            systemUses24h={systemUses24h}
            isRestoring={msg.message_id ? restoringKeys.has(msg.message_id) : false}
            isFirstInGroup={j === 0}
            onScrollToMessage={handleScrollToMessage}
            onOpenLightbox={handleOpenLightbox}
            readReceiptIndicator={
              msg.is_own && msg.message_id && channelId != null
                ? <ReadReceiptIndicator messageId={msg.message_id} channelId={channelId} allMessageIds={allMessageIds} />
                : undefined
            }
            inlineActions={
              alwaysShowMessageActions && hasMsgId && !msg.is_legacy
                ? (
                  <span className={styles.inlineActions}>
                    <button
                      type="button"
                      className={styles.inlineActionBtn}
                      onClick={(e) => { e.stopPropagation(); handleCite(msg); }}
                      title={t("inlineActions.quote")}
                      aria-label={t("inlineActions.quote")}
                    >
                      <QuoteIcon width={12} height={12} />
                    </button>
                    <button
                      type="button"
                      className={styles.inlineActionBtn}
                      onClick={(e) => { e.stopPropagation(); handleCopyText(msg); }}
                      title={t("inlineActions.copy")}
                      aria-label={t("inlineActions.copy")}
                    >
                      <CopyIcon width={12} height={12} />
                    </button>
                  </span>
                )
                : undefined
            }
          >
            {msg.message_id && (() => {
              const reactions = getMessageReactions(msg.message_id!);
              return reactions.length > 0 ? (
                <ReactionBar
                  reactions={reactions}
                  ownHash={ownHash}
                  isOwn={group.isOwn}
                  onToggle={(emoji) => onToggleReaction(msg, emoji)}
                  onAdd={(e) => onAddReaction(msg, e)}
                />
              ) : null;
            })()}
          </MessageItem>
          {selectionMode && canDelete && hasMsgId && (
            <div className={`${styles.selectCheckbox} ${isSelected ? styles.selectCheckboxChecked : ""}`}>
              {isSelected && (
                <CheckIcon width={12} height={12} />
              )}
            </div>
          )}
        </div>
      </React.Fragment>
    );
  };

  const renderGroupBlock = (group: MsgGroup, msgs: ChatMessage[], startIdx: number, senderUser: UserEntry | undefined, senderAvatar: string | undefined, keyOverride?: string) => {
    const firstMsg = msgs[0];
    const key = keyOverride ?? firstMsg.message_id ?? `${firstMsg.channel_id}-${firstMsg.sender_session ?? "s"}-${startIdx}`;
    return (
      <div key={key} className={`${styles.messageGroup} ${group.isOwn ? styles.messageGroupOwn : ""}`}>
        {(!group.isOwn || bubbleStyle === "flat") && (
          <div className={styles.avatarColumn}>
            <MessageAvatar
              senderSession={group.senderId}
              senderName={firstMsg.sender_name}
              avatarUrl={senderAvatar}
              user={senderUser}
              onAvatarClick={selectUser}
            />
          </div>
        )}
        <div className={styles.bubbleColumn}>
          {(() => {
            const nodes: React.ReactNode[] = [];
            let j = 0;
            while (j < msgs.length) {
              const ref = getGalleryRef(msgs[j].message_id);
              // Collect a run of consecutive messages sharing this gallery id.
              const runStart = j;
              const run: ChatMessage[] = [];
              if (ref) {
                while (j < msgs.length && getGalleryRef(msgs[j].message_id)?.groupId === ref.groupId) {
                  run.push(msgs[j]);
                  j += 1;
                }
              }
              if (!ref || run.length < 2) {
                // Not a gallery (or a lone image not yet joined by its peers).
                nodes.push(renderMessage(msgs[runStart], startIdx + runStart, runStart, group, senderUser, senderAvatar));
                if (!ref) j += 1;
                continue;
              }
              // Render the gallery as a tile grid: one tile per index up to
              // `total`, with placeholders for images that haven't arrived yet
              // (prevents layout shift as the batch uploads). Odd totals give
              // the first image a full-width banner so the grid stays balanced.
              const { total } = getGalleryRef(run[0].message_id)!;
              const byIndex = new Map<number, ChatMessage>();
              for (const m of run) {
                const r = getGalleryRef(m.message_id);
                if (r) byIndex.set(r.index, m);
              }
              const tiles: React.ReactNode[] = [];
              for (let i = 0; i < total; i += 1) {
                const m = byIndex.get(i);
                tiles.push(
                  m
                    ? renderMessage(m, startIdx + runStart + i, runStart + i, group, senderUser, senderAvatar, true)
                    : <div key={`ph-${ref.groupId}-${i}`} className={styles.galleryTilePlaceholder} aria-hidden="true" />,
                );
              }
              nodes.push(
                <div
                  key={`gal-${ref.groupId}-${runStart}`}
                  className={`${styles.galleryGrid} ${total % 2 === 1 ? styles.galleryGridOdd : ""}`}
                >
                  {tiles}
                </div>,
              );
            }
            return nodes;
          })()}
        </div>
      </div>
    );
  };

  let lastDay = "";
  return (
    <>
      {groups.map((group) => {
        const firstGlobalIdx = group.startIdx;
        const firstMsg = group.messages[0];
        const groupKey = firstMsg.message_id ?? `${firstMsg.channel_id}-${firstMsg.sender_session ?? "s"}-${firstGlobalIdx}`;
        const senderUser = (group.senderId !== null ? userBySession.get(group.senderId) : undefined)
          ?? (group.senderHash ? userByHash.get(group.senderHash) : undefined);
        const senderAvatar = (group.senderId !== null ? avatarBySession.get(group.senderId) : undefined)
          ?? (group.senderHash ? avatarByHash.get(group.senderHash) : undefined);

        let dateChip: React.ReactNode = null;
        if (group.day && group.day !== lastDay) {
          const label = formatDateChip(firstMsg.timestamp!, convertToLocalTime);
          dateChip = (
            <div key={`date-${group.day}`} className={styles.dateDivider} aria-label={label}>
              <span className={styles.dateDividerLabel}>{label}</span>
            </div>
          );
          lastDay = group.day;
        }

        const groupEnd = firstGlobalIdx + group.messages.length;
        const dividerInGroup = lastReadIdx !== null && lastReadIdx >= firstGlobalIdx && lastReadIdx < groupEnd;
        const dividerAtStart = dividerInGroup && lastReadIdx === firstGlobalIdx;
        const dividerMidGroup = dividerInGroup && !dividerAtStart;

        const unreadDivider = (
          <div key={`unread-${lastReadIdx}`} className={styles.unreadDivider} aria-label={t("dates.newMessages")}>
            <span className={styles.unreadDividerLabel}>{t("dates.newMessages")}</span>
          </div>
        );

        if (dividerMidGroup) {
          const splitAt = lastReadIdx! - firstGlobalIdx;
          return (
            <React.Fragment key={groupKey}>
              {dateChip}
              {renderGroupBlock(group, group.messages.slice(0, splitAt), firstGlobalIdx, senderUser, senderAvatar, `${groupKey}-pre`)}
              {unreadDivider}
              {renderGroupBlock(group, group.messages.slice(splitAt), lastReadIdx!, senderUser, senderAvatar, `${groupKey}-post`)}
            </React.Fragment>
          );
        }

        return (
          <React.Fragment key={groupKey}>
            {dateChip}
            {dividerAtStart && unreadDivider}
            {renderGroupBlock(group, group.messages, firstGlobalIdx, senderUser, senderAvatar)}
          </React.Fragment>
        );
      })}
    </>
  );
}
