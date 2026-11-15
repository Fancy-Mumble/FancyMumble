import type { ChannelEntry } from "@core/types";
import { isStructuralChannel } from "@core/utils/channelAttributes";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../primitives";

export interface ChannelContextMenuProps {
  channel: ChannelEntry;
  x: number;
  y: number;
  listening: boolean;
  notificationsMuted: boolean;
  onOpenText: () => void;
  onJoinVoice: () => void;
  onToggleListen: () => void;
  onToggleNotifications: () => void;
  onCreateSubchannel: () => void;
  onEdit: () => void;
  onEditPermissions: () => void;
  onMove: (direction: -1 | 1) => void;
  onMoveAllUsers: () => void;
  onPurgeHistory: () => void;
}

/**
 * Actions for a single channel, grouped by what they act on: entering the
 * channel, its notifications, its configuration, its ordering, and finally the
 * destructive action on its own.
 *
 * A structural channel is a heading rather than a room, so the entry actions
 * that cannot apply to it are omitted instead of shown failing.
 */
export default function ChannelContextMenu({
  channel,
  x,
  y,
  listening,
  notificationsMuted,
  onOpenText,
  onJoinVoice,
  onToggleListen,
  onToggleNotifications,
  onCreateSubchannel,
  onEdit,
  onEditPermissions,
  onMove,
  onMoveAllUsers,
  onPurgeHistory,
}: ChannelContextMenuProps) {
  const structural = isStructuralChannel(channel);
  const purgeable = !!channel.pchat_protocol && channel.pchat_protocol !== "none";

  return (
    <ContextMenu x={x} y={y} label={`Actions for ${channel.name}`} heading={`#${channel.name}`}>
      {!structural && (
        <>
          <ContextMenuItem onSelect={onOpenText}>Open chat</ContextMenuItem>
          <ContextMenuItem onSelect={onJoinVoice}>Join voice</ContextMenuItem>
          <ContextMenuItem onSelect={onToggleListen}>
            {listening ? "Stop listening" : "Listen only"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={onToggleNotifications}
            hint={notificationsMuted ? "Muted" : "All messages"}
          >
            {notificationsMuted ? "Unmute channel" : "Mute channel"}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      <ContextMenuItem onSelect={onCreateSubchannel}>New subchannel</ContextMenuItem>
      <ContextMenuItem onSelect={onEdit}>{structural ? "Edit category" : "Edit channel"}</ContextMenuItem>
      <ContextMenuItem onSelect={onEditPermissions}>Permissions</ContextMenuItem>

      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onMove(-1)}>Move up</ContextMenuItem>
      <ContextMenuItem onSelect={() => onMove(1)}>Move down</ContextMenuItem>
      {!structural && channel.user_count > 0 && (
        <ContextMenuItem onSelect={onMoveAllUsers}>Move users…</ContextMenuItem>
      )}

      {!structural && purgeable && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem tone="danger" onSelect={onPurgeHistory}>
            Purge history…
          </ContextMenuItem>
        </>
      )}
    </ContextMenu>
  );
}
