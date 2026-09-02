/**
 * The Channel information sheet, over the shell.
 *
 * The mock opens it the way it opens the User information sheet - a card over
 * a scrim rather than a rail beside the conversation - so this is the same
 * thin wrapper `UserInfoDialog` is: the dialog decides that the sheet is open
 * and over what, and `ChannelInfoSheet` draws it.
 *
 * It closes itself when the channel goes, because a sheet describing a room
 * that no longer exists would only go stale.
 */

import { useEffect } from "react";
import { Dialog } from "@mui/material";
import { useAppStore } from "@core/store";
import { ChannelInfoSheet } from "./ChannelInfoSheet";

interface ChannelInfoPanelProps {
  /** The channel being described. */
  readonly channelId: number;
  readonly onClose: () => void;
}

export function ChannelInfoPanel({ channelId, onClose }: Readonly<ChannelInfoPanelProps>) {
  const known = useAppStore((state) => state.channels.some((entry) => entry.id === channelId));

  useEffect(() => {
    if (!known) onClose();
  }, [known, onClose]);

  return (
    <Dialog
      open={known}
      onClose={onClose}
      maxWidth={false}
      slotProps={{ paper: { sx: { m: "16px", overflow: "hidden" } } }}
    >
      {known && <ChannelInfoSheet channelId={channelId} onClose={onClose} />}
    </Dialog>
  );
}
