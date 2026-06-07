import { SearchIcon } from "../../icons";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "react-router-dom";
import type { AclData, AclGroup, RegisteredUser, RegisteredUserUpdate, UserEntry } from "../../types";
import { formatRelativeDate } from "../../utils/format";
import KebabMenu, { type KebabMenuItem } from "../../components/elements/KebabMenu";
import { RoleChip } from "../../components/elements/role/RoleChip";
import UserHoverCard from "../../components/sidebar/user/UserHoverCard";
import { useAppStore } from "../../store";
import { rootChannelId } from "./rootChannel";
import { UserRoleManagerDialog } from "./UserRoleManagerDialog";
import styles from "./AdminPanel.module.css";

/** Builds a map of `user_id -> roles` from the root-channel ACL groups. */
function buildUserRoleMap(groups: readonly AclGroup[]): Map<number, AclGroup[]> {
  const result = new Map<number, AclGroup[]>();
  for (const group of groups) {
    const memberIds = new Set([...group.add, ...group.inherited_members]);
    for (const id of memberIds) {
      const existing = result.get(id);
      if (existing) {
        existing.push(group);
      } else {
        result.set(id, [group]);
      }
    }
  }
  return result;
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

interface UserActionsArgs {
  readonly user: RegisteredUser;
  readonly isEditing: boolean;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onManageRoles: () => void;
  readonly t: TFn;
}

/** Builds the kebab-menu items for a user row. */
function buildUserActions({ user, isEditing, onRename, onDelete, onManageRoles, t }: UserActionsArgs): KebabMenuItem[] {
  return [
    {
      id: "rename",
      label: isEditing ? t("registeredUsers.actionEditing") : t("registeredUsers.actionRename"),
      disabled: isEditing,
      onClick: onRename,
    },
    {
      id: "manage-roles",
      label: t("registeredUsers.actionManageRoles"),
      onClick: onManageRoles,
    },
    {
      id: "delete",
      label: t("registeredUsers.actionDelete", { name: user.name }),
      danger: true,
      onClick: onDelete,
    },
  ];
}

type SortKey = "name" | "last_seen" | "last_channel";
type SortDir = "asc" | "desc";

export function RegisteredUsersTab() {
  const navigate = useNavigate();
  const { t } = useTranslation(["settings", "common"]);
  const tFn = t as TFn;
  const channels = useAppStore((s) => s.channels);
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  // Currently-connected users, keyed by registered id, so a registered user
  // who is online shows the same live profile card on hover as elsewhere.
  const onlineUsers = useAppStore((s) => s.users);
  const connectedById = useMemo(() => {
    const m = new Map<number, UserEntry>();
    for (const u of onlineUsers) if (u.user_id != null) m.set(u.user_id, u);
    return m;
  }, [onlineUsers]);

  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [rootAcl, setRootAcl] = useState<AclData | null>(null);
  const [roleDialogUser, setRoleDialogUser] = useState<RegisteredUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const searchRef = useRef<HTMLInputElement>(null);

  // Inline-edit state: which user_id is being renamed and its draft name.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  // Pending delete confirmation.
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Listen for user-list events from the backend.  Also clear the loading
  // state on permission-denied so the table doesn't show "Loading..." forever
  // when the server denies the request.
  useEffect(() => {
    const unlistenList = listen<RegisteredUser[]>("user-list", (event) => {
      setUsers(event.payload);
      setLoading(false);
    });
    const unlistenDenied = listen("permission-denied", () => {
      setLoading(false);
    });
    return () => {
      unlistenList.then((f) => f());
      unlistenDenied.then((f) => f());
    };
  }, []);

  // Request the user list on mount.
  useEffect(() => {
    setLoading(true);
    invoke("request_user_list").catch(() => setLoading(false));
  }, []);

  // Subscribe to root-channel ACL so we can show role chips per user.
  useEffect(() => {
    let cancelled = false;
    const unlisten = listen<AclData>("acl", (event) => {
      if (!cancelled && event.payload.channel_id === rootId) {
        setRootAcl(event.payload);
      }
    });
    invoke("request_acl", { channelId: rootId }).catch(() => {});
    return () => {
      cancelled = true;
      unlisten.then((f) => f());
    };
  }, [rootId]);

  const rootGroups = useMemo<readonly AclGroup[]>(() => rootAcl?.groups ?? [], [rootAcl]);
  const userRoleMap = useMemo(() => buildUserRoleMap(rootGroups), [rootGroups]);

  const refetchAcl = useCallback(() => {
    invoke("request_acl", { channelId: rootId }).catch(() => {});
  }, [rootId]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    invoke("request_user_list").catch(() => setLoading(false));
  }, []);

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  // --- Rename ---
  const startRename = useCallback((user: RegisteredUser) => {
    setEditingId(user.user_id);
    setEditName(user.name);
    setDeletingId(null);
    // Focus the input on next render.
    setTimeout(() => editRef.current?.focus(), 0);
  }, []);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditName("");
  }, []);

  const submitRename = useCallback(async () => {
    if (editingId === null) return;
    const trimmed = editName.trim();
    if (!trimmed) return;
    const update: RegisteredUserUpdate = { user_id: editingId, name: trimmed };
    await invoke("update_user_list", { users: [update] });
    setEditingId(null);
    setEditName("");
    // Refresh the list after the server processes the change.
    setLoading(true);
    invoke("request_user_list").catch(() => setLoading(false));
  }, [editingId, editName]);

  // --- Delete ---
  const confirmDelete = useCallback((userId: number) => {
    setDeletingId(userId);
    setEditingId(null);
  }, []);

  const cancelDelete = useCallback(() => setDeletingId(null), []);

  const submitDelete = useCallback(async () => {
    if (deletingId === null) return;
    const update: RegisteredUserUpdate = { user_id: deletingId, name: null };
    await invoke("update_user_list", { users: [update] });
    setDeletingId(null);
    setLoading(true);
    invoke("request_user_list").catch(() => setLoading(false));
  }, [deletingId]);

  // Filter + sort users.
  const filtered = users
    .filter((u) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return u.name.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "last_seen":
          return dir * (a.last_seen ?? "").localeCompare(b.last_seen ?? "");
        case "last_channel":
          return dir * ((a.last_channel ?? 0) - (b.last_channel ?? 0));
        default:
          return 0;
      }
    });

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  let emptyMessage: string;
  if (loading) emptyMessage = t("registeredUsers.loading");
  else if (users.length === 0) emptyMessage = t("registeredUsers.noUsers");
  else emptyMessage = t("registeredUsers.noMatches");

  return (
    <>
      <h2 className={styles.panelTitle}>{t("registeredUsers.title")}</h2>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <SearchIcon className={styles.searchIcon} width={14} height={14} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            type="text"
            placeholder={t("registeredUsers.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={() => { setSearch(""); searchRef.current?.focus(); }}
              aria-label={t("registeredUsers.clearSearch")}
            >
              &times;
            </button>
          )}
        </div>
        <button type="button" className={styles.refreshBtn} onClick={handleRefresh} disabled={loading}>
          {loading ? t("registeredUsers.loading") : t("registeredUsers.refresh")}
        </button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.sortable} onClick={() => toggleSort("name")}>
                {t("registeredUsers.colUsername")}{sortArrow("name")}
              </th>
              <th className={styles.sortable} onClick={() => toggleSort("last_seen")}>
                {t("registeredUsers.colLastSeen")}{sortArrow("last_seen")}
              </th>
              <th className={styles.sortable} onClick={() => toggleSort("last_channel")}>
                {t("registeredUsers.colLastChannel")}{sortArrow("last_channel")}
              </th>
              <th>{t("registeredUsers.colRoles")}</th>
              <th>{t("registeredUsers.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.emptyRow}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.user_id}>
                  <td>
                    {editingId === u.user_id ? (
                      <span className={styles.inlineEdit}>
                        <input
                          ref={editRef}
                          className={styles.inputSmall}
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitRename();
                            if (e.key === "Escape") cancelRename();
                          }}
                        />
                        <button type="button" className={styles.saveBtn} onClick={submitRename}>{t("registeredUsers.save")}</button>
                        <button type="button" className={styles.removeBtn} onClick={cancelRename}>{t("common:actions.cancel")}</button>
                      </span>
                    ) : connectedById.has(u.user_id) ? (
                      <UserHoverCard user={connectedById.get(u.user_id)!}>{u.name}</UserHoverCard>
                    ) : (
                      u.name
                    )}
                  </td>
                  <td className={styles.dimText} title={u.last_seen ?? undefined}>
                    {u.last_seen ? formatRelativeDate(u.last_seen) : t("registeredUsers.never")}
                  </td>
                  <td className={styles.dimText}>{u.last_channel ?? t("registeredUsers.unknown")}</td>
                  <td>
                    <span className={styles.userRoleChips}>
                      {(userRoleMap.get(u.user_id) ?? []).map((g) => (
                        <RoleChip
                          key={g.name}
                          name={g.name}
                          color={g.color}
                          icon={g.icon}
                          size="small"
                          onClick={() => navigate(`/admin/role/${encodeURIComponent(g.name)}`)}
                        />
                      ))}
                    </span>
                  </td>
                  <td>
                    {deletingId === u.user_id ? (
                      <span className={styles.inlineEdit}>
                        <span className={styles.confirmText}>{t("registeredUsers.deleteConfirmLabel")}</span>
                        <button type="button" className={styles.removeBtn} onClick={submitDelete}>{t("registeredUsers.deleteConfirmYes")}</button>
                        <button type="button" className={styles.refreshBtn} onClick={cancelDelete}>{t("registeredUsers.deleteConfirmNo")}</button>
                      </span>
                    ) : (
                      <KebabMenu
                        ariaLabel={tFn("registeredUsers.actionsAriaLabel", { name: u.name })}
                        items={buildUserActions({
                          user: u,
                          isEditing: editingId === u.user_id,
                          onRename: () => startRename(u),
                          onDelete: () => confirmDelete(u.user_id),
                          onManageRoles: () => {
                            setRoleDialogUser(u);
                            refetchAcl();
                          },
                          t: tFn,
                        })}
                      />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.statusBar}>
        {t("registeredUsers.statusBar", { filtered: filtered.length, total: users.length, count: users.length })}
      </div>

      {roleDialogUser && (
        <UserRoleManagerDialog
          user={roleDialogUser}
          acl={rootAcl}
          onClose={() => setRoleDialogUser(null)}
          onSaved={refetchAcl}
        />
      )}
    </>
  );
}
