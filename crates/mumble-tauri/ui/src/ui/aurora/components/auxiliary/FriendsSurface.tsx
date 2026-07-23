import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { requestFriendChannel } from "@core/friendsChannel";
import {
  FRIENDS_CHANGED_EVENT,
  getFriends,
  removeFriend,
  type Friend,
} from "@core/friendsStorage";
import { getSavedServers, getServerPassword } from "@core/serverStorage";
import { useAppStore } from "@core/store";
import { MessageCircleIcon, SearchIcon, TrashIcon, UsersGroupIcon } from "@ui/icons";
import { Button, IconButton, ModalSurface, SearchField } from "../primitives";
import styles from "./FriendsSurface.module.css";

interface FriendsMatch {
  serverId: string;
  userSession: number;
  userName: string;
}

const REFRESH_INTERVAL_MS = 15_000;

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

export default function FriendsSurface({ onClose }: { onClose: () => void }) {
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [matches, setMatches] = useState<Record<string, FriendsMatch>>({});
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(() => {
    void getFriends().then(setFriends).catch(() => setFriends([]));
  }, []);

  useEffect(() => {
    reload();
    globalThis.addEventListener(FRIENDS_CHANGED_EVENT, reload);
    return () => globalThis.removeEventListener(FRIENDS_CHANGED_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next: Record<string, FriendsMatch> = {};
      await Promise.all(friends.map(async (friend) => {
        if (!friend.userHash) return;
        try {
          const match = await invoke<FriendsMatch | null>("find_user_by_hash", { userHash: friend.userHash });
          if (match) next[friend.id] = match;
        } catch {
          // A server without the cross-session lookup still supports saved/offline friends.
        }
      }));
      if (!cancelled) setMatches(next);
    };
    void refresh();
    const timer = globalThis.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => { cancelled = true; globalThis.clearInterval(timer); };
  }, [friends, sessions]);

  const visibleFriends = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return friends
      .filter((friend) => !needle || `${friend.userName} ${friend.serverLabel ?? ""}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => Number(!matches[left.id]) - Number(!matches[right.id]) || left.userName.localeCompare(right.userName));
  }, [friends, matches, query]);

  const openFriend = async (friend: Friend) => {
    if (busyId) return;
    setBusyId(friend.id);
    setStatus(null);
    try {
      let match: FriendsMatch | undefined = matches[friend.id];
      let serverId: string | undefined = match?.serverId;
      if (!serverId && friend.serverHost) {
        serverId = sessions.find((session) => session.status === "connected" && session.host === friend.serverHost && session.port === friend.serverPort && session.username === friend.serverUsername)?.id;
      }
      if (!serverId && friend.serverHost && friend.serverPort) {
        const saved = (await getSavedServers()).find((server) => server.host === friend.serverHost && server.port === friend.serverPort && server.username === friend.serverUsername);
        await useAppStore.getState().connect(friend.serverHost, friend.serverPort, friend.serverUsername ?? "", friend.serverCertLabel ?? null, saved ? await getServerPassword(saved.id) : null);
        serverId = useAppStore.getState().activeServerId ?? undefined;
        if (friend.userHash) match = await invoke<FriendsMatch | null>("find_user_by_hash", { userHash: friend.userHash }) ?? undefined;
      }
      if (!serverId) {
        setStatus(`No connection information is available for ${friend.userName}.`);
        return;
      }
      if (activeServerId !== serverId) await useAppStore.getState().switchServer(serverId);
      if (match) await useAppStore.getState().selectDmUser(match.userSession);
      else if (friend.userId != null) requestFriendChannel(friend.userId);
      else {
        setStatus(`${friend.userName} is offline and has no registered account stored for offline chat.`);
        return;
      }
      onClose();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  };

  return <ModalSurface title="Friends & conversations" eyebrow="PRIVATE CONVERSATIONS" onClose={onClose} className={styles.surface}>
    <div className={styles.toolbar}>
      <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a friend or server" aria-label="Search friends" />
      <span><b>{friends.length}</b> saved</span>
    </div>
    {status && <div className={styles.status}>{status}</div>}
    <div className={styles.list}>
      {visibleFriends.map((friend) => {
        const match = matches[friend.id];
        const connected = match != null || sessions.some((session) => session.status === "connected" && friend.serverHost === session.host && friend.serverPort === session.port && friend.serverUsername === session.username);
        return <article key={friend.id} className={styles.friend}>
          <button type="button" className={styles.open} onClick={() => void openFriend(friend)} disabled={busyId != null}>
            <span className={styles.avatar}>{friend.avatar ? <img src={`data:image/png;base64,${friend.avatar}`} alt="" /> : initials(friend.userName)}</span>
            <span className={styles.identity}><strong>{match?.userName ?? friend.userName}</strong><small>{friend.serverLabel ?? (friend.serverHost ? `${friend.serverHost}:${friend.serverPort ?? 64738}` : "Unknown server")}</small></span>
            <span className={`${styles.presence} ${match ? styles.online : connected ? styles.connected : ""}`}><i />{match ? "Online" : connected ? "Offline chat" : "Disconnected"}</span>
            <MessageCircleIcon />
          </button>
          <IconButton icon={<TrashIcon />} label={`Remove ${friend.userName}`} onClick={() => void removeFriend(friend.id)} />
        </article>;
      })}
      {visibleFriends.length === 0 && <div className={styles.empty}>
        <span>{query ? <SearchIcon /> : <UsersGroupIcon />}</span>
        <strong>{query ? "No matching friends" : "No saved friends yet"}</strong>
        <p>{query ? "Try another name or server." : "Open a user profile and choose Add friend. They will appear here even when offline."}</p>
        {query && <Button onClick={() => setQuery("")}>Clear search</Button>}
      </div>}
    </div>
  </ModalSurface>;
}
