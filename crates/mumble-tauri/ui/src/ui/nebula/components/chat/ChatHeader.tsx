import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { KeyTrustLevel } from "@core/types";
import { TID } from "@core/testids";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  DownloadIcon,
  FileTextIcon,
  HashIcon,
  InfoIcon,
  KebabMenuIcon,
  MonitorIcon,
  PinIcon,
  PopoutIcon,
  RadioIcon,
  SearchIcon,
  UploadIcon,
  UsersGroupIcon,
  VolumeIcon,
} from "@ui/icons";
import { chamferedSurface, cornerControlsClearance, glassChrome, handheldChrome } from "../../theme";
import { radius } from "../../tokens";
import { UserAvatar, Stack } from "../primitives";
import { HistoryBadge, KeyTrustBadge } from "./KeyTrustBadge";

interface ChatHeaderProps {
  title: string;
  subtitle: string;
  /** Set for a direct message, so the header shows a face instead of a hash. */
  partner?: { name: string; session: number; textureSize: number | null };
  /** Everyone the open channel counts as a member; absent for a direct message
   *  and for the empty state, neither of which has a roster to open. */
  memberCount?: number;
  /** Whether the channel keeps its history on the server. */
  persisted?: boolean;
  /** Whether the channel's messages are end-to-end encrypted. */
  encrypted?: boolean;
  /** Trust in the channel's key, once there is one to judge. */
  trustLevel?: KeyTrustLevel;
  onVerifyKey?: () => void;
  canJoinVoice: boolean;
  onJoinVoice: () => void;
  onToggleSearch: () => void;
  onShowMembers: () => void;
  onShareScreen: () => void;
  onShowPinned: () => void;
  /** Whether the pinned panel is the one currently hanging from the header. */
  pinnedOpen?: boolean;
  onShowInfo: () => void;
  onShowDownloads: () => void;
  /** Describe the open channel. Absent for a direct message, which is not one. */
  onShowChannelInfo?: () => void;
  /** Something has been pinned since the panel was last opened. */
  hasNewPins?: boolean;
  /** A download has finished since the panel was last opened. */
  hasNewDownloads?: boolean;
  /** Open this channel's document library. Absent where the server has no
   *  live-doc plugin loaded, which is what hides the entry. */
  onShowDocs?: () => void;
  /** Send this conversation to its own window. Absent outside a direct
   *  message, and inside a popout, which has nothing left to pop out. */
  onPopOutDm?: () => void;
  /** List what you have uploaded to this server's file store. Absent where
   *  the server runs no file server, which is what hides the entry. */
  onShowMyFiles?: () => void;
  /** Show what the applications on this machine are publishing. Absent while
   *  rich presence is switched off, so the entry appears with the feature. */
  onShowPresence?: () => void;
  /**
   * Where the conversation came from, when it is the only thing on screen.
   *
   * A window shows the channel column beside the conversation, so there is
   * nothing to go back to and no button. A phone shows one at a time.
   */
  onBack?: () => void;
  /**
   * Laid out for a phone: the skin's own header height clamped, the window's
   * 26px inset dropped to 14, and everything but joining voice folded into the
   * menu. Five buttons, a title and a back arrow do not fit across 390px, and
   * a header that wraps is not a header.
   */
  dense?: boolean;
}

/**
 * The 66px conversation header.
 *
 * It says three things about the channel and offers four actions. The facts -
 * who is here, whether the history is kept, whether it is encrypted and
 * trusted - sit beside the name, because they qualify the room rather than the
 * conversation. Everything past the roster, search and the pins lives behind
 * the kebab, so the header stays the same width however many surfaces a
 * channel has.
 *
 * Pins earned their own button rather than a menu entry: they are the one
 * surface here that fills up on its own, and a thing that announces itself has
 * to be reachable without first opening the menu that was announcing it.
 *
 * The name itself is the fifth control: clicking it opens the same menu the
 * kebab does, which is what the chevron beside it promises.
 */
export function ChatHeader({
  title,
  subtitle,
  partner,
  memberCount,
  persisted = false,
  encrypted = false,
  trustLevel,
  onVerifyKey,
  canJoinVoice,
  onJoinVoice,
  onToggleSearch,
  onShowMembers,
  onShareScreen,
  onShowPinned,
  pinnedOpen = false,
  onShowInfo,
  onShowDownloads,
  onShowChannelInfo,
  hasNewPins = false,
  hasNewDownloads = false,
  onShowDocs,
  onPopOutDm,
  onShowMyFiles,
  onShowPresence,
  onBack,
  dense = false,
}: Readonly<ChatHeaderProps>) {
  const { t } = useTranslation(["nebulaChat", "nebulaCommon", "common", "chat", "server"]);
  const stencil = useTheme().palette.nebulaSkin.chrome === "stencil";
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = () => setMenuAnchor(null);
  const run = (action: () => void) => () => {
    closeMenu();
    action();
  };

  // A direct message has no channel menu behind the name, and neither does the
  // empty state - a chevron on either would open onto channel actions that
  // have nothing to act on.
  const named = !partner && memberCount !== undefined;

  return (
    <Stack
      component="header"
      direction="row"
      alignItems="center"
      gap={1.5}
      sx={(theme) => ({
        height: dense ? handheldChrome(theme).headerHeight : theme.palette.nebulaSkin.headerHeight,
        flex: "none",
        px: dense ? "14px" : "26px",
        // The bar is chrome, not the conversation: dragging across the name to
        // aim at its menu, or across the row to reach a button, would otherwise
        // leave the room's name sitting there highlighted.
        userSelect: "none",
        // Centred in the header, this row's buttons run into the underside of
        // the floating window controls; the padding drops it clear of them.
        // A phone draws no such controls, and the sheet above owns that edge.
        ...(dense ? {} : cornerControlsClearance(theme)),
        borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
        ...glassChrome(theme),
      })}
    >
      {onBack && (
        <IconButton
          aria-label={t("nebulaCommon:app.back")}
          onClick={onBack}
          sx={{ flex: "none", ml: "-6px" }}
        >
          <ChevronLeftIcon width={18} height={18} />
        </IconButton>
      )}
      {partner ? (
        <UserAvatar
          name={partner.name}
          session={partner.session}
          textureSize={partner.textureSize}
          size={28}
        />
      ) : stencil ? (
        <Box
          aria-hidden
          sx={(theme) => ({
            flex: "none",
            width: 8,
            height: 34,
            transform: "skewX(-12deg)",
            background: theme.palette.nebula.accent,
          })}
        />
      ) : (
        <Box sx={(theme) => ({ display: "flex", color: theme.palette.nebula.dim })}>
          <HashIcon width={15} height={15} />
        </Box>
      )}
      <Box
        {...(named
          ? {
              component: "button",
              type: "button",
              "aria-haspopup": "menu" as const,
              onClick: (event: React.MouseEvent<HTMLElement>) => setMenuAnchor(event.currentTarget),
            }
          : {})}
        sx={(theme) => ({
          ...(named
            ? {
                // `all: unset` strips the button chrome; what the name needs
                // back is the block box its two lines were laid out in.
                all: "unset",
                display: "block",
                cursor: "pointer",
                px: "6px",
                mx: "-6px",
                borderRadius: radius("md"),
                "&:hover": { background: theme.palette.nebula.hover },
              }
            : {}),
          minWidth: 0,
        })}
      >
        <Stack direction="row" alignItems="center" gap={0.5}>
          <Typography data-testid={TID.chatHeaderTitle} sx={{ fontWeight: 600, fontSize: 14 }} noWrap>
            {title}
          </Typography>
          {named && (
            <Box sx={(theme) => ({ display: "flex", color: theme.palette.nebula.dim })}>
              <ChevronDownIcon width={13} height={13} aria-hidden="true" />
            </Box>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.75} sx={{ minWidth: 0 }}>
          {stencil && (
            <Box
              aria-hidden
              sx={(theme) => ({
                flex: "none",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: theme.palette.nebula.ok,
              })}
            />
          )}
          <Typography
            sx={(theme) => ({
              fontSize: 11,
              color: theme.palette.nebula.muted,
              textAlign: "left",
              ...(stencil
                ? {
                    fontStyle: "italic",
                    fontWeight: 700,
                    fontSize: 10,
                    letterSpacing: ".18em",
                    textTransform: "uppercase",
                  }
                : {}),
            })}
            noWrap
          >
            {subtitle}
          </Typography>
        </Stack>
      </Box>

      <Stack direction="row" alignItems="center" gap={0.75} sx={{ flex: "none" }}>
        <KeyTrustBadge encrypted={encrypted} level={trustLevel} onVerify={onVerifyKey} />
        {persisted && <HistoryBadge />}
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        gap={stencil ? 0 : 0.375}
        sx={(theme) => ({
          ml: "auto",
          // Said once over the row rather than on each button: a stencil skin
          // stands every header action on its own bordered plate.
          ...(stencil
            ? {
                // Kerned the way slanted type is: the plates' boxes overlap by
                // 6 of the 10px their leading edge leans, so the drawn shapes
                // never actually meet - what is left between two parallel
                // leaning edges is a 4px slit of window, cut on the same
                // angle. `gap` cannot go negative, hence the margin.
                "& > * + *": { marginLeft: "-6px" },
                // The artboard fills exactly one of these - the roster count -
                // and leaves the rest white.
                "& .MuiIconButton-root[data-accent]": {
                  color: theme.palette.nebula.accent,
                  "&::before": { background: theme.palette.nebula.card2 },
                },
                "& .MuiIconButton-root": {
                  borderRadius: 0,
                  height: 38,
                  minWidth: 38,
                  color: theme.palette.nebula.dim,
                  // An opaque ground, not `accentSoft`: that token is the
                  // accent at 20%, and a chamfered surface paints the fill
                  // over the *edge* colour, so anything translucent comes out
                  // as a wash of the edge instead of the pale plate drawn.
                  ...chamferedSurface(
                    theme,
                    theme.palette.nebula.card,
                    theme.palette.nebula.tile,
                    "var(--nebula-clip-plate, none)",
                  ),
                },
              }
            : {}),
        })}
      >
        {memberCount !== undefined && !dense && (
          <Tooltip title={t("nebulaChat:header.members")}>
            <IconButton
              data-accent={stencil ? "" : undefined}
              aria-label={t("nebulaChat:header.membersCount", { count: memberCount })}
              onClick={onShowMembers}
              sx={{ gap: "6px", px: "9px" }}
            >
              <UsersGroupIcon width={14} height={14} />
              <Box component="span" sx={{ fontSize: 11.5, fontWeight: 600 }}>
                {memberCount}
              </Box>
            </IconButton>
          </Tooltip>
        )}
        {canJoinVoice && (
          <Tooltip title={t("nebulaChat:header.joinVoice")}>
            <IconButton aria-label={t("nebulaChat:header.joinVoice")} onClick={onJoinVoice}>
              <VolumeIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        )}
        {!dense && (
          <Tooltip title={t("nebulaChat:header.searchMessages")}>
            <IconButton aria-label={t("nebulaChat:header.searchMessages")} onClick={onToggleSearch}>
              <SearchIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        )}
        {!dense && (
          <Tooltip title={t("chat:header.pinnedMessages")}>
            <IconButton
              aria-label={hasNewPins ? t("nebulaChat:header.pinnedNew") : t("chat:header.pinnedMessages")}
              aria-expanded={pinnedOpen}
              onClick={onShowPinned}
              sx={(theme) => ({
                position: "relative",
                // Lit while its panel is hanging from it, so the popover reads as
                // this button's own rather than as a card that appeared.
                ...(pinnedOpen
                  ? {
                      background: theme.palette.nebula.accentSoft,
                      color: theme.palette.nebula.text,
                      boxShadow: `inset 0 0 0 1px ${theme.palette.nebula.accentLine}`,
                      "&:hover": { background: theme.palette.nebula.accentSoft },
                    }
                  : {}),
              })}
            >
              <PinIcon width={14} height={14} />
              {hasNewPins && <NewDot label={t("nebulaChat:header.new")} corner />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t("common:actions.more")}>
          <IconButton
            data-testid={TID.chatHeaderKebab}
            aria-label={
              hasNewDownloads ? t("nebulaChat:header.channelMenuNew") : t("nebulaChat:header.channelMenu")
            }
            onClick={(event) => setMenuAnchor(event.currentTarget)}
            sx={(theme) => ({
              position: "relative",
              ...(menuAnchor ? { background: theme.palette.nebula.hover } : {}),
            })}
          >
            <KebabMenuIcon width={14} height={14} />
            {/* The kebab carries what its menu is hiding - downloads only, now
                that pins have a button of their own. The panel is a click
                further in, so without this the only way to learn a download
                landed is to go and look. */}
            {hasNewDownloads && <NewDot label={t("nebulaChat:header.new")} corner />}
          </IconButton>
        </Tooltip>
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {/* What the dense row folded away. A phone has no room for five
            buttons beside a title, and a button that is merely absent is a
            feature the reader has lost. */}
        {dense && (
          <MenuItem onClick={run(onToggleSearch)}>
            <SearchIcon width={13} height={13} />
            {t("nebulaChat:header.searchMessages")}
          </MenuItem>
        )}
        {dense && (
          <MenuItem onClick={run(onShowPinned)}>
            <PinIcon width={13} height={13} />
            {t("chat:header.pinnedMessages")}
            {hasNewPins && <NewDot label={t("nebulaChat:header.new")} />}
          </MenuItem>
        )}
        <MenuItem onClick={run(onShowMembers)}>
          <UsersGroupIcon width={13} height={13} />
          {t("nebulaChat:header.members")}
          {dense && memberCount !== undefined ? ` (${memberCount})` : ""}
        </MenuItem>
        <MenuItem onClick={run(onShareScreen)}>
          <MonitorIcon width={13} height={13} />
          {t("chat:header.shareScreen")}
        </MenuItem>
        {onShowChannelInfo && (
          <MenuItem onClick={run(onShowChannelInfo)}>
            <HashIcon width={13} height={13} />
            {t("chat:header.channelInfo")}
          </MenuItem>
        )}
        <MenuItem onClick={run(onShowInfo)}>
          <InfoIcon width={13} height={13} />
          {t("server:infoPanel.heading")}
        </MenuItem>
        <MenuItem onClick={run(onShowDownloads)}>
          <DownloadIcon width={13} height={13} />
          {t("chat:header.downloads")}
          {hasNewDownloads && <NewDot label={t("nebulaChat:header.new")} />}
        </MenuItem>
        {/* Beside Downloads, because the pair is "what I took off this server"
            and "what I put on it", and only one of them was reachable. */}
        {onShowMyFiles && (
          <MenuItem onClick={run(onShowMyFiles)}>
            <UploadIcon width={13} height={13} />
            {t("chat:mySharedFiles.title")}
          </MenuItem>
        )}
        {onShowPresence && (
          <MenuItem onClick={run(onShowPresence)}>
            <RadioIcon width={13} height={13} />
            {t("chat:richPresence.title")}
          </MenuItem>
        )}
        {onShowDocs && (
          <MenuItem onClick={run(onShowDocs)}>
            <FileTextIcon width={13} height={13} />
            {t("nebulaChat:header.documents")}
          </MenuItem>
        )}
        {onPopOutDm && (
          <MenuItem onClick={run(onPopOutDm)}>
            <PopoutIcon width={13} height={13} />
            {t("chat:header.popOutDm")}
          </MenuItem>
        )}
      </Menu>
    </Stack>
  );
}

/**
 * The mark on a control whose panel has something in it you have not seen.
 *
 * On a menu entry it is held to the row's right edge rather than set beside
 * its icon, so a row that has one and a row that does not still read as the
 * same column of labels; `corner` puts the same dot on a header button's
 * top-right instead. One dot for both, because they mean the same thing and a
 * second one drawn by hand is how two badges end up different sizes.
 *
 * The word is on the dot rather than in the label because the label is the
 * panel's name, and "Downloads (new)" would make it a different one.
 */
function NewDot({ label, corner = false }: Readonly<{ label: string; corner?: boolean }>) {
  return (
    <Box
      component="span"
      role="img"
      aria-label={label}
      sx={(theme) => ({
        width: 6,
        height: 6,
        flex: "none",
        borderRadius: "50%",
        background: theme.palette.nebula.accent,
        ...(corner ? { position: "absolute", top: 5, right: 5 } : { ml: "auto" }),
      })}
    />
  );
}
