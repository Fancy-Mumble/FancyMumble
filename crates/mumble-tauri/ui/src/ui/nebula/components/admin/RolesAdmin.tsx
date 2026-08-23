import { useEffect, useMemo, useState } from "react";
import { Box, Button, Checkbox, IconButton, MenuItem, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "@core/registeredTextureLease";
import { useAppStore } from "@core/store";
import { getCachedUserAvatar } from "@core/lazyBlobs";
import { useChannelAcl } from "@core/features/admin/useChannelAcl";
import { rootChannelId } from "@core/features/admin/rootChannel";
import { PERMISSIONS } from "@core/utils/permissions";
import { TID } from "@core/testids";
import type { AclData, AclEntry, AclGroup, RegisteredUser } from "@core/types";
import { RoleChip } from "@standard/components/elements/role/RoleChip";
import { RoleColorPicker } from "@standard/components/elements/role/RoleColorPicker";
import { RoleIconPicker } from "@standard/components/elements/role/RoleIconPicker";
import { RolePreviewCard } from "@standard/components/elements/role/RolePreviewCard";
import { MemberPicker } from "@standard/components/elements/MemberPicker";
import { ArrowLeftIcon, CloseIcon } from "@ui/icons";
import { SearchBox, Stack } from "../primitives";
import { EmptyState, Field, GroupTitle, SegmentedGroup, SettingsCard, ToggleRow } from "../settings/controls";
import { AdminPage } from "./controls";
import { radius } from "../../tokens";

type RoleTab = "display" | "permissions" | "members";

/**
 * Roles.
 *
 * A "role" on this server is a channel group on the root channel, so the whole
 * page is one `AclData` edited in place and saved as a unit - which is why the
 * editor is a view of this page rather than its own route, as it is in
 * Standard: there is one dirty document, and leaving it by navigating away
 * would silently discard it.
 */
export function RolesAdmin({ initialRole }: Readonly<{ initialRole?: string | null }>) {
  const { t } = useTranslation(["settings", "common"]);
  const channels = useAppStore((state) => state.channels);
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  const { acl, loading, dirty, saving, setAcl, save } = useChannelAcl(rootId);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(initialRole ?? null);
  const [tab, setTab] = useState<RoleTab>("display");
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);

  // Listener before request: a fast server's answer can beat an un-awaited
  // `listen()` and Tauri does not replay, which would leave the Members
  // picker permanently empty.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    acquireRegisteredTextures();
    void (async () => {
      const off = await listen<RegisteredUser[]>("user-list", (event) =>
        setRegisteredUsers(event.payload),
      );
      if (cancelled) return off();
      unlisten = off;
      invoke("request_user_list").catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      releaseRegisteredTextures();
    };
  }, []);

  const roleIndex = useMemo(
    () => (editing === null ? -1 : (acl?.groups.findIndex((group) => group.name === editing) ?? -1)),
    [acl, editing],
  );
  const role: AclGroup | null = roleIndex === -1 ? null : (acl?.groups[roleIndex] ?? null);

  const patchRole = (patch: Partial<AclGroup>) => {
    if (!acl || roleIndex === -1) return;
    setAcl({
      ...acl,
      groups: acl.groups.map((group, index) => (index === roleIndex ? { ...group, ...patch } : group)),
    });
    // Renaming the role being edited has to move the selection with it, or the
    // editor loses track of the row it is editing on the next render.
    if (patch.name !== undefined) setEditing(patch.name);
  };

  const createRole = () => {
    if (!acl) return;
    const base = t("roles.createRole");
    let name = base;
    for (let n = 2; acl.groups.some((group) => group.name === name); n += 1) name = `${base} ${n}`;
    const group: AclGroup = {
      name,
      inherited: false,
      inherit: true,
      inheritable: true,
      add: [],
      remove: [],
      inherited_members: [],
      color: null,
      icon: null,
      style_preset: null,
      metadata: {},
    };
    setAcl({ ...acl, groups: [...acl.groups, group] });
    setEditing(name);
    setTab("display");
  };

  const deleteRole = async () => {
    if (!acl || roleIndex === -1) return;
    const next = { ...acl, groups: acl.groups.filter((_, index) => index !== roleIndex) };
    setAcl(next);
    await save(next);
    setEditing(null);
  };

  if (editing !== null) {
    return (
      <AdminPage
        title={t("roleEditor.headingPrefix", { name: editing })}
        toolbar={
          <>
            {role != null && !role.inherited && (
              <Button size="small" color="error" disabled={saving} onClick={() => void deleteRole()}>
                {t("roleEditor.deleteRole")}
              </Button>
            )}
            {dirty && (
              <Button size="small" variant="contained" disabled={saving} onClick={() => void save()}>
                {saving ? t("roleEditor.saving") : t("roleEditor.saveChanges")}
              </Button>
            )}
          </>
        }
      >
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: "16px" }}>
          <IconButton
            size="small"
            aria-label={t("common:actions.back", { defaultValue: "Back" })}
            onClick={() => setEditing(null)}
          >
            <ArrowLeftIcon width={15} height={15} />
          </IconButton>
          <SegmentedGroup
            ariaLabel={t("roles.title")}
            value={tab}
            onChange={setTab}
            options={[
              { id: "display", label: t("roleEditor.tabDisplay") },
              { id: "permissions", label: t("roleEditor.tabPermissions") },
              { id: "members", label: t("roleEditor.tabMembers") },
            ]}
          />
        </Stack>

        {loading && !acl ? (
          <EmptyState>{t("roleEditor.loadingRole")}</EmptyState>
        ) : !role ? (
          <Box data-testid={TID.roleEditorNotFound} data-role-name={editing}>
            <EmptyState>{t("roleEditor.notFound", { name: editing })}</EmptyState>
          </Box>
        ) : tab === "display" ? (
          <RoleDisplay role={role} onPatch={patchRole} />
        ) : tab === "permissions" && acl ? (
          <RolePermissions acl={acl} roleName={role.name} onAclChange={setAcl} />
        ) : (
          <RoleMembers role={role} onPatch={patchRole} registeredUsers={registeredUsers} />
        )}
      </AdminPage>
    );
  }

  const query = search.trim().toLowerCase();
  const visible = (acl?.groups ?? []).filter(
    (group) => !query || group.name.toLowerCase().includes(query),
  );

  return (
    <AdminPage
      title={t("roles.title")}
      hint={t("roles.description")}
      toolbar={
        <>
          <Box sx={{ width: 200 }}>
            <SearchBox value={search} onChange={setSearch} placeholder={t("roles.searchPlaceholder")} />
          </Box>
          <Button
            size="small"
            variant="contained"
            disabled={!acl}
            data-testid={TID.rolesCreateButton}
            onClick={createRole}
          >
            {t("roles.createRole")}
          </Button>
          {dirty && (
            <Button size="small" variant="outlined" disabled={saving} onClick={() => void save()}>
              {saving ? t("roleEditor.saving") : t("roleEditor.saveChanges")}
            </Button>
          )}
        </>
      }
    >
      {loading && !acl ? (
        <EmptyState>{t("roles.loadingRoles")}</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>{t("roles.noMatch")}</EmptyState>
      ) : (
        <Stack gap={0.625}>
          {visible.map((group) => (
            <Box
              key={group.name}
              component="button"
              data-testid={TID.roleListRow}
              data-role-name={group.name}
              onClick={() => {
                setEditing(group.name);
                setTab("display");
              }}
              sx={(theme) => ({
                all: "unset",
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                width: "100%",
                cursor: "pointer",
                px: "14px",
                py: "11px",
                borderRadius: radius("lg"),
                background: theme.palette.nebula.card,
                border: `1px solid ${theme.palette.nebula.line}`,
                "&:hover": { background: theme.palette.nebula.hover },
              })}
            >
              <RoleChip name={group.name} color={group.color} icon={group.icon} size="medium" />
              <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
                {t("roles.member", { count: group.add.length + group.inherited_members.length })}
              </Typography>
              {group.style_preset && (
                <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
                  {t("roles.preset", { name: group.style_preset })}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </AdminPage>
  );
}

/** Display: what the role looks like wherever it is shown. */
function RoleDisplay({
  role,
  onPatch,
}: Readonly<{ role: AclGroup; onPatch: (patch: Partial<AclGroup>) => void }>) {
  const { t } = useTranslation("settings");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  // An inherited role is defined on a parent channel; it can be read here but
  // every edit would be discarded on save.
  const locked = role.inherited;
  const metadata = Object.entries(role.metadata ?? {});

  const setMetadata = (key: string, value: string | null) => {
    const next: Record<string, string> = { ...(role.metadata ?? {}) };
    if (value === null) delete next[key];
    else next[key] = value;
    onPatch({ metadata: next });
  };

  return (
    <Stack direction="row" gap={3} alignItems="flex-start" flexWrap="wrap">
      <Box sx={{ flex: 1, minWidth: 320 }}>
        <Field label={t("roleDisplay.fieldName")} sx={{ mb: "16px" }}>
          <TextField
            fullWidth
            size="small"
            value={role.name}
            disabled={locked}
            onChange={(event) => onPatch({ name: event.target.value })}
            slotProps={{
              htmlInput: { "aria-label": t("roleDisplay.fieldName"), "data-testid": TID.roleNameInput },
            }}
          />
        </Field>

        <Field label={t("roleDisplay.fieldColor")} sx={{ mb: "16px" }}>
          <RoleColorPicker value={role.color} onChange={(color) => onPatch({ color })} disabled={locked} />
        </Field>

        <Field label={t("roleDisplay.fieldIcon")} sx={{ mb: "16px" }}>
          <RoleIconPicker value={role.icon} onChange={(icon) => onPatch({ icon })} disabled={locked} />
        </Field>

        <Field label={t("roleDisplay.fieldStylePreset")} sx={{ mb: "16px" }}>
          <TextField
            select
            fullWidth
            size="small"
            value={role.style_preset ?? ""}
            disabled={locked}
            onChange={(event) => onPatch({ style_preset: event.target.value || null })}
            slotProps={{ htmlInput: { "aria-label": t("roleDisplay.fieldStylePreset") } }}
          >
            <MenuItem value="">{t("roleDisplay.presetDefault")}</MenuItem>
            <MenuItem value="neon">{t("roleDisplay.presetNeon")}</MenuItem>
            <MenuItem value="gradient">{t("roleDisplay.presetGradient")}</MenuItem>
            <MenuItem value="minimal">{t("roleDisplay.presetMinimal")}</MenuItem>
          </TextField>
        </Field>

        <GroupTitle>{t("roleDisplay.fieldMetadata")}</GroupTitle>
        {metadata.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {t("roleDisplay.noMetadata")}
          </Typography>
        )}
        <Stack gap={0.75}>
          {metadata.map(([key, value]) => (
            <Stack key={key} direction="row" alignItems="center" gap={1}>
              <Typography sx={{ flex: "0 0 130px", fontSize: 11.5, fontWeight: 600 }} noWrap>
                {key}
              </Typography>
              <TextField
                size="small"
                sx={{ flex: 1 }}
                value={value}
                disabled={locked}
                onChange={(event) => setMetadata(key, event.target.value)}
                slotProps={{ htmlInput: { "aria-label": key } }}
              />
              {!locked && (
                <IconButton
                  size="small"
                  aria-label={t("roleDisplay.removeKey", { key })}
                  onClick={() => setMetadata(key, null)}
                >
                  <CloseIcon width={13} height={13} />
                </IconButton>
              )}
            </Stack>
          ))}
        </Stack>
        {!locked && (
          <Stack direction="row" gap={1} sx={{ mt: "10px" }}>
            <TextField
              size="small"
              sx={{ flex: "0 0 130px" }}
              value={newKey}
              placeholder={t("roleDisplay.keyPlaceholder")}
              onChange={(event) => setNewKey(event.target.value)}
              slotProps={{ htmlInput: { "aria-label": t("roleDisplay.keyPlaceholder") } }}
            />
            <TextField
              size="small"
              sx={{ flex: 1 }}
              value={newValue}
              placeholder={t("roleDisplay.valuePlaceholder")}
              onChange={(event) => setNewValue(event.target.value)}
              slotProps={{ htmlInput: { "aria-label": t("roleDisplay.valuePlaceholder") } }}
            />
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                const key = newKey.trim();
                if (!key) return;
                setMetadata(key, newValue);
                setNewKey("");
                setNewValue("");
              }}
            >
              {t("roleDisplay.addButton")}
            </Button>
          </Stack>
        )}
      </Box>

      <Box sx={{ flex: "none", width: 240, position: "sticky", top: 0 }}>
        <RolePreviewCard name={role.name} color={role.color} icon={role.icon} />
      </Box>
    </Stack>
  );
}

/** The index of the rule this role's permissions live on, or -1. */
function findRoleAclIndex(acl: AclData, roleName: string): number {
  return acl.acls.findIndex(
    (entry) => entry.group === roleName && entry.user_id == null && entry.apply_here && !entry.inherited,
  );
}

/**
 * Permissions: the grant/deny bits on the one rule that targets this role.
 *
 * A role with no rule yet has none to edit, so the first switch creates it -
 * `ensureRoleAcl` - rather than the page requiring a separate "add rule" step
 * for something the user has already asked for by flipping a permission.
 */
function RolePermissions({
  acl,
  roleName,
  onAclChange,
}: Readonly<{ acl: AclData; roleName: string; onAclChange: (next: AclData) => void }>) {
  const { t } = useTranslation("settings");
  type DynamicT = (key: string, options?: Record<string, unknown>) => string;
  const tDynamic = t as unknown as DynamicT;

  const index = findRoleAclIndex(acl, roleName);
  const entry: AclEntry | null = index === -1 ? null : acl.acls[index];
  const inherited = acl.acls.filter((rule) => rule.group === roleName && rule.inherited);

  const toggle = (bit: number, allow: boolean) => {
    let next = acl;
    let target = findRoleAclIndex(acl, roleName);
    if (target === -1) {
      const created: AclEntry = {
        apply_here: true,
        apply_subs: true,
        inherited: false,
        user_id: null,
        group: roleName,
        grant: 0,
        deny: 0,
      };
      next = { ...acl, acls: [...acl.acls, created] };
      target = acl.acls.length;
    }
    const rule = next.acls[target];
    // Turning a permission off clears both bits rather than setting deny: an
    // explicit deny also overrides grants the user inherits elsewhere, which
    // is a stronger statement than the switch is making.
    const updated: AclEntry = allow
      ? { ...rule, grant: rule.grant | bit, deny: rule.deny & ~bit }
      : { ...rule, grant: rule.grant & ~bit, deny: rule.deny & ~bit };
    onAclChange({ ...next, acls: next.acls.map((a, i) => (i === target ? updated : a)) });
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography sx={(theme) => ({ mb: "14px", fontSize: 11.5, color: theme.palette.nebula.muted })}>
        {t("rolePermissions.description", { role: roleName })}
      </Typography>
      {entry === null && (
        <Typography sx={(theme) => ({ mb: "12px", fontSize: 11.5, color: theme.palette.nebula.dim })}>
          {t("rolePermissions.noExplicitPerms")}
        </Typography>
      )}

      {PERMISSIONS.map(({ bit, label, ident }) => (
        <ToggleRow
          key={bit}
          title={tDynamic(`permissionMeta.${ident}.title`) || label}
          hint={
            tDynamic(`permissionMeta.${ident}.description`) ||
            t("rolePermissions.defaultDescription", { label })
          }
          checked={entry !== null && (entry.grant & bit) !== 0}
          onChange={() => toggle(bit, !(entry !== null && (entry.grant & bit) !== 0))}
        />
      ))}

      {inherited.length > 0 && (
        <>
          <GroupTitle>{t("rolePermissions.inheritedRules", { count: inherited.length })}</GroupTitle>
          <SettingsCard>
            {inherited.map((rule, i) => (
              <Typography
                key={`${rule.grant}-${rule.deny}-${i}`}
                sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}
              >
                grant=0x{rule.grant.toString(16)}, deny=0x{rule.deny.toString(16)}
              </Typography>
            ))}
          </SettingsCard>
        </>
      )}
    </Box>
  );
}

/** Members: who is in the role, who is explicitly kept out, and inheritance. */
function RoleMembers({
  role,
  onPatch,
  registeredUsers,
}: Readonly<{
  role: AclGroup;
  onPatch: (patch: Partial<AclGroup>) => void;
  registeredUsers: readonly RegisteredUser[];
}>) {
  const { t } = useTranslation("settings");
  const onlineUsers = useAppStore((state) => state.users);
  const locked = role.inherited;

  const candidates = useMemo(
    () => registeredUsers.map((user) => ({ user_id: user.user_id, name: user.name })),
    [registeredUsers],
  );
  const resolveName = (id: number) =>
    registeredUsers.find((user) => user.user_id === id)?.name ?? `User #${id}`;
  // Avatars only exist for users who are online: the registered list carries
  // no texture, so an offline member simply has none to show.
  const getAvatar = (id: number): string | null => {
    const live = onlineUsers.find((user) => user.user_id === id);
    return live ? getCachedUserAvatar(live.session, live.texture_size) : null;
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <GroupTitle>{t("roleMembers.legendMembers")}</GroupTitle>
      <MemberPicker
        value={role.add}
        candidates={candidates}
        resolveName={resolveName}
        getAvatar={getAvatar}
        onChange={(add) => onPatch({ add })}
        disabled={locked}
        emptyLabel={t("roleMembers.emptyMembers")}
        placeholder={t("roleMembers.addUserPlaceholder")}
      />

      <GroupTitle hint={t("roleMembers.excludedDesc")}>{t("roleMembers.legendExcluded")}</GroupTitle>
      <MemberPicker
        value={role.remove}
        candidates={candidates}
        resolveName={resolveName}
        getAvatar={getAvatar}
        onChange={(remove) => onPatch({ remove })}
        disabled={locked}
        emptyLabel={t("roleMembers.emptyExclusions")}
        placeholder={t("roleMembers.addUserPlaceholder")}
      />

      {role.inherited_members.length > 0 && (
        <>
          <GroupTitle>
            {t("roleMembers.legendInherited", { count: role.inherited_members.length })}
          </GroupTitle>
          <Stack direction="row" gap={0.5} flexWrap="wrap">
            {role.inherited_members.map((id) => (
              <Box
                key={id}
                component="span"
                sx={(theme) => ({
                  px: "9px",
                  py: "3px",
                  borderRadius: "999px",
                  fontSize: 11,
                  background: theme.palette.nebula.card2,
                  color: theme.palette.nebula.muted,
                })}
              >
                {resolveName(id)}
              </Box>
            ))}
          </Stack>
        </>
      )}

      <GroupTitle>{t("roleMembers.legendInheritance")}</GroupTitle>
      <Stack gap={0.25}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Checkbox
            size="small"
            checked={role.inherit}
            disabled={locked}
            onChange={(event) => onPatch({ inherit: event.target.checked })}
            slotProps={{ input: { "aria-label": t("roleMembers.inheritFromParent") } }}
          />
          <Typography sx={{ fontSize: 12.5 }}>{t("roleMembers.inheritFromParent")}</Typography>
        </Stack>
        <Stack direction="row" alignItems="center" gap={1}>
          <Checkbox
            size="small"
            checked={role.inheritable}
            disabled={locked}
            onChange={(event) => onPatch({ inheritable: event.target.checked })}
            slotProps={{ input: { "aria-label": t("roleMembers.allowChildInherit") } }}
          />
          <Typography sx={{ fontSize: 12.5 }}>{t("roleMembers.allowChildInherit")}</Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
