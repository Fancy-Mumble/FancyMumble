import { useState } from "react";
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import {
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
import { UserAvatar, Stack } from "../primitives";

interface ChatHeaderProps {
  title: string;
  subtitle: string;
  /** Set for a direct message, so the header shows a face instead of a hash. */
  partner?: { name: string; session: number; textureSize: number | null };
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
 * The 66px conversation header. Everything past search lives behind the kebab,
 * as in the mock - the header stays two glyphs wide however many surfaces the
 * channel actually has.
 */
export function ChatHeader({
  title,
  subtitle,
  partner,
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
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14 }} noWrap>
          {title}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
          {subtitle}
        </Typography>
      </Box>

      <Stack direction="row" gap={0.375} sx={{ ml: "auto" }}>
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
