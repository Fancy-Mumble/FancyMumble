/**
 * Friends page - global Mumble-style friends list.
 *
 * Layout (left -> right):
 *   1. Friends sidebar: scrollable list of saved friends.  Each entry shows
 *      an online indicator computed by asking the backend whether the
 *      friend (by TLS cert hash) is currently connected on any server.
 *   2. Self info row (below the friends list): when the local user is in
 *      a voice call on the active server, render the same `UserListItem`
 *      used by the channel sidebar, showing avatar, name, registered
 *      status, current channel and mute/deaf icons.
 *   3. Chat panel: re-uses the existing `ChatView` component which already
 *      switches between channel chat and DMs based on `selectedDmUser` in
 *      the store.  Clicking a friend resolves their session via
 *      `find_user_by_hash`, switches to the matching server tab if
 *      necessary, and opens the DM in-place.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CloseIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  SearchIcon,
  SettingsIcon,
  UserXIcon,
} from "../icons";
import { useAppStore } from "../store";
import { TID } from "../testids";
import { isDmChannel, dmPeerUserId } from "../utils/channelVisibility";
import { requestFriendChannel, FRIENDS_PLUGIN } from "../friendsChannel";
import { getSavedServers, getServerPassword } from "../serverStorage";
import { useAclGroups } from "../hooks/useAclGroups";
import {
  RoleColorsContext,
  RoleGroupsContext,
  UserListItem,
  buildRoleColorMap,
  buildRoleGroupsMap,
} from "../components/sidebar/user/UserListItem";
import ChatView from "../components/chat/ChatView";
import {
  FRIENDS_CHANGED_EVENT,
  type Friend,
  type FriendIdentity,
  base64ToBytes,
  friendServerKey,
  getFriends,
  removeFriend,
  updateFriendAvatar,
  updateFriendIdentity,
} from "../friendsStorage";
import { bytesToAvatarUrl, revokeDisplayUrl } from "../utils/imageBlobs";
import sidebarStyles from "../components/sidebar/channel/ChannelSidebar.module.css";
import styles from "./FriendsPage.module.css";

interface FriendsMatch {
  serverId: string;
  userSession: number;
  userName: string;
}

const ONLINE_REFRESH_MS = 15000;

/** Id prefix for the synthetic "yourself" friend entry (a self-chat). */
const SELF_FRIEND_PREFIX = "self:";

export default function FriendsPage() {
  const { t } = useTranslation("server");
  const { t: tChat } = useTranslation("chat");
  const { t: tSidebar } = useTranslation("sidebar");
  const navigate = useNavigate();
  const sessions = useAppStore((s) => s.sessions);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const users = useAppStore((s) => s.users);
  const channels = useAppStore((s) => s.channels);
  const ownSession = useAppStore((s) => s.ownSession);
  const voiceState = useAppStore((s) => s.voiceState);
  const toggleMute = useAppStore((s) => s.toggleMute);
  const toggleDeafen = useAppStore((s) => s.toggleDeafen);
  const selectedDmUser = useAppStore((s) => s.selectedDmUser);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const pluginInfos = useAppStore((s) => s.pluginInfos);
  const switchServer = useAppStore((s) => s.switchServer);
  const selectDmUser = useAppStore((s) => s.selectDmUser);
  const connect = useAppStore((s) => s.connect);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [onlineMap, setOnlineMap] = useState<Record<string, FriendsMatch>>({});
  const [searchQuery, setSearchQuery] = useState("");
  // A friend whose server we aren't connected to, awaiting a connect decision.
  const [pendingConnect, setPendingConnect] = useState<Friend | null>(null);
  // A friend to auto-open once their server finishes (re)connecting.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  // Load + watch the persisted friends list.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const list = await getFriends();
      if (!cancelled) setFriends(list);
    };
    void load();
    const onChange = () => { void load(); };
    globalThis.addEventListener(FRIENDS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      globalThis.removeEventListener(FRIENDS_CHANGED_EVENT, onChange);
    };
  }, []);

  // Resolve online state for every friend with a known cert hash.
  // Re-runs whenever the friends list, the active server, or the set of
  // connected sessions changes, plus on a slow interval as a safety net.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next: Record<string, FriendsMatch> = {};
      for (const f of friends) {
        if (!f.userHash) continue;
        try {
          const match = await invoke<FriendsMatch | null>("find_user_by_hash", {
            userHash: f.userHash,
          });
          if (match) next[f.id] = match;
        } catch (e) {
          console.warn("find_user_by_hash failed", e);
        }
      }
      if (!cancelled) setOnlineMap(next);
    };
    void refresh();
    const handle = globalThis.setInterval(() => { void refresh(); }, ONLINE_REFRESH_MS);
    return () => {
      cancelled = true;
      globalThis.clearInterval(handle);
    };
  }, [friends, sessions, activeServerId]);

  // Refresh the cached avatar for any friend who is currently online on
  // the active server.  The texture is only fetchable for sessions on
  // the active connection, so cross-server avatars are updated whenever
  // the user switches tabs to that server.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const f of friends) {
        const match = onlineMap[f.id];
        if (!match || match.serverId !== activeServerId) continue;
        const liveUser = users.find((u) => u.session === match.userSession);
        // Backfill the friend's registered uid + connection target while we can
        // see them live, so we can open their chat offline / reconnect later.
        const sess = sessions.find((s) => s.id === match.serverId);
        const identity: FriendIdentity = {};
        if (liveUser?.user_id != null && liveUser.user_id >= 0) identity.userId = liveUser.user_id;
        if (sess) {
          identity.serverHost = sess.host;
          identity.serverPort = sess.port;
          identity.serverUsername = sess.username;
          identity.serverCertLabel = sess.certLabel;
        }
        void updateFriendIdentity(f.id, identity);
        if (!liveUser?.texture_size) continue;
        if (f.avatarSize === liveUser.texture_size && f.avatar != null) continue;
        try {
          const bytes = await invoke<number[] | null>("get_user_texture", {
            session: match.userSession,
          });
          if (cancelled) return;
          if (bytes && bytes.length > 0) {
            await updateFriendAvatar(f.id, bytes);
          }
        } catch (e) {
          console.warn("refresh friend avatar failed", e);
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [friends, onlineMap, users, activeServerId, sessions]);

  /** Resolve how to reach `friend`: the connected session for their server (if
   *  any), their live online match, and whether we can open the chat now or must
   *  first connect to their server. */
  const resolveFriend = useCallback((friend: Friend) => {
    const online: FriendsMatch | undefined = onlineMap[friend.id];
    let sessionId: string | undefined = online?.serverId;
    if (sessionId == null && friend.serverHost != null) {
      sessionId = sessions.find(
        (s) =>
          s.status === "connected" &&
          s.host === friend.serverHost &&
          s.port === friend.serverPort &&
          s.username === friend.serverUsername,
      )?.id;
    }
    // We can open a chat when connected to their server and we either see them
    // live (classic / upgrade) or know their registered uid - the persisted E2E
    // channel can be opened even while they're offline.
    const canOpen = sessionId != null && (online != null || friend.userId != null);
    // Otherwise, if we know how to reach their server, we can offer to connect.
    const canConnect = sessionId == null && friend.serverHost != null;
    return { online, sessionId, canOpen, canConnect };
  }, [onlineMap, sessions]);

  /** Open `friend`'s chat when their server is connected. Returns false when we
   *  aren't connected to it (the caller then offers to connect). */
  const openFriendChat = useCallback(async (friend: Friend): Promise<boolean> => {
    const { online, sessionId } = resolveFriend(friend);
    if (sessionId == null) return false;
    if (activeServerId !== sessionId) await switchServer(sessionId);
    if (online != null) {
      // Online: open the DM; a registered pair upgrades to the E2E channel.
      await selectDmUser(online.userSession);
      return true;
    }
    if (friend.userId != null) {
      // Offline: the friend chat is a persisted, end-to-end-encrypted (signal)
      // channel.  The plugin finds-or-creates it and points us at it
      // (`friends.room`); we can write right away and the server replays the
      // messages to the friend when they reconnect.
      requestFriendChannel(friend.userId);
      return true;
    }
    return false;
  }, [resolveFriend, activeServerId, switchServer, selectDmUser]);

  const handleClickFriend = useCallback(
    async (friend: Friend) => {
      try {
        // The synthetic self-entry opens a chat with yourself.
        if (friend.id.startsWith(SELF_FRIEND_PREFIX)) {
          requestFriendChannel();
          return;
        }
        if (await openFriendChat(friend)) return;
        // Not connected to their server - offer to (re)connect to it.
        if (resolveFriend(friend).canConnect) setPendingConnect(friend);
      } catch (e) {
        console.error("open friend chat failed", e);
      }
    },
    [openFriendChat, resolveFriend],
  );

  /** Connect to `friend`'s server (reusing a saved password when we have one),
   *  then auto-open the chat once the session comes up. */
  const handleConnectToFriendServer = useCallback(async (friend: Friend) => {
    if (friend.serverHost == null || friend.serverPort == null) return;
    setPendingConnect(null);
    setPendingOpenId(friend.id);
    try {
      const saved = (await getSavedServers()).find(
        (s) =>
          s.host === friend.serverHost &&
          s.port === friend.serverPort &&
          s.username === friend.serverUsername,
      );
      const pw = saved ? await getServerPassword(saved.id) : null;
      await connect(
        friend.serverHost,
        friend.serverPort,
        friend.serverUsername ?? "",
        friend.serverCertLabel ?? null,
        pw,
      );
    } catch (e) {
      console.error("connect to friend server failed", e);
      setPendingOpenId(null);
    }
  }, [connect]);

  // Once a pending friend's server is connected, open the chat + clear the flag.
  useEffect(() => {
    if (pendingOpenId == null) return;
    const friend = friends.find((f) => f.id === pendingOpenId);
    if (!friend) { setPendingOpenId(null); return; }
    if (!resolveFriend(friend).canOpen) return; // still connecting
    void openFriendChat(friend).finally(() => setPendingOpenId(null));
  }, [pendingOpenId, friends, sessions, onlineMap, resolveFriend, openFriendChat]);

  // The own registered user id on the active server (null for a guest). Chatting
  // with yourself (a private E2E notepad) needs a registered user + the plugin;
  // when available, "yourself" shows up in the friends list like any friend.
  const ownUserId = useMemo(
    () => users.find((u) => u.session === ownSession)?.user_id ?? null,
    [users, ownSession],
  );
  const canSelfChat =
    activeServerId != null && ownUserId != null && pluginInfos.has(FRIENDS_PLUGIN);

  // Whether a friend chat is open in the embedded ChatView: either a classic DM
  // (selectedDmUser) or - after the upgrade - the friend's `__dm:` channel (the
  // upgrade clears selectedDmUser and selects the channel instead).
  const friendChatActive = useMemo(() => {
    if (selectedDmUser != null) return true;
    const ch = selectedChannel != null ? channels.find((c) => c.id === selectedChannel) : undefined;
    return ch != null && isDmChannel(ch);
  }, [selectedDmUser, selectedChannel, channels]);

  // Whether our own self-chat (the `__dm:<self>` channel) is the open one, so the
  // self friend-entry can render as the active row like any other friend.
  const selfChatActive = useMemo(() => {
    if (ownUserId == null) return false;
    const ch = selectedChannel != null ? channels.find((c) => c.id === selectedChannel) : undefined;
    return ch != null && isDmChannel(ch) && dmPeerUserId(ch, ownUserId) === ownUserId;
  }, [selectedChannel, channels, ownUserId]);

  const handleRemove = useCallback(async (friend: Friend) => {
    try {
      await removeFriend(friend.id);
    } catch (e) {
      console.error("remove friend failed", e);
    }
  }, []);

  // ACL role colors / groups for the active server (used by UserListItem).
  const aclGroups = useAclGroups();
  const roleColors = useMemo(() => buildRoleColorMap(aclGroups), [aclGroups]);
  const roleGroups = useMemo(() => buildRoleGroupsMap(aclGroups), [aclGroups]);

  const ownUser = ownSession != null ? users.find((u) => u.session === ownSession) ?? null : null;
  const ownChannelName = useMemo(
    () => (ownUser ? channels.find((c) => c.id === ownUser.channel_id)?.name : undefined),
    [ownUser, channels],
  );

  // "Yourself" as a friend entry on the active server: it groups under your own
  // name, is searchable, and clicking it opens your private E2E self-chat - it
  // behaves like any other friend.  Only present when self-chat is possible.
  const selfFriend = useMemo<Friend | null>(() => {
    if (!canSelfChat || activeServerId == null || !ownUser) return null;
    const label = sessions.find((s) => s.id === activeServerId)?.label;
    const f: Friend = {
      id: `${SELF_FRIEND_PREFIX}${activeServerId}`,
      userName: ownUser.name,
      serverId: activeServerId,
      addedAt: 0,
    };
    if (ownUser.hash) f.userHash = ownUser.hash;
    if (label) f.serverLabel = label;
    return f;
  }, [canSelfChat, activeServerId, ownUser, sessions]);

  const allFriends = useMemo(
    () => (selfFriend ? [selfFriend, ...friends] : friends),
    [selfFriend, friends],
  );

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allFriends;
    // Search matches the friend's name OR the server they're on, so typing a
    // server name narrows to that server's chats.
    return allFriends.filter(
      (f) =>
        f.userName.toLowerCase().includes(q) ||
        (f.serverLabel ?? "").toLowerCase().includes(q),
    );
  }, [allFriends, searchQuery]);

  /** Friends grouped by the server they belong to, for the divided list. Keyed
   *  by a *stable* server identity (label / connection target, not the volatile
   *  per-session id) so the same server is one group; the active server sorts
   *  first, then groups alphabetically. */
  const friendGroups = useMemo(() => {
    const activeSession = sessions.find((s) => s.id === activeServerId);
    const activeKey = activeSession
      ? friendServerKey({
          serverLabel: activeSession.label,
          serverHost: activeSession.host,
          serverPort: activeSession.port,
          serverUsername: activeSession.username,
        })
      : null;
    const byServer = new Map<string, { key: string; label: string; friends: typeof friends }>();
    for (const f of filteredFriends) {
      const key = friendServerKey(f);
      const label =
        f.serverLabel || f.serverHost || t("friendsPage.unknownServer", { defaultValue: "Other" });
      let group = byServer.get(key);
      if (!group) {
        group = { key, label, friends: [] };
        byServer.set(key, group);
      }
      group.friends.push(f);
    }
    return [...byServer.values()].sort((a, b) => {
      // Active server first, then by label.
      const aActive = activeKey != null && a.key === activeKey;
      const bActive = activeKey != null && b.key === activeKey;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [filteredFriends, sessions, activeServerId, t]);

  return (
    <RoleColorsContext.Provider value={roleColors}>
      <RoleGroupsContext.Provider value={roleGroups}>
        <div className={styles.page}>
          <aside className={sidebarStyles.sidebar}>
            <div className={sidebarStyles.header}>
              <div className={sidebarStyles.searchBar}>
                <SearchIcon className={sidebarStyles.searchBarIcon} width={14} height={14} />
                <input
                  className={sidebarStyles.searchBarInput}
                  type="text"
                  placeholder={tSidebar("channelSidebar.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery(""); }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className={sidebarStyles.searchBarClose}
                    onClick={() => setSearchQuery("")}
                    aria-label={tSidebar("channelSidebar.closeSearch")}
                    title={tSidebar("channelSidebar.closeSearchTooltip")}
                  >
                    <CloseIcon width={14} height={14} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className={sidebarStyles.collapseBtn}
                onClick={() => navigate("/settings")}
                title={t("friendsPage.openSettings")}
                aria-label={t("friendsPage.openSettings")}
              >
                <SettingsIcon width={18} height={18} />
              </button>
            </div>
            <div className={styles.list}>
              {allFriends.length === 0 && (
                <div className={styles.empty}>{t("friendsPage.empty")}</div>
              )}
              {allFriends.length > 0 && filteredFriends.length === 0 && (
                <div className={styles.empty}>{t("friendsPage.noMatches")}</div>
              )}
              {friendGroups.map((group) => (
                <div key={group.key} className={styles.serverGroup}>
                  <div className={styles.serverDivider} data-server-label={group.label}>
                    <span className={styles.serverDividerLabel}>{group.label}</span>
                    <span className={styles.serverDividerCount}>{group.friends.length}</span>
                  </div>
                  {group.friends.map((f) => {
                    // "Yourself" is always online and active when its self-chat is
                    // open; it has no unfriend action.
                    const isSelf = f.id.startsWith(SELF_FRIEND_PREFIX);
                    const match = isSelf ? undefined : onlineMap[f.id];
                    const res = isSelf ? null : resolveFriend(f);
                    const isActive = isSelf
                      ? selfChatActive
                      : match != null && selectedDmUser === match.userSession
                        && activeServerId === match.serverId;
                    // Clickable when we can open the chat (online, or offline on a
                    // connected server) or at least offer to connect to the server.
                    const clickable = isSelf || res!.canOpen || res!.canConnect;
                    return (
                      <FriendRow
                        key={f.id}
                        friend={f}
                        online={isSelf || match != null}
                        clickable={clickable}
                        isActive={isActive}
                        onClick={() => { void handleClickFriend(f); }}
                        onRemove={isSelf ? undefined : () => { void handleRemove(f); }}
                        removeTitle={t("friendsPage.remove")}
                        offlineHint={t("friendsPage.offline")}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            {ownUser && (
              <div className={sidebarStyles.selfUserSection}>
                <UserListItem
                  user={ownUser}
                  isSelf
                  channelName={ownChannelName}
                />
                <div className={`${sidebarStyles.selfVoiceActions} ${sidebarStyles.desktopOnly}`}>
                  <button
                    type="button"
                    className={`${sidebarStyles.voiceToggle} ${voiceState === "active" ? sidebarStyles.voiceActive : sidebarStyles.voiceMuted}`}
                    onClick={toggleMute}
                    title={voiceState === "active" ? tChat("callControls.mute") : tChat("callControls.unmute")}
                    aria-label={voiceState === "active" ? tChat("callControls.mute") : tChat("callControls.unmute")}
                  >
                    {voiceState === "active" ? (
                      <MicIcon width={18} height={18} />
                    ) : (
                      <MicOffIcon width={18} height={18} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={`${sidebarStyles.voiceToggle} ${voiceState === "inactive" ? sidebarStyles.voiceMuted : sidebarStyles.voiceActive}`}
                    onClick={toggleDeafen}
                    title={voiceState === "inactive" ? tChat("callControls.undeafen") : tChat("callControls.deafen")}
                    aria-label={voiceState === "inactive" ? tChat("callControls.undeafen") : tChat("callControls.deafen")}
                  >
                    {voiceState === "inactive" ? (
                      <HeadphonesOffIcon width={18} height={18} />
                    ) : (
                      <HeadphonesIcon width={18} height={18} />
                    )}
                  </button>
                </div>
              </div>
            )}
          </aside>
          <div className={styles.chat}>
            {friendChatActive ? (
              <ChatView />
            ) : pendingConnect ? (
              <div className={styles.connectPrompt} data-testid={TID.friendsConnectPrompt}>
                <p>
                  {t("friendsPage.notConnected", {
                    server: pendingConnect.serverLabel ?? pendingConnect.serverHost ?? "",
                    name: pendingConnect.userName,
                    defaultValue: "You're not connected to {{server}}. Connect to chat with {{name}}.",
                  })}
                </p>
                <div className={styles.connectActions}>
                  <button
                    type="button"
                    className={styles.connectButton}
                    data-testid={TID.friendsConnect}
                    onClick={() => { void handleConnectToFriendServer(pendingConnect); }}
                  >
                    {t("friendsPage.connect", { defaultValue: "Connect" })}
                  </button>
                  <button
                    type="button"
                    className={styles.connectCancel}
                    onClick={() => setPendingConnect(null)}
                  >
                    {t("friendsPage.cancel", { defaultValue: "Cancel" })}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.placeholder}>{t("friendsPage.placeholder")}</div>
            )}
          </div>
        </div>
      </RoleGroupsContext.Provider>
    </RoleColorsContext.Provider>
  );
}

interface FriendRowProps {
  readonly friend: Friend;
  readonly online: boolean;
  /** Whether the row can be clicked - true when we can open the chat (incl. an
   *  offline friend on a connected server) or offer to connect to their server.
   *  Decoupled from {@link online} so offline friends remain interactive. */
  readonly clickable: boolean;
  readonly isActive: boolean;
  readonly onClick: () => void;
  /** Unfriend action; omitted for the synthetic self-entry (you can't unfriend
   *  yourself), in which case no remove button is rendered. */
  readonly onRemove?: () => void;
  readonly removeTitle: string;
  readonly offlineHint: string;
}

function FriendRow({ friend, online, clickable, isActive, onClick, onRemove, removeTitle, offlineHint }: FriendRowProps) {
  const interactive = clickable;
  // Blob object URL (downscaled when oversized) instead of a data: URL
  // so a large saved avatar doesn't bloat the DOM (see utils/imageBlobs).
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!friend.avatar) {
      setAvatarUrl(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        url = await bytesToAvatarUrl(base64ToBytes(friend.avatar!));
        if (!cancelled) setAvatarUrl(url || null);
      } catch {
        if (!cancelled) setAvatarUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      revokeDisplayUrl(url);
    };
  }, [friend.avatar]);
  return (
    <div
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-disabled={!interactive}
      data-testid={TID.friendRow}
      data-friend-name={friend.userName}
      data-online={online}
      className={`${styles.friendItem} ${isActive ? styles.friendItemActive : ""}`}
      onClick={interactive ? onClick : undefined}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      title={online || interactive ? friend.userName : offlineHint}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className={styles.friendAvatar} />
      ) : (
        <span className={styles.friendAvatarInitial} aria-hidden="true">
          {friend.userName.charAt(0).toUpperCase() || "?"}
        </span>
      )}
      <span className={`${styles.friendStatus} ${online ? styles.friendStatusOnline : ""}`} />
      <span className={styles.friendName}>{friend.userName}</span>
      {onRemove && (
        <button
          type="button"
          className={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title={removeTitle}
          aria-label={removeTitle}
        >
          <UserXIcon width={14} height={14} />
        </button>
      )}
    </div>
  );
}
