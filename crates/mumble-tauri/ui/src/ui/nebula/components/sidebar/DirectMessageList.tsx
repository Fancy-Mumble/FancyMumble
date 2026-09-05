import { Box, Typography } from "@mui/material";
import type { UserEntry } from "@core/types";
import { formatTime } from "../../selectors";
import { UserAvatar, Stack } from "../primitives";
import { radius } from "../../tokens";

/**
 * One row of the Messages list.
 *
 * Declared here rather than in the selectors: the selector that used to build
 * these went with the Nebula redesign, and nothing feeds this list today.
 */
interface DirectConversation {
  user: UserEntry;
  /** Rendered preview of the most recent message, or null when there is none. */
  preview: string | null;
  timestamp: number | null;
  unread: number;
}

interface DirectMessageListProps {
  conversations: readonly DirectConversation[];
  selectedSession: number | null;
  onSelect: (session: number) => void;
  onHover?: (session: number, event: React.MouseEvent) => void;
  onLeave?: () => void;
  /** Right-click on a conversation's row - the same actions as the person's row anywhere else. */
  onContextMenu?: (user: UserEntry, event: React.MouseEvent) => void;
}

/** The Messages column: one row per person, unread threads first. */
export function DirectMessageList({
  conversations,
  selectedSession,
  onSelect,
  onHover,
  onLeave,
  onContextMenu,
}: Readonly<DirectMessageListProps>) {
  return (
    <Box
      component="ul"
      sx={{
        flex: 1,
        overflowY: "auto",
        listStyle: "none",
        m: 0,
        p: "4px 8px",
        display: "flex",
        flexDirection: "column",
        gap: "1px",
        minHeight: 0,
      }}
    >
      {conversations.map(({ user, preview, timestamp, unread }) => {
        const active = user.session === selectedSession;
        return (
          <Stack
            component="li"
            key={user.session}
            direction="row"
            alignItems="center"
            gap={1.5}
            onClick={() => onSelect(user.session)}
            onMouseEnter={(event) => onHover?.(user.session, event)}
            onMouseLeave={onLeave}
            onContextMenu={onContextMenu ? (event) => onContextMenu(user, event) : undefined}
            sx={(theme) => ({
              px: "12px",
              py: "11px",
              borderRadius: radius("lg"),
              cursor: "pointer",
              background: active ? theme.palette.nebula.card : "transparent",
              border: `1px solid ${active ? theme.palette.nebula.line : "transparent"}`,
              "&:hover": { background: active ? theme.palette.nebula.card : theme.palette.nebula.hover },
            })}
          >
            <UserAvatar
              name={user.name}
              session={user.session}
              textureSize={user.texture_size}
              size={32}
              status={user.session < 0 ? "offline" : "online"}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: unread ? 600 : 500, fontSize: 12.5 }} noWrap>
                {user.name}
              </Typography>
              <Typography
                sx={(theme) => ({
                  fontSize: 11,
                  color: unread ? theme.palette.nebula.muted : theme.palette.nebula.dim,
                })}
                noWrap
              >
                {preview ?? (user.session < 0 ? "Offline" : "No messages yet")}
              </Typography>
            </Box>
            {unread > 0 ? (
              <Box
                component="span"
                sx={(theme) => ({
                  px: "7px",
                  py: "1px",
                  borderRadius: radius("md"),
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#fff",
                  background: theme.palette.nebula.accent,
                })}
              >
                {unread}
              </Box>
            ) : (
              timestamp && (
                <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
                  {formatTime(timestamp)}
                </Typography>
              )
            )}
          </Stack>
        );
      })}
    </Box>
  );
}
