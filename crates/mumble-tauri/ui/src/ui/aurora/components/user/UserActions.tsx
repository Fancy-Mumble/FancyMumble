import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UserEntry } from "@core/types";
import { useAppStore } from "@core/store";
import { addFriend, getFriends, removeFriend, type Friend } from "@core/friendsStorage";
import {
  getUserRelation,
  updateUserRelation,
  userRelationIdentity,
  type UserRelation,
} from "@core/userRelationsStorage";
import {
  PERM_BAN,
  PERM_KICK,
  PERM_MOVE,
  PERM_MUTE_DEAFEN,
  PERM_REGISTER,
  PERM_RESET_USER_CONTENT,
} from "@core/utils/permissions";
import {
  applyUserShortcut,
  clearUserShortcut,
  loadUserShortcuts,
  saveUserShortcuts,
  type UserShortcut,
} from "@core/features/settings/userShortcuts";
import { Button, TextField } from "../primitives";
import styles from "../../AuroraClientExtensions.module.css";

type AdminAction =
  | "mute"
  | "deaf"
  | "priority"
  | "kick"
  | "ban"
  | "register"
  | "unregister"
  | "reset_comment"
  | "remove_avatar";

export default function UserActions({ user }: { user: UserEntry }) {
  const channels = useAppStore((state) => state.channels);
  const ownSession = useAppStore((state) => state.ownSession);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const sessions = useAppStore((state) => state.sessions);
  const storedVolume = useAppStore((state) => (user.hash ? (state.userVolumes[user.hash] ?? 100) : 100));
  const [volume, setVolume] = useState(storedVolume);
  const [friend, setFriend] = useState<Friend | null>(null);
  const [relation, setRelation] = useState<UserRelation>({ blocked: false, ignored: false, note: "" });
  const [note, setNote] = useState("");
  const [moveTarget, setMoveTarget] = useState(user.channel_id);
  const [pendingAction, setPendingAction] = useState<AdminAction | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState<UserShortcut | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState("");
  const identity = userRelationIdentity(user);
  const isSelf = user.session === ownSession;

  useEffect(() => {
    void getFriends().then((entries) =>
      setFriend(
        entries.find((entry) =>
          user.hash
            ? entry.userHash === user.hash
            : entry.userName === user.name && entry.serverId === activeServerId,
        ) ?? null,
      ),
    );
    void getUserRelation(identity).then((value) => {
      setRelation(value);
      setNote(value.note);
    });
    void loadUserShortcuts().then((entries) => {
      const match =
        entries.find((entry) =>
          user.hash
            ? entry.userHash === user.hash
            : entry.userName === user.name && entry.serverId === activeServerId,
        ) ?? null;
      setShortcut(match);
      setShortcutDraft(match?.hotkey ?? "");
    });
  }, [activeServerId, identity, user.hash, user.name]);

  const permissions = useMemo(() => {
    const root = channels.find((channel) => channel.id === 0)?.permissions ?? 0;
    const local = channels.find((channel) => channel.id === user.channel_id)?.permissions ?? 0;
    return {
      mute: !!(local & PERM_MUTE_DEAFEN),
      move: !!(local & PERM_MOVE),
      kick: !!(root & PERM_KICK),
      ban: !!(root & PERM_BAN),
      register: !!(root & PERM_REGISTER),
      reset: !!(root & PERM_RESET_USER_CONTENT),
    };
  }, [channels, user.channel_id]);

  if (isSelf) return null;

  const setVolumeValue = (next: number) => {
    setVolume(next);
    if (user.hash) useAppStore.getState().setUserVolume(user.hash, next);
    void invoke("set_user_volume", { session: user.session, volume: next / 100 });
  };
  const toggleFriend = async () => {
    if (friend) {
      await removeFriend(friend.id);
      setFriend(null);
      setStatus("Removed from friends");
      return;
    }
    const session = sessions.find((entry) => entry.id === activeServerId);
    const created = await addFriend({
      userName: user.name,
      userHash: user.hash,
      serverId: activeServerId ?? undefined,
      serverLabel: session?.label,
      userId: user.user_id ?? undefined,
      serverHost: session?.host,
      serverPort: session?.port,
      serverUsername: session?.username,
      serverCertLabel: session?.certLabel,
    });
    setFriend(created);
    setStatus("Added to friends");
  };
  const patchRelation = async (patch: Partial<UserRelation>) => {
    const next = await updateUserRelation(identity, patch);
    setRelation(next);
    setStatus("Local preference saved");
  };
  const runAdmin = async (action: AdminAction) => {
    const commands: Record<AdminAction, [string, Record<string, unknown>]> = {
      mute: ["mute_user", { session: user.session, muted: !user.mute }],
      deaf: ["deafen_user", { session: user.session, deafened: !user.deaf }],
      priority: ["set_priority_speaker", { session: user.session, priority: !user.priority_speaker }],
      kick: ["kick_user", { session: user.session, reason: null }],
      ban: ["ban_user", { session: user.session, reason: null }],
      register: ["register_user", { session: user.session }],
      unregister: ["update_user_list", { users: [{ user_id: user.user_id, name: null }] }],
      reset_comment: ["reset_user_comment", { session: user.session }],
      remove_avatar: ["remove_user_avatar", { session: user.session }],
    };
    try {
      const [command, args] = commands[action];
      await invoke(command, args);
      setStatus("Action completed");
    } catch (reason) {
      setStatus(`Action failed: ${String(reason)}`);
    } finally {
      setPendingAction(null);
    }
  };
  const move = async () => {
    try {
      await invoke("move_user_to_channel", { session: user.session, channelId: moveTarget });
      setStatus("User moved");
    } catch (reason) {
      setStatus(`Move failed: ${String(reason)}`);
    }
  };
  const saveShortcut = async () => {
    const entries = await loadUserShortcuts();
    if (shortcut?.hotkey) await clearUserShortcut(shortcut.hotkey);
    const next: UserShortcut = {
      id: shortcut?.id ?? crypto.randomUUID(),
      hotkey: shortcutDraft.trim(),
      userName: user.name,
      userHash: user.hash,
      serverId: activeServerId ?? undefined,
      serverLabel: sessions.find((entry) => entry.id === activeServerId)?.label,
    };
    const updated = [...entries.filter((entry) => entry.id !== next.id), ...(next.hotkey ? [next] : [])];
    await saveUserShortcuts(updated);
    if (next.hotkey) await applyUserShortcut(next);
    setShortcut(next.hotkey ? next : null);
    setStatus(next.hotkey ? "User shortcut registered" : "User shortcut removed");
  };

  return (
    <section className={styles.userActions}>
      <h3>Local controls</h3>
      <label className={styles.volumeControl}>
        <span>
          Personal volume <b>{volume}%</b>
        </span>
        <input
          type="range"
          min={0}
          max={200}
          value={volume}
          onChange={(event) => setVolumeValue(Number(event.target.value))}
        />
      </label>
      <div className={styles.userActionGrid}>
        <Button onClick={() => void toggleFriend()}>{friend ? "Remove friend" : "Add friend"}</Button>
        <Button onClick={() => void patchRelation({ ignored: !relation.ignored })}>
          {relation.ignored ? "Show messages" : "Ignore messages"}
        </Button>
        <Button onClick={() => void patchRelation({ blocked: !relation.blocked })}>
          {relation.blocked ? "Unblock DMs" : "Block DMs"}
        </Button>
        <Button onClick={() => setVolumeValue(volume === 0 ? 100 : 0)}>
          {volume === 0 ? "Unmute locally" : "Mute locally"}
        </Button>
      </div>
      <TextField
        label="Private note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => void patchRelation({ note })}
        placeholder="Only visible to you"
      />
      <div className={styles.userShortcut}>
        <TextField
          label="Jump-to-DM shortcut"
          value={shortcutDraft}
          onChange={(event) => setShortcutDraft(event.target.value)}
          placeholder="Example: Ctrl+Alt+1"
        />
        <Button onClick={() => void saveShortcut()}>Save shortcut</Button>
      </div>
      {permissions.move && (
        <div className={styles.moveUser}>
          <label>
            Move to
            <select value={moveTarget} onChange={(event) => setMoveTarget(Number(event.target.value))}>
              {channels
                .filter((channel) => !channel.detached)
                .map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
            </select>
          </label>
          <Button onClick={() => void move()} disabled={moveTarget === user.channel_id}>
            Move
          </Button>
        </div>
      )}
      {(permissions.mute ||
        permissions.kick ||
        permissions.ban ||
        permissions.register ||
        permissions.reset) && (
        <>
          <h3>Moderation</h3>
          <div className={styles.userActionGrid}>
            {permissions.mute && (
              <>
                <Button onClick={() => setPendingAction("mute")}>
                  {user.mute ? "Server unmute" : "Server mute"}
                </Button>
                <Button onClick={() => setPendingAction("deaf")}>
                  {user.deaf ? "Server undeafen" : "Server deafen"}
                </Button>
                <Button onClick={() => setPendingAction("priority")}>
                  {user.priority_speaker ? "Remove priority" : "Priority speaker"}
                </Button>
              </>
            )}
            {permissions.register && (
              <Button onClick={() => setPendingAction(user.user_id == null ? "register" : "unregister")}>
                {user.user_id == null ? "Register user" : "Unregister user"}
              </Button>
            )}
            {permissions.reset && (
              <>
                <Button onClick={() => setPendingAction("reset_comment")}>Reset profile text</Button>
                <Button onClick={() => setPendingAction("remove_avatar")}>Remove avatar</Button>
              </>
            )}
            {permissions.kick && (
              <Button variant="danger" onClick={() => setPendingAction("kick")}>
                Kick
              </Button>
            )}
            {permissions.ban && (
              <Button variant="danger" onClick={() => setPendingAction("ban")}>
                Ban
              </Button>
            )}
          </div>
        </>
      )}
      {pendingAction && (
        <div className={styles.confirmAction}>
          <span>
            Confirm {pendingAction.replace("_", " ")} for {user.name}?
          </span>
          <Button variant="danger" onClick={() => void runAdmin(pendingAction)}>
            Confirm
          </Button>
          <Button onClick={() => setPendingAction(null)}>Cancel</Button>
        </div>
      )}
      {status && (
        <p className={styles.actionStatus} role="status">
          {status}
        </p>
      )}
    </section>
  );
}
