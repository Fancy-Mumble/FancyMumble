import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Box, Menu, MenuItem, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { getCachedUserAvatar } from "@core/lazyBlobs";
import { getReadersForMessage } from "@core/features/chat/readreceipt/readReceiptStore";
import { findPopOutImageSrc, imagePopoutCaption } from "@core/features/chat/imagePopout";
import { useWatchStart } from "@core/features/chat/watch/useWatchStart";
import { canDeleteMessages } from "@standard/components/sidebar/channel/ChannelEditorDialog";
import { EmojiPlusIcon } from "@ui/icons";
import { plainText } from "../../selectors";
import { Stack, UserAvatar } from "../primitives";
import { radius } from "../../tokens";

export interface MessageMenuTarget {
  message: ChatMessage;
  x: number;
  y: number;
  /** True when the body is plain text, so editing would not eat a card marker. */
  editable: boolean;
}

interface MessageMenuProps {
  target: MessageMenuTarget | null;
  onClose: () => void;
  onReact: (message: ChatMessage, at: { x: number; y: number }) => void;
  /** Applies one emoji straight away, toggling it if it is already yours. */
  onQuickReact: (message: ChatMessage, emoji: string) => void;
  onQuote: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  /** Enter selection mode with this message already picked. */
  onSelect: (messageId: string) => void;
  /**
   * Every id in the conversation, oldest first.
   *
   * A read receipt is a watermark - one id per person - rather than a flag per
   * message, so who has read *this* one is a question about positions in this
   * list. Without it the reader list is simply not offered.
   */
  allMessageIds?: readonly string[];
}

/**
 * The three reactions offered without opening the picker.
 *
 * A fixed set rather than a recent one: the row is muscle memory, and a list
 * that reorders itself under the pointer defeats that.
 */
const QUICK_REACTIONS = ["👍", "🔥", "😂"] as const;
/**
 * Right-click actions on a message.
 *
 * The hover strip carries the two or three things wanted mid-conversation;
 * this is where the rest lives, so the strip does not grow into a toolbar that
 * covers the message it belongs to.
 *
 * Rows carry no icons. At this size a glyph column costs more width than the
 * labels save in scanning, and the canvas draws the menu as text with one
 * strip of reactions above it.
 *
 * Deletion is gated on the server DeleteMessage bit for *this* channel, and on
 * the channel actually persisting messages - there is nothing stored to delete
 * otherwise. Selecting several to delete at once is offered only where deleting
 * one is, so the mode cannot be entered to reach an action that will be refused.
 */
export function MessageMenu({
  target,
  onClose,
  onReact,
  onQuickReact,
  onQuote,
  onEdit,
  onSelect,
  allMessageIds,
}: Readonly<MessageMenuProps>) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const ownSession = useAppStore((state) => state.ownSession);
  // Receipts live in a side store keyed by channel; the version counter is the
  // only thing that tells React another one has landed.
  const readReceiptVersion = useAppStore((state) => state.readReceiptVersion);

  /**
   * Who has read this, or null where the question does not apply.
   *
   * Only your own messages: a receipt says who has caught up to a message, and
   * on somebody else's that is a list of who has read *them*, which is not the
   * reader's business. Direct messages carry no channel watermark at all, and
   * you are dropped from your own list - having read what you sent is not news.
   */
  const readers = useMemo(() => {
    const messageId = target?.message.message_id;
    if (!target || !messageId || !target.message.is_own) return null;
    if (target.message.dm_session || !allMessageIds) return null;
    const ownHash = users.find((user) => user.session === ownSession)?.hash;
    void readReceiptVersion;
    return getReadersForMessage(target.message.channel_id, messageId, [...allMessageIds])
      .filter((state) => state.name && state.cert_hash !== ownHash)
      .map((state) => {
        const user = users.find((entry) => entry.hash === state.cert_hash);
        return {
          certHash: state.cert_hash,
          name: state.name,
          online: state.is_online,
          session: user?.session ?? null,
          avatar: user ? getCachedUserAvatar(user.session, user.texture_size) : null,
        };
      });
  }, [target, allMessageIds, users, ownSession, readReceiptVersion]);

  /**
   * Whether this message can start a watch-together session, and the call that
   * does it.
   *
   * Asked of every message because the answer is in the body - a video link -
   * rather than in a flag, so the hook runs on menus that will never show the
   * row. Nebula already renders the card and runs the lifecycle; starting one
   * was the only part missing, and without it two Nebula users could join a
   * session that neither of them could ever open.
   */
  const {
    canStart: canWatchTogether,
    busy: watchBusy,
    start: startWatch,
  } = useWatchStart(target?.message.body, target?.message.channel_id);

  if (!target) return null;

  const { message } = target;
  const channel = channels.find((candidate) => candidate.id === message.channel_id);
  const hasId = !!message.message_id;
  const canBulkDelete = hasId && canDeleteMessages(channel);
  // Your own message is yours to remove wherever it landed; anyone else needs
  // the moderation bit.
  const canDelete = hasId && (message.is_own || canBulkDelete);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  /**
   * The picture this message carries, if it is one that can stand alone.
   *
   * A popout is a second, always-on-top window over whatever the reader does
   * next - watching a diagram while typing about it is the point - so it is
   * offered only where there is actually a picture to put in it.
   */
  const popOutSrc = findPopOutImageSrc(message.body);

  const popOutImage = (src: string) => {
    const sender = users.find((entry) => entry.session === message.sender_session);
    void invoke("open_image_popout", {
      payload: {
        src,
        sender_name: message.sender_name || null,
        // Whatever the river already fetched; the window has no session of its
        // own to fetch an avatar through.
        sender_avatar: sender ? getCachedUserAvatar(sender.session, sender.texture_size) : null,
        caption: imagePopoutCaption(message.body),
        timestamp_ms: message.timestamp ?? null,
      },
    }).catch(() => undefined);
  };

  return (
    <Menu
      open
      onClose={onClose}
      // Focus the list, not its first row: the canvas opens the menu with
      // nothing chosen, and a highlighted Reply reads as a pending action.
      autoFocus={false}
      anchorReference="anchorPosition"
      anchorPosition={{ top: target.y, left: target.x }}
      slotProps={{
        list: { sx: { p: 0 } },
        paper: {
          sx: (theme) => ({
            width: 224,
            p: "5px",
            borderRadius: radius("lg"),
            border: "1px solid " + theme.palette.nebula.line2,
            background: theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
            boxShadow: theme.palette.nebula.shadow,
            backdropFilter: "blur(20px) saturate(1.2)",
          }),
        },
      }}
    >
      {hasId && (
        <Box sx={{ display: "flex", alignItems: "center", gap: "5px", px: "6px", pt: "5px", pb: "7px" }}>
          {QUICK_REACTIONS.map((emoji) => (
            <ReactionButton
              key={emoji}
              label={t("nebulaChat:menu.reactWith", { emoji })}
              onClick={run(() => onQuickReact(message, emoji))}
            >
              {emoji}
            </ReactionButton>
          ))}
          <ReactionButton
            label={t("chat:contextMenu.moreReactions")}
            onClick={run(() => onReact(message, { x: target.x, y: target.y }))}
            muted
          >
            <EmojiPlusIcon width={14} height={14} />
          </ReactionButton>
        </Box>
      )}
      {hasId && <Rule />}
      {hasId && (
        <MenuItem sx={ITEM} onClick={run(() => onQuote(message))}>
          {t("nebulaChat:menu.reply")}
        </MenuItem>
      )}
      {message.is_own && target.editable && hasId && (
        <MenuItem sx={ITEM} onClick={run(() => onEdit(message))}>
          {t("chat:contextMenu.edit")}
        </MenuItem>
      )}
      {hasId && (
        <MenuItem
          sx={ITEM}
          onClick={run(() =>
            useAppStore.getState().pinMessage(message.channel_id, message.message_id!, !!message.pinned),
          )}
        >
          {message.pinned
            ? t("nebulaChat:menu.unpinFromChannel")
            : t("nebulaChat:menu.pinToChannel")}
        </MenuItem>
      )}
      <MenuItem sx={ITEM} onClick={run(() => void navigator.clipboard?.writeText(plainText(message.body)))}>
        {t("chat:contextMenu.copyText")}
      </MenuItem>
      {popOutSrc && (
        <MenuItem sx={ITEM} onClick={run(() => popOutImage(popOutSrc))}>
          {t("chat:contextMenu.popOutImage")}
        </MenuItem>
      )}
      {/* Beside the popout: both open what the message carries somewhere
          larger, and both appear only where there is something to open. The
          busy label is short-lived - the click closes the menu - but it is
          what makes the disabled row legible while it goes. */}
      {canWatchTogether && (
        <MenuItem sx={ITEM} disabled={watchBusy} onClick={run(() => void startWatch())}>
          {watchBusy ? t("chat:contextMenu.watchTogetherBusy") : t("chat:contextMenu.watchTogether")}
        </MenuItem>
      )}

      {canDelete && [
        <Rule key="danger" />,
        canBulkDelete ? (
          <MenuItem key="select" sx={ITEM} onClick={run(() => onSelect(message.message_id!))}>
            {t("nebulaChat:menu.selectMessages")}
          </MenuItem>
        ) : null,
        <MenuItem
          key="delete"
          onClick={run(() =>
            useAppStore
              .getState()
              .deletePchatMessages(message.channel_id, { messageIds: [message.message_id!] }),
          )}
          sx={(theme) => ({ ...ITEM, color: theme.palette.nebula.bad })}
        >
          {t("chat:contextMenu.deleteMessage")}
        </MenuItem>,
      ]}
      {readers !== null && [
        <Rule key="readers-rule" />,
        <Box key="readers" sx={{ px: "10px", pt: "2px", pb: "5px" }}>
          <Typography
            sx={(theme) => ({
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: theme.palette.nebula.dim,
            })}
          >
            {t("chat:contextMenu.readBy")}
          </Typography>
          {readers.length === 0 ? (
            <Typography sx={(theme) => ({ mt: "4px", fontSize: 12, color: theme.palette.nebula.muted })}>
              {t("chat:contextMenu.noReaders")}
            </Typography>
          ) : (
            <Stack gap="4px" sx={{ mt: "6px", maxHeight: 148, overflowY: "auto" }}>
              {readers.map((reader) => (
                <Stack
                  key={reader.certHash}
                  direction="row"
                  alignItems="center"
                  gap={1}
                  // Somebody who read it and has since left still read it; the
                  // row says so by fading rather than by disappearing.
                  sx={{ opacity: reader.online ? 1 : 0.55 }}
                >
                  <UserAvatar name={reader.name} session={reader.session} src={reader.avatar} size={20} />
                  <Typography
                    sx={{
                      minWidth: 0,
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {reader.name}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>,
      ]}
    </Menu>
  );
}

/**
 * One row.
 *
 * MUI sizes a menu row for touch, which at this width leaves the labels
 * swimming - so the row is given the canvas own padding and a matching radius
 * instead of the default.
 */
const ITEM = {
  minHeight: 0,
  px: "10px",
  py: "7px",
  gap: "9px",
  fontSize: 12.5,
  borderRadius: radius("sm"),
} as const;

/** The hairline between groups of rows. */
function Rule() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({ height: "1px", mx: "6px", my: "4px", background: theme.palette.nebula.line })}
    />
  );
}

/** One square in the strip above the rows. */
function ReactionButton({
  label,
  onClick,
  muted = false,
  children,
}: Readonly<{ label: string; onClick: () => void; muted?: boolean; children: React.ReactNode }>) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        width: 29,
        height: 29,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        fontSize: 14,
        lineHeight: 1,
        borderRadius: radius("sm"),
        color: muted ? theme.palette.nebula.muted : "inherit",
        "&:hover": { background: theme.palette.nebula.hover },
        "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: -2 },
      })}
    >
      {children}
    </Box>
  );
}
