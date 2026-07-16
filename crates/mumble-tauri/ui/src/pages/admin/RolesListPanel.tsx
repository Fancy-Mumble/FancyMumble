import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../store";
import type { AclGroup } from "../../types";
import { TID } from "../../testids";
import { RoleChip } from "../../components/elements/role/RoleChip";
import { useChannelAcl } from "./useChannelAcl";
import { rootChannelId } from "./rootChannel";
import styles from "./AdminPanel.module.css";

export function RolesListPanel() {
  const channels = useAppStore((s) => s.channels);
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  const { acl, loading } = useChannelAcl(rootId);
  const [search, setSearch] = useState("");

  const visibleRoles = useMemo(() => {
    if (!acl) return [];
    const trimmed = search.trim().toLowerCase();
    return acl.groups
      .map((g, idx) => ({ group: g, idx }))
      .filter(({ group }) => !trimmed || group.name.toLowerCase().includes(trimmed));
  }, [acl, search]);

  const memberCount = (group: AclGroup): number => group.add.length + group.inherited_members.length;

  // Nothing is created here: this only opens the new-role wizard
  // (`/admin/roles/new`), which persists the draft itself once its final
  // step's "Create role" button is clicked.
  const handleCreate = () => navigate("/admin/roles/new");

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
        <button
          type="button"
          className={styles.addBtn}
          onClick={handleCreate}
          disabled={!acl}
          data-testid={TID.rolesCreateButton}
        >
          {t("roles.createRole")}
        </button>
      </div>

      {loading && !acl && <div className={styles.dimText}>{t("roles.loadingRoles")}</div>}

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
              data-testid={TID.roleListRow}
              data-role-name={group.name}
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
