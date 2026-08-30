import { useState } from "react";
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import type { KeyTrustLevel } from "@core/types";
import {
  ChevronDownIcon,
  DownloadIcon,
  HashIcon,
  InfoIcon,
  KebabMenuIcon,
  MonitorIcon,
  PinIcon,
  SearchIcon,
  UsersGroupIcon,
  VolumeIcon,
} from "@ui/icons";
import { glassChrome } from "../../theme";
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
  onShowInfo: () => void;
  onShowDownloads: () => void;
}

/**
 * The 66px conversation header.
 *
 * It says three things about the channel and offers three actions. The facts -
 * who is here, whether the history is kept, whether it is encrypted and
 * trusted - sit beside the name, because they qualify the room rather than the
 * conversation. Everything past the roster and search lives behind the kebab,
 * so the header stays the same width however many surfaces a channel has.
 *
 * The name itself is the fourth control: clicking it opens the same menu the
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
  onShowInfo,
  onShowDownloads,
}: Readonly<ChatHeaderProps>) {
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
        height: 66,
        flex: "none",
        px: "26px",
        borderBottom: `1px solid ${theme.palette.nebula.line}`,
        ...glassChrome(theme),
      })}
    >
      {partner ? (
        <UserAvatar
          name={partner.name}
          session={partner.session}
          textureSize={partner.textureSize}
          size={28}
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
          <Typography sx={{ fontWeight: 600, fontSize: 14 }} noWrap>
            {title}
          </Typography>
          {named && (
            <Box sx={(theme) => ({ display: "flex", color: theme.palette.nebula.dim })}>
              <ChevronDownIcon width={13} height={13} aria-hidden="true" />
            </Box>
          )}
        </Stack>
        <Typography
          sx={(theme) => ({
            fontSize: 11,
            color: theme.palette.nebula.muted,
            textAlign: "left",
          })}
          noWrap
        >
          {subtitle}
        </Typography>
      </Box>

      <Stack direction="row" alignItems="center" gap={0.75} sx={{ flex: "none" }}>
        <KeyTrustBadge encrypted={encrypted} level={trustLevel} onVerify={onVerifyKey} />
        {persisted && <HistoryBadge />}
      </Stack>

      <Stack direction="row" alignItems="center" gap={0.375} sx={{ ml: "auto" }}>
        {memberCount !== undefined && (
          <Tooltip title="Members">
            <IconButton
              aria-label={`Members (${memberCount})`}
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
          <Tooltip title="Join voice">
            <IconButton aria-label="Join voice" onClick={onJoinVoice}>
              <VolumeIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Search messages">
          <IconButton aria-label="Search messages" onClick={onToggleSearch}>
            <SearchIcon width={14} height={14} />
          </IconButton>
        </Tooltip>
        <Tooltip title="More">
          <IconButton
            aria-label="Channel menu"
            onClick={(event) => setMenuAnchor(event.currentTarget)}
            sx={(theme) => (menuAnchor ? { background: theme.palette.nebula.hover } : {})}
          >
            <KebabMenuIcon width={14} height={14} />
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
        <MenuItem onClick={run(onShowMembers)}>
          <UsersGroupIcon width={13} height={13} />
          Members
        </MenuItem>
        <MenuItem onClick={run(onShareScreen)}>
          <MonitorIcon width={13} height={13} />
          Share screen
        </MenuItem>
        <MenuItem onClick={run(onShowPinned)}>
          <PinIcon width={13} height={13} />
          Pinned messages
        </MenuItem>
        <MenuItem onClick={run(onShowInfo)}>
          <InfoIcon width={13} height={13} />
          Server info
        </MenuItem>
        <MenuItem onClick={run(onShowDownloads)}>
          <DownloadIcon width={13} height={13} />
          Downloads
        </MenuItem>
      </Menu>
    </Stack>
  );
}
