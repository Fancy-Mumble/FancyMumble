import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { selectMicLive, selectSelfDeafened } from "@core/store/voiceSelectors";
import { HeadphonesIcon, HeadphonesOffIcon, MicIcon, MicOffIcon, SettingsIcon, ShieldIcon } from "@ui/icons";
import { StatusDot, UserAvatar, Stack } from "../primitives";
import { radius } from "../../tokens";

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

  return (
    <Box
      sx={(theme) => ({
        flex: "none",
        m: "12px",
        p: "14px",
        borderRadius: radius("xl"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 28px rgba(0,0,0,.14)",
      })}
    >
      <Stack direction="row" alignItems="center" gap={1.25} sx={{ mb: "9px" }}>
        <Box
          component="button"
          onClick={onOpenProfile}
          onContextMenu={onContextMenuProfile}
          aria-label="Your profile"
          sx={{ all: "unset", cursor: "pointer", display: "flex" }}
        >
          <UserAvatar name={name} session={session} textureSize={textureSize} size={30} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 12.5 }} noWrap>
            {name}
          </Typography>
          <Stack
            direction="row"
            alignItems="center"
            gap={0.75}
            sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}
          >
            <StatusDot status={voiceState === "inactive" ? "offline" : "online"} />
            <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {voiceState === "inactive" ? "Voice off" : (channelName ?? "Not in voice")}
            </Box>
            {latencyMs != null && <Box component="span">· {latencyMs} ms</Box>}
          </Stack>
        </Box>
        <Stack direction="row" gap={0.25} sx={{ ml: "auto" }}>
          {onOpenAdmin && (
            <Tooltip title="Server admin">
              <IconButton size="small" aria-label="Server admin" onClick={onOpenAdmin}>
                <ShieldIcon width={13} height={13} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Settings">
            <IconButton size="small" aria-label="Settings" onClick={onOpenSettings}>
              <SettingsIcon width={13} height={13} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Stack direction="row" gap={0.75}>
        <ControlButton
          off={!micLive}
          label={micLive ? "Mute" : voiceState === "inactive" ? "Enable voice" : "Unmute"}
          onClick={() =>
            void (voiceState === "inactive"
              ? useAppStore.getState().enableVoice()
              : useAppStore.getState().toggleMute())
          }
        >
          {micLive ? <MicIcon width={13} height={13} /> : <MicOffIcon width={13} height={13} />}
        </ControlButton>
        <ControlButton
          off={deafened}
          label={deafened ? "Undeafen" : "Deafen"}
          onClick={() => void useAppStore.getState().toggleDeafen()}
        >
          {deafened ? (
            <HeadphonesOffIcon width={13} height={13} />
          ) : (
            <HeadphonesIcon width={13} height={13} />
          )}
        </ControlButton>
        <Button
          variant="outlined"
          disabled={!onLeave}
          onClick={onLeave}
          sx={(theme) => ({
            flex: 1.7,
            height: 29,
            fontSize: 11,
            color: theme.palette.nebula.bad,
            borderColor: theme.palette.nebula.line2,
          })}
        >
          Leave
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * A control in the dock's button row.
 *
 * The mock keeps these neutral - one chip colour, one icon colour - and lets
 * the icon itself carry the state (a struck-through mic reads as muted). Only
 * the glyph tints when the control is off, so the row stays a quiet strip
 * rather than a red alarm the moment voice is disabled.
 */
function ControlButton({
  off,
  label,
  onClick,
  children,
}: Readonly<{ off: boolean; label: string; onClick: () => void; children: React.ReactNode }>) {
  return (
    <Tooltip title={label}>
      <Box
        component="button"
        aria-label={label}
        onClick={onClick}
        sx={(theme) => ({
          all: "unset",
          flex: 1,
          height: 29,
          borderRadius: radius("md"),
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          color: off ? theme.palette.nebula.muted : theme.palette.nebula.text,
          background: theme.palette.nebula.card2,
          "&:hover": { background: theme.palette.nebula.hover },
        })}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
