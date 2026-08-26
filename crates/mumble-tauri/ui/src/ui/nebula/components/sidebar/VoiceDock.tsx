import { useState } from "react";
import { Box, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { selectMicLive, selectSelfDeafened } from "@core/store/voiceSelectors";
import { HeadphonesIcon, HeadphonesOffIcon, MicIcon, MicOffIcon, KebabMenuIcon } from "@ui/icons";
import { UserAvatar, Stack } from "../primitives";

/** The dock sits on the composer's inset and radius; they are one strip. */
const DOCK_INSET = "10px";
const DOCK_RADIUS = "16px";

interface VoiceDockProps {
  name: string;
  session: number | null;
  textureSize: number | null;
  /** Channel the user is joined to, or null when only browsing. */
  channelName: string | null;
  latencyMs: number | null;
  onOpenSettings: () => void;
  /** Carries the click so the card opens beside the avatar it came from. */
  onOpenProfile: (event: React.MouseEvent) => void;
  /** Right-click on your own avatar, for the same menu everyone else's row opens. */
  onContextMenuProfile?: (event: React.MouseEvent) => void;
  /** Open server administration; absent without write access to the root channel. */
  onOpenAdmin?: () => void;
  /** Leave the server entirely; absent when there is nothing to leave. */
  onLeave?: () => void;
}

/**
 * The card pinned to the bottom of the sidebar: who you are, where you are,
 * and the three controls the mock keeps permanently reachable. `Leave` leaves
 * the server - the same disconnect the title bar's ✕ performs, confirmation
 * and all. Mumble has no channel-less state to fall back to, so there is
 * nothing else for the word to mean.
 */
export function VoiceDock({
  name,
  session,
  textureSize,
  channelName,
  latencyMs,
  onOpenSettings,
  onOpenProfile,
  onContextMenuProfile,
  onOpenAdmin,
  onLeave,
}: Readonly<VoiceDockProps>) {
  const micLive = useAppStore(selectMicLive);
  const deafened = useAppStore(selectSelfDeafened);
  const voiceState = useAppStore((state) => state.voiceState);
  const [overflow, setOverflow] = useState<HTMLElement | null>(null);

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="14px"
      sx={(theme) => ({
        flex: "none",
        height: 52,
        m: DOCK_INSET,
        px: "14px",
        borderRadius: DOCK_RADIUS,
        background: theme.palette.nebula.wash,
        border: `1px solid ${theme.palette.nebula.washLine}`,
      })}
    >
      <Box
        component="button"
        onClick={onOpenProfile}
        onContextMenu={onContextMenuProfile}
        aria-label="Your profile"
        sx={{ all: "unset", cursor: "pointer", display: "flex", flex: "none" }}
      >
        {/* The avatar draws its own presence dot - a second one here sat
            beside it rather than on it. */}
        <UserAvatar
          name={name}
          session={session}
          textureSize={textureSize}
          size={28}
          status={voiceState === "inactive" ? "offline" : "online"}
        />
      </Box>

      {/* Name over channel: two lines in the width a status sentence used to
          take, which is what lets the whole dock be one 52px row. */}
      <Stack gap="1px" sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 13 }} noWrap>
          {name}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
          {voiceState === "inactive" ? "Voice off" : (channelName ?? "Not in voice")}
          {latencyMs != null && voiceState !== "inactive" ? ` · ${latencyMs} ms` : ""}
        </Typography>
      </Stack>

      <DockIcon
        label={micLive ? "Mute" : voiceState === "inactive" ? "Enable voice" : "Unmute"}
        alert={!micLive}
        onClick={() =>
          void (voiceState === "inactive"
            ? useAppStore.getState().enableVoice()
            : useAppStore.getState().toggleMute())
        }
      >
        {micLive ? <MicIcon width={18} height={18} /> : <MicOffIcon width={18} height={18} />}
      </DockIcon>
      <DockIcon
        label={deafened ? "Undeafen" : "Deafen"}
        alert={deafened}
        onClick={() => void useAppStore.getState().toggleDeafen()}
      >
        {deafened ? <HeadphonesOffIcon width={18} height={18} /> : <HeadphonesIcon width={18} height={18} />}
      </DockIcon>

      <Box
        aria-hidden
        sx={(theme) => ({ width: "1px", height: 16, background: theme.palette.nebula.line2 })}
      />

      <DockIcon label="More" onClick={(event) => setOverflow(event.currentTarget)}>
        <KebabMenuIcon width={18} height={18} />
      </DockIcon>

      {/* Settings, administration and leaving are all here now. The row has
          space for three controls, and leaving is not one you want under a
          thumb that is aiming for mute. */}
      <Menu anchorEl={overflow} open={!!overflow} onClose={() => setOverflow(null)}>
        <MenuItem
          onClick={() => {
            setOverflow(null);
            onOpenSettings();
          }}
        >
          Settings
        </MenuItem>
        {onOpenAdmin && (
          <MenuItem
            onClick={() => {
              setOverflow(null);
              onOpenAdmin();
            }}
          >
            Server admin
          </MenuItem>
        )}
        {onLeave && (
          <MenuItem
            onClick={() => {
              setOverflow(null);
              onLeave();
            }}
            sx={(theme) => ({ color: theme.palette.nebula.bad })}
          >
            Leave server
          </MenuItem>
        )}
      </Menu>
    </Stack>
  );
}

/**
 * One control in the dock's row.
 *
 * Bare, like the composer's tools: the row is the container. Only the glyph
 * tints when a control is off, so a muted mic reads without the strip turning
 * into an alarm.
 */
function DockIcon({
  label,
  alert = false,
  onClick,
  children,
}: Readonly<{
  label: string;
  alert?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip title={label}>
      <Box
        component="button"
        type="button"
        aria-label={label}
        onClick={onClick}
        sx={(theme) => ({
          all: "unset",
          cursor: "pointer",
          flex: "none",
          display: "grid",
          placeItems: "center",
          color: alert ? theme.palette.nebula.bad : theme.palette.nebula.muted,
          "&:hover": { color: alert ? theme.palette.nebula.bad : theme.palette.nebula.text },
        })}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
