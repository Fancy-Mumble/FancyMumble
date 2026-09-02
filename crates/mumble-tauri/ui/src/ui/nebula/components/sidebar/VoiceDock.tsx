import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Menu, MenuItem, Switch, Tooltip, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useAppStore } from "@core/store";
import { selectMicLive, selectSelfDeafened } from "@core/store/voiceSelectors";
import { stopOwnBroadcast } from "@standard/components/chat/stream/useScreenShare";
import { captureHolders, useCaptureError } from "@standard/hooks/useCaptureError";
import {
  HeadphonesIcon,
  HeadphonesOffIcon,
  KebabMenuIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  SettingsIcon,
  ShieldIcon,
  UserXIcon,
  WebcamIcon,
} from "@ui/icons";
import { SectionLabel, Stack, UserAvatar } from "../primitives";
import { chamferedSurface } from "../../theme";
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
  hideEmpty,
  onToggleHideEmpty,
  onOpenSettings,
  onOpenProfile,
  onContextMenuProfile,
  onOpenAdmin,
  onShareScreen,
  onShareCamera,
}: Readonly<VoiceDockProps>) {
  const { t } = useTranslation(["nebulaSidebar", "common", "chat", "sidebar"]);
  const micLive = useAppStore(selectMicLive);
  const deafened = useAppStore(selectSelfDeafened);
  const voiceState = useAppStore((state) => state.voiceState);
  const ownSession = useAppStore((state) => state.ownSession);
  const broadcastingOwnSession = useAppStore((state) => state.broadcastingOwnSession);
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
  const sharing =
    broadcastingOwnSession !== null && ownSession !== null && broadcastingOwnSession === ownSession;

  return (
    <Box
      ref={card}
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
        // A card, so it takes the same chamfer the HUD skins cut into every
        // other surface - stroke included, which is what `chamferedSurface`
        // is for. `none` everywhere else leaves the radius above alone.
        ...chamferedSurface(theme, theme.palette.nebula.card, theme.palette.nebula.line2),
        backdropFilter: "blur(var(--nebula-blur, 12px))",
        WebkitBackdropFilter: "blur(var(--nebula-blur, 12px))",
        boxShadow: "0 8px 28px rgba(0,0,0,.14)",
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
          <Typography sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.25 }} noWrap>
            {name}
          </Typography>
          <Typography
            sx={(theme) => ({ fontSize: 10.5, lineHeight: 1.35, color: theme.palette.nebula.muted })}
            noWrap
          >
            {voiceState === "inactive"
              ? t("common:minimal.voiceOff")
              : (channelName ?? t("nebulaSidebar:dock.notInVoice"))}
            {latencyMs != null && voiceState !== "inactive"
              ? t("nebulaSidebar:dock.latency", { ms: latencyMs })
              : ""}
          </Typography>
        </Stack>

        <DockButton label={t("common:actions.more")} active={open} width={28} onClick={() => setOpen(true)}>
          <KebabMenuIcon width={15} height={15} />
        </DockButton>
      </Stack>

      <Stack direction="row" alignItems="center" gap="4px">
        <DockButton
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
          onClick={() =>
            void (voiceState === "inactive"
              ? useAppStore.getState().enableVoice()
              : useAppStore.getState().toggleMute())
          }
        >
          {micLive ? <MicIcon width={15} height={15} /> : <MicOffIcon width={15} height={15} />}
        </DockButton>

        <DockButton
          label={deafened ? t("chat:callControls.undeafen") : t("chat:callControls.deafen")}
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
            label={sharing ? t("chat:screenShare.stopScreenShare") : t("nebulaSidebar:dock.shareScreen")}
            active={sharing}
            accent
            trailing
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
        {onShareCamera && <Group first>{t("nebulaSidebar:dock.groupShare")}</Group>}
        {onShareCamera && (
          <MenuItem
            onClick={() => {
              setOpen(false);
              onShareCamera();
            }}
          >
            <MenuGlyph>
              <WebcamIcon width={15} height={15} />
            </MenuGlyph>
            {t("nebulaSidebar:dock.shareCamera")}
          </MenuItem>
        )}

        <Group first={!onShareCamera}>{t("nebulaSidebar:dock.groupApp")}</Group>
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
        </MenuItem>

        <Group>{t("nebulaSidebar:dock.groupChannelList")}</Group>
        <MenuItem
          role="menuitemcheckbox"
          aria-checked={hideEmpty}
          onClick={() => {
            setOpen(false);
            onToggleHideEmpty();
          }}
        >
          <MenuGlyph>
            <UserXIcon width={15} height={15} />
          </MenuGlyph>
          {t("sidebar:channelSidebar.hideEmptyChannels")}
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

        {onOpenAdmin && <Group>{t("nebulaSidebar:dock.groupServer")}</Group>}
        {onOpenAdmin && (
          <MenuItem
            onClick={() => {
              setOpen(false);
              onOpenAdmin();
            }}
          >
            <MenuGlyph>
              <ShieldIcon width={15} height={15} />
            </MenuGlyph>
            {t("nebulaSidebar:dock.serverAdmin")}
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
  trailing = false,
  onClick,
  children,
}: Readonly<{
  label: string;
  active?: boolean;
  alert?: boolean;
  accent?: boolean;
  warn?: boolean;
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
          const fill = warn
            ? { background: `${nebula.warn}29`, border: `1px solid ${nebula.warn}57`, color: nebula.warn }
            : alert
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

/**
 * A group heading in the sheet. The mock separates groups with air rather
 * than rules, so every heading but the first carries the gap above it.
 */
function Group({ first = false, children }: Readonly<{ first?: boolean; children: React.ReactNode }>) {
  return <SectionLabel sx={{ p: first ? "4px 12px 4px" : "14px 12px 4px" }}>{children}</SectionLabel>;
}

/** The muted glyph a menu row leads with, as the canvas draws its menus. */
function MenuGlyph({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box aria-hidden sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.muted })}>
      {children}
    </Box>
  );
}
