import { useTranslation } from "react-i18next";
import { Box, Divider, Menu, MenuItem } from "@mui/material";
import { useAppStore } from "@core/store";
import type { ChannelEntry } from "@core/types";
import { isStructuralChannel } from "@core/utils/channelAttributes";
import { PERM_WRITE } from "@core/utils/permissions";
import {
  canCreateChannel,
  canDeleteChannel,
  canDeleteMessages,
  canEditChannel,
  canOnlyCreateTemp,
} from "@standard/components/sidebar/channel/ChannelEditorDialog";
import {
  BellIcon,
  BellOffIcon,
  DatabaseIcon,
  EditIcon,
  HashIcon,
  InfoIcon,
  Link2Icon,
  LockIcon,
  PlusIcon,
  RadioIcon,
  TrashIcon,
  UsersGroupIcon,
} from "@ui/icons";
import { MenuCheckBox } from "./MenuCheckBox";

interface ChannelMenuProps {
  /** Right-click target and where the menu was opened, or null when closed. */
  target: { channel: ChannelEntry; x: number; y: number } | null;
  listening: boolean;
  notificationsMuted: boolean;
  /** How many people are standing in it, which is what "move everyone" acts on. */
  occupantCount: number;
  hideEmpty: boolean;
  onToggleHideEmpty: () => void;
  /** Enter it. The shell answers this rather than the store, because a
   *  restricted room has a password to ask for first. */
  onJoin: (channel: ChannelEntry) => void;
  onShowInfo: (channel: ChannelEntry) => void;
  onEdit: (channel: ChannelEntry) => void;
  /** Make a channel under this one. `tempOnly` when that is all they may make. */
  onCreate: (parent: ChannelEntry, tempOnly: boolean) => void;
  onMoveAllUsers: (channel: ChannelEntry) => void;
  onPurgeHistory: (channel: ChannelEntry) => void;
  onDelete: (channel: ChannelEntry) => void;
  onEditPermissions: (channel: ChannelEntry) => void;
  onClose: () => void;
}

/**
 * Right-click actions on a channel row, in the mock's four groups: entering
 * the channel, silencing it, describing it and what the list shows, and
 * finally administering it.
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
 *
 * Below them are the three acts on the room itself - make one under it, move
 * everyone out of it, empty its archive - each gated on its own grant read off
 * this channel, so nothing here is offered that the server would then refuse.
 * Unlike the pair above, these are hidden while permissions are unknown: an
 * entry that empties an archive is worse to offer speculatively than one that
 * opens an editor.
 */
export function ChannelMenu({
  target,
  listening,
  notificationsMuted,
  occupantCount,
  hideEmpty,
  onToggleHideEmpty,
  onJoin,
  onShowInfo,
  onEdit,
  onCreate,
  onMoveAllUsers,
  onPurgeHistory,
  onDelete,
  onEditPermissions,
  onClose,
}: Readonly<ChannelMenuProps>) {
  const { t } = useTranslation(["nebulaSidebar", "sidebar", "chat"]);
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
  // Moving the room needs someone in it to move: on an empty channel the entry
  // would be an action with no subject.
  const movable = canEditChannel(channel) && occupantCount > 0;
  // Purging is a different grant from deleting the channel, and only means
  // anything where the server is keeping a history at all - `canDeleteMessages`
  // is exactly that pair.
  const purgeable = canDeleteMessages(channel);
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
            <MenuItem key="text" onClick={run(() => void useAppStore.getState().selectChannel(channel.id))}>
              <Glyph>
                <HashIcon width={13} height={13} />
              </Glyph>
              {t("nebulaSidebar:channels.openTextChat")}
            </MenuItem>,
            <MenuItem key="join" onClick={run(() => onJoin(channel))}>
              <Glyph>
                <Link2Icon width={13} height={13} />
              </Glyph>
              {t("nebulaSidebar:channels.joinChannel")}
            </MenuItem>,
            <MenuItem key="listen" onClick={run(() => void useAppStore.getState().toggleListen(channel.id))}>
              <Glyph>
                <RadioIcon width={13} height={13} />
              </Glyph>
              {listening
                ? t("nebulaSidebar:channels.stopListeningIn")
                : t("nebulaSidebar:channels.listenIn")}
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
              {notificationsMuted ? t("chat:header.unmuteChannel") : t("chat:header.muteChannel")}
            </MenuItem>,
            <Divider key="mute-end" sx={DIVIDER} />,
          ]}

      {/* What the room is, rather than what to do with it. Above the list
          filter because it is about this channel and the filter is about the
          list, and below the entry actions because reading a description is
          rarely why the menu was opened. */}
      <MenuItem onClick={run(() => onShowInfo(channel))}>
        <Glyph>
          <InfoIcon width={13} height={13} />
        </Glyph>
        {t("chat:header.channelInfo")}
      </MenuItem>

      <MenuItem role="menuitemcheckbox" aria-checked={hideEmpty} onClick={run(onToggleHideEmpty)}>
        <MenuCheckBox checked={hideEmpty} />
        {t("sidebar:channelSidebar.hideEmptyChannels")}
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
              {structural
                ? t("nebulaSidebar:channels.editCategory")
                : t("nebulaSidebar:channels.editChannel")}
            </MenuItem>,
            <MenuItem
              key="permissions"
              onClick={run(() => onEditPermissions(channel))}
              sx={(theme) => ({ color: theme.palette.nebula.muted })}
            >
              <LockIcon width={13} height={13} />
              {t("nebulaSidebar:channels.permissions")}
            </MenuItem>,
          ]
        : null}

      {creatable && (
        <MenuItem
          onClick={run(() => onCreate(channel, tempOnly))}
          sx={(theme) => ({ color: theme.palette.nebula.muted })}
        >
          <PlusIcon width={13} height={13} />
          {tempOnly
            ? t("nebulaSidebar:channels.newTemporaryChannelHere")
            : t("nebulaSidebar:channels.newChannelHere")}
        </MenuItem>
      )}

      {movable && (
        <MenuItem
          onClick={run(() => onMoveAllUsers(channel))}
          sx={(theme) => ({ color: theme.palette.nebula.muted })}
        >
          <UsersGroupIcon width={13} height={13} />
          {t("sidebar:channelSidebar.moveAllUsers")}
        </MenuItem>
      )}

      {/* Emptying the archive sits with deleting the channel rather than with
          the administrative pair above: both take something away for good, and
          both are drawn in the colour that says so. */}
      {purgeable && (
        <MenuItem
          onClick={run(() => onPurgeHistory(channel))}
          sx={(theme) => ({ color: theme.palette.nebula.bad })}
        >
          <DatabaseIcon width={13} height={13} />
          {t("sidebar:channelSidebar.purgeHistory")}
        </MenuItem>
      )}

      {deletable && (
        <MenuItem
          onClick={run(() => onDelete(channel))}
          sx={(theme) => ({ color: theme.palette.nebula.bad })}
        >
          <TrashIcon width={13} height={13} />
          {t("nebulaSidebar:channels.deleteChannel")}
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
