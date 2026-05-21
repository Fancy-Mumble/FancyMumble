import { BellIcon, BellOffIcon, CloseIcon, DatabaseIcon, FolderIcon, PollIcon, PopoutIcon, ScreenShareIcon, SearchIcon, UsersGroupIcon } from "../../icons";
import { useTranslation } from "react-i18next";
import { isMobile } from "../../utils/platform";
import type { KeyTrustLevel } from "../../types";
import KeyTrustIndicator from "../security/KeyTrustIndicator";
import KebabMenu, { type KebabMenuItem } from "../elements/KebabMenu";
import styles from "./ChatView.module.css";
import { colorFor } from "../sidebar/UserListItem";

/** Info about the active broadcast, passed in when streaming is active. */
export interface BroadcastInfo {
  /** Name of the broadcaster. */
  broadcasterName: string;
  /** Avatar data URL (or null for initial-based avatar). */
  avatarUrl: string | null;
  /** Number of viewers in the channel (excluding the broadcaster). */
  viewerCount: number;
  /** Whether the current user is the broadcaster. */
  isOwnBroadcast: boolean;
  /** Channel name the broadcast is happening in. */
  channelName: string;
  /** Called when the user clicks the close/stop button in the stream header. */
  onClose: () => void;
}

interface ChatHeaderProps {
  readonly channelName: string;
  readonly memberCount: number;
  readonly isInChannel: boolean;
  readonly isDm?: boolean;
  readonly isPersisted?: boolean;
  readonly onJoin?: () => void;
  readonly onChannelInfoToggle?: () => void;
  readonly onChannelSearch?: () => void;
  readonly keyTrustLevel?: KeyTrustLevel;
  readonly onVerifyClick?: () => void;
  readonly onPollCreate?: () => void;
  readonly isSilenced?: boolean;
  readonly onToggleSilence?: () => void;
  readonly isScreenSharing?: boolean;
  readonly onToggleScreenShare?: () => void;
  /** When set, the share button is shown but disabled with this tooltip. */
  readonly screenShareDisabledReason?: string;
  /** True when the server has a WebRTC SFU module for server-relayed screen sharing. */
  readonly sfuAvailable?: boolean;
  /** When a stream is active, display broadcast info in the header. */
  readonly broadcastInfo?: BroadcastInfo;
  /** Whether there are unseen pin changes (shows red dot on kebab & menu item). */
  readonly hasNewPins?: boolean;
  /** Called when the user opens the pinned messages panel. */
  readonly onPinnedMessages?: () => void;
  /** Whether the user has unseen completed downloads. */
  readonly hasNewDownloads?: boolean;
  /** Called when the user opens the downloads panel. */
  readonly onDownloads?: () => void;
  /** Called when the user clicks "Pop out DM" (only meaningful when isDm). */
  readonly onPopOutDm?: () => void;
}

function buildKebabItems({
  onPollCreate,
  isSilenced,
  onToggleSilence,
  hasNewPins,
  onPinnedMessages,
  hasNewDownloads,
  onDownloads,
  t,
}: Pick<ChatHeaderProps, "onPollCreate" | "isSilenced" | "onToggleSilence" | "hasNewPins" | "onPinnedMessages" | "hasNewDownloads" | "onDownloads"> & { t: (key: string) => string }): KebabMenuItem[] {
  const items: KebabMenuItem[] = [];
  if (onPinnedMessages) {
    items.push({
      id: "pinned-messages",
      label: t("header.pinnedMessages"),
      icon: <span style={{ fontSize: 15, lineHeight: 1 }}>📌</span>,
      badge: hasNewPins,
      onClick: onPinnedMessages,
    });
  }
  if (onDownloads) {
    items.push({
      id: "downloads",
      label: t("header.downloads"),
      icon: <FolderIcon width={16} height={16} />,
      badge: hasNewDownloads,
      onClick: onDownloads,
    });
  }
  if (onPollCreate) {
    items.push({
      id: "create-poll",
      label: t("header.createPoll"),
      icon: <PollIcon width={16} height={16} />,
      onClick: onPollCreate,
    });
  }
  if (onToggleSilence) {
    items.push({
      id: "toggle-silence",
      label: isSilenced ? t("header.unmuteChannel") : t("header.muteChannel"),
      icon: isSilenced
        ? <BellIcon width={16} height={16} />
        : <BellOffIcon width={16} height={16} />,
      active: isSilenced,
      onClick: onToggleSilence,
    });
  }
  return items;
}

export default function ChatHeader({
  channelName,
  memberCount,
  isInChannel,
  isDm,
  isPersisted,
  onJoin,
  onChannelInfoToggle,
  onChannelSearch,
  keyTrustLevel,
  onVerifyClick,
  onPollCreate,
  isSilenced,
  onToggleSilence,
  isScreenSharing,
  onToggleScreenShare,
  screenShareDisabledReason,
  sfuAvailable,
  broadcastInfo,
  hasNewPins,
  onPinnedMessages,
  hasNewDownloads,
  onDownloads,
  onPopOutDm,
}: ChatHeaderProps) {
  const { t } = useTranslation("chat");
  const tStr = t as (key: string) => string;
  const prefix = isDm ? "@" : "#";
  const subtitle = isDm ? t("header.directMessage") : t("header.members", { count: memberCount });

  const privateBadge = isDm;
  const isStreaming = !!broadcastInfo;

  return (
    <div className={`${styles.header} ${isStreaming ? styles.headerStreaming : ""}`}>
      {/* Broadcaster info (replaces channel info when streaming) */}
      {isStreaming ? (
        <div className={styles.headerInfo}>
          <div className={styles.broadcasterRow}>
            <div
              className={styles.broadcasterAvatar}
              style={{
                background: broadcastInfo.avatarUrl
                  ? "transparent"
                  : colorFor(broadcastInfo.broadcasterName),
              }}
            >
              {broadcastInfo.avatarUrl ? (
                <img
                  src={broadcastInfo.avatarUrl}
                  alt={broadcastInfo.broadcasterName}
                  className={styles.broadcasterAvatarImg}
                />
              ) : (
                broadcastInfo.broadcasterName.charAt(0).toUpperCase()
              )}
            </div>
            <div className={styles.broadcasterMeta}>
              <span className={styles.broadcasterName}>
                {broadcastInfo.isOwnBroadcast ? t("header.you") : broadcastInfo.broadcasterName}
                <span className={styles.broadcasterChannel}> - {broadcastInfo.channelName}</span>
              </span>
              <span className={styles.broadcastLabel}>
                <span className={styles.liveDot} />
                Screen sharing
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.headerInfo}>
          <h2 className={styles.channelName}>
            {prefix} {channelName}
            {isPersisted && (
              <DatabaseIcon
                className={styles.persistedIcon}
                width={14}
                height={14}
                aria-label={t("header.persistedChat")}
              >
                <title>{t("header.persistedChatTooltip")}</title>
              </DatabaseIcon>
            )}
          </h2>
          {!isMobile && (<span className={styles.memberCount}>{subtitle}</span>)}
        </div>
      )}

      <div className={styles.headerActions}>
        {/* Viewer count (when streaming, shown on the right) */}
        {isStreaming && (
          <span className={styles.viewerCount}>
            <UsersGroupIcon width={14} height={14} />
            {broadcastInfo.viewerCount}
          </span>
        )}
        {keyTrustLevel && !privateBadge && (
          <KeyTrustIndicator
            trustLevel={keyTrustLevel}
            onVerifyClick={onVerifyClick}
          />
        )}
        {privateBadge && onPopOutDm && (
          <button
            className={styles.serverInfoBtn}
            onClick={onPopOutDm}
            aria-label={t("header.popOutDm")}
            title={t("header.popOutDm")}
          >
            <PopoutIcon width={18} height={18} />
          </button>
        )}
        {onChannelSearch && !privateBadge && (
          <button
            className={styles.serverInfoBtn}
            onClick={onChannelSearch}
            aria-label={t("header.searchInChannel")}
            title={t("header.searchInChannel")}
          >
            <SearchIcon width={18} height={18} />
          </button>
        )}
        {onChannelInfoToggle && !privateBadge && (
          <button
            className={styles.serverInfoBtn}
            onClick={onChannelInfoToggle}
            aria-label={t("header.channelInfo")}
            title={t("header.channelInfo")}
          >
            <FolderIcon width={18} height={18} />
          </button>
        )}
        {onToggleScreenShare && !privateBadge && !broadcastInfo?.isOwnBroadcast && (
          <button
            className={`${styles.serverInfoBtn} ${isScreenSharing ? styles.screenShareActive : ""}`}
            onClick={onToggleScreenShare}
            disabled={!!screenShareDisabledReason}
            aria-label={isScreenSharing ? t("header.stopSharing") : t("header.shareScreen")}
            title={
              screenShareDisabledReason ?? (
                isScreenSharing
                  ? t("header.stopSharing")
                  : sfuAvailable
                    ? t("header.shareScreenRelayed")
                    : t("header.shareScreenP2P")
              )
            }
          >
            <ScreenShareIcon width={18} height={18} />
          </button>
        )}
        {/* Stream close button (when streaming, replaces the toggle) */}
        {isStreaming && (
          <button
            className={styles.streamCloseBtn}
            onClick={broadcastInfo.onClose}
            title={broadcastInfo.isOwnBroadcast ? t("header.stopSharing") : t("header.closeStream")}
            aria-label={broadcastInfo.isOwnBroadcast ? t("header.stopSharing") : t("header.closeStream")}
          >
            <CloseIcon width={16} height={16} />
          </button>
        )}
        {!privateBadge && (
          <KebabMenu
            items={buildKebabItems({ onPollCreate, isSilenced, onToggleSilence, hasNewPins, onPinnedMessages, hasNewDownloads, onDownloads, t: tStr })}
            ariaLabel={t("header.channelOptions")}
            badge={hasNewPins || hasNewDownloads}
          />
        )}
        {!isInChannel && onJoin && (
          <button className={styles.joinBtn} onClick={onJoin}>
            {isMobile ? t("header.join") : t("header.joinChannel")}
          </button>
        )}
      </div>
    </div>
  );
}
