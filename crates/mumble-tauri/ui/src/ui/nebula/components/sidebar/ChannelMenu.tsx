import { Box, Divider, Menu, MenuItem } from "@mui/material";
import { useAppStore } from "@core/store";
import type { ChannelEntry } from "@core/types";
import { isStructuralChannel } from "@core/utils/channelAttributes";
import { PERM_WRITE } from "@core/utils/permissions";
import {
  canCreateChannel,
  canDeleteChannel,
  canOnlyCreateTemp,
} from "@standard/components/sidebar/channel/ChannelEditorDialog";
import {
  BellIcon,
  BellOffIcon,
  CheckIcon,
  EditIcon,
  HashIcon,
  Link2Icon,
  LockIcon,
  PlusIcon,
  RadioIcon,
  TrashIcon,
} from "@ui/icons";
import { radius } from "../../tokens";

interface ChannelMenuProps {
  /** Right-click target and where the menu was opened, or null when closed. */
  target: { channel: ChannelEntry; x: number; y: number } | null;
  listening: boolean;
  notificationsMuted: boolean;
  hideEmpty: boolean;
  onToggleHideEmpty: () => void;
  onEdit: (channel: ChannelEntry) => void;
  /** Make a channel under this one. `tempOnly` when that is all they may make. */
  onCreate: (parent: ChannelEntry, tempOnly: boolean) => void;
  onDelete: (channel: ChannelEntry) => void;
  onEditPermissions: (channel: ChannelEntry) => void;
  onClose: () => void;
}

/**
 * Right-click actions on a channel row, in the mock's four groups: entering
 * the channel, silencing it, what the list shows, and finally administering
 * it.
 *
 * The list filter sits in a channel menu because that is where you are when
 * you notice the list is too long - it is the same preference the funnel above
 * the list toggles, not a second setting.
 *
 * The administrative pair is de-emphasised rather than hidden: it leaves for
 * the surfaces that own those jobs, where the permissions governing them are
 * visible. Both drop out entirely once the server has told us the user cannot
 * write to this channel; while permissions are still unknown they are shown,
 * since a menu that grows a second later reads as a bug.
 */
export function ChannelMenu({
  target,
  listening,
  notificationsMuted,
  hideEmpty,
  onToggleHideEmpty,
  onEdit,
  onCreate,
  onDelete,
  onEditPermissions,
  onClose,
}: Readonly<ChannelMenuProps>) {
  if (!target) return null;
  const { channel } = target;
  // A structural channel is a heading rather than a room: it holds no users
  // and cannot be entered, so the entry actions are omitted instead of shown
  // failing.
  const structural = isStructuralChannel(channel);
  const administrable = channel.permissions == null || (channel.permissions & PERM_WRITE) !== 0;
  // Creating and deleting are separate grants from editing, and each is read
  // off this channel rather than off "somewhere": MakeChannel here is what
  // decides whether a sub-channel can be made here, and offering it on the
  // strength of a permission held elsewhere would promise what the server
  // then refuses.
  const creatable = canCreateChannel(channel);
  const tempOnly = canOnlyCreateTemp(channel);
  const deletable = canDeleteChannel(channel);
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
      {structural
        ? null
        : [
            <MenuItem
              key="text"
              onClick={run(() => void useAppStore.getState().selectChannel(channel.id))}
            >
              <Glyph>
                <HashIcon width={13} height={13} />
              </Glyph>
              Open text chat
            </MenuItem>,
            <MenuItem
              key="join"
              onClick={run(() => void useAppStore.getState().joinChannel(channel.id))}
            >
              <Glyph>
                <Link2Icon width={13} height={13} />
              </Glyph>
              Join channel
            </MenuItem>,
            <MenuItem
              key="listen"
              onClick={run(() => void useAppStore.getState().toggleListen(channel.id))}
            >
              <Glyph>
                <RadioIcon width={13} height={13} />
              </Glyph>
              {listening ? "Stop listening in" : "Listen in"}
            </MenuItem>,
            <Divider key="entry-end" sx={DIVIDER} />,
            <MenuItem
              key="mute"
              onClick={run(() => void useAppStore.getState().toggleMutePushChannel(channel.id))}
            >
              <Glyph>
                {notificationsMuted ? (
                  <BellIcon width={13} height={13} />
                ) : (
                  <BellOffIcon width={13} height={13} />
                )}
              </Glyph>
              {notificationsMuted ? "Unmute channel" : "Mute channel"}
            </MenuItem>,
            <Divider key="mute-end" sx={DIVIDER} />,
          ]}

      <MenuItem onClick={run(onToggleHideEmpty)}>
        <CheckBox checked={hideEmpty} />
        Hide empty channels
      </MenuItem>

      {administrable
        ? [
            <Divider key="admin-start" sx={DIVIDER} />,
            <MenuItem
              key="edit"
              onClick={run(() => onEdit(channel))}
              sx={(theme) => ({ color: theme.palette.nebula.muted })}
            >
              <EditIcon width={13} height={13} />
              {structural ? "Edit category" : "Edit channel"}
            </MenuItem>,
            <MenuItem
              key="permissions"
              onClick={run(() => onEditPermissions(channel))}
              sx={(theme) => ({ color: theme.palette.nebula.muted })}
            >
              <LockIcon width={13} height={13} />
              Permissions…
            </MenuItem>,
          ]
        : null}

      {creatable && (
        <MenuItem
          onClick={run(() => onCreate(channel, tempOnly))}
          sx={(theme) => ({ color: theme.palette.nebula.muted })}
        >
          <PlusIcon width={13} height={13} />
          {tempOnly ? "New temporary channel here" : "New channel here"}
        </MenuItem>
      )}

      {deletable && (
        <MenuItem
          onClick={run(() => onDelete(channel))}
          sx={(theme) => ({ color: theme.palette.nebula.bad })}
        >
          <TrashIcon width={13} height={13} />
          Delete channel
        </MenuItem>
      )}
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
      sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.muted })}
    >
      {children}
    </Box>
  );
}

/** The mock's tick box: filled with the accent when on, an empty chip when off. */
function CheckBox({ checked }: Readonly<{ checked: boolean }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        width: 15,
        height: 15,
        borderRadius: radius("sm"),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        color: "#fff",
        background: checked ? theme.palette.nebula.accent : theme.palette.nebula.card2,
        border: `1px solid ${checked ? theme.palette.nebula.accent : theme.palette.nebula.line2}`,
      })}
    >
      {checked && <CheckIcon width={9} height={9} strokeWidth={3} />}
    </Box>
  );
}
