import { useTranslation } from "react-i18next";
import type { AclData, AclEntry } from "../../types";
import { PERMISSIONS } from "../../utils/permissions";
import styles from "./AdminPanel.module.css";

export interface RolePermissionsPanelProps {
  readonly acl: AclData;
  readonly roleName: string;
  readonly onAclChange: (next: AclData) => void;
  readonly disabled?: boolean;
}

/** Returns the index of the ACL entry that targets this role at apply_here, or -1. */
function findRoleAclIndex(acl: AclData, roleName: string): number {
  return acl.acls.findIndex(
    (a) => a.group === roleName && a.user_id == null && a.apply_here && !a.inherited,
  );
}

function ensureRoleAcl(acl: AclData, roleName: string): { acl: AclData; idx: number } {
  const existing = findRoleAclIndex(acl, roleName);
  if (existing !== -1) return { acl, idx: existing };
  const newEntry: AclEntry = {
    apply_here: true,
    apply_subs: true,
    inherited: false,
    user_id: null,
    group: roleName,
    grant: 0,
    deny: 0,
  };
  return { acl: { ...acl, acls: [...acl.acls, newEntry] }, idx: acl.acls.length };
}

/** Permissions sub-tab: edit grant/deny bits for the ACL rule that targets this role. */
export function RolePermissionsPanel({ acl, roleName, onAclChange, disabled }: RolePermissionsPanelProps) {
  const { t } = useTranslation("settings");
  type TFn = (key: string, opts?: Record<string, unknown>) => string;
  const tAny = t as unknown as TFn;
  const idx = findRoleAclIndex(acl, roleName);
  const entry: AclEntry | null = idx === -1 ? null : acl.acls[idx];

  const togglePerm = (bit: number, allow: boolean) => {
    const { acl: nextAcl, idx: targetIdx } = ensureRoleAcl(acl, roleName);
    const target = nextAcl.acls[targetIdx];
    const updated: AclEntry = allow
      ? { ...target, grant: target.grant | bit, deny: target.deny & ~bit }
      : { ...target, grant: target.grant & ~bit, deny: target.deny & ~bit };
    onAclChange({
      ...nextAcl,
      acls: nextAcl.acls.map((a, i) => (i === targetIdx ? updated : a)),
    });
  };

  const inheritedEntries = acl.acls.filter((a) => a.group === roleName && a.inherited);

  return (
    <div className={styles.editorMain}>
      <p className={styles.dimText}>
        {t("rolePermissions.description", { role: roleName })}
      </p>

      {entry === null && (
        <div className={styles.dimText}>{t("rolePermissions.noExplicitPerms")}</div>
      )}

      <ul className={styles.permList}>
        {PERMISSIONS.map(({ bit, label, ident }) => {
          const title = tAny(`permissionMeta.${ident}.title`) || label;
          const description = tAny(`permissionMeta.${ident}.description`)
            || t("rolePermissions.defaultDescription", { label });
          const checked = entry !== null && (entry.grant & bit) !== 0;
          const switchId = `perm-toggle-${bit}`;
          return (
            <li key={bit} className={styles.permItem}>
              <div className={styles.permText}>
                <label htmlFor={switchId} className={styles.permTitle}>
                  {title}
                </label>
                <p className={styles.permDesc}>{description}</p>
              </div>
              <label className={styles.toggleSwitch}>
                <input
                  id={switchId}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => togglePerm(bit, e.target.checked)}
                  disabled={disabled}
                />
                <span className={styles.toggleSlider} aria-hidden="true" />
              </label>
            </li>
          );
        })}
      </ul>

      {inheritedEntries.length > 0 && (
        <div className={styles.fieldset}>
          <strong>{t("rolePermissions.inheritedRules", { count: inheritedEntries.length })}</strong>
          <ul className={styles.inheritedList}>
            {inheritedEntries.map((a, i) => (
              <li key={`${a.grant}-${a.deny}-${i}`} className={styles.dimText}>
                grant=0x{a.grant.toString(16)}, deny=0x{a.deny.toString(16)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
