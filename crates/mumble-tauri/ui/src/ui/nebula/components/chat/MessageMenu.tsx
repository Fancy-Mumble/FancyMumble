import { Box, Menu, MenuItem } from "@mui/material";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { canDeleteMessages } from "@standard/components/sidebar/channel/ChannelEditorDialog";
import { EmojiPlusIcon } from "@ui/icons";
import { plainText } from "../../selectors";
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
}: Readonly<MessageMenuProps>) {
  const channels = useAppStore((state) => state.channels);
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
              label={"React with " + emoji}
              onClick={run(() => onQuickReact(message, emoji))}
            >
              {emoji}
            </ReactionButton>
          ))}
          <ReactionButton
            label="More reactions"
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
          Reply
        </MenuItem>
      )}
      {message.is_own && target.editable && hasId && (
        <MenuItem sx={ITEM} onClick={run(() => onEdit(message))}>
          Edit
        </MenuItem>
      )}
      {hasId && (
        <MenuItem
          sx={ITEM}
          onClick={run(() =>
            useAppStore.getState().pinMessage(message.channel_id, message.message_id!, !!message.pinned),
          )}
        >
          {message.pinned ? "Unpin from channel" : "Pin to channel"}
        </MenuItem>
      )}
      <MenuItem sx={ITEM} onClick={run(() => void navigator.clipboard?.writeText(plainText(message.body)))}>
        Copy text
      </MenuItem>

      {canDelete && [
        <Rule key="danger" />,
        canBulkDelete ? (
          <MenuItem key="select" sx={ITEM} onClick={run(() => onSelect(message.message_id!))}>
            Select messages…
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
          Delete message
        </MenuItem>,
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
