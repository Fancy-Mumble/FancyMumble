import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../store";
import type { AclGroup } from "../../types";
import { RoleChip } from "../../components/elements/role/RoleChip";
import { useChannelAcl } from "./useChannelAcl";
import { rootChannelId } from "./rootChannel";
import styles from "./AdminPanel.module.css";

export function RolesListPanel() {
  const channels = useAppStore((s) => s.channels);
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  const { acl, loading, dirty, saving, setAcl, save } = useChannelAcl(rootId);
  const [search, setSearch] = useState("");

  const visibleRoles = useMemo(() => {
    if (!acl) return [];
    const trimmed = search.trim().toLowerCase();
    return acl.groups
      .map((g, idx) => ({ group: g, idx }))
      .filter(({ group }) => !trimmed || group.name.toLowerCase().includes(trimmed));
  }, [acl, search]);

  const memberCount = (group: AclGroup): number => group.add.length + group.inherited_members.length;

  const handleCreate = () => {
    if (!acl) return;
    const baseName = "new_role";
    const existing = new Set(acl.groups.map((g) => g.name));
    let name = baseName;
    let suffix = 1;
    while (existing.has(name)) {
      suffix += 1;
      name = `${baseName}_${suffix}`;
    }
    const newGroup: AclGroup = {
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
    setAcl({ ...acl, groups: [...acl.groups, newGroup] });
    save().then(() => navigate(`/admin/role/${encodeURIComponent(name)}`));
  };

  return (
    <div className={styles.rolesPanel}>
      <h2 className={styles.panelTitle}>{t("roles.title")}</h2>
      <p className={styles.dimText}>
        {t("roles.description")}
      </p>

      <div className={styles.rolesToolbar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder={t("roles.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className={styles.addBtn} onClick={handleCreate} disabled={!acl || saving}>
          {t("roles.createRole")}
        </button>
      </div>

      {loading && !acl && <div className={styles.dimText}>{t("roles.loadingRoles")}</div>}
      {dirty && <div className={styles.dimText}>{t("roles.saving")}</div>}

      {acl && visibleRoles.length === 0 && (
        <div className={styles.dimText}>{t("roles.noMatch")}</div>
      )}

      <ul className={styles.rolesList}>
        {visibleRoles.map(({ group }) => (
          <li key={group.name}>
            <button
              type="button"
              className={styles.roleRow}
              onClick={() => navigate(`/admin/role/${encodeURIComponent(group.name)}`)}
            >
              <RoleChip
                name={group.name}
                color={group.color}
                icon={group.icon}
                size="medium"
              />
              <span className={styles.roleMeta}>
                {t("roles.member", { count: memberCount(group) })}
              </span>
              {group.style_preset && (
                <span className={styles.rolePreset}>{t("roles.preset", { name: group.style_preset })}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
