import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Menu, MenuItem, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { canOpenPrivately, openPrivatelyOrExplain } from "@core/features/elements/privateBrowsing";
import { useAppStore } from "@core/store";
import { LOCAL_NOTES_CHANNEL_ID } from "@core/notepad";
import type { ChatMessage } from "@core/types";
import { getCachedUserAvatar } from "@core/lazyBlobs";
import { getReadersForMessage } from "@core/features/chat/readreceipt/readReceiptStore";
import { findPopOutImageSrc, imagePopoutCaption } from "@core/features/chat/imagePopout";
import { isRemoteImage } from "@core/features/chat/imageActions";
import { useImageActions, type ImageActionKind } from "@core/features/chat/useImageActions";
import { useWatchStart } from "@core/features/chat/watch/useWatchStart";
import { canDeleteMessages } from "@standard/components/sidebar/channel/ChannelEditorDialog";
import { EmojiPlusIcon } from "@ui/icons";
import { Stack, UserAvatar } from "../primitives";
import { contextMenuRootSlot } from "../contextMenuRoot";
import { popupActions, useMessageMenuTarget } from "../../clientState";
import { radius } from "../../tokens";
import { bodyToCopyText } from "@core/features/chat/bodyText";

/** One picture, as the row that was right-clicked knows it. */
export interface MenuImage {
  /** The `src` attribute as written, which is what every index here uses. */
  readonly src: string;
  readonly alt: string;
  /**
   * An address a browser could open this picture at, where it has one.
   *
   * Not always the `src`: a file sent as a public or password-protected link
   * is drawn from a downloaded copy or from bytes this client fetched, so
   * what is on screen is a local path while the thing worth sharing is the
   * link it arrived as. Null where there is nothing anybody else could open -
   * a pasted picture, or a file only this session can reach.
   */
  readonly link?: string | null;
}

export interface MessageMenuTarget {
  message: ChatMessage;
  x: number;
  y: number;
  /** True when the body is plain text, so editing would not eat a card marker. */
  editable: boolean;
  /**
   * The picture the pointer was over, or null where it was not over one.
   *
   * A message can carry four of them, so "the message's picture" is not a
   * question the menu can answer for itself - the row reads which one was
   * aimed at off the event and hands it over.
   */
  image?: MenuImage | null;
  /**
   * The external link the pointer was over, or null where it was not over one.
   *
   * Read off the event by the row for the same reason the picture is: a
   * message can carry several links, and which one was aimed at is a question
   * only the pointer can answer.
   */
  link?: string | null;
  /**
   * What the reader had highlighted when they opened the menu, or "".
   *
   * Read at right-click time by the row, because "copy" on a message the
   * reader has half-selected means the part they picked - offering only the
   * whole message is the answer to a question nobody asked.
   */
  selection: string;
}

interface MessageMenuProps {
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
/** How long a finished picture action stays on screen before the menu goes. */
const IMAGE_ACTION_LINGER = 900;
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
  onReact,
  onQuickReact,
  onQuote,
  onEdit,
  onSelect,
  allMessageIds,
}: Readonly<MessageMenuProps>) {
  // The message the menu is about is pack state, not a prop - see
  // `popupActions`. The shell used to hold it, which made a right-click on a
  // message re-render every other message in the river first.
  const target = useMessageMenuTarget();
  const onClose = popupActions.closeMessageMenu;
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
    if (target.message.channel_id === LOCAL_NOTES_CHANNEL_ID) return null;
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

  /**
   * The picture the reader aimed at, and what can be done with it.
   *
   * Bound to the `src` rather than to the message: a block of four tiles is
   * one message with four different answers to "copy this", and the row has
   * already worked out which of them was clicked.
   */
  const image = target?.image ?? null;
  /**
   * The address to give somebody else, or null where there is none.
   *
   * A picture fetched over the network is its own link; one sent as a public
   * or password-protected file carries the link separately, because what is
   * drawn is a local copy of it. A picture pasted into the message is neither
   * - there is nowhere to open it, and those two rows stay away.
   */
  const imageLink = image ? (image.link ?? (isRemoteImage(image.src) ? image.src : null)) : null;
  /** The link the pointer was over, as the row read it off the event. */
  const link = target?.link ?? null;
  const imageActions = useImageActions(image?.src ?? null, imageLink);
  const imageStatus = imageActions.status;

  /**
   * An action that has finished takes the menu with it.
   *
   * Long enough that "Copied" is read rather than glimpsed, and short enough
   * that the menu is not still sitting there when the reader has moved on. A
   * cancelled save reports nothing at all, so the menu simply stays open.
   */
  useEffect(() => {
    if (!imageStatus || imageStatus.phase === "busy") return;
    const timer = setTimeout(onClose, IMAGE_ACTION_LINGER);
    return () => clearTimeout(timer);
  }, [imageStatus, onClose]);

  /**
   * Whether this machine can open a private window at all.
   *
   * Asked on mount rather than when the menu opens, so the row is either there
   * from the first frame or never - one appearing a moment late, under a
   * pointer already moving towards Reply, is how the wrong thing gets clicked.
   * The answer is cached in `canOpenPrivately` for the session, so this costs
   * one call however many message rows mount.
   */
  const [canPrivate, setCanPrivate] = useState(false);
  useEffect(() => {
    let live = true;
    void canOpenPrivately().then((available) => {
      if (live) setCanPrivate(available);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!target) return null;

  const { message } = target;
  const channel = channels.find((candidate) => candidate.id === message.channel_id);
  const hasId = !!message.message_id;
  // A note kept on this device: no reactions, pins or watch sessions to reach.
  const local = message.channel_id === LOCAL_NOTES_CHANNEL_ID;
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
  const popOutSrc = image?.src ?? findPopOutImageSrc(message.body);

  /**
   * What a picture row says while it is working, and once it has.
   *
   * The row that was clicked is the only one that changes, so the menu still
   * reads as itself: nothing moves, and the answer arrives where the question
   * was asked.
   */
  const imageLabel = (kind: ImageActionKind, idle: string) => {
    if (imageStatus?.kind !== kind) return idle;
    if (imageStatus.phase === "busy") return t("chat:contextMenu.imageWorking");
    if (imageStatus.phase === "failed") return t("chat:contextMenu.imageFailed");
    return kind === "save" ? t("chat:contextMenu.imageSaved") : t("chat:contextMenu.imageCopied");
  };
  const imageBusy = imageStatus?.phase === "busy";
  /**
   * The link a private-window row would act on, or null where no such row
   * belongs: either the pointer was not on a link, or this desktop's default
   * browser has no private mode to open one in.
   */
  const privateLink = canPrivate ? link : null;
  /** What is said when the browser refuses, once, rather than at each row. */
  const privateFailure = t("chat:contextMenu.openLinkPrivateFailed");
  /** The message's words, or "" where it is only pictures and markers. */
  const copyText = bodyToCopyText(message.body);

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
        // A second right-click is still this menu's: see `contextMenuRootSlot`.
        root: contextMenuRootSlot(onClose),
        list: { sx: { p: 0 } },
        paper: {
          sx: (theme) => ({
            width: 224,
            p: "5px",
            borderRadius: radius("lg"),
            border: "var(--nebula-line-width, 1px) solid " + theme.palette.nebula.line2,
            background: theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
            boxShadow: theme.palette.nebula.shadow,
            backdropFilter: "blur(20px) saturate(1.2)",
          }),
        },
      }}
    >
      {hasId && !local && (
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
      {hasId && !local && <Rule />}
      {/* The picture first, and above everything about the message: a
          right-click that landed on a photograph was aimed at the photograph,
          and "Reply" is not what it was reaching for. What it was reaching
          for is still all here - the message's own rows follow underneath. */}
      {image && [
        <MenuItem key="copy-image" sx={ITEM} disabled={imageBusy} onClick={imageActions.copyImage}>
          {imageLabel("copy", t("chat:contextMenu.copyImage"))}
        </MenuItem>,
        <MenuItem key="save-image" sx={ITEM} disabled={imageBusy} onClick={imageActions.saveImage}>
          {imageLabel("save", t("chat:contextMenu.saveImage"))}
        </MenuItem>,
        // A pasted picture has no address to copy and no page to open: it is
        // carried in the message, and the only place it exists is here.
        imageLink ? (
          <MenuItem key="copy-image-link" sx={ITEM} disabled={imageBusy} onClick={imageActions.copyLink}>
            {imageLabel("link", t("chat:contextMenu.copyImageLink"))}
          </MenuItem>
        ) : null,
        <MenuItem key="pop-out-image" sx={ITEM} onClick={run(() => popOutImage(image.src))}>
          {t("chat:contextMenu.popOutImage")}
        </MenuItem>,
        imageLink ? (
          <MenuItem
            key="open-image-externally"
            sx={ITEM}
            onClick={run(() => void openUrl(imageLink).catch(() => undefined))}
          >
            {t("chat:contextMenu.openImageExternally")}
          </MenuItem>
        ) : null,
        <Rule key="image-rule" />,
      ]}
      {/* Under the picture rows and above the message's own: a link is a thing
          in the message rather than the message, but a photograph the pointer
          is actually on outranks it. Drawn only where the desktop can honour
          it - see `canOpenPrivately` - because the alternative is a row whose
          only outcome is an error dialog. */}
      {privateLink && [
        <MenuItem
          key="open-link-private"
          sx={ITEM}
          onClick={run(() => void openPrivatelyOrExplain(privateLink, privateFailure))}
        >
          {t("chat:contextMenu.openLinkPrivate")}
        </MenuItem>,
        <Rule key="link-rule" />,
      ]}
      {hasId && (
        <MenuItem sx={ITEM} onClick={run(() => onQuote(message))}>
          {t("nebulaChat:menu.reply")}
        </MenuItem>
      )}
      {message.is_own && target.editable && hasId && !local && (
        <MenuItem sx={ITEM} onClick={run(() => onEdit(message))}>
          {t("chat:contextMenu.edit")}
        </MenuItem>
      )}
      {hasId && !local && (
        <MenuItem
          sx={ITEM}
          onClick={run(() =>
            useAppStore.getState().pinMessage(message.channel_id, message.message_id!, !!message.pinned),
          )}
        >
          {message.pinned ? t("nebulaChat:menu.unpinFromChannel") : t("nebulaChat:menu.pinToChannel")}
        </MenuItem>
      )}
      {/* Above "Copy text" and only when there is one: the highlight is the
          more specific answer, and it is what the reader was already reaching
          for when they right-clicked it. */}
      {target.selection && (
        <MenuItem sx={ITEM} onClick={run(() => void navigator.clipboard?.writeText(target.selection))}>
          {t("chat:contextMenu.copySelection")}
        </MenuItem>
      )}
      {/* A message that is nothing but pictures has no text to copy, and a
          row that puts an empty string on the clipboard is a row that looks
          like it did nothing. */}
      {copyText && (
        <MenuItem sx={ITEM} onClick={run(() => void navigator.clipboard?.writeText(copyText))}>
          {t("chat:contextMenu.copyText")}
        </MenuItem>
      )}
      {/* Only where the picture group is not already offering it. */}
      {!image && popOutSrc && (
        <MenuItem sx={ITEM} onClick={run(() => popOutImage(popOutSrc))}>
          {t("chat:contextMenu.popOutImage")}
        </MenuItem>
      )}
      {/* Beside the popout: both open what the message carries somewhere
          larger, and both appear only where there is something to open. The
          busy label is short-lived - the click closes the menu - but it is
          what makes the disabled row legible while it goes. */}
      {canWatchTogether && !local && (
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
            local
              ? useAppStore.getState().deleteLocalNotes([message.message_id!])
              : useAppStore
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
