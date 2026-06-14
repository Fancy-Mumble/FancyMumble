import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { AclGroup } from "../../types";
import styles from "./AdminPanel.module.css";

interface UserLike {
  session: number;
  name: string;
  user_id?: number | null;
}

export function GroupsPanel({
  groups,
  users,
  registeredNames,
  onAdd,
  onRemove,
  onPatch,
}: Readonly<{
  groups: AclGroup[];
  users: UserLike[];
  registeredNames: Map<number, string>;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onPatch: (idx: number, patch: Partial<AclGroup>) => void;
}>) {
  const { t } = useTranslation("settings");
  return (
    <>
      <div className={styles.aclSectionHeader}>
        <span className={styles.aclSectionTitle}>{t("groups.sectionTitle")}</span>
        <button type="button" className={styles.addBtn} onClick={onAdd}>
          {t("groups.addGroup")}
        </button>
      </div>
      {groups.length === 0 ? (
        <div className={styles.dimText}>{t("groups.noGroups")}</div>
      ) : (
        groups.map((g, i) => (
          <GroupCard
            key={`group-${i}`}
            group={g}
            index={i}
            users={users}
            registeredNames={registeredNames}
            onPatch={onPatch}
            onRemove={onRemove}
          />
        ))
      )}
    </>
  );
}

function GroupCard({
  group,
  index,
  users,
  registeredNames,
  onPatch,
  onRemove,
}: Readonly<{
  group: AclGroup;
  index: number;
  users: UserLike[];
  registeredNames: Map<number, string>;
  onPatch: (idx: number, patch: Partial<AclGroup>) => void;
  onRemove: (idx: number) => void;
}>) {
  const [addInput, setAddInput] = useState("");
  const [removeInput, setRemoveInput] = useState("");
  const { t } = useTranslation("settings");

  const resolveUserId = useCallback(
    (input: string): number | null => {
      const trimmed = input.trim();
      if (!trimmed) return null;
      const asNum = Number(trimmed);
      if (Number.isFinite(asNum) && asNum >= 0) return asNum;
      const match = users.find(
        (u) => u.name.toLowerCase() === trimmed.toLowerCase() && u.user_id != null,
      );
      return match?.user_id ?? null;
    },
    [users],
  );

  const handleAddMember = useCallback(() => {
    const uid = resolveUserId(addInput);
    if (uid === null) return;
    if (group.add.includes(uid)) return;
    onPatch(index, { add: [...group.add, uid] });
    setAddInput("");
  }, [addInput, resolveUserId, group.add, onPatch, index]);

  const handleRemoveMember = useCallback(() => {
    const uid = resolveUserId(removeInput);
    if (uid === null) return;
    if (group.remove.includes(uid)) return;
    onPatch(index, { remove: [...group.remove, uid] });
    setRemoveInput("");
  }, [removeInput, resolveUserId, group.remove, onPatch, index]);

  const dropFromAdd = useCallback(
    (uid: number) => {
      onPatch(index, { add: group.add.filter((id) => id !== uid) });
    },
    [group.add, onPatch, index],
  );

  const dropFromRemove = useCallback(
    (uid: number) => {
      onPatch(index, { remove: group.remove.filter((id) => id !== uid) });
    },
    [group.remove, onPatch, index],
  );

  const userNameById = useCallback(
    (uid: number): string => {
      const online = users.find((usr) => usr.user_id === uid);
      if (online) return online.name;
      const registered = registeredNames.get(uid);
      if (registered) return registered;
      return `User #${uid}`;
    },
    [users, registeredNames],
  );

  return (
    <div className={styles.aclCard}>
      <div className={styles.aclCardHeaderStatic}>
        <input
          className={styles.inputSmall}
          type="text"
          value={group.name}
          disabled={group.inherited}
          onChange={(e) => onPatch(index, { name: e.target.value })}
        />
        {group.inherited && <span className={styles.inheritBadge}>{t("groups.labelInherit")}</span>}
        {!group.inherited && (
          <button type="button" className={styles.removeSmallBtn} onClick={() => onRemove(index)}>
            &times;
          </button>
        )}
      </div>

      <div className={styles.aclCardBody}>
        <div className={styles.aclRuleOptions}>
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={group.inherit} disabled={group.inherited} onChange={(e) => onPatch(index, { inherit: e.target.checked })} />
            {t("groups.labelInherit")}
          </label>
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={group.inheritable} disabled={group.inherited} onChange={(e) => onPatch(index, { inheritable: e.target.checked })} />
            {t("groups.labelInheritable")}
          </label>
        </div>

        {group.inherited_members.length > 0 && (
          <div className={styles.memberSection}>
            <span className={styles.memberSectionTitle}>{t("groups.inheritedMembers")}</span>
            <div className={styles.memberChips}>
              {group.inherited_members.map((uid) => (
                <span key={uid} className={styles.memberChip}>
                  {userNameById(uid)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={styles.memberSection}>
          <span className={styles.memberSectionTitle}>{t("groups.membersToAdd")}</span>
          <div className={styles.memberChips}>
            {group.add.map((uid) => (
              <span key={uid} className={styles.memberChipRemovable}>
                {userNameById(uid)}
                {!group.inherited && (
                  <button type="button" className={styles.chipRemoveBtn} onClick={() => dropFromAdd(uid)}>
                    &times;
                  </button>
                )}
              </span>
            ))}
          </div>
          {!group.inherited && (
            <div className={styles.memberAddRow}>
              <input
                className={styles.inputSmall}
                type="text"
                placeholder={t("groups.userIdPlaceholder")}
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddMember(); }}
              />
              <button type="button" className={styles.addBtn} onClick={handleAddMember}>
                {t("groups.addButton")}
              </button>
            </div>
          )}
        </div>

        <div className={styles.memberSection}>
          <span className={styles.memberSectionTitle}>{t("groups.membersToRemove")}</span>
          <div className={styles.memberChips}>
            {group.remove.map((uid) => (
              <span key={uid} className={styles.memberChipRemovable}>
                {userNameById(uid)}
                {!group.inherited && (
                  <button type="button" className={styles.chipRemoveBtn} onClick={() => dropFromRemove(uid)}>
                    &times;
                  </button>
                )}
              </span>
            ))}
          </div>
          {!group.inherited && (
            <div className={styles.memberAddRow}>
              <input
                className={styles.inputSmall}
                type="text"
                placeholder={t("groups.userIdPlaceholder")}
                value={removeInput}
                onChange={(e) => setRemoveInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRemoveMember(); }}
              />
              <button type="button" className={styles.addBtn} onClick={handleRemoveMember}>
                {t("groups.excludeButton")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
