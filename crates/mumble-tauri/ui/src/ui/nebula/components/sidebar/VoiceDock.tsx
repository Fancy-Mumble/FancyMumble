import { useState } from "react";
import { Box, Divider, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useAppStore } from "@core/store";
import { selectMicLive, selectSelfDeafened } from "@core/store/voiceSelectors";
import { stopOwnBroadcast } from "@standard/components/chat/stream/useScreenShare";
import {
  HeadphonesIcon,
  HeadphonesOffIcon,
  KebabMenuIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  ShieldIcon,
  WebcamIcon,
} from "@ui/icons";
import { SectionLabel, Stack, UserAvatar } from "../primitives";
import { radius } from "../../tokens";

/** The dock sits on the composer's inset; they are one strip. */
const DOCK_INSET = "10px";

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
  /** Ask for the screen picker; absent where there is nothing to share into. */
  onShareScreen?: () => void;
  /** Ask for the picker in camera-only mode, from the overflow menu. */
  onShareCamera?: () => void;
}

/**
 * The card pinned to the bottom of the sidebar: who you are, where you are,
 * and the controls the canvas keeps permanently reachable.
 *
 * Two rows rather than one. The canvas gives the identity a line of its own -
 * a 42px portrait beside a name and where that name is - and puts the voice
 * controls on the line under it, which is what lets mute, deafen, share and
 * Leave all be first-class without any of them being squeezed into a strip
 * that also has to hold a name.
 *
 * `Leave` leaves the server - the same disconnect the title bar's close
 * performs, confirmation and all. Mumble has no channel-less state to fall
 * back to, so there is nothing else for the word to mean.
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
  onShareScreen,
  onShareCamera,
}: Readonly<VoiceDockProps>) {
  const micLive = useAppStore(selectMicLive);
  const deafened = useAppStore(selectSelfDeafened);
  const voiceState = useAppStore((state) => state.voiceState);
  const ownSession = useAppStore((state) => state.ownSession);
  const broadcastingOwnSession = useAppStore((state) => state.broadcastingOwnSession);
  const [overflow, setOverflow] = useState<HTMLElement | null>(null);

  // Read from the store rather than from `useScreenShare`: that hook owns the
  // capture and only one component may. All the dock needs to know is whether
  // the broadcast running in this window belongs to this tab's session.
  const sharing =
    broadcastingOwnSession !== null && ownSession !== null && broadcastingOwnSession === ownSession;

  return (
    <Box
      sx={(theme) => ({
        flex: "none",
        m: DOCK_INSET,
        p: DOCK_INSET,
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gridTemplateRows: "auto auto",
        columnGap: "14px",
        rowGap: "8px",
        alignItems: "center",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.wash,
        border: `1px solid ${theme.palette.nebula.washLine}`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 8px 28px rgba(0,0,0,.14)",
      })}
    >
      <Box
        component="button"
        onClick={onOpenProfile}
        onContextMenu={onContextMenuProfile}
        aria-label="Your profile"
        sx={{ all: "unset", cursor: "pointer", display: "flex", gridRow: "1 / 3" }}
      >
        {/* The avatar draws its own presence dot - a second one here sat
            beside it rather than on it. */}
        <UserAvatar
          name={name}
          session={session}
          textureSize={textureSize}
          size={42}
          status={voiceState === "inactive" ? "offline" : "online"}
        />
      </Box>

      {/* Name over channel, with the overflow beside them: the identity keeps
          the top row and the controls get the one below. */}
      <Stack direction="row" alignItems="center" gap="8px" sx={{ minWidth: 0 }}>
        <Stack gap="1px" sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.25 }} noWrap>
            {name}
          </Typography>
          <Typography
            sx={(theme) => ({ fontSize: 10.5, lineHeight: 1.35, color: theme.palette.nebula.muted })}
            noWrap
          >
            {voiceState === "inactive" ? "Voice off" : (channelName ?? "Not in voice")}
            {latencyMs != null && voiceState !== "inactive" ? ` · ${latencyMs} ms` : ""}
          </Typography>
        </Stack>

        <DockButton
          label="More"
          active={!!overflow}
          width={28}
          onClick={(event) => setOverflow(event.currentTarget)}
        >
          <KebabMenuIcon width={15} height={15} />
        </DockButton>
      </Stack>

      <Stack direction="row" alignItems="center" gap="4px">
        <DockButton
          label={micLive ? "Mute" : voiceState === "inactive" ? "Enable voice" : "Unmute"}
          active={!micLive}
          alert
          onClick={() =>
            void (voiceState === "inactive"
              ? useAppStore.getState().enableVoice()
              : useAppStore.getState().toggleMute())
          }
        >
          {micLive ? <MicIcon width={15} height={15} /> : <MicOffIcon width={15} height={15} />}
        </DockButton>

        <DockButton
          label={deafened ? "Undeafen" : "Deafen"}
          active={deafened}
          alert
          onClick={() => void useAppStore.getState().toggleDeafen()}
        >
          {deafened ? (
            <HeadphonesOffIcon width={15} height={15} />
          ) : (
            <HeadphonesIcon width={15} height={15} />
          )}
        </DockButton>

        {onShareScreen && (
          <DockButton
            label={sharing ? "Stop sharing your screen" : "Share your screen"}
            active={sharing}
            accent
            trailing
            onClick={() => (sharing ? stopOwnBroadcast() : onShareScreen())}
          >
            <ScreenShareIcon width={15} height={15} />
          </DockButton>
        )}
      </Stack>

      {/* What is left over: the picker the row has no space for, and the two
          destinations - devices and administration - that are settings rather
          than voice controls. */}
      <Menu
        anchorEl={overflow}
        open={!!overflow}
        onClose={() => setOverflow(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        // The two boxes already meet corner to corner, but a 14px surface
        // radius against the button's 10px leaves ~6px of daylight between the
        // arcs. Tucking the paper back by that much is what makes them touch.
        slotProps={{ paper: { sx: { mt: "6px", ml: "-6px" } } }}
      >
        {onShareCamera && <SectionLabel sx={{ p: "7px 10px 4px" }}>SHARE</SectionLabel>}
        {onShareCamera && (
          <MenuItem
            onClick={() => {
              setOverflow(null);
              onShareCamera();
            }}
          >
            <MenuGlyph>
              <WebcamIcon width={14} height={14} />
            </MenuGlyph>
            Share your camera
          </MenuItem>
        )}
        {onShareCamera && <Divider sx={{ m: "5px 8px" }} />}

        <SectionLabel sx={{ p: "7px 10px 4px" }}>AUDIO</SectionLabel>
        <MenuItem
          onClick={() => {
            setOverflow(null);
            onOpenSettings();
          }}
        >
          <MenuGlyph>
            <HeadphonesIcon width={14} height={14} />
          </MenuGlyph>
          Sound &amp; devices
        </MenuItem>

        {onOpenAdmin && <Divider sx={{ m: "5px 8px" }} />}
        {onOpenAdmin && (
          <MenuItem
            onClick={() => {
              setOverflow(null);
              onOpenAdmin();
            }}
          >
            <MenuGlyph>
              <ShieldIcon width={14} height={14} />
            </MenuGlyph>
            Server admin
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}

/**
 * The shape every control in the dock's row is drawn to.
 *
 * The canvas gives these a chip each rather than the bare glyphs the
 * composer's tools are: they are states, not actions, and a state needs
 * somewhere for the fill to go when it is on.
 */
function dockButtonBase(theme: Theme) {
  return {
    all: "unset" as const,
    boxSizing: "border-box" as const,
    cursor: "pointer",
    flex: "none",
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "5px",
    borderRadius: radius("md"),
    border: "1px solid transparent",
    color: theme.palette.nebula.muted,
    background: "transparent",
    transition: "background 120ms ease, color 120ms ease",
  };
}

/**
 * One control in the dock's row.
 *
 * Off is bare; on is a filled chip. `alert` is for the two controls whose "on"
 * is a warning - a muted mic, stopped ears - and `accent` for the one whose
 * "on" is simply live, so a share in progress does not read as a fault.
 */
function DockButton({
  label,
  active = false,
  alert = false,
  accent = false,
  width = 30,
  trailing = false,
  onClick,
  children,
}: Readonly<{
  label: string;
  active?: boolean;
  alert?: boolean;
  accent?: boolean;
  width?: number;
  /** Pushes the button to the end of the row. */
  trailing?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip title={label}>
      <Box
        component="button"
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        sx={(theme: Theme) => {
          const { nebula } = theme.palette;
          const align = trailing ? { marginLeft: "auto" } : {};
          const fill = alert
            ? { background: `${nebula.bad}29`, border: `1px solid ${nebula.bad}57`, color: nebula.bad }
            : accent
              ? {
                  background: nebula.accentSoft,
                  border: `1px solid ${nebula.accentLine}`,
                  color: nebula.accent,
                }
              : { background: nebula.card2, color: nebula.text };
          return {
            ...dockButtonBase(theme),
            width,
            ...align,
            ...(active ? fill : { "&:hover": { background: nebula.hover, color: nebula.text } }),
          };
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

/** The muted glyph a menu row leads with, as the canvas draws its menus. */
function MenuGlyph({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box aria-hidden sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.muted })}>
      {children}
    </Box>
  );
}
