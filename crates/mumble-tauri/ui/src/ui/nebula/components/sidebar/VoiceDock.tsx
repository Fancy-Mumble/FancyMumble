import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Divider, Menu, MenuItem, Switch, Tooltip, Typography } from "@mui/material";
import { useTheme, type Theme } from "@mui/material/styles";
import { useAppStore } from "@core/store";
import { selectMicLive, selectSelfDeafened } from "@core/store/voiceSelectors";
import { TID } from "@core/testids";
import { stopOwnBroadcast } from "@standard/components/chat/stream/useScreenShare";
import { captureHolders, useCaptureError } from "@standard/hooks/useCaptureError";
import { useWhisperState } from "@core/features/settings/useWhisperState";
import {
  ChevronRightIcon,
  CircleDotIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  KebabMenuIcon,
  LogOutIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  SettingsIcon,
  ShieldIcon,
  UserXIcon,
  WebcamIcon,
} from "@ui/icons";
import { Stack, UserAvatar } from "../primitives";
import { chamferedSurface, frost } from "../../theme";
import { radius } from "../../tokens";
import { formatElapsed } from "../recording/useRecording";
import { useShareAvailability } from "../chat/share/useShareAvailability";

/** The dock sits on the composer's inset; they are one strip. */
const DOCK_INSET = "10px";

/** The artboard sets the dock further off the column's edges than the pack does. */
const DOCK_INSET_STENCIL = "16px";

/** Ties the filter row to the line explaining it. */
const HIDE_EMPTY_HINT_ID = "nebula-dock-hide-empty-hint";

interface VoiceDockProps {
  name: string;
  session: number | null;
  textureSize: number | null;
  /** Channel the user is joined to, or null when only browsing. */
  channelName: string | null;
  latencyMs: number | null;
  /** The list filter: on when channels nobody is in are folded away. */
  hideEmpty: boolean;
  onToggleHideEmpty: () => void;
  onOpenSettings: () => void;
  /** Carries the click so the card opens beside the avatar it came from. */
  onOpenProfile: (event: React.MouseEvent) => void;
  /** Right-click on your own avatar, for the same menu everyone else's row opens. */
  onContextMenuProfile?: (event: React.MouseEvent) => void;
  /** Open server administration; absent without write access to the root channel. */
  onOpenAdmin?: () => void;
  /** The server the menu belongs to, named at its head. */
  serverName?: string;
  /** Leave the server entirely; absent when there is nothing to leave. */
  onLeaveServer?: () => void;
  /** Ask for the screen picker; absent where there is nothing to share into. */
  onShareScreen?: () => void;
  /** Ask for the picker in camera-only mode, from the overflow menu. */
  onShareCamera?: () => void;
  /** Open the audio recorder; absent outside developer mode, as in Standard. */
  onRecord?: () => void;
  /** Seconds recorded so far while a recording runs, or null when none does. */
  recordingElapsed?: number | null;
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
  hideEmpty,
  onToggleHideEmpty,
  onOpenSettings,
  onOpenProfile,
  onContextMenuProfile,
  onOpenAdmin,
  serverName,
  onLeaveServer,
  onShareScreen,
  onShareCamera,
  onRecord,
  recordingElapsed = null,
}: Readonly<VoiceDockProps>) {
  const { t } = useTranslation(["nebulaSidebar", "nebulaChat", "common", "chat", "sidebar"]);
  const micLive = useAppStore(selectMicLive);
  const deafened = useAppStore(selectSelfDeafened);
  const voiceState = useAppStore((state) => state.voiceState);
  // The whisper key is global, so the press that starts one usually lands while
  // the user is looking at something else. The status line under the name is
  // where they look to check what they are sending, so that is where it shows.
  const whisper = useWhisperState();
  const refusedChannel = useAppStore((state) =>
    whisper.refusal
      ? (state.channels.find((channel) => channel.id === whisper.refusal?.channelId)?.name ??
        `#${whisper.refusal.channelId}`)
      : null,
  );
  const stencil = useTheme().palette.nebulaSkin.chrome === "stencil";
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  // Another application holding the input device is the one mic fault the user
  // can act on, and it is invisible from inside the client: the button looks
  // live, and nothing goes out. The dock marks it and names the holder where
  // the backend could work one out, rather than only saying "busy".
  const captureError = useCaptureError();
  const micBusy = captureError?.kind === "device_busy";
  const micHolders = captureHolders(captureError);
  const micBusyLabel = micHolders
    ? t("sidebar:channelSidebar.micInUseBy", { app: micHolders })
    : t("sidebar:channelSidebar.micInUse");

  // Read from the store rather than from `useScreenShare`: that hook owns the
  // capture and only one component may. All the dock needs to know is whether
  // the broadcast running in this window belongs to this tab's session.
  // Compared by server as well as by session: two servers can hand out the
  // same session number, and a share on the other one is not ours to stop here.
  const shareAvailability = useShareAvailability();
  const sharing = shareAvailability.here;
  // The app runs one capture. While another server connection holds it, the
  // start controls stay drawn but say why they do nothing.
  const shareBlocked = !sharing && shareAvailability.elsewhere;
  const shareBlockedReason = t("chat:screenShare.alreadySharingOtherServer");

  return (
    <Box
      ref={card}
      sx={(theme) => ({
        flex: "none",
        m: stencil ? DOCK_INSET_STENCIL : DOCK_INSET,
        p: stencil ? "12px 14px" : DOCK_INSET,
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gridTemplateRows: "auto auto",
        columnGap: "14px",
        rowGap: "8px",
        alignItems: "center",
        borderRadius: radius("lg"),
        // A card, so it takes the same chamfer the HUD skins cut into every
        // other surface - stroke included, which is what `chamferedSurface`
        // is for. `none` everywhere else leaves the radius above alone.
        ...chamferedSurface(
          theme,
          theme.palette.nebula.card,
          // The artboard outlines the dock in the window's own navy, a good
          // deal heavier than the hairline every other panel gets.
          stencil ? theme.palette.nebula.railLine : theme.palette.nebula.line2,
        ),
        ...frost(theme, "var(--nebula-blur, 12px)"),
        // A drawn skin has no light source to cast a soft shadow, so the panel
        // sits on a hard offset plate instead of floating over a blur.
        boxShadow:
          theme.palette.nebulaSkin.chrome === "stencil"
            ? `6px 6px 0 ${theme.palette.nebula.line2}`
            : "0 8px 28px rgba(0,0,0,.14)",
      })}
    >
      <Box
        component="button"
        onClick={onOpenProfile}
        onContextMenu={onContextMenuProfile}
        aria-label={t("nebulaSidebar:dock.profile")}
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
          <Typography
            sx={{ fontWeight: stencil ? 900 : 600, fontSize: stencil ? 16 : 13, lineHeight: 1.15 }}
            noWrap
          >
            {name}
          </Typography>
          <Typography
            data-testid={TID.selfDockStatus}
            data-whisper={whisper.active ? "active" : undefined}
            aria-live="polite"
            sx={(theme) => ({
              fontSize: 10.5,
              lineHeight: 1.35,
              color: theme.palette.nebula.muted,
              // Voice being off is the one state the artboard raises its voice
              // about: tracked caps in the alarm colour, not a quiet subtitle.
              ...(stencil && voiceState === "inactive"
                ? {
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: theme.palette.nebula.bad,
                  }
                : {}),
              // Replaces the channel name rather than adding a line: the dock
              // keeps its height, and the channel is exactly what a whisper is
              // not going to.
              ...(whisper.refusal !== null || whisper.unresolved !== null
                ? { color: theme.palette.nebula.warn, fontWeight: 600 }
                : whisper.active
                  ? { color: theme.palette.nebula.accent, fontWeight: 600 }
                  : {}),
            })}
            noWrap
          >
            {refusedChannel !== null
              ? t("nebulaSidebar:dock.whisperDenied", { channel: refusedChannel })
              : whisper.unresolved !== null
              ? t("nebulaSidebar:dock.whisperUnresolved", { name: whisper.unresolved })
              : whisper.active
                ? t("nebulaSidebar:dock.whispering")
                : voiceState === "inactive"
                  ? t("common:minimal.voiceOff")
                  : (channelName ?? t("nebulaSidebar:dock.notInVoice"))}
            {latencyMs != null && voiceState !== "inactive" && !whisper.active && whisper.unresolved === null && whisper.refusal === null
              ? t("nebulaSidebar:dock.latency", { ms: latencyMs })
              : ""}
          </Typography>
        </Stack>

        {/* A recording keeps running after its dialog closes, so the button
            that leads back to it carries a mark for as long as it does. */}
        <Box sx={{ position: "relative", display: "flex" }}>
          <DockButton
            label={t("common:actions.more")}
            active={open}
            width={28}
            testId={TID.selfDockMenu}
            onClick={() => setOpen(true)}
          >
            <KebabMenuIcon width={15} height={15} />
          </DockButton>
          {recordingElapsed !== null && (
            <Box
              data-recording-dot=""
              aria-hidden
              sx={(theme) => ({
                position: "absolute",
                top: 2,
                right: 2,
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: theme.palette.nebula.bad,
                pointerEvents: "none",
              })}
            />
          )}
        </Box>
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        gap="8px"
        // Plated, the row is the mock's bank of switches and runs the whole
        // width of the panel rather than sitting in the column beside the face.
        sx={stencil ? { gridColumn: "1 / -1" } : undefined}
      >
        <DockButton
          spread
          label={
            micBusy
              ? micBusyLabel
              : micLive
                ? t("chat:callControls.mute")
                : voiceState === "inactive"
                  ? t("nebulaSidebar:dock.enableVoice")
                  : t("chat:callControls.unmute")
          }
          active={micBusy || !micLive}
          alert={!micBusy}
          warn={micBusy}
          testId={TID.toggleMute}
          onClick={() =>
            void (voiceState === "inactive"
              ? useAppStore.getState().enableVoice()
              : useAppStore.getState().toggleMute())
          }
        >
          {micLive ? <MicIcon width={15} height={15} /> : <MicOffIcon width={15} height={15} />}
        </DockButton>

        <DockButton
          spread
          label={deafened ? t("chat:callControls.undeafen") : t("chat:callControls.deafen")}
          active={deafened}
          alert
          testId={TID.toggleDeafen}
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
            spread
            label={
              sharing
                ? t("chat:screenShare.stopScreenShare")
                : shareBlocked
                  ? shareBlockedReason
                  : t("nebulaSidebar:dock.shareScreenRoute", {
                      route: shareAvailability.relayed
                        ? t("nebulaChat:share.routeRelayed")
                        : t("nebulaChat:share.routeP2P"),
                    })
            }
            disabled={shareBlocked}
            active={sharing}
            accent
            trailing
            /* Only while it is the *start* control: once a share is up, the
               stage draws the stop button and carries this id, and two
               elements answering to it would make the handle ambiguous. */
            testId={sharing ? undefined : TID.screenShareToggle}
            onClick={() => (sharing ? stopOwnBroadcast() : onShareScreen())}
          >
            <ScreenShareIcon width={15} height={15} />
          </DockButton>
        )}
      </Stack>

      {/* What is left over: the picker the row has no space for, the filter on
          the list this card sits under, and the two destinations - settings and
          administration - that are not voice controls.

          The mock draws it as a sheet grown out of this card - as wide as the
          dock and flush against its top edge - rather than a popover that
          happens to open nearby, so it is anchored to the card, not to the
          button that summoned it. */}
      <Menu
        anchorEl={card.current}
        open={open}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        marginThreshold={0}
        slotProps={{
          paper: {
            sx: {
              width: card.current?.offsetWidth,
              mt: "-4px",
              p: "6px",
              "& .MuiMenuItem-root": { fontSize: 13.5, p: "8px 12px", gap: "12px" },
            },
          },
        }}
      >
        {serverName && <MenuHeader name={serverName} caption={t("nebulaSidebar:dock.menuCaption")} />}
        {serverName && <MenuRule />}

        {onShareCamera && (
          <MenuItem
            disabled={shareBlocked}
            onClick={() => {
              setOpen(false);
              onShareCamera();
            }}
            sx={shareBlocked ? { alignItems: "flex-start" } : undefined}
          >
            <MenuGlyph inset={shareBlocked}>
              <WebcamIcon width={15} height={15} />
            </MenuGlyph>
            <Stack gap="1px" sx={{ minWidth: 0 }}>
              {t("nebulaSidebar:dock.shareCamera")}
              {shareBlocked && (
                <Typography sx={(theme) => ({ fontSize: 11, lineHeight: 1.35, whiteSpace: "normal", color: theme.palette.nebula.muted })}>
                  {shareBlockedReason}
                </Typography>
              )}
            </Stack>
          </MenuItem>
        )}
        {onShareCamera && <MenuRule />}

        <MenuItem
          role="menuitemcheckbox"
          aria-checked={hideEmpty}
          // Named by the label alone: the line under it says what the filter
          // does, which is a description rather than part of what to call it.
          aria-label={t("sidebar:channelSidebar.hideEmptyChannels")}
          aria-describedby={HIDE_EMPTY_HINT_ID}
          onClick={() => {
            setOpen(false);
            onToggleHideEmpty();
          }}
          sx={{ alignItems: "flex-start" }}
        >
          <MenuGlyph inset>
            <UserXIcon width={15} height={15} />
          </MenuGlyph>
          <Stack gap="1px" sx={{ minWidth: 0 }}>
            {t("sidebar:channelSidebar.hideEmptyChannels")}
            <Typography
              id={HIDE_EMPTY_HINT_ID}
              sx={(theme) => ({ fontSize: 11, lineHeight: 1.35, color: theme.palette.nebula.muted })}
            >
              {t("nebulaSidebar:dock.hideEmptyHint")}
            </Typography>
          </Stack>
          {/* The row is the control; the switch only shows its state, so it is
              kept out of the tab order and off the accessibility tree. */}
          <Switch
            checked={hideEmpty}
            readOnly
            tabIndex={-1}
            slotProps={{ input: { "aria-hidden": true, tabIndex: -1 } }}
            sx={{ ml: "auto", pointerEvents: "none" }}
          />
        </MenuItem>

        <MenuItem
          onClick={() => {
            setOpen(false);
            onOpenSettings();
          }}
        >
          <MenuGlyph>
            <SettingsIcon width={15} height={15} />
          </MenuGlyph>
          {t("common:minimal.settings")}
          <MenuChevron />
        </MenuItem>

        {onOpenAdmin && (
          <MenuItem
            data-testid={TID.adminPanel}
            onClick={() => {
              setOpen(false);
              onOpenAdmin();
            }}
          >
            <MenuGlyph>
              <ShieldIcon width={15} height={15} />
            </MenuGlyph>
            {t("nebulaSidebar:dock.serverAdmin")}
            <MenuChevron />
          </MenuItem>
        )}

        {onRecord && (
          <MenuItem
            onClick={() => {
              setOpen(false);
              onRecord();
            }}
            sx={recordingElapsed !== null ? (theme) => ({ color: theme.palette.nebula.bad }) : undefined}
          >
            <MenuGlyph tone={recordingElapsed !== null ? "inherit" : "muted"}>
              <CircleDotIcon width={15} height={15} />
            </MenuGlyph>
            {recordingElapsed !== null
              ? t("nebulaSidebar:dock.recordingElapsed", { elapsed: formatElapsed(recordingElapsed) })
              : t("sidebar:channelSidebar.recordAudio")}
          </MenuItem>
        )}

        {onLeaveServer && <MenuRule />}
        {onLeaveServer && (
          <MenuItem
            data-testid={TID.disconnectServer}
            onClick={() => {
              setOpen(false);
              onLeaveServer();
            }}
            // The one row here that ends a session rather than opening
            // something, and the only one worth marking as such.
            sx={(theme) => ({ color: theme.palette.nebula.bad })}
          >
            <MenuGlyph tone="inherit">
              <LogOutIcon width={15} height={15} />
            </MenuGlyph>
            {t("nebulaSidebar:dock.leaveServer")}
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
    border: "var(--nebula-line-width, 1px) solid transparent",
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
 * `warn` is neither: something outside the client is in the way, which is not
 * a state the user chose and not one this button can clear.
 */
function DockButton({
  label,
  active = false,
  alert = false,
  accent = false,
  warn = false,
  width = 30,
  spread = false,
  trailing = false,
  disabled = false,
  testId,
  onClick,
  children,
}: Readonly<{
  label: string;
  active?: boolean;
  alert?: boolean;
  accent?: boolean;
  warn?: boolean;
  width?: number;
  /**
   * One of the row of call controls, which a stencil skin draws as equal
   * bordered plates rather than as small icons that only outline when active.
   */
  spread?: boolean;
  /** Pushes the button to the end of the row. */
  trailing?: boolean;
  /**
   * Drawn, but not acted on. Kept focusable and hoverable rather than using the
   * `disabled` attribute, which would also silence the tooltip - and the
   * tooltip is where the label says why.
   */
  disabled?: boolean;
  /** e2e handle; the dock's own buttons carry the shared registry's ids. */
  testId?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}>) {
  const stencil = useTheme().palette.nebulaSkin.chrome === "stencil";
  const plated = spread && stencil;
  return (
    <Tooltip title={label}>
      <Box
        component="button"
        type="button"
        data-testid={testId}
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        sx={(theme: Theme) => {
          const { nebula } = theme.palette;
          const align = trailing ? { marginLeft: "auto" } : {};
          const fill = warn
            ? { background: `${nebula.warn}29`, border: `var(--nebula-line-width, 1px) solid ${nebula.warn}57`, color: nebula.warn }
            : alert
              ? { background: `${nebula.bad}29`, border: `var(--nebula-line-width, 1px) solid ${nebula.bad}57`, color: nebula.bad }
              : accent
                ? {
                    background: nebula.accentSoft,
                    border: `var(--nebula-line-width, 1px) solid ${nebula.accentLine}`,
                    color: nebula.accent,
                  }
                : { background: nebula.card2, color: nebula.text };
          // The same three tones as a pair a cut plate can be built from: a
          // `border` would be sliced off at the diagonal.
          const tone = warn
            ? { fill: `${nebula.warn}29`, edge: `${nebula.warn}57`, ink: nebula.warn }
            : alert
              ? { fill: `${nebula.bad}29`, edge: `${nebula.bad}57`, ink: nebula.bad }
              : accent
                ? { fill: nebula.accentSoft, edge: nebula.accentLine, ink: nebula.accent }
                : { fill: nebula.card2, edge: nebula.line2, ink: nebula.text };
          // A plated control is lit at rest: the mock's row reads as three
          // switches, and a switch that only outlines when thrown reads as
          // nothing at all until you throw it.
          const rest = plated
            ? {
                color: nebula.text,
                // Squared, unlike the header's plates: the artboard leans the
                // chrome above the conversation and leaves the switches below
                // it upright.
                background: nebula.card2,
                border: `2px solid ${nebula.accentLine}`,
                // Each switch stands on its own offset plate, the way the
                // dock around them does. Hard, not soft: a drawn skin has no
                // light source, so depth is a second edge behind the first.
                boxShadow: `3px 3px 0 ${nebula.line2}`,
                "&:hover": { filter: "brightness(.96)" },
              }
            : { "&:hover": { background: nebula.hover, color: nebula.text } };
          return {
            ...dockButtonBase(theme),
            ...(plated ? { flex: 1, width: "auto", height: 34 } : { width }),
            ...align,
            ...(active
              ? plated
                ? { color: tone.ink, background: tone.fill, border: `2px solid ${tone.edge}` }
                : fill
              : rest),
            ...(disabled ? { opacity: 0.45, cursor: "not-allowed", "&:hover": {} } : {}),
          };
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

/**
 * A group heading in the sheet. The mock separates groups with air rather
 * than rules, so every heading but the first carries the gap above it.
 */
function MenuHeader({ name, caption }: Readonly<{ name: string; caption: string }>) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: "10px", p: "6px 12px 8px" }}>
      <Box
        aria-hidden
        sx={(theme) => ({
          flex: "none",
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          borderRadius: radius("md"),
          background: theme.palette.nebula.accentSoft,
          color: theme.palette.nebula.accent,
          fontSize: 13,
          fontWeight: 600,
        })}
      >
        {/* Spread, not `charAt`: a name starting outside the basic plane would
            otherwise be cut in half and drawn as a broken glyph. */}
        {[...name.trim()][0]?.toUpperCase() ?? ""}
      </Box>
      <Stack gap="1px" sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25 }} noWrap>
          {name}
        </Typography>
        <Typography
          sx={(theme) => ({ fontSize: 11, lineHeight: 1.35, color: theme.palette.nebula.muted })}
          noWrap
        >
          {caption}
        </Typography>
      </Stack>
    </Box>
  );
}

/** The line between one cluster of rows and the next. */
function MenuRule() {
  return <Divider sx={(theme) => ({ my: "6px", borderColor: theme.palette.nebula.line })} />;
}

/** Marks a row that opens somewhere else rather than acting where it stands. */
function MenuChevron() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({ display: "flex", ml: "auto", pl: "8px", color: theme.palette.nebula.dim })}
    >
      <ChevronRightIcon width={14} height={14} />
    </Box>
  );
}

/** The muted glyph a menu row leads with, as the canvas draws its menus. */
function MenuGlyph({
  children,
  inset = false,
  tone = "muted",
}: Readonly<{ children: React.ReactNode; inset?: boolean; tone?: "muted" | "inherit" }>) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        display: "flex",
        flex: "none",
        // A row that runs to two lines still leads with its glyph on the
        // first one, beside the label rather than centred on the pair.
        mt: inset ? "1px" : 0,
        color: tone === "muted" ? theme.palette.nebula.muted : "inherit",
      })}
    >
      {children}
    </Box>
  );
}
