/**
 * Everything the stage can do to the picture, as one menu.
 *
 * It is Nebula's context menu - the same MUI `Menu` the message, channel,
 * server and calendar menus are, down to `contextMenuRootSlot` - rather than a
 * panel of its own, because a right-click on the picture is the same gesture
 * as a right-click on a message and should answer in the same shape. The kebab
 * under the picture opens this too, anchored to itself: one list of rows, two
 * ways in, so the two can never drift apart.
 *
 * Portalled into the stage rather than the body while the stage is expanded:
 * a fullscreen element paints over everything outside it, and the in-window
 * fallback sits at a z-index no MUI popup would clear, so a menu mounted on
 * the body would be invisible in both.
 */
import { useTranslation } from "react-i18next";
import { Box, ListSubheader, Menu, MenuItem } from "@mui/material";
import {
  AppWindowIcon,
  CameraIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  EyeOffIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  PollIcon,
  PopoutIcon,
  ScreenShareIcon,
  SettingsIcon,
} from "@ui/icons";
import { radius } from "../../../tokens";
import { contextMenuRootSlot } from "../../contextMenuRoot";
import { FIT_LABEL_KEYS, FIT_MODES, type FitMode } from "./fitMode";
import type { StreamFeed } from "./feeds";

/** Where the menu opens: the pointer, or the button that asked for it. */
export type StageMenuAnchor = { readonly x: number; readonly y: number } | HTMLElement;

/** The rows only the broadcaster is offered, because only their machine can
 *  perform them. Absent while we are watching someone else. */
export interface StageMenuBroadcast {
  /** The encoder preset's name, shown beside the row that changes it. */
  readonly quality: string;
  readonly onOpenQuality: () => void;
  readonly onChangeSource: () => void;
  /** Whether our own windows hide from every capture API. Undefined where the
   *  platform has no such mechanism to offer (X11). */
  readonly screenshotsAllowed?: boolean;
  readonly onToggleScreenshots?: () => void;
  readonly overlayOn: boolean;
  readonly onToggleOverlay: () => void;
  /** Why the desktop overlay cannot be placed here, where it cannot. The row
   *  stays and explains itself rather than vanishing, so the feature is still
   *  discoverable on a machine that cannot run it. */
  readonly overlayUnavailable?: string;
  readonly onStop: () => void;
}

export interface StageMenuProps {
  readonly anchor: StageMenuAnchor;
  readonly onClose: () => void;
  /** The element to portal into; the body when omitted. See the note above. */
  readonly container?: HTMLElement | null;
  /** The feed the rows act on - always the one on the stage, because opening
   *  this on a filmstrip tile puts that tile on the stage first. */
  readonly feed: StreamFeed;
  readonly fit: FitMode;
  readonly onFit: (mode: FitMode) => void;
  readonly onCopyFrame: () => void;
  readonly annotating: boolean;
  /** Null until the channel and our own session are both known, which is what
   *  an annotation is addressed by. */
  readonly onToggleAnnotating: (() => void) | null;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly statsOpen: boolean;
  readonly onToggleStats: () => void;
  /** Null where this feed cannot be popped out: our own picture, the native
   *  viewer family (no webview to build the second viewer in), or mobile. */
  readonly onPopOut: (() => void) | null;
  readonly broadcast: StageMenuBroadcast | null;
}

export function StageMenu({
  anchor,
  onClose,
  container,
  feed,
  fit,
  onFit,
  onCopyFrame,
  annotating,
  onToggleAnnotating,
  expanded,
  onToggleExpanded,
  statsOpen,
  onToggleStats,
  onPopOut,
  broadcast,
}: Readonly<StageMenuProps>) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
  /** Every row closes the menu; only what it then does differs. */
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const pointer = anchor instanceof HTMLElement ? null : anchor;

  return (
    <Menu
      open
      onClose={onClose}
      container={container ?? undefined}
      // Nothing is chosen when a right-click opens it, so nothing is
      // highlighted: a focused first row reads as a pending action.
      autoFocus={false}
      {...(pointer
        ? { anchorReference: "anchorPosition" as const, anchorPosition: { top: pointer.y, left: pointer.x } }
        : {
            anchorEl: anchor as HTMLElement,
            // The kebab sits along the bottom of the picture, so the menu
            // grows up from it rather than off the stage.
            anchorOrigin: { vertical: "top", horizontal: "right" } as const,
            transformOrigin: { vertical: "bottom", horizontal: "right" } as const,
          })}
      slotProps={{
        // A second right-click is still this menu's: see `contextMenuRootSlot`.
        root: contextMenuRootSlot(onClose),
        list: { sx: { p: 0 }, dense: true, "aria-label": t("nebulaChat:share.streamOptions") },
        paper: {
          sx: (theme) => ({
            width: 232,
            p: "5px",
            borderRadius: radius("lg"),
            border: "var(--nebula-line-width, 1px) solid " + theme.palette.nebula.line2,
            background: theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
            boxShadow: theme.palette.nebula.shadow,
            backdropFilter: "blur(20px) saturate(1.2)",
          }),
        },
      }}
    >
      {/* Which picture the rows are about - two shares in a channel look
          alike enough that a menu without a name is a guess. */}
      <ListSubheader sx={HEADING}>{`${feed.name} · ${feed.kind}`}</ListSubheader>

      {FIT_MODES.map((mode) => (
        <MenuItem
          key={mode}
          sx={ITEM}
          role="menuitemradio"
          aria-checked={fit === mode}
          onClick={run(() => onFit(mode))}
        >
          <Tick on={fit === mode} />
          {mode === "actual" ? "1:1" : t(`nebulaChat:${FIT_LABEL_KEYS[mode]}` as const)}
        </MenuItem>
      ))}

      <Rule />

      <MenuItem sx={ITEM} onClick={run(onCopyFrame)}>
        <CameraIcon width={13} height={13} />
        {t("nebulaChat:share.copyFrame")}
      </MenuItem>
      {onToggleAnnotating && (
        <MenuItem
          sx={ITEM}
          role="menuitemcheckbox"
          aria-checked={annotating}
          onClick={run(onToggleAnnotating)}
        >
          <EditIcon width={13} height={13} />
          {annotating ? t("chat:screenShare.drawOff") : t("chat:screenShare.drawOn")}
        </MenuItem>
      )}
      <MenuItem sx={ITEM} onClick={run(onToggleExpanded)}>
        {expanded ? <FullscreenExitIcon width={13} height={13} /> : <FullscreenIcon width={13} height={13} />}
        {expanded ? t("chat:screenShare.exitFullscreen") : t("chat:screenShare.fullscreen")}
      </MenuItem>
      <MenuItem sx={ITEM} role="menuitemcheckbox" aria-checked={statsOpen} onClick={run(onToggleStats)}>
        <PollIcon width={13} height={13} />
        {t("chat:screenShare.stats.toggle")}
        <Value>{statsOpen ? t("nebulaChat:share.on") : undefined}</Value>
      </MenuItem>
      {onPopOut && (
        <MenuItem sx={ITEM} onClick={run(onPopOut)}>
          <PopoutIcon width={13} height={13} />
          {t("nebulaChat:share.popOut")}
        </MenuItem>
      )}

      {broadcast && <Rule />}
      {broadcast && (
        <MenuItem sx={ITEM} onClick={run(broadcast.onOpenQuality)}>
          <SettingsIcon width={13} height={13} />
          {t("chat:screenShare.config.quality")}
          <Value>{broadcast.quality}</Value>
        </MenuItem>
      )}
      {broadcast && (
        <MenuItem sx={ITEM} onClick={run(broadcast.onChangeSource)}>
          <ScreenShareIcon width={13} height={13} />
          {t("nebulaChat:share.changeSource")}
        </MenuItem>
      )}
      {/* While a screen is shared our own windows hide from every capture API,
          the user's own screenshots included. */}
      {broadcast?.onToggleScreenshots && (
        <MenuItem
          sx={ITEM}
          role="menuitemcheckbox"
          aria-checked={broadcast.screenshotsAllowed === true}
          onClick={run(broadcast.onToggleScreenshots)}
        >
          <EyeOffIcon width={13} height={13} />
          {t("nebulaChat:share.allowScreenshots")}
          <Value>{broadcast.screenshotsAllowed ? t("nebulaChat:share.on") : t("nebulaChat:share.off")}</Value>
        </MenuItem>
      )}
      {broadcast && (
        <MenuItem
          sx={ITEM}
          role="menuitemcheckbox"
          aria-checked={broadcast.overlayOn}
          disabled={broadcast.overlayUnavailable !== undefined}
          title={broadcast.overlayUnavailable}
          onClick={run(broadcast.onToggleOverlay)}
        >
          <AppWindowIcon width={13} height={13} />
          {t("chat:screenShare.showOverlay")}
          <Value>{broadcast.overlayOn ? t("nebulaChat:share.on") : t("nebulaChat:share.off")}</Value>
        </MenuItem>
      )}
      {broadcast && <Rule />}
      {/* The only stream this client can end is its own, so the red row means
          that and nothing else. */}
      {broadcast && (
        <MenuItem
          sx={(theme) => ({ ...ITEM, color: theme.palette.nebula.bad })}
          onClick={run(broadcast.onStop)}
        >
          <CloseIcon width={13} height={13} />
          {t("chat:screenShare.stopSharing")}
        </MenuItem>
      )}
    </Menu>
  );
}

/**
 * One row.
 *
 * MUI sizes a menu row for touch, which at this width leaves the labels
 * swimming - so the row is given the canvas own padding and a matching radius
 * instead of the default, exactly as the message menu's rows are.
 */
const ITEM = {
  minHeight: 0,
  px: "10px",
  py: "7px",
  gap: "9px",
  fontSize: 12.5,
  borderRadius: radius("sm"),
} as const;

const HEADING = {
  px: "10px",
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  lineHeight: "24px",
  background: "transparent",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

/** A check that holds its column whether or not it is showing. */
function Tick({ on }: Readonly<{ on: boolean }>) {
  return (
    <Box component="span" sx={{ width: 13, display: "inline-flex" }}>
      {on && <CheckIcon width={13} height={13} />}
    </Box>
  );
}

/** What a row currently stands at, right-aligned after its label. */
function Value({ children }: Readonly<{ children?: React.ReactNode }>) {
  if (children === undefined) return null;
  return (
    <Box component="span" sx={(theme) => ({ ml: "auto", fontSize: 10, color: theme.palette.nebula.muted })}>
      {children}
    </Box>
  );
}

/** The hairline between groups of rows. */
function Rule() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({ height: "1px", mx: "6px", my: "4px", background: theme.palette.nebula.line })}
    />
  );
}
