import { BlockIcon, HashIcon, HeadphonesIcon, HeadphonesOffIcon, ImageIcon, MessageMinusIcon, MicIcon, MicOffIcon, StarIcon, TrashIcon, UserPlusIcon, UserXIcon, VolumeIcon } from "../../../icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { UserEntry } from "../../../types";
import { TID } from "../../../testids";
import { useAppStore } from "../../../store";
import {
  addFriend,
  removeFriend,
  getFriends,
  FRIENDS_CHANGED_EVENT,
  type Friend,
} from "../../../friendsStorage";
import { canDeleteMessages } from "../channel/ChannelEditorDialog";
import ConfirmDialog from "../../elements/ConfirmDialog";
import Toast, { type ToastData } from "../../elements/Toast";
import styles from "./UserContextMenu.module.css";
import pickerStyles from "../move/MoveUserPicker.module.css";
import { PERM_BAN, PERM_KICK, PERM_MOVE, PERM_MUTE_DEAFEN, PERM_REGISTER, PERM_RESET_USER_CONTENT } from "../../../utils/permissions";

// -- Local per-session state --------------------------------------

/** Look up the persisted volume for a user by hash (0-200, default 100). */
export function getLocalVolume(hash?: string): number {
  if (!hash) return 100;
  return useAppStore.getState().userVolumes[hash] ?? 100;
}

// -- Position computation (overflow-aware) -------------------------

interface MenuPosition {
  top: number;
  left: number;
}

function computePosition(
  clickX: number,
  clickY: number,
  menuEl: HTMLElement,
): MenuPosition {
  const { innerWidth: vw, innerHeight: vh } = window;
  const rect = menuEl.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const margin = 4;

  let left = clickX;
  let top = clickY;

  // Flip horizontally if overflowing right
  if (left + w + margin > vw) {
    left = Math.max(margin, clickX - w);
  }
  // Flip vertically if overflowing bottom
  if (top + h + margin > vh) {
    top = Math.max(margin, clickY - h);
  }

  return { top, left };
}

// -- Menu component ------------------------------------------------

export interface UserContextMenuState {
  x: number;
  y: number;
  user: UserEntry;
}

interface UserContextMenuProps {
  readonly menu: UserContextMenuState;
  readonly onClose: () => void;
}

export function UserContextMenu({ menu, onClose }: UserContextMenuProps) {
  const { user } = menu;
  const { t } = useTranslation(["sidebar", "common"]);
  const ownSession = useAppStore((s) => s.ownSession);
  const channels = useAppStore((s) => s.channels);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const currentChannel = useAppStore((s) => s.currentChannel);
  const joinChannel = useAppStore((s) => s.joinChannel);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const sessions = useAppStore((s) => s.sessions);
  const deletePchatMessages = useAppStore((s) => s.deletePchatMessages);
  const setUserVolume = useAppStore((s) => s.setUserVolume);
  const storedVolume = useAppStore((s) => user.hash ? (s.userVolumes[user.hash] ?? 100) : 100);
  const isSelf = user.session === ownSession;

  const channel = channels.find((c) => c.id === selectedChannel);
  const showDeleteMessages = !isSelf && canDeleteMessages(channel) && user.hash;

  const userChannel = channels.find((c) => c.id === user.channel_id);
  const canJoinChannel = !isSelf && user.channel_id !== currentChannel;

  const rootChannel = channels.find((c) => c.id === 0);
  const rootPerms = rootChannel?.permissions ?? 0;

  const hasRegisterPerm = (rootPerms & PERM_REGISTER) !== 0;
  const isUnregistered = user.user_id == null || user.user_id === 0;
  const canRegister = !isSelf && hasRegisterPerm && isUnregistered;

  // Mute / Deafen / Priority Speaker - MUTE_DEAFEN on the user's channel.
  const userChannelPerms = channels.find((c) => c.id === user.channel_id)?.permissions ?? 0;
  const canMuteDeafen = !isSelf && (userChannelPerms & PERM_MUTE_DEAFEN) !== 0;

  // Move - MOVE must be held on the user's current channel (source).
  // Checking any channel is too broad: the actor might own a temp channel
  // but lack Move on the channel where the target user actually sits.
  const canMoveUser = !isSelf && (userChannelPerms & PERM_MOVE) !== 0;

  // Kick / Ban - checked at root channel.
  const canKick = !isSelf && (rootPerms & PERM_KICK) !== 0;
  const canBan  = !isSelf && (rootPerms & PERM_BAN) !== 0;

  // Reset comment / Remove avatar - RESET_USER_CONTENT at root channel.
  const canResetContent = !isSelf && (rootPerms & PERM_RESET_USER_CONTENT) !== 0;

  const hasAnyAdminAction =
    canMuteDeafen || canMoveUser || canKick || canBan || canRegister || canResetContent;

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [volume, setVolume] = useState(() => storedVolume);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [deleteUserConfirm, setDeleteUserConfirm] = useState(false);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [friendEntry, setFriendEntry] = useState<Friend | null>(null);

  // Track whether the target user is already saved as a friend.  We re-run
  // on every menu open and refresh when the persisted list changes.
  useEffect(() => {
    if (isSelf) {
      setFriendEntry(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const friends = await getFriends();
      const match =
        friends.find((f) => user.hash && f.userHash === user.hash) ??
        friends.find(
          (f) =>
            !f.userHash &&
            !user.hash &&
            f.userName === user.name &&
            f.serverId === activeServerId,
        ) ??
        null;
      if (!cancelled) setFriendEntry(match);
    };
    refresh().catch((e) => console.error("load friends failed", e));
    const onChange = () => { refresh().catch(() => {}); };
    globalThis.addEventListener(FRIENDS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      globalThis.removeEventListener(FRIENDS_CHANGED_EVENT, onChange);
    };
  }, [isSelf, user.hash, user.name, activeServerId]);

  const handleFriendToggle = useCallback(async () => {
    try {
      if (friendEntry) {
        await removeFriend(friendEntry.id);
        setToast({ variant: "info", message: t("userMenu.toastFriendRemoved", { name: user.name }) });
      } else {
        const session = sessions.find((s) => s.id === activeServerId);
        await addFriend({
          userName: user.name,
          userHash: user.hash,
          serverId: activeServerId ?? undefined,
          serverLabel: session?.label,
          // Capture the registered uid + connection target so we can open the
          // friend chat while they're offline, or (re)connect to their server.
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
        setToast({ variant: "success", message: t("userMenu.toastFriendAdded", { name: user.name }) });
      }
      onClose();
    } catch (e) {
      console.error("toggle friend failed", e);
      setToast({ variant: "error", message: t("userMenu.toastFriendFailed") });
    }
  }, [friendEntry, user.name, user.hash, activeServerId, sessions, t, onClose]);

  // Compute position once the menu is rendered and we know its size.
  useEffect(() => {
    if (menuRef.current) {
      setPos(computePosition(menu.x, menu.y, menuRef.current));
    }
  }, [menu.x, menu.y]);

  // Close on Escape.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // -- Volume handler ----------------------------------------------

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      setVolume(v);
      if (user.hash) {
        setUserVolume(user.hash, v);
      }
      invoke("set_user_volume", { session: user.session, volume: v / 100 }).catch((err: unknown) =>
        console.error("set_user_volume failed:", err),
      );
    },
    [user.session, user.hash, setUserVolume],
  );

  // -- Admin actions -----------------------------------------------

  const handleAction = useCallback(
    async (action: string) => {
      try {
        switch (action) {
          case "mute":
            await invoke("mute_user", { session: user.session, muted: !user.mute });
            break;
          case "deaf":
            await invoke("deafen_user", { session: user.session, deafened: !user.deaf });
            break;
          case "priority":
            await invoke("set_priority_speaker", {
              session: user.session,
              priority: !user.priority_speaker,
            });
            break;
          case "kick":
            await invoke("kick_user", { session: user.session, reason: null });
            break;
          case "ban":
            await invoke("ban_user", { session: user.session, reason: null });
            break;
          case "reset_comment":
            await invoke("reset_user_comment", { session: user.session });
            break;
          case "remove_avatar":
            await invoke("remove_user_avatar", { session: user.session });
            break;
          case "register":
            try {
              await invoke("register_user", { session: user.session });
              setToast({ message: t("userMenu.toastRegistered", { name: user.name }), variant: "success" });
            } catch (regErr) {
              console.error("register_user failed:", regErr);
              setToast({ message: t("userMenu.toastRegisterFailed"), variant: "error" });
            }
            break;
        }
      } catch (err) {
        console.error(`Admin action "${action}" failed:`, err);
      }
      onClose();
    },
    [user, onClose],
  );

  return createPortal(
    <>
      {/* Invisible overlay to catch clicks outside */}
      <div className={styles.overlay} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={menuRef}
        className={styles.menu}
        style={pos ? { top: pos.top, left: pos.left } : { top: menu.y, left: menu.x, visibility: "hidden" }}
      >
        {/* -- Local settings -- */}
        {!isSelf && (
          <>
            <div className={styles.sectionLabel}>{ t("userMenu.sectionLocal") }</div>
            <div className={styles.volumeRow}>
              <span className={styles.menuIcon}>
                <VolumeIcon width={14} height={14} />
              </span>
              <input
                type="range"
                className={styles.volumeSlider}
                min={0}
                max={200}
                value={volume}
                onChange={handleVolumeChange}
                title={t("userMenu.volume", { volume })}
              />
              <span className={styles.volumeValue}>{volume}%</span>
            </div>
            <button
              type="button"
              className={styles.menuItem}
              data-testid={TID.userMenuFriendToggle}
              onClick={() => { void handleFriendToggle(); }}
            >
              <span className={styles.menuIcon}>
                {friendEntry
                  ? <UserXIcon width={14} height={14} />
                  : <UserPlusIcon width={14} height={14} />}
              </span>
              {friendEntry ? t("userMenu.removeFriend") : t("userMenu.addFriend")}
            </button>
            {canJoinChannel && (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  joinChannel(user.channel_id);
                  onClose();
                }}
              >
                <span className={styles.menuIcon}>
                  <HashIcon width={14} height={14} />
                </span>
                {t("userMenu.joinChannel", { channel: userChannel?.name ?? "channel" })}
              </button>
            )}
          </>
        )}

        {/* -- Admin actions -- */}
        {!isSelf && hasAnyAdminAction && (
          <>
            <div className={styles.divider} />
            <div className={styles.sectionLabel}>{ t("userMenu.sectionAdmin") }</div>
            {canMuteDeafen && (
              <button type="button" className={styles.menuItem} onClick={() => handleAction("mute")}>
                <span className={styles.menuIcon}>
                  {user.mute ? (
                    <MicIcon width={14} height={14} />
                  ) : (
                    <MicOffIcon width={14} height={14} />
                  )}
                </span>
                {user.mute ? t("userMenu.unmute") : t("userMenu.mute")}
              </button>
            )}
            {canMuteDeafen && (
              <button type="button" className={styles.menuItem} onClick={() => handleAction("deaf")}>
                <span className={styles.menuIcon}>
                  {user.deaf ? (
                    <HeadphonesIcon width={14} height={14} />
                  ) : (
                    <HeadphonesOffIcon width={14} height={14} />
                  )}
                </span>
                {user.deaf ? t("userMenu.undeafen") : t("userMenu.deafen")}
              </button>
            )}
            {canMuteDeafen && (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => handleAction("priority")}
              >
                <span className={styles.menuIcon}>
                  <StarIcon width={14} height={14} />
                </span>
                {user.priority_speaker ? t("userMenu.removePriority") : t("userMenu.prioritySpeaker")}
              </button>
            )}
            {canMoveUser && (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => setShowMoveSheet(true)}
              >
                <span className={styles.menuIcon}>
                  <HashIcon width={14} height={14} />
                </span>
                {t("userMenu.moveToChannel")}
              </button>
            )}
            {canRegister && (
              <button type="button" className={styles.menuItem} onClick={() => handleAction("register")}>
                <span className={styles.menuIcon}>
                  <UserPlusIcon width={14} height={14} />
                </span>
                {t("userMenu.register")}
              </button>
            )}
            {canResetContent && (
              <>
                <div className={styles.divider} />
                <button type="button" className={styles.menuItem} onClick={() => handleAction("reset_comment")}>
                  <span className={styles.menuIcon}>
                    <MessageMinusIcon width={14} height={14} />
                  </span>
                  {t("userMenu.resetComment")}
                </button>
                <button type="button" className={styles.menuItem} onClick={() => handleAction("remove_avatar")}>
                  <span className={styles.menuIcon}>
                    <ImageIcon width={14} height={14} />
                  </span>
                  {t("userMenu.removeAvatar")}
                </button>
              </>
            )}
            {(canKick || canBan) && <div className={styles.divider} />}
            {showDeleteMessages && (
              <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => setDeleteUserConfirm(true)}>
                <span className={styles.menuIcon}>
                  <TrashIcon width={14} height={14} />
                </span>
                {t("userMenu.deleteMessages")}
              </button>
            )}
            {canKick && (
              <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => handleAction("kick")}>
                <span className={styles.menuIcon}>
                  <UserXIcon width={14} height={14} />
                </span>
                {t("userMenu.kick")}
              </button>
            )}
            {canBan && (
              <button type="button" className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => handleAction("ban")}>
                <span className={styles.menuIcon}>
                  <BlockIcon width={14} height={14} />
                </span>
                {t("userMenu.ban")}
              </button>
            )}
          </>
        )}

        {/* Self user - minimal menu */}
        {isSelf && (
          <div className={styles.sectionLabel} style={{ padding: "8px 12px" }}>
            {t("userMenu.noActionsForSelf")}
          </div>
        )}
      </div>

      {/* Delete-by-user confirmation dialog */}
      {deleteUserConfirm && (
        <ConfirmDialog
          title={t("userMenu.deleteMessagesTitle")}
          body={t("userMenu.deleteMessagesBody", { name: user.name })}
          confirmLabel={t("userMenu.deleteConfirm")}
          danger
          onConfirm={async () => {
            if (selectedChannel !== null && user.hash) {
              try {
                await deletePchatMessages(selectedChannel, { senderHash: user.hash });
                setToast({ message: t("userMenu.toastMessagesDeleted", { name: user.name }), variant: "success" });
              } catch (err) {
                console.error("delete user messages error:", err);
                setToast({ message: t("userMenu.toastDeleteFailed"), variant: "error" });
              }
            }
            setDeleteUserConfirm(false);
            onClose();
          }}
          onCancel={() => setDeleteUserConfirm(false)}
        />
      )}

      {showMoveSheet && (
        <MoveUserChannelPicker
          user={user}
          channels={channels}
          onClose={() => setShowMoveSheet(false)}
          onMoved={(name) => {
            setShowMoveSheet(false);
            setToast({ message: t("userMenu.toastUserMoved", { name: user.name, channel: name }), variant: "success" });
            onClose();
          }}
          onError={() => {
            setShowMoveSheet(false);
            setToast({ message: t("userMenu.toastMoveFailed", { name: user.name }), variant: "error" });
          }}
        />
      )}

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </>,
    document.body,
  );
}

// -- Move-to-channel picker ---------------------------------------

interface MoveUserChannelPickerProps {
  readonly user: UserEntry;
  readonly channels: { id: number; name: string; parent_id: number | null }[];
  readonly onClose: () => void;
  readonly onMoved: (channelName: string) => void;
  readonly onError: () => void;
}

function MoveUserChannelPicker({
  user,
  channels,
  onClose,
  onMoved,
  onError,
}: MoveUserChannelPickerProps) {
  const { t } = useTranslation(["sidebar", "common"]);
  const [filter, setFilter] = useState("");
  const users = useAppStore((s) => s.users);

  const usersByChannel = useMemo(() => {
    const m = new Map<number, number>();
    for (const u of users) m.set(u.channel_id, (m.get(u.channel_id) ?? 0) + 1);
    return m;
  }, [users]);

  const filtered = useMemo(
    () =>
      channels
        .filter((c) => c.id !== user.channel_id)
        .filter((c) =>
          filter.trim() === ""
            ? true
            : (c.name ?? "").toLowerCase().includes(filter.toLowerCase()),
        )
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [channels, filter, user.channel_id],
  );

  const handlePick = useCallback(
    async (channelId: number, channelName: string) => {
      try {
        await invoke("move_user_to_channel", { session: user.session, channelId });
        onMoved(channelName || t("movePicker.root"));
      } catch (err) {
        console.error("move_user_to_channel failed:", err);
        onError();
      }
    },
    [user.session, onMoved, onError],
  );

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className={pickerStyles.overlay} onClick={onClose} />
      <div
        className={pickerStyles.dialog}
        role="dialog"
        aria-label={t("movePicker.ariaLabel", { name: user.name })}
      >
        <div className={pickerStyles.header}>
          <span className={pickerStyles.title}>{t("movePicker.title")}</span>
          <span className={pickerStyles.subtitle}>
            {t("movePicker.subtitle", { name: user.name })}
          </span>
        </div>
        <div className={pickerStyles.searchWrap}>
          <input
            type="search"
            className={pickerStyles.search}
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("movePicker.filterPlaceholder")}
          />
        </div>
        <div className={pickerStyles.list}>
          {filtered.length === 0 ? (
            <div className={pickerStyles.empty}>{t("movePicker.noChannels")}</div>
          ) : (
            filtered.map((c) => {
              const count = usersByChannel.get(c.id) ?? 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={pickerStyles.item}
                  onClick={() => handlePick(c.id, c.name)}
                >
                  <span className={pickerStyles.itemIcon}>
                    <HashIcon width={14} height={14} />
                  </span>
                  <span className={pickerStyles.itemName}>{c.name || t("movePicker.root")}</span>
                  {count > 0 && (
                    <span className={pickerStyles.itemMeta}>
                      {t("movePicker.member", { count })}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className={pickerStyles.footer}>
          <button
            type="button"
            className={pickerStyles.cancelBtn}
            onClick={onClose}
          >
            {t("common:actions.cancel")}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
