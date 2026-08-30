import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  Menu,
  MenuItem,
  Slider,
  Snackbar,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import type { ChannelEntry, UserEntry } from "@core/types";
import {
  addFriend,
  getFriends,
  removeFriend,
  FRIENDS_CHANGED_EVENT,
  type Friend,
} from "@core/friendsStorage";
import {
  BlockIcon,
  HashIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  ImageIcon,
  InfoIcon,
  MessageCircleIcon,
  MessageMinusIcon,
  MicIcon,
  MicOffIcon,
  StarIcon,
  TrashIcon,
  UserPlusIcon,
  UserXIcon,
  VolumeIcon,
} from "@ui/icons";
import { canDeleteMessages } from "@standard/components/sidebar/channel/ChannelEditorDialog";
import { userMenuActions } from "../../selectors";
import { SearchBox, Stack } from "../primitives";
import { radius } from "../../tokens";

/** The person a right-click landed on, and where it landed. */
export interface UserMenuTarget {
  user: UserEntry;
  x: number;
  y: number;
}

interface UserMenuProps {
  /** The row that was right-clicked, or null when the menu is closed. */
  target: UserMenuTarget | null;
  onClose: () => void;
  /** Open the conversation with this person; the menu omits "Message" without it. */
  onMessage?: (session: number) => void;
  /** Open the User Information sheet; omitted from the menu without it. */
  onInfo?: (session: number) => void;
}

/**
 * Right-click actions on a person, wherever Nebula draws one.
 *
 * There is one of these for the whole client, mounted by the shell, and every
 * surface that lists people - the channel tree, the roster, the message
 * authors, the DM column, the dock, mini mode - opens this same menu. A row
 * that shows a name gets the same actions as any other row showing that name,
 * so there is nothing to drift.
 *
 * The menu is in two halves. Above the rule is what *you* can do about someone
 * without the server's say-so: how loud they are here, whether you keep them,
 * where they are. Below it is moderation, which is offered only where the
 * server has actually granted it - see `userMenuActions`. Somebody with no
 * permissions never sees the second half at all, rather than meeting a row of
 * greyed-out verbs.
 *
 * The confirmations and the move picker outlive the menu itself: they hold
 * their own copy of the target so dismissing the menu to show a dialog does
 * not take the dialog's subject with it.
 */
export function UserMenu({ target, onClose, onMessage, onInfo }: Readonly<UserMenuProps>) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  return (
    <>
      {target && (
        <UserMenuSurface
          target={target}
          onClose={onClose}
          onMessage={onMessage}
          onInfo={onInfo}
          onConfirm={setPending}
          onNote={setNote}
        />
      )}

      {pending?.kind === "move" && (
        <MoveUserDialog
          user={pending.user}
          onClose={() => setPending(null)}
          onDone={(note) => {
            setPending(null);
            setNote(note);
          }}
        />
      )}

      {pending && pending.kind !== "move" && (
        <ConfirmDialog
          {...CONFIRMATIONS[pending.kind](pending.user)}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const request = pending;
            setPending(null);
            void runConfirmed(request).then(setNote);
          }}
        />
      )}

      <Snackbar
        open={note !== null}
        autoHideDuration={4000}
        onClose={() => setNote(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {note ? (
          <Alert severity={note.severity} variant="filled" onClose={() => setNote(null)}>
            {note.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}

// -- The menu itself ------------------------------------------------

interface UserMenuSurfaceProps {
  target: UserMenuTarget;
  onClose: () => void;
  onMessage?: (session: number) => void;
  onInfo?: (session: number) => void;
  onConfirm: (pending: Pending) => void;
  onNote: (note: Note) => void;
}

function UserMenuSurface({
  target,
  onClose,
  onMessage,
  onInfo,
  onConfirm,
  onNote,
}: Readonly<UserMenuSurfaceProps>) {
  const { user } = target;
  const channels = useAppStore((state) => state.channels);
  const ownSession = useAppStore((state) => state.ownSession);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const selectedChannel = useAppStore((state) => state.selectedChannel);
  const storedVolume = useAppStore((state) => (user.hash ? (state.userVolumes[user.hash] ?? 100) : 100));

  const actions = useMemo(
    () => userMenuActions({ user, channels, ownSession, currentChannel }),
    [user, channels, ownSession, currentChannel],
  );
  const friend = useFriendEntry(user, actions.isSelf);
  const [volume, setVolume] = useState(storedVolume);

  // Deleting somebody's messages is scoped to the conversation on screen, so
  // it is offered only where that channel keeps history and grants the right.
  const showDeleteMessages =
    !actions.isSelf &&
    !!user.hash &&
    canDeleteMessages(channels.find((channel) => channel.id === selectedChannel));

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const moderate = (action: ModerationAction) => () => {
    void invokeModeration(action, user).catch((error: unknown) =>
      console.error(`user action "${action}" failed:`, error),
    );
    onClose();
  };

  const applyVolume = (next: number) => {
    setVolume(next);
    if (user.hash) useAppStore.getState().setUserVolume(user.hash, next);
    void invoke("set_user_volume", { session: user.session, volume: next / 100 }).catch((error: unknown) =>
      console.error("set_user_volume failed:", error),
    );
  };

  const toggleFriend = async () => {
    try {
      onNote(await writeFriend(user, friend));
      onClose();
    } catch (error) {
      console.error("toggle friend failed:", error);
      onNote({ severity: "error", message: "Could not update your friends list." });
    }
  };

  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: target.y, left: target.x }}
      slotProps={{ list: { sx: { minWidth: 208 } } }}
    >
      {/* Everything you can do about someone on your own. */}
      {actions.isSelf
        ? [
            <Typography
              key="self"
              sx={(theme) => ({ px: "14px", py: "8px", fontSize: 11.5, color: theme.palette.nebula.muted })}
            >
              That&rsquo;s you.
            </Typography>,
            onInfo ? (
              <MenuItem key="info" onClick={run(() => onInfo(user.session))}>
                <Glyph>
                  <InfoIcon width={13} height={13} />
                </Glyph>
                User information
              </MenuItem>
            ) : null,
          ]
        : [
            <Stack
              key="volume"
              direction="row"
              alignItems="center"
              gap={1.25}
              // The menu list treats arrow keys as "next item" and letters as
              // type-ahead, both of which the slider needs for itself.
              onKeyDown={(event: React.KeyboardEvent) => event.stopPropagation()}
              sx={{ px: "14px", py: "6px", minWidth: 208 }}
            >
              <Glyph>
                <VolumeIcon width={13} height={13} />
              </Glyph>
              <Slider
                size="small"
                min={0}
                max={200}
                value={volume}
                aria-label={`Volume for ${user.name}`}
                onChange={(_event, next) => setVolume(next as number)}
                onChangeCommitted={(_event, next) => applyVolume(next as number)}
                sx={{ flex: 1 }}
              />
              <Typography
                sx={(theme) => ({
                  fontSize: 10.5,
                  width: 34,
                  textAlign: "right",
                  color: theme.palette.nebula.dim,
                })}
              >
                {volume}%
              </Typography>
            </Stack>,

            onMessage ? (
              <MenuItem key="message" onClick={run(() => onMessage(user.session))}>
                <Glyph>
                  <MessageCircleIcon width={13} height={13} />
                </Glyph>
                Message
              </MenuItem>
            ) : null,

            onInfo ? (
              <MenuItem key="info" onClick={run(() => onInfo(user.session))}>
                <Glyph>
                  <InfoIcon width={13} height={13} />
                </Glyph>
                User information
              </MenuItem>
            ) : null,

            <MenuItem key="friend" data-testid={TID.userMenuFriendToggle} onClick={() => void toggleFriend()}>
              <Glyph>
                {friend ? <UserXIcon width={13} height={13} /> : <UserPlusIcon width={13} height={13} />}
              </Glyph>
              {friend ? "Remove friend" : "Add friend"}
            </MenuItem>,

            actions.canJoinChannel ? (
              <MenuItem
                key="join"
                onClick={run(() => void useAppStore.getState().joinChannel(user.channel_id))}
              >
                <Glyph>
                  <HashIcon width={13} height={13} />
                </Glyph>
                {`Join ${actions.userChannel?.name ?? "their channel"}`}
              </MenuItem>
            ) : null,
          ]}

      {/* And everything the server has granted you over them. */}
      {actions.hasModeration || showDeleteMessages
        ? [
            <Divider key="moderation-start" sx={DIVIDER} />,
            actions.canMuteDeafen ? (
              <MenuItem key="mute" onClick={moderate("mute")}>
                <Glyph>
                  {user.mute ? <MicIcon width={13} height={13} /> : <MicOffIcon width={13} height={13} />}
                </Glyph>
                {user.mute ? "Unmute on server" : "Mute on server"}
              </MenuItem>
            ) : null,
            actions.canMuteDeafen ? (
              <MenuItem key="deafen" onClick={moderate("deafen")}>
                <Glyph>
                  {user.deaf ? (
                    <HeadphonesIcon width={13} height={13} />
                  ) : (
                    <HeadphonesOffIcon width={13} height={13} />
                  )}
                </Glyph>
                {user.deaf ? "Undeafen on server" : "Deafen on server"}
              </MenuItem>
            ) : null,
            actions.canMuteDeafen ? (
              <MenuItem key="priority" onClick={moderate("priority")}>
                <Glyph>
                  <StarIcon width={13} height={13} />
                </Glyph>
                {user.priority_speaker ? "Remove priority speaker" : "Priority speaker"}
              </MenuItem>
            ) : null,
            actions.canMove ? (
              <MenuItem key="move" onClick={run(() => onConfirm({ kind: "move", user }))}>
                <Glyph>
                  <HashIcon width={13} height={13} />
                </Glyph>
                Move to channel…
              </MenuItem>
            ) : null,
            actions.canRegister ? (
              <MenuItem key="register" onClick={run(() => onConfirm({ kind: "register", user }))}>
                <Glyph>
                  <UserPlusIcon width={13} height={13} />
                </Glyph>
                Register on server…
              </MenuItem>
            ) : null,
            actions.canUnregister ? (
              <MenuItem
                key="unregister"
                sx={DANGER}
                onClick={run(() => onConfirm({ kind: "unregister", user }))}
              >
                <Glyph>
                  <UserXIcon width={13} height={13} />
                </Glyph>
                Deregister…
              </MenuItem>
            ) : null,

            actions.canResetContent ? <Divider key="content-start" sx={DIVIDER} /> : null,
            actions.canResetContent ? (
              <MenuItem key="reset-comment" onClick={moderate("reset_comment")}>
                <Glyph>
                  <MessageMinusIcon width={13} height={13} />
                </Glyph>
                Reset comment
              </MenuItem>
            ) : null,
            actions.canResetContent ? (
              <MenuItem key="remove-avatar" onClick={moderate("remove_avatar")}>
                <Glyph>
                  <ImageIcon width={13} height={13} />
                </Glyph>
                Remove avatar
              </MenuItem>
            ) : null,

            showDeleteMessages || actions.canKick || actions.canBan ? (
              <Divider key="eject-start" sx={DIVIDER} />
            ) : null,
            showDeleteMessages ? (
              <MenuItem
                key="delete-messages"
                sx={DANGER}
                onClick={run(() => onConfirm({ kind: "delete-messages", user, channelId: selectedChannel }))}
              >
                <Glyph>
                  <TrashIcon width={13} height={13} />
                </Glyph>
                Delete their messages…
              </MenuItem>
            ) : null,
            actions.canKick ? (
              <MenuItem key="kick" sx={DANGER} onClick={moderate("kick")}>
                <Glyph>
                  <UserXIcon width={13} height={13} />
                </Glyph>
                Kick
              </MenuItem>
            ) : null,
            actions.canBan ? (
              <MenuItem key="ban" sx={DANGER} onClick={moderate("ban")}>
                <Glyph>
                  <BlockIcon width={13} height={13} />
                </Glyph>
                Ban
              </MenuItem>
            ) : null,
          ]
        : null}
    </Menu>
  );
}

// -- Friends --------------------------------------------------------

/**
 * The saved friend matching this person, or null.
 *
 * Matched on certificate hash where there is one, and only otherwise on name
 * plus server - two people can share a name, and the hash is the only thing
 * that survives one of them renaming.
 */
function useFriendEntry(user: UserEntry, isSelf: boolean): Friend | null {
  const activeServerId = useAppStore((state) => state.activeServerId);
  const [friend, setFriend] = useState<Friend | null>(null);

  useEffect(() => {
    if (isSelf) {
      setFriend(null);
      return;
    }
    let active = true;
    const refresh = () =>
      getFriends()
        .then((friends) => {
          if (!active) return;
          setFriend(
            friends.find((entry) => user.hash && entry.userHash === user.hash) ??
              friends.find(
                (entry) =>
                  !entry.userHash &&
                  !user.hash &&
                  entry.userName === user.name &&
                  entry.serverId === activeServerId,
              ) ??
              null,
          );
        })
        .catch((error: unknown) => console.error("load friends failed:", error));

    void refresh();
    const onChanged = () => void refresh();
    globalThis.addEventListener(FRIENDS_CHANGED_EVENT, onChanged);
    return () => {
      active = false;
      globalThis.removeEventListener(FRIENDS_CHANGED_EVENT, onChanged);
    };
  }, [isSelf, user.hash, user.name, activeServerId]);

  return friend;
}

/** Add or drop the friend, capturing enough to reach them while they are offline. */
async function writeFriend(user: UserEntry, friend: Friend | null): Promise<Note> {
  if (friend) {
    await removeFriend(friend.id);
    return { severity: "info", message: `${user.name} is no longer a friend.` };
  }

  const { activeServerId, sessions } = useAppStore.getState();
  const session = sessions.find((entry) => entry.id === activeServerId);
  await addFriend({
    userName: user.name,
    userHash: user.hash,
    serverId: activeServerId ?? undefined,
    serverLabel: session?.label,
    // The registered id and the connection target are what let the friend
    // chat open, or the server be rejoined, when they are not online now.
    ...(user.user_id != null && user.user_id >= 0 ? { userId: user.user_id } : {}),
    ...(session
      ? {
          serverHost: session.host,
          serverPort: session.port,
          serverUsername: session.username,
          serverCertLabel: session.certLabel,
        }
      : {}),
  });
  return { severity: "success", message: `${user.name} added to your friends.` };
}

// -- Moderation -----------------------------------------------------

export type ModerationAction =
  "mute" | "deafen" | "priority" | "kick" | "ban" | "reset_comment" | "remove_avatar";

/** The backend command behind each immediate moderation action. */
export function invokeModeration(action: ModerationAction, user: UserEntry): Promise<unknown> {
  switch (action) {
    case "mute":
      return invoke("mute_user", { session: user.session, muted: !user.mute });
    case "deafen":
      return invoke("deafen_user", { session: user.session, deafened: !user.deaf });
    case "priority":
      return invoke("set_priority_speaker", {
        session: user.session,
        priority: !user.priority_speaker,
      });
    case "kick":
      return invoke("kick_user", { session: user.session, reason: null });
    case "ban":
      return invoke("ban_user", { session: user.session, reason: null });
    case "reset_comment":
      return invoke("reset_user_comment", { session: user.session });
    case "remove_avatar":
      return invoke("remove_user_avatar", { session: user.session });
  }
}

// -- Actions that ask first ------------------------------------------

type Pending =
  | { kind: "move"; user: UserEntry }
  | { kind: "register"; user: UserEntry }
  | { kind: "unregister"; user: UserEntry }
  | { kind: "delete-messages"; user: UserEntry; channelId: number | null };

export interface Note {
  severity: "success" | "error" | "info";
  message: string;
}

const CONFIRMATIONS: Record<
  Exclude<Pending["kind"], "move">,
  (user: UserEntry) => { title: string; body: string; confirmLabel: string; danger?: boolean }
> = {
  register: (user) => ({
    title: "Register this user?",
    body: `${user.name} will get a permanent account on this server, keeping their name and any groups they are put in.`,
    confirmLabel: "Register",
  }),
  unregister: (user) => ({
    title: "Deregister this user?",
    body: `${user.name}'s account and everything the server stores against it are deleted. This cannot be undone.`,
    confirmLabel: "Deregister",
    danger: true,
  }),
  "delete-messages": (user) => ({
    title: "Delete their messages?",
    body: `Every message ${user.name} has sent in this channel is removed for everyone. This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  }),
};

/** Carry out a confirmed action and say how it went. */
async function runConfirmed(pending: Exclude<Pending, { kind: "move" }>): Promise<Note> {
  const { user } = pending;
  switch (pending.kind) {
    case "register":
      try {
        await invoke("register_user", { session: user.session });
        return { severity: "success", message: `${user.name} is now registered.` };
      } catch (error) {
        console.error("register_user failed:", error);
        return { severity: "error", message: `Could not register ${user.name}.` };
      }
    case "unregister":
      try {
        // Deregistering is an edit of the server's user list with the name
        // cleared, not a command of its own.
        await invoke("update_user_list", { users: [{ user_id: user.user_id, name: null }] });
        return { severity: "success", message: `${user.name} is no longer registered.` };
      } catch (error) {
        console.error("unregister (update_user_list) failed:", error);
        return { severity: "error", message: `Could not deregister ${user.name}.` };
      }
    case "delete-messages":
      if (pending.channelId === null || !user.hash)
        return { severity: "error", message: "There is no channel to delete from." };
      try {
        await useAppStore.getState().deletePchatMessages(pending.channelId, { senderHash: user.hash });
        return { severity: "success", message: `Deleted ${user.name}'s messages in this channel.` };
      } catch (error) {
        console.error("delete user messages failed:", error);
        return { severity: "error", message: `Could not delete ${user.name}'s messages.` };
      }
  }
}

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Nebula's own confirmation, in the same shape as the leave-server one. */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: Readonly<ConfirmDialogProps>) {
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogContent>
        <Typography sx={{ fontWeight: 600, fontSize: 14, mb: "6px" }}>{title}</Typography>
        <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
          {body}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          sx={danger ? (theme) => ({ background: theme.palette.nebula.bad }) : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// -- Move to channel --------------------------------------------------

interface MoveUserDialogProps {
  user: UserEntry;
  onClose: () => void;
  onDone: (note: Note) => void;
}

/**
 * Pick where to move somebody.
 *
 * A server's channel list is long enough that a submenu of it is unusable, so
 * this is a filtered dialog instead. Occupancy is shown because "which Gaming
 * channel" is nearly always answered by which one has people in it.
 */
export function MoveUserDialog({ user, onClose, onDone }: Readonly<MoveUserDialogProps>) {
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const [query, setQuery] = useState("");

  const occupancy = useMemo(() => {
    const counts = new Map<number, number>();
    for (const entry of users) counts.set(entry.channel_id, (counts.get(entry.channel_id) ?? 0) + 1);
    return counts;
  }, [users]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return channels
      .filter((channel) => channel.id !== user.channel_id)
      .filter((channel) => needle === "" || (channel.name ?? "").toLowerCase().includes(needle))
      .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""));
  }, [channels, query, user.channel_id]);

  const pick = useCallback(
    async (channel: ChannelEntry) => {
      const name = channel.name || "the root channel";
      try {
        await invoke("move_user_to_channel", { session: user.session, channelId: channel.id });
        onDone({ severity: "success", message: `Moved ${user.name} to ${name}.` });
      } catch (error) {
        console.error("move_user_to_channel failed:", error);
        onDone({ severity: "error", message: `Could not move ${user.name}.` });
      }
    },
    [user.session, user.name, onDone],
  );

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogContent>
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Move to channel</Typography>
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted, mb: "10px" })}>
          Where should {user.name} go?
        </Typography>
        <SearchBox autoFocus value={query} onChange={setQuery} placeholder="Filter channels" />
        <Box
          component="ul"
          sx={{ listStyle: "none", m: 0, mt: "8px", p: 0, maxHeight: 280, overflowY: "auto" }}
        >
          {matches.length === 0 ? (
            <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.dim, py: "10px" })}>
              No channels match.
            </Typography>
          ) : (
            matches.map((channel) => {
              const count = occupancy.get(channel.id) ?? 0;
              return (
                <Stack
                  component="li"
                  key={channel.id}
                  direction="row"
                  alignItems="center"
                  gap={1.125}
                  onClick={() => void pick(channel)}
                  sx={(theme) => ({
                    px: "10px",
                    py: "8px",
                    borderRadius: radius("md"),
                    cursor: "pointer",
                    "&:hover": { background: theme.palette.nebula.hover },
                  })}
                >
                  <Glyph>
                    <HashIcon width={13} height={13} />
                  </Glyph>
                  <Typography sx={{ fontSize: 12.5 }} noWrap>
                    {channel.name || "Root"}
                  </Typography>
                  {count > 0 && (
                    <Typography
                      sx={(theme) => ({ ml: "auto", fontSize: 10.5, color: theme.palette.nebula.dim })}
                    >
                      {count}
                    </Typography>
                  )}
                </Stack>
              );
            })
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

// -- Shared trim ------------------------------------------------------

const DIVIDER = { my: "4px", mx: "6px" } as const;

const DANGER = (theme: { palette: { nebula: { bad: string } } }) => ({ color: theme.palette.nebula.bad });

/** The mock draws item icons a step quieter than the label beside them. */
function Glyph({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.muted })}
    >
      {children}
    </Box>
  );
}
