import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import {
  InviteRefusedError,
  InviteTimeoutError,
  listInvites,
  revokeInvite,
  type Invite,
} from "@core/features/invites/invitesApi";
import styles from "./InvitesTab.module.css";

/**
 * Every open invite on the server, each with a way to revoke it.
 *
 * The rules - who may mint one, how long it lives, how often it may be used
 * and whether it gets past the password - are rows of the Server Settings
 * tab, which is what the intro says rather than being a second place to set
 * them.
 */
export default function InvitesTab() {
  const { t } = useTranslation("server");
  const channels = useAppStore((state) => state.channels);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setInvites(await listInvites(true));
      setNotice(null);
    } catch (reason) {
      setInvites([]);
      if (reason instanceof InviteRefusedError && reason.reason === "unavailable")
        setNotice(t("invites.admin.off"));
      else if (reason instanceof InviteTimeoutError) setNotice(t("invites.refused.noAnswer"));
      else setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = async (code: string) => {
    try {
      await revokeInvite(code);
      setInvites((current) => current.filter((invite) => invite.code !== code));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const channelName = (id: number) =>
    id === 0
      ? t("invites.admin.anywhere")
      : (channels.find((channel) => channel.id === id)?.name ?? `#${id}`);

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <p className={styles.intro}>{t("invites.admin.intro")}</p>
        <button type="button" className={styles.refresh} disabled={loading} onClick={() => void refresh()}>
          {t("invites.admin.refresh")}
        </button>
      </div>
      {invites.length === 0 ? (
        <div className={styles.empty}>{notice ?? t("invites.admin.empty")}</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t("invites.admin.code")}</th>
              <th>{t("invites.admin.channel")}</th>
              <th>{t("invites.admin.creator")}</th>
              <th>{t("invites.admin.expires")}</th>
              <th className={styles.right}>{t("invites.admin.uses")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => (
              <tr key={invite.code} data-testid={TID.inviteRow} data-invite-code={invite.code}>
                <td className={styles.code}>{invite.code}</td>
                <td>{channelName(invite.channelId)}</td>
                <td>{invite.creator}</td>
                <td>
                  {invite.expiresMs === 0
                    ? t("invites.neverExpires")
                    : new Date(invite.expiresMs).toLocaleString()}
                </td>
                <td className={styles.right}>
                  {invite.maxUses === 0
                    ? t("invites.usedBy", { uses: invite.uses })
                    : t("invites.usedOf", { uses: invite.uses, max: invite.maxUses })}
                </td>
                <td className={styles.right}>
                  <button
                    type="button"
                    className={styles.revoke}
                    data-testid={TID.inviteRevoke}
                    onClick={() => void revoke(invite.code)}
                  >
                    {t("invites.admin.revoke")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
