import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AclEntry, AclGroup } from "../../types";
import { computeChannelAccess } from "./channelAclModel";
import styles from "./AdminPanel.module.css";

interface UserLike {
  session: number;
  name: string;
  user_id?: number | null;
}

/**
 * "Users with access" tab for a channel: derives who can enter the channel from
 * its ACL entries.  Per-user `Enter` grants (how private/detached channels admit
 * their members) are listed by name; `@all` / `@auth` grants and group grants are
 * summarised.  This is the read-only counterpart to the Rules/Groups editors.
 */
export function AccessUsersPanel({
  acls,
  groups,
  users,
  registeredNames,
}: Readonly<{
  acls: AclEntry[];
  groups: AclGroup[];
  users: UserLike[];
  registeredNames: Map<number, string>;
}>) {
  const { t } = useTranslation("settings");

  const access = useMemo(() => computeChannelAccess(acls, groups), [acls, groups]);

  const onlineIds = useMemo(() => {
    const s = new Set<number>();
    for (const u of users) if (u.user_id != null) s.add(u.user_id);
    return s;
  }, [users]);

  const nameFor = (uid: number) =>
    registeredNames.get(uid) ?? users.find((u) => u.user_id === uid)?.name ?? `#${uid}`;

  const renderUser = (uid: number, withHint: boolean) => {
    const online = onlineIds.has(uid);
    return (
      <li key={uid} className={styles.accessUserItem}>
        <span className={`${styles.accessUserDot} ${online ? styles.accessUserOnline : ""}`} />
        <span className={styles.accessUserName}>{nameFor(uid)}</span>
        {withHint && online && (
          <span className={styles.accessUserHint}>{t("channelAcl.accessOnlineHint")}</span>
        )}
      </li>
    );
  };

  const nothing =
    !access.allUsers && !access.allRegistered &&
    access.granted.length === 0 && access.groupMembers.size === 0;

  return (
    <div className={styles.accessUsers}>
      {access.allUsers && (
        <div className={styles.accessNote}>{t("channelAcl.accessAllUsers")}</div>
      )}
      {!access.allUsers && access.allRegistered && (
        <div className={styles.accessNote}>{t("channelAcl.accessAllRegistered")}</div>
      )}

      {access.granted.length > 0 && (
        <>
          <div className={styles.aclSectionTitle}>{t("channelAcl.accessUsersHeading")}</div>
          <ul className={styles.accessUserList}>
            {access.granted
              .map((uid) => ({ uid, name: nameFor(uid) }))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(({ uid }) => renderUser(uid, true))}
          </ul>
        </>
      )}

      {[...access.groupMembers.entries()].map(([group, members]) => (
        <div key={group} className={styles.accessGroupBlock}>
          <div className={styles.aclSectionTitle}>
            {t("channelAcl.accessViaGroup", { group })}
          </div>
          {members.length === 0 ? (
            <div className={styles.dimText}>&mdash;</div>
          ) : (
            <ul className={styles.accessUserList}>
              {members.map((uid) => renderUser(uid, false))}
            </ul>
          )}
        </div>
      ))}

      {nothing && <div className={styles.dimText}>{t("channelAcl.accessNoneExplicit")}</div>}
    </div>
  );
}
