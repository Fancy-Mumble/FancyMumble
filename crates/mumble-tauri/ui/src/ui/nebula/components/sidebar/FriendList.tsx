import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Tooltip, Typography } from "@mui/material";
import { TID } from "@core/testids";
import { base64ToBytes, type Friend } from "@core/friendsStorage";
import { bytesToAvatarUrl, revokeDisplayUrl } from "@core/utils/imageBlobs";
import { UserXIcon } from "@ui/icons";
import type { FriendEntry, FriendGroup } from "../../friends";
import { SectionLabel, Stack, UserAvatar } from "../primitives";
import { radius } from "../../tokens";

interface FriendListProps {
  groups: readonly FriendGroup[];
  /** Which row is the conversation currently open, by friend id. */
  activeId: string | null;
  onOpen: (entry: FriendEntry) => void;
  onRemove: (entry: FriendEntry) => void;
  /** Right-click a friend who is online here: the same menu every other row of
   *  a person opens. Absent for anyone we cannot see, who has no live entry for
   *  the menu to act on. */
  onContextMenu?: (session: number, event: React.MouseEvent) => void;
  onHover?: (session: number, event: React.MouseEvent) => void;
  onLeave?: () => void;
  /** Shown instead of the list when there is nothing in it. */
  empty: string;
}

/**
 * The Friends column: the people you keep, grouped by the server you keep them
 * on.
 *
 * The grouping is the point rather than decoration. A friend is saved with the
 * server they were met on, and only friends on a server that is *open* can be
 * reached by clicking; the rest are an offer to reconnect. Drawing them under
 * their server, with the one you are on first, is what makes that legible
 * instead of a flat list where half the rows quietly do something different.
 *
 * A row is clickable whenever *something* can happen: they are here, or their
 * chat is a persisted room on a server that is open, or their server can be
 * connected to. Only an anonymous friend on a closed server is inert.
 */
export function FriendList({
  groups,
  activeId,
  onOpen,
  onRemove,
  onContextMenu,
  onHover,
  onLeave,
  empty,
}: Readonly<FriendListProps>) {
  return (
    <Stack
      sx={{
        flex: 1,
        overflowY: "auto",
        p: "4px 8px",
        gap: "2px",
        minHeight: 0,
      }}
    >
      {groups.length === 0 && (
        <Typography sx={(theme) => ({ p: "18px 12px", fontSize: 12, color: theme.palette.nebula.dim })}>
          {empty}
        </Typography>
      )}
      {groups.map((group) => (
        <Box key={group.key} component="section">
          <Stack direction="row" alignItems="center" gap={1} sx={{ px: "12px", pt: "10px", pb: "2px" }}>
            <SectionLabel
              sx={(theme) => ({ fontSize: 10, lineHeight: 1.6, color: theme.palette.nebula.dim })}
            >
              {group.label}
            </SectionLabel>
            <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
              {group.entries.length}
            </Typography>
          </Stack>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {group.entries.map((entry) => (
              <FriendRow
                key={entry.friend.id}
                entry={entry}
                active={entry.friend.id === activeId}
                onOpen={onOpen}
                onRemove={onRemove}
                onContextMenu={onContextMenu}
                onHover={onHover}
                onLeave={onLeave}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

/** What the row says about a friend under their name, as a `nebulaSidebar`
 *  key.  The literal union is what lets `t()` still check it at the call site. */
function statusLineKey(
  entry: FriendEntry,
):
  | "friends.notepad"
  | "friends.online"
  | "friends.offline"
  | "friends.serverNotConnected"
  | "friends.unreachable" {
  if (entry.self) return "friends.notepad";
  if (entry.match !== null) return "friends.online";
  if (entry.canOpen) return "friends.offline";
  if (entry.canConnect) return "friends.serverNotConnected";
  return "friends.unreachable";
}

interface FriendRowProps {
  entry: FriendEntry;
  active: boolean;
  onOpen: (entry: FriendEntry) => void;
  onRemove: (entry: FriendEntry) => void;
  onContextMenu?: (session: number, event: React.MouseEvent) => void;
  onHover?: (session: number, event: React.MouseEvent) => void;
  onLeave?: () => void;
}

function FriendRow({
  entry,
  active,
  onOpen,
  onRemove,
  onContextMenu,
  onHover,
  onLeave,
}: Readonly<FriendRowProps>) {
  const { t } = useTranslation("nebulaSidebar");
  const cached = useCachedAvatar(entry.friend);
  const online = entry.self || entry.match !== null;
  // Only a friend on the server in front of the user has a live entry, and so
  // only they can be hovered for a card, right-clicked for the menu, or drawn
  // with a freshly-fetched picture.
  const live = entry.live;
  const session = live?.session ?? null;
  const interactive = entry.self || entry.canOpen || entry.canConnect;

  return (
    <Stack
      component="li"
      direction="row"
      alignItems="center"
      gap={1.5}
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-disabled={!interactive}
      data-testid={TID.friendRow}
      data-friend-name={entry.friend.userName}
      data-online={online}
      onClick={interactive ? () => onOpen(entry) : undefined}
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(entry);
        }
      }}
      onMouseEnter={session !== null ? (event) => onHover?.(session, event) : undefined}
      onMouseLeave={session !== null ? onLeave : undefined}
      onContextMenu={session !== null && onContextMenu ? (event) => onContextMenu(session, event) : undefined}
      sx={(theme) => ({
        px: "12px",
        py: "9px",
        borderRadius: radius("lg"),
        cursor: interactive ? "pointer" : "default",
        opacity: interactive ? 1 : 0.55,
        background: active ? theme.palette.nebula.card : "transparent",
        border: `1px solid ${active ? theme.palette.nebula.line : "transparent"}`,
        "&:hover": {
          background: active ? theme.palette.nebula.card : theme.palette.nebula.hover,
        },
        "&:hover .friend-remove": { opacity: 1 },
      })}
    >
      {/* `src` is what chooses the avatar source: passing it at all turns off
          the lazy fetch, which can only reach a session on the active
          connection. A friend anywhere else wears the copy cached when they
          were last seen. */}
      {live ? (
        <UserAvatar
          name={live.name}
          session={live.session}
          textureSize={live.texture_size}
          size={32}
          status="online"
        />
      ) : (
        <UserAvatar
          name={entry.friend.userName}
          src={cached}
          size={32}
          status={online ? "online" : "offline"}
        />
      )}

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: entry.unread > 0 ? 600 : 500, fontSize: 12.5 }} noWrap>
          {entry.friend.userName}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })} noWrap>
          {t(statusLineKey(entry))}
        </Typography>
      </Box>

      {entry.unread > 0 && (
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
          {entry.unread}
        </Box>
      )}

      {/* You cannot unfriend yourself, so the notepad row has no button. */}
      {!entry.self && (
        <Tooltip title={`Remove ${entry.friend.userName}`} placement="left">
          <Box
            component="button"
            type="button"
            className="friend-remove"
            aria-label={`Remove ${entry.friend.userName}`}
            onClick={(event: React.MouseEvent) => {
              event.stopPropagation();
              onRemove(entry);
            }}
            sx={(theme) => ({
              all: "unset",
              display: "flex",
              flex: "none",
              cursor: "pointer",
              opacity: 0,
              color: theme.palette.nebula.dim,
              transition: "opacity 120ms ease",
              "&:hover": { color: theme.palette.nebula.bad },
              "&:focus-visible": { opacity: 1 },
            })}
          >
            <UserXIcon width={14} height={14} />
          </Box>
        </Tooltip>
      )}
    </Stack>
  );
}

/**
 * The avatar saved with a friend, as an object URL.
 *
 * Friends cache their picture so an offline row is not a blank circle, and it
 * is stored as base64 because that is what a JSON store can hold. Handing that
 * straight to an `<img>` would put the whole image in the DOM attribute; a blob
 * URL is a handle to bytes the browser keeps once, so the row costs the same
 * whether the friend's avatar is 4 KB or 4 MB.
 */
function useCachedAvatar(friend: Friend): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const avatar = friend.avatar;

  useEffect(() => {
    if (!avatar) {
      setUrl(null);
      return;
    }
    let live = true;
    let created: string | null = null;
    void bytesToAvatarUrl(base64ToBytes(avatar))
      .then((next) => {
        created = next;
        if (live) setUrl(next || null);
      })
      .catch(() => {
        if (live) setUrl(null);
      });
    return () => {
      live = false;
      revokeDisplayUrl(created);
    };
  }, [avatar]);

  return url;
}
