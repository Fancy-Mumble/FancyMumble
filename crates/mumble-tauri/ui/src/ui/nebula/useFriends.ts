/**
 * The Friends screen's live state: the saved list, where everyone on it is, and
 * what opening one of them does.
 *
 * The saved list is the same record Standard's Friends page reads and the same
 * one Nebula's user menu writes, so a friend added in either design is a friend
 * in both. What is not saved is presence: a friend is a certificate hash, and
 * only the backend knows whether that hash is attached to a live user on any of
 * the connections currently open. That answer is asked for whenever the list,
 * the connections or the active server change, and on a slow timer besides -
 * a friend can arrive on a server without anything in this client moving.
 *
 * Opening a friend is three cases wearing one click:
 *
 *   - online, on an open server: the classic direct message, which the store
 *     upgrades to the pair's encrypted channel by itself when both are
 *     registered and the `fancy-friends` plugin is loaded;
 *   - offline, on an open server: no session to address, so the plugin is asked
 *     for the pair's room directly - it is persisted, so it can be written to
 *     now and replayed to them when they return;
 *   - on a server that is not open: nothing can be done until it is, so the
 *     caller is handed a pending friend to ask about, and the chat opens by
 *     itself once the connection comes up.
 *
 * The pure shaping of all this - grouping, sorting, searching - is `friends.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { FRIENDS_PLUGIN, requestFriendChannel } from "@core/friendsChannel";
import { getSavedServers, getServerPassword } from "@core/serverStorage";
import {
  FRIENDS_CHANGED_EVENT,
  getFriends,
  removeFriend,
  updateFriendAvatar,
  updateFriendIdentity,
  type Friend,
  type FriendIdentity,
} from "@core/friendsStorage";
import {
  listFriendGroups,
  selfFriend,
  type FriendEntry,
  type FriendGroup,
  type FriendMatch,
} from "./friends";

/** How often presence is re-asked for when nothing else has prompted it. */
const ONLINE_REFRESH_MS = 15_000;

export interface FriendsScreen {
  /** The saved friends, plus yourself, grouped by server and searched. */
  groups: FriendGroup[];
  /** True when the list is empty because the search matched nothing, rather
   *  than because there are no friends to match - two different empty states. */
  filtered: boolean;
  /** A friend whose server is closed, awaiting an answer about connecting. */
  pendingConnect: Friend | null;
  /** Open this friend's chat, or ask about connecting to their server. */
  open: (entry: FriendEntry) => void;
  /** Connect to the pending friend's server, then open the chat. */
  confirmConnect: () => void;
  cancelConnect: () => void;
  /** Drop a friend from the saved list. */
  remove: (entry: FriendEntry) => void;
}

/**
 * The saved friends list, kept current.
 *
 * Split out because two things need it for different reasons: the Friends
 * column, which is about them, and the conversation header, which only needs
 * their names - a friend chat opened while the friend is offline has no live
 * user to take a title from, and would otherwise be headed `__dm:3-7`.
 */
export function useSavedFriends(): Friend[] {
  const [saved, setSaved] = useState<Friend[]>([]);

  // The user menu writes this list from anywhere in the client, so a column
  // that read it once and stopped would go stale the first time it was used.
  useEffect(() => {
    let live = true;
    const load = () =>
      void getFriends()
        .then((list) => {
          if (live) setSaved(list);
        })
        .catch((reason: unknown) => console.error("Nebula friends load failed:", reason));
    load();
    globalThis.addEventListener(FRIENDS_CHANGED_EVENT, load);
    return () => {
      live = false;
      globalThis.removeEventListener(FRIENDS_CHANGED_EVENT, load);
    };
  }, []);

  return saved;
}

export function useFriends(query: string): FriendsScreen {
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const users = useAppStore((state) => state.users);
  const ownSession = useAppStore((state) => state.ownSession);
  const dmUnreadCounts = useAppStore((state) => state.dmUnreadCounts);
  const pluginInfos = useAppStore((state) => state.pluginInfos);

  const saved = useSavedFriends();
  const [online, setOnline] = useState<Record<string, FriendMatch>>({});
  const [pendingConnect, setPendingConnect] = useState<Friend | null>(null);
  /** A friend to open as soon as their server finishes connecting. */
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  // Presence, by certificate hash, across every open connection. Friends saved
  // without a hash are anonymous users who cannot be resolved at all; they stay
  // in the list, and stay offline.
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      const next: Record<string, FriendMatch> = {};
      for (const friend of saved) {
        if (!friend.userHash) continue;
        try {
          const match = await invoke<FriendMatch | null>("find_user_by_hash", {
            userHash: friend.userHash,
          });
          if (match) next[friend.id] = match;
        } catch (reason) {
          console.warn("find_user_by_hash failed:", reason);
        }
      }
      if (live) setOnline(next);
    };
    void refresh();
    const timer = globalThis.setInterval(() => void refresh(), ONLINE_REFRESH_MS);
    return () => {
      live = false;
      globalThis.clearInterval(timer);
    };
  }, [saved, sessions, activeServerId]);

  // What we learn about a friend while we can see them: their registered id and
  // the connection target of the server they are on, which together are what
  // let their chat open - or their server be rejoined - when they are gone.
  // Their avatar is cached alongside, because the texture is only fetchable for
  // a session on the *active* connection, and an offline friend has none.
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const friend of saved) {
        const match = online[friend.id];
        if (!match || match.serverId !== activeServerId) continue;
        const user = users.find((entry) => entry.session === match.userSession);
        const session = sessions.find((entry) => entry.id === match.serverId);
        const identity: FriendIdentity = {};
        if (user?.user_id != null && user.user_id >= 0) identity.userId = user.user_id;
        if (session) {
          identity.serverHost = session.host;
          identity.serverPort = session.port;
          identity.serverUsername = session.username;
          identity.serverCertLabel = session.certLabel;
        }
        void updateFriendIdentity(friend.id, identity);

        if (!user?.texture_size) continue;
        if (friend.avatarSize === user.texture_size && friend.avatar != null) continue;
        try {
          const bytes = await invoke<number[] | null>("get_user_texture", {
            session: match.userSession,
          });
          if (!live) return;
          if (bytes && bytes.length > 0) await updateFriendAvatar(friend.id, bytes);
        } catch (reason) {
          console.warn("Nebula friend avatar refresh failed:", reason);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [saved, online, users, sessions, activeServerId]);

  const ownUser = useMemo(
    () => users.find((user) => user.session === ownSession) ?? null,
    [users, ownSession],
  );

  // Yourself, as a friend: the notepad is the same kind of room a friend chat
  // is, so it is listed like one rather than hidden behind its own control.
  const friends = useMemo(() => {
    const self = selfFriend({
      activeServerId,
      ownUser,
      sessions,
      hasFriendsPlugin: pluginInfos.has(FRIENDS_PLUGIN),
    });
    return self ? [self, ...saved] : saved;
  }, [activeServerId, ownUser, pluginInfos, saved, sessions]);

  const groups = useMemo(
    () =>
      listFriendGroups({
        friends,
        online,
        sessions,
        users,
        activeServerId,
        unreadCounts: dmUnreadCounts,
        query,
      }),
    [activeServerId, dmUnreadCounts, friends, online, query, sessions, users],
  );

  /** Open the chat, or answer false when their server is not open. */
  const openChat = useCallback(async (entry: FriendEntry): Promise<boolean> => {
    // Yourself first: your own hash resolves online like anyone's, and taking
    // the direct-message path on it would open a conversation with yourself
    // rather than the notepad the plugin keeps for you.
    if (entry.self) {
      requestFriendChannel();
      return true;
    }
    if (entry.sessionId === null) return false;
    const store = useAppStore.getState();
    if (store.activeServerId !== entry.sessionId) await store.switchServer(entry.sessionId);
    if (entry.match !== null) {
      // Online: the direct message. Between two registered users the store
      // upgrades it to the pair's encrypted channel on its own.
      await useAppStore.getState().selectDmUser(entry.match.userSession);
      return true;
    }
    if (entry.friend.userId != null) {
      // Offline: there is no session to address, so the plugin is asked for the
      // pair's persisted room directly and answers by selecting it.
      requestFriendChannel(entry.friend.userId);
      return true;
    }
    return false;
  }, []);

  const open = useCallback(
    (entry: FriendEntry) => {
      void openChat(entry)
        .then((opened) => {
          if (!opened && entry.canConnect) setPendingConnect(entry.friend);
        })
        .catch((reason: unknown) => console.error("Nebula open friend chat failed:", reason));
    },
    [openChat],
  );

  const confirmConnect = useCallback(() => {
    const friend = pendingConnect;
    const host = friend?.serverHost;
    const port = friend?.serverPort;
    if (!friend || host == null || port == null) return;
    const username = friend.serverUsername ?? "";
    setPendingConnect(null);
    setPendingOpenId(friend.id);
    void (async () => {
      try {
        // The saved password is part of the saved login: without it, connecting
        // for a friend would stop on the password overlay for exactly the
        // servers the user has already told the client how to enter.
        const server = (await getSavedServers()).find(
          (candidate) =>
            candidate.host === host && candidate.port === port && candidate.username === username,
        );
        const password = server ? await getServerPassword(server.id).catch(() => null) : null;
        await useAppStore.getState().connect(host, port, username, friend.serverCertLabel ?? null, password);
      } catch (reason) {
        console.error("Nebula connect to friend server failed:", reason);
        setPendingOpenId(null);
      }
    })();
  }, [pendingConnect]);

  // The connection asked for above, once it is up. `groups` is what carries the
  // answer: the entry becomes openable the moment its server is reachable.
  useEffect(() => {
    if (pendingOpenId === null) return;
    const entry = groups.flatMap((group) => group.entries).find((row) => row.friend.id === pendingOpenId);
    if (!entry) {
      setPendingOpenId(null);
      return;
    }
    if (!entry.canOpen) return; // still connecting
    void openChat(entry).finally(() => setPendingOpenId(null));
  }, [groups, openChat, pendingOpenId]);

  const cancelConnect = useCallback(() => setPendingConnect(null), []);

  const remove = useCallback((entry: FriendEntry) => {
    void removeFriend(entry.friend.id).catch((reason: unknown) =>
      console.error("Nebula remove friend failed:", reason),
    );
  }, []);

  return {
    groups,
    filtered: friends.length > 0 && groups.length === 0,
    pendingConnect,
    open,
    confirmConnect,
    cancelConnect,
    remove,
  };
}
