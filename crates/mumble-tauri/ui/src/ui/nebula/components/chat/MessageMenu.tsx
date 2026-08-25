import { Box, Divider, Menu, MenuItem } from "@mui/material";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { canDeleteMessages } from "@standard/components/sidebar/channel/ChannelEditorDialog";
import { CheckIcon, CopyIcon, EditIcon, EmojiPlusIcon, PinIcon, QuoteIcon, TrashIcon } from "@ui/icons";
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
  onQuote: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  /** Enter selection mode with this message already picked. */
  onSelect: (messageId: string) => void;
}

/**
 * Right-click actions on a message.
 *
 * The hover strip carries the two or three things wanted mid-conversation;
 * this is where the rest lives, so the strip does not grow into a toolbar that
 * covers the message it belongs to.
 *
 * Deletion is gated on the server's DeleteMessage bit for *this* channel, and
 * on the channel actually persisting messages - there is nothing stored to
 * delete otherwise. Selecting several to delete at once is offered only where
 * deleting one is, so the mode cannot be entered to reach an action that will
 * be refused.
 */
export function MessageMenu({
  target,
  onClose,
  onReact,
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
  // Your own message is yours to remove wherever it landed; anyone else's
  // needs the moderation bit.
  const canDelete = hasId && (message.is_own || canBulkDelete);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: target.y, left: target.x }}
    >
      {hasId && (
        <MenuItem onClick={run(() => onReact(message, { x: target.x, y: target.y }))}>
          <Glyph>
            <EmojiPlusIcon width={13} height={13} />
          </Glyph>
          React
        </MenuItem>
      )}
      {hasId && (
        <MenuItem onClick={run(() => onQuote(message))}>
          <Glyph>
            <QuoteIcon width={13} height={13} />
          </Glyph>
          Reply
        </MenuItem>
      )}
      {message.is_own && target.editable && hasId && (
        <MenuItem onClick={run(() => onEdit(message))}>
          <Glyph>
            <EditIcon width={13} height={13} />
          </Glyph>
          Edit
        </MenuItem>
      )}

      <Divider sx={DIVIDER} />

      <MenuItem onClick={run(() => void navigator.clipboard?.writeText(plainText(message.body)))}>
        <Glyph>
          <CopyIcon width={13} height={13} />
        </Glyph>
        Copy text
      </MenuItem>
      {hasId && (
        <MenuItem
          onClick={run(() =>
            useAppStore.getState().pinMessage(message.channel_id, message.message_id!, !!message.pinned),
          )}
        >
          <Glyph>
            {message.pinned ? <CheckIcon width={13} height={13} /> : <PinIcon width={13} height={13} />}
          </Glyph>
          {message.pinned ? "Unpin" : "Pin"}
        </MenuItem>
      )}

      {canDelete && [
        <Divider key="danger" sx={DIVIDER} />,
        canBulkDelete ? (
          <MenuItem key="select" onClick={run(() => onSelect(message.message_id!))}>
            <Glyph>
              <CheckIcon width={13} height={13} />
            </Glyph>
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
          sx={(theme) => ({ color: theme.palette.nebula.bad })}
        >
          <Glyph>
            <TrashIcon width={13} height={13} />
          </Glyph>
          Delete
        </MenuItem>,
      ]}
    </Menu>
  );
}

const DIVIDER = { my: "4px", mx: "6px" } as const;

/** The mock draws item icons a step quieter than the label beside them. */
function Glyph({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        display: "flex",
        flex: "none",
        mr: "8px",
        borderRadius: radius("sm"),
        color: theme.palette.nebula.muted,
      })}
    >
      {children}
    </Box>
  );
}
