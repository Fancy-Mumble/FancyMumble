/**
 * The Friends screen's model: who your friends are, where they are, and what
 * clicking one would do.
 *
 * Nebula's Messages column used to list *everyone on the server you happened to
 * be connected to*, which is a roster rather than a friends list - the people
 * you keep are a saved, cross-server set (`@core/friendsStorage`), most of whom
 * are offline and many of whom are not on this server at all. This module turns
 * that saved set into rows, so the column answers "who do I talk to" instead of
 * "who is here".
 *
 * Identification follows Standard's rule, because it is the same saved list: a
 * friend is a TLS certificate hash, resolved live by the backend across every
 * open connection (`find_user_by_hash`), with the registered user id and the
 * connection target kept beside it so an *offline* friend can still be opened -
 * their chat is a persisted, end-to-end-encrypted channel the server replays
 * when they come back.
 *
 * Everything here is pure. The fetching, the polling and the writing live in
 * `useFriends`.
 */

import type { ChannelEntry, SessionMeta, UserEntry } from "@core/types";
import { friendServerKey, type Friend } from "@core/friendsStorage";
import { dmPeerUserId, isDmChannel } from "@core/utils/channelVisibility";

/** Id prefix of the synthetic "yourself" row - your own private notepad. */
export const SELF_FRIEND_PREFIX = "self:";

/** Where a friend was found online, as `find_user_by_hash` answers it. */
export interface FriendMatch {
  serverId: string;
  userSession: number;
  userName: string;
}

/** A friend, plus everything a row needs to draw and act on them. */
export interface FriendEntry {
  friend: Friend;
  /** The live session they were found on, or null when they are not visible. */
  match: FriendMatch | null;
  /** Their entry in the *active* server's user list, when that is where they
   *  were found. Only there can the row read live presence or fetch a texture;
   *  a friend on another open connection is online and nothing more. */
  live: UserEntry | null;
  /** The open server their chat would land on, or null when there is none. */
  sessionId: string | null;
  /** True when the chat can be opened now - they are online, or they are a
   *  registered friend on a server that is already open, whose channel is
   *  persisted and so opens while they are away. */
  canOpen: boolean;
  /** True when their server is closed but we know how to reach it. */
  canConnect: boolean;
  /** Waiting direct messages from them. */
  unread: number;
  /** True for the synthetic "yourself" row, which is never removable. */
  self: boolean;
}

/** The friends of one server, drawn under one heading. */
export interface FriendGroup {
  key: string;
  label: string;
  entries: FriendEntry[];
}

/**
 * How to reach `friend`: the open session hosting their server, and whether
 * that is enough to open the chat or only enough to offer to connect.
 *
 * A friend seen online names their own session. One who is not may still be
 * reachable: their saved connection target can match a session that is already
 * open - they are simply away - and a *registered* friend's chat is a persisted
 * channel, so it opens with nobody on the other side of it.
 */
export function reachFriend(
  friend: Friend,
  match: FriendMatch | null,
  sessions: readonly SessionMeta[],
): Pick<FriendEntry, "sessionId" | "canOpen" | "canConnect"> {
  let sessionId = match?.serverId ?? null;
  if (sessionId === null && friend.serverHost != null) {
    sessionId =
      sessions.find(
        (session) =>
          session.status === "connected" &&
          session.host === friend.serverHost &&
          session.port === friend.serverPort &&
          session.username === friend.serverUsername,
      )?.id ?? null;
  }
  return {
    sessionId,
    canOpen: sessionId !== null && (match !== null || friend.userId != null),
    canConnect: sessionId === null && friend.serverHost != null,
  };
}

/**
 * The synthetic "yourself" row.
 *
 * Chatting with yourself is a private, end-to-end-encrypted notepad the
 * `fancy-friends` plugin provisions like any other friend pair, so it is listed
 * as a friend rather than tucked behind a button of its own. It needs a
 * registered account and the plugin, and it is only ever about the server you
 * are on - hence null when any of that is missing.
 */
export function selfFriend(input: {
  activeServerId: string | null;
  ownUser: UserEntry | null;
  sessions: readonly SessionMeta[];
  hasFriendsPlugin: boolean;
}): Friend | null {
  const { activeServerId, ownUser } = input;
  if (!input.hasFriendsPlugin || activeServerId === null || ownUser === null) return null;
  if (ownUser.user_id == null || ownUser.user_id < 0) return null;
  const session = input.sessions.find((entry) => entry.id === activeServerId);
  return {
    id: `${SELF_FRIEND_PREFIX}${activeServerId}`,
    userName: ownUser.name,
    serverId: activeServerId,
    addedAt: 0,
    userId: ownUser.user_id,
    ...(ownUser.hash ? { userHash: ownUser.hash } : {}),
    ...(session?.label ? { serverLabel: session.label } : {}),
  };
}

/**
 * The saved friends, searched and grouped by the server they belong to.
 *
 * Grouping is on `friendServerKey` rather than on the stored `serverId`: that id
 * is minted afresh on every connect, so friends added across two sessions of the
 * same server would otherwise split into two identically-labelled groups. The
 * server you are on sorts first - it is where a click lands without
 * reconnecting - and inside a group the rows you would want first do: yourself,
 * then anyone waiting, then whoever is here.
 */
export function listFriendGroups(input: {
  friends: readonly Friend[];
  online: Readonly<Record<string, FriendMatch>>;
  sessions: readonly SessionMeta[];
  users: readonly UserEntry[];
  activeServerId: string | null;
  unreadCounts: Readonly<Record<number, number>>;
  query: string;
}): FriendGroup[] {
  const needle = input.query.trim().toLocaleLowerCase();
  const activeSession = input.sessions.find((session) => session.id === input.activeServerId);
  const activeKey = activeSession
    ? friendServerKey({
        serverLabel: activeSession.label,
        serverHost: activeSession.host,
        serverPort: activeSession.port,
        serverUsername: activeSession.username,
      })
    : null;

  const groups = new Map<string, FriendGroup>();
  for (const friend of input.friends) {
    // The server name is searched alongside the person's, so typing a server
    // narrows the column to that server's friends.
    if (
      needle &&
      !friend.userName.toLocaleLowerCase().includes(needle) &&
      !(friend.serverLabel ?? "").toLocaleLowerCase().includes(needle)
    ) {
      continue;
    }
    const match = input.online[friend.id] ?? null;
    const entry: FriendEntry = {
      friend,
      match,
      live:
        match !== null && match.serverId === input.activeServerId
          ? (input.users.find((user) => user.session === match.userSession) ?? null)
          : null,
      ...reachFriend(friend, match, input.sessions),
      unread: match ? (input.unreadCounts[match.userSession] ?? 0) : 0,
      self: friend.id.startsWith(SELF_FRIEND_PREFIX),
    };
    const key = friendServerKey(friend);
    const group = groups.get(key) ?? {
      key,
      label: friend.serverLabel || friend.serverHost || "Other",
      entries: [],
    };
    group.entries.push(entry);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.entries.sort(
      (left, right) =>
        Number(right.self) - Number(left.self) ||
        Number(right.unread > 0) - Number(left.unread > 0) ||
        Number(right.match !== null) - Number(left.match !== null) ||
        left.friend.userName.localeCompare(right.friend.userName),
    );
  }

  return [...groups.values()].sort((left, right) => {
    const leftActive = activeKey !== null && left.key === activeKey;
    const rightActive = activeKey !== null && right.key === activeKey;
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

/**
 * Whether `entry` is the conversation currently open.
 *
 * A friend chat is one of two things, and turns into the other while it is
 * open: a classic direct message keyed by session, or - once the plugin has
 * provisioned the pair's room - the `__dm:` channel, which arrives by clearing
 * `selectedDmUser` and selecting a channel instead. Both have to answer here,
 * or the row would unhighlight itself the moment the upgrade landed.
 */
export function isFriendChatOpen(
  entry: FriendEntry,
  state: {
    selectedDmUser: number | null;
    selectedChannel: number | null;
    activeServerId: string | null;
    channels: readonly ChannelEntry[];
    ownUserId: number | null;
  },
): boolean {
  if (
    entry.match !== null &&
    state.selectedDmUser === entry.match.userSession &&
    state.activeServerId === entry.match.serverId
  ) {
    return true;
  }
  if (entry.friend.userId == null || state.selectedChannel === null) return false;
  const channel = state.channels.find((candidate) => candidate.id === state.selectedChannel);
  if (!channel || !isDmChannel(channel)) return false;
  return dmPeerUserId(channel, state.ownUserId) === entry.friend.userId;
}

/**
 * What to call a friend-chat channel in the conversation header.
 *
 * A `__dm:` room is named for the two user ids in it, which is a storage detail
 * rather than a title. The peer's live entry names it while they are here; the
 * saved friend names it when they are not, which is the common case - the chat
 * is persisted precisely so it can be read while they are away. A self-notepad
 * resolves to your own name, because it is listed as a friend like any other.
 *
 * Returns null for a channel that is not a friend chat, which is the caller's
 * signal to use the channel's own name.
 */
export function dmChannelLabel(
  channel: ChannelEntry,
  input: {
    users: readonly UserEntry[];
    friends: readonly Friend[];
    ownUserId: number | null;
  },
): string | null {
  const peerUserId = dmPeerUserId(channel, input.ownUserId);
  if (peerUserId === null) return null;
  const live = input.users.find((user) => user.user_id === peerUserId);
  if (live) return live.name;
  return input.friends.find((friend) => friend.userId === peerUserId)?.userName ?? "Direct message";
}
