import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "@core/registeredTextureLease";
import { useAppStore } from "@core/store";
import { rootChannelId } from "@core/features/admin/rootChannel";
import { formatRelativeDate } from "@core/utils/format";
import { TID } from "@core/testids";
import type { AclData, AclGroup, RegisteredUser, RegisteredUserUpdate, UserEntry } from "@core/types";
import { RoleChip } from "@standard/components/elements/role/RoleChip";
import { KebabMenuIcon } from "@ui/icons";
import { SearchBox, Stack } from "../primitives";
import { Banner } from "../settings/controls";
import { AdminPage, DataTable, type Column } from "./controls";

type SortKey = "name" | "last_seen" | "last_channel";

/** `user_id -> roles`, from the root channel's ACL groups. */
function buildUserRoleMap(groups: readonly AclGroup[]): Map<number, AclGroup[]> {
  const result = new Map<number, AclGroup[]>();
  for (const group of groups) {
    for (const id of new Set([...group.add, ...group.inherited_members])) {
      const existing = result.get(id);
      if (existing) existing.push(group);
      else result.set(id, [group]);
    }
  }
  return result;
}

/**
 * The registered-users table.
 *
 * Roles are read from the *root channel's* ACL rather than from the user list,
 * because a "role" on this server is channel-group membership and the root
 * channel is where the server-wide ones live. That is a second subscription
 * with its own request, which is why the page can show users before it can
 * show their roles.
 */
export function UsersAdmin({ onOpenRole }: Readonly<{ onOpenRole?: (roleName: string) => void }>) {
  const { t } = useTranslation(["settings", "common"]);
  const channels = useAppStore((state) => state.channels);
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  const onlineUsers = useAppStore((state) => state.users);
  // A registered user who happens to be online should show the same live
  // profile the rest of the client shows, not a second, staler version.
  const connectedById = useMemo(() => {
    const map = new Map<number, UserEntry>();
    for (const user of onlineUsers) if (user.user_id != null) map.set(user.user_id, user);
    return map;
  }, [onlineUsers]);

  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [rootAcl, setRootAcl] = useState<AclData | null>(null);
  const [roleDialogUser, setRoleDialogUser] = useState<RegisteredUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<RegisteredUser | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; user: RegisteredUser } | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // The request must go out only after the listeners are registered:
  // `listen()` is an async IPC round trip, and against a local server the
  // response can beat an un-awaited registration. Tauri does not replay
  // events, so losing that race leaves the table loading for ever.
  // `permission-denied` clears the state too, or a refusal hangs it just as
  // effectively as a lost event.
  useEffect(() => {
    let cancelled = false;
    const offs: (() => void)[] = [];
    // The response makes the backend cache every registered avatar; the lease
    // is what lets it drop them again when no page is showing them.
    acquireRegisteredTextures();
    void (async () => {
      const [offList, offDenied] = await Promise.all([
        listen<RegisteredUser[]>("user-list", (event) => {
          setUsers(event.payload);
          setLoading(false);
        }),
        listen("permission-denied", () => setLoading(false)),
      ]);
      if (cancelled) {
        offList();
        offDenied();
        return;
      }
      offs.push(offList, offDenied);
      setLoading(true);
      invoke("request_user_list").catch(() => setLoading(false));
    })();
    return () => {
      cancelled = true;
      for (const off of offs) off();
      releaseRegisteredTextures();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const off = await listen<AclData>("acl", (event) => {
        if (!cancelled && event.payload.channel_id === rootId) setRootAcl(event.payload);
      });
      if (cancelled) return off();
      unlisten = off;
      invoke("request_acl", { channelId: rootId }).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [rootId]);

  const userRoles = useMemo(() => buildUserRoleMap(rootAcl?.groups ?? []), [rootAcl]);

  const refresh = useCallback(() => {
    setLoading(true);
    invoke("request_user_list").catch(() => setLoading(false));
  }, []);
  const refetchAcl = useCallback(() => {
    invoke("request_acl", { channelId: rootId }).catch(() => undefined);
  }, [rootId]);

  const submitRename = async () => {
    if (editingId === null) return;
    const name = editName.trim();
    if (!name) return;
    const update: RegisteredUserUpdate = { user_id: editingId, name };
    await invoke("update_user_list", { users: [update] });
    setEditingId(null);
    setEditName("");
    refresh();
  };

  // A registration is deleted by updating the user with a null name; there is
  // no separate unregister call.
  const submitDelete = async () => {
    if (!deleting) return;
    const update: RegisteredUserUpdate = { user_id: deleting.user_id, name: null };
    await invoke("update_user_list", { users: [update] });
    setDeleting(null);
    refresh();
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = query ? users.filter((user) => user.name.toLowerCase().includes(query)) : [...users];
    const direction = sortDir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      if (sortKey === "name") return direction * a.name.localeCompare(b.name);
      if (sortKey === "last_seen") return direction * (a.last_seen ?? "").localeCompare(b.last_seen ?? "");
      return direction * ((a.last_channel ?? 0) - (b.last_channel ?? 0));
    });
  }, [users, search, sortKey, sortDir]);

  const sortable = (key: SortKey, header: string) => (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else {
          setSortKey(key);
          setSortDir("asc");
        }
      }}
      sx={{ cursor: "pointer", userSelect: "none" }}
    >
      {header}
      {sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </Box>
  );

  const columns: Column<RegisteredUser>[] = [
    {
      key: "name",
      header: sortable("name", t("registeredUsers.colUsername")),
      cell: (user) =>
        editingId === user.user_id ? (
          <Stack direction="row" gap={0.75} alignItems="center">
            <TextField
              inputRef={editRef}
              size="small"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitRename();
                if (event.key === "Escape") {
                  setEditingId(null);
                  setEditName("");
                }
              }}
              slotProps={{
                htmlInput: {
                  "aria-label": t("registeredUsers.renameAriaLabel", { defaultValue: "User name" }),
                },
              }}
            />
            <Button size="small" variant="contained" onClick={() => void submitRename()}>
              {t("registeredUsers.save")}
            </Button>
            <Button
              size="small"
              onClick={() => {
                setEditingId(null);
                setEditName("");
              }}
            >
              {t("common:actions.cancel")}
            </Button>
          </Stack>
        ) : (
          <Box
            component="span"
            sx={(theme) => ({
              fontWeight: 500,
              color: connectedById.has(user.user_id) ? theme.palette.nebula.text : undefined,
            })}
          >
            {user.name}
          </Box>
        ),
    },
    {
      key: "last_seen",
      header: sortable("last_seen", t("registeredUsers.colLastSeen")),
      cell: (user) => (
        <Box
          component="span"
          title={user.last_seen ?? undefined}
          sx={(theme) => ({ color: theme.palette.nebula.muted })}
        >
          {user.last_seen ? formatRelativeDate(user.last_seen) : t("registeredUsers.never")}
        </Box>
      ),
    },
    {
      key: "last_channel",
      header: sortable("last_channel", t("registeredUsers.colLastChannel")),
      cell: (user) => (
        <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.muted })}>
          {user.last_channel ?? t("registeredUsers.unknown")}
        </Box>
      ),
    },
    {
      key: "roles",
      header: t("registeredUsers.colRoles"),
      cell: (user) => (
        <Stack direction="row" gap={0.5} flexWrap="wrap">
          {(userRoles.get(user.user_id) ?? []).map((group) => (
            <RoleChip
              key={group.name}
              name={group.name}
              color={group.color}
              icon={group.icon}
              size="small"
              onClick={onOpenRole ? () => onOpenRole(group.name) : undefined}
            />
          ))}
        </Stack>
      ),
    },
    {
      key: "actions",
      header: t("registeredUsers.colActions"),
      width: 56,
      align: "right",
      cell: (user) => (
        <IconButton
          size="small"
          aria-label={t("registeredUsers.actionsAriaLabel", { name: user.name })}
          onClick={(event) => setMenu({ anchor: event.currentTarget, user })}
        >
          <KebabMenuIcon width={15} height={15} />
        </IconButton>
      ),
    },
  ];
  return (
    <AdminPage
      wide
      title={t("registeredUsers.title")}
      toolbar={
        <>
          <Box sx={{ width: 220 }}>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder={t("registeredUsers.searchPlaceholder")}
            />
          </Box>
          <Button size="small" variant="outlined" disabled={loading} onClick={refresh}>
            {loading ? t("registeredUsers.loading") : t("registeredUsers.refresh")}
          </Button>
        </>
      }
    >
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(user) => String(user.user_id)}
        rowAttrs={(user) => ({ "data-testid": TID.registeredUserRow, "data-user-name": user.name })}
        empty={
          loading
            ? t("registeredUsers.loading")
            : users.length === 0
              ? t("registeredUsers.noUsers")
              : t("registeredUsers.noMatches")
        }
      />

      <Typography sx={(theme) => ({ mt: "10px", fontSize: 11, color: theme.palette.nebula.dim })}>
        {t("registeredUsers.statusBar", {
          filtered: filtered.length,
          total: users.length,
          count: users.length,
        })}
      </Typography>

      <Menu anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem
          disabled={menu !== null && editingId === menu.user.user_id}
          onClick={() => {
            if (!menu) return;
            setEditingId(menu.user.user_id);
            setEditName(menu.user.name);
            setDeleting(null);
            setMenu(null);
            // The input does not exist until the table re-renders in edit mode.
            setTimeout(() => editRef.current?.focus(), 0);
          }}
        >
          {menu !== null && editingId === menu.user.user_id
            ? t("registeredUsers.actionEditing")
            : t("registeredUsers.actionRename")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!menu) return;
            setRoleDialogUser(menu.user);
            refetchAcl();
            setMenu(null);
          }}
        >
          {t("registeredUsers.actionManageRoles")}
        </MenuItem>
        <MenuItem
          sx={(theme) => ({ color: theme.palette.nebula.bad })}
          onClick={() => {
            if (!menu) return;
            setDeleting(menu.user);
            setEditingId(null);
            setMenu(null);
          }}
        >
          {menu ? t("registeredUsers.actionUnregister", { name: menu.user.name }) : ""}
        </MenuItem>
      </Menu>

      {roleDialogUser && (
        <RoleManagerDialog
          user={roleDialogUser}
          acl={rootAcl}
          onClose={() => setRoleDialogUser(null)}
          onSaved={refetchAcl}
        />
      )}

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
          {t("registeredUsers.unregisterTitle")}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5 }}>
            {deleting ? t("registeredUsers.unregisterBody", { name: deleting.name }) : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setDeleting(null)}>
            {t("common:actions.cancel")}
          </Button>
          <Button size="small" color="error" variant="contained" onClick={() => void submitDelete()}>
            {t("registeredUsers.unregisterConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </AdminPage>
  );
}

/**
 * Which server-wide roles a user holds.
 *
 * Saved by pushing a patched root-channel `AclData` back, so only the groups
 * that actually changed are rewritten - resending every group would clobber
 * concurrent edits made from another client between load and save.
 *
 * A membership that comes from a parent channel cannot be removed here, so its
 * checkbox is disabled rather than offering an edit the server would refuse.
 */
function RoleManagerDialog({
  user,
  acl,
  onClose,
  onSaved,
}: Readonly<{
  user: RegisteredUser;
  acl: AclData | null;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const { t } = useTranslation(["settings", "common"]);
  const groups = useMemo(() => acl?.groups ?? [], [acl]);

  const initial = useMemo(() => {
    const set = new Set<string>();
    for (const group of groups) if (group.add.includes(user.user_id)) set.add(group.name);
    return set;
  }, [groups, user.user_id]);

  const [membership, setMembership] = useState<Set<string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeded when the ACL finally arrives, since the dialog opens before it.
  useEffect(() => setMembership(initial), [initial]);

  const rows = useMemo(
    () =>
      groups
        // `~`-prefixed groups are the server's own; they are not roles.
        .filter((group) => !group.name.startsWith("~"))
        .map((group) => {
          const added = group.add.includes(user.user_id);
          const inherited = group.inherited_members.includes(user.user_id);
          return { group, inheritedOnly: inherited && !added };
        })
        .sort((a, b) => a.group.name.localeCompare(b.group.name)),
    [groups, user.user_id],
  );

  const dirty =
    membership.size !== initial.size || [...membership].some((name) => !initial.has(name));

  const save = async () => {
    if (!dirty || saving || !acl) return;
    setSaving(true);
    setError(null);
    const patched: AclGroup[] = acl.groups.map((group) => {
      const shouldBeMember = membership.has(group.name);
      if (shouldBeMember === group.add.includes(user.user_id)) return group;
      return {
        ...group,
        add: shouldBeMember
          ? [...group.add, user.user_id]
          : group.add.filter((id) => id !== user.user_id),
        // Adding somebody also has to lift an explicit removal, or the two
        // lists disagree and the server keeps them out.
        remove: shouldBeMember ? group.remove.filter((id) => id !== user.user_id) : group.remove,
      };
    });
    try {
      await invoke("update_acl", { acl: { ...acl, groups: patched } });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
        {t("roleManagerDialog.title", { name: user.name })}
      </DialogTitle>
      <DialogContent>
        {acl === null ? (
          <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
            {t("roleManagerDialog.loading")}
          </Typography>
        ) : rows.length === 0 ? (
          <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
            {t("roleManagerDialog.noRoles")}
          </Typography>
        ) : (
          <Stack gap={0.25}>
            {rows.map(({ group, inheritedOnly }) => {
              const checked = membership.has(group.name);
              return (
                <Stack key={group.name} direction="row" alignItems="center" gap={1}>
                  <Checkbox
                    size="small"
                    checked={checked}
                    disabled={inheritedOnly && !checked}
                    onChange={() =>
                      setMembership((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.name)) next.delete(group.name);
                        else next.add(group.name);
                        return next;
                      })
                    }
                    slotProps={{ input: { "aria-label": group.name } }}
                  />
                  <RoleChip name={group.name} color={group.color} icon={group.icon} size="small" />
                  {inheritedOnly && (
                    <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
                      {t("roleManagerDialog.inherited")}
                    </Typography>
                  )}
                </Stack>
              );
            })}
          </Stack>
        )}
        {error && <Banner tone="danger">{error}</Banner>}
      </DialogContent>
      <DialogActions>
        <Button size="small" disabled={saving} onClick={onClose}>
          {t("common:actions.cancel")}
        </Button>
        <Button size="small" variant="contained" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? t("roleManagerDialog.saving") : t("roleManagerDialog.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
