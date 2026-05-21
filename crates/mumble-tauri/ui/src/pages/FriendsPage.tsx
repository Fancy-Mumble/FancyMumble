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
import { useAclGroups } from "../hooks/useAclGroups";
import {
  RoleColorsContext,
  RoleGroupsContext,
  UserListItem,
  buildRoleColorMap,
  buildRoleGroupsMap,
} from "../components/sidebar/UserListItem";
import ChatView from "../components/chat/ChatView";
import {
  FRIENDS_CHANGED_EVENT,
  type Friend,
  base64ToBytes,
  getFriends,
  removeFriend,
  updateFriendAvatar,
} from "../friendsStorage";
import { textureToDataUrl } from "../profileFormat";
import sidebarStyles from "../components/sidebar/ChannelSidebar.module.css";
import styles from "./FriendsPage.module.css";

interface FriendsMatch {
  serverId: string;
  userSession: number;
  userName: string;
}

const ONLINE_REFRESH_MS = 15000;

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
  const switchServer = useAppStore((s) => s.switchServer);
  const selectDmUser = useAppStore((s) => s.selectDmUser);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [onlineMap, setOnlineMap] = useState<Record<string, FriendsMatch>>({});
  const [searchQuery, setSearchQuery] = useState("");

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
  }, [friends, onlineMap, users, activeServerId]);

  const handleClickFriend = useCallback(
    async (friend: Friend) => {
      const match = onlineMap[friend.id];
      if (!match) return;
      try {
        if (activeServerId !== match.serverId) {
          await switchServer(match.serverId);
        }
        await selectDmUser(match.userSession);
      } catch (e) {
        console.error("open friend DM failed", e);
      }
    },
    [onlineMap, activeServerId, switchServer, selectDmUser],
  );

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

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => f.userName.toLowerCase().includes(q));
  }, [friends, searchQuery]);

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
              {friends.length === 0 && (
                <div className={styles.empty}>{t("friendsPage.empty")}</div>
              )}
              {friends.length > 0 && filteredFriends.length === 0 && (
                <div className={styles.empty}>{t("friendsPage.noMatches")}</div>
              )}
              {filteredFriends.map((f) => {
                const online = onlineMap[f.id];
                const isActive = online != null && selectedDmUser === online.userSession
                  && activeServerId === online.serverId;
                return (
                  <FriendRow
                    key={f.id}
                    friend={f}
                    online={online != null}
                    isActive={isActive}
                    onClick={() => { void handleClickFriend(f); }}
                    onRemove={() => { void handleRemove(f); }}
                    removeTitle={t("friendsPage.remove")}
                    offlineHint={t("friendsPage.offline")}
                  />
                );
              })}
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
            {selectedDmUser != null ? (
              <ChatView />
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
  readonly isActive: boolean;
  readonly onClick: () => void;
  readonly onRemove: () => void;
  readonly removeTitle: string;
  readonly offlineHint: string;
}

function FriendRow({ friend, online, isActive, onClick, onRemove, removeTitle, offlineHint }: FriendRowProps) {
  const interactive = online;
  const avatarUrl = useMemo(() => {
    if (!friend.avatar) return null;
    try {
      const bytes = Array.from(base64ToBytes(friend.avatar));
      return textureToDataUrl(bytes);
    } catch {
      return null;
    }
  }, [friend.avatar]);
  return (
    <div
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-disabled={!interactive}
      className={`${styles.friendItem} ${isActive ? styles.friendItemActive : ""}`}
      onClick={interactive ? onClick : undefined}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      title={online ? friend.userName : offlineHint}
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
      {friend.serverLabel && (
        <span className={styles.friendServer}>{friend.serverLabel}</span>
      )}
      <button
        type="button"
        className={styles.removeBtn}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title={removeTitle}
        aria-label={removeTitle}
      >
        <UserXIcon width={14} height={14} />
      </button>
    </div>
  );
}
