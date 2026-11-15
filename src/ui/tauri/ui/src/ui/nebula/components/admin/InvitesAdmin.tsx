import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button } from "@mui/material";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import {
  InviteRefusedError,
  InviteTimeoutError,
  listInvites,
  revokeInvite,
  type Invite,
} from "@core/features/invites/invitesApi";
import { AdminPage, DataTable, type Column } from "./controls";

/**
 * Every open invite on the server, and the one thing to do with each.
 *
 * Only listing and revoking: minting happens where the person being invited
 * matters - a channel's menu - and the rules (who may, how long, how often,
 * past the password or not) are rows of the server settings form, which is
 * what the hint says rather than a second place to set them.
 */
export function InvitesAdmin() {
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

  const columns: Column<Invite>[] = [
    {
      key: "code",
      header: t("invites.admin.code"),
      cell: (invite) => <Box sx={{ fontFamily: "monospace" }}>{invite.code}</Box>,
    },
    { key: "channel", header: t("invites.admin.channel"), cell: (invite) => channelName(invite.channelId) },
    { key: "creator", header: t("invites.admin.creator"), cell: (invite) => invite.creator },
    {
      key: "expires",
      header: t("invites.admin.expires"),
      cell: (invite) =>
        invite.expiresMs === 0 ? t("invites.neverExpires") : new Date(invite.expiresMs).toLocaleString(),
    },
    {
      key: "uses",
      header: t("invites.admin.uses"),
      align: "right",
      cell: (invite) =>
        invite.maxUses === 0
          ? t("invites.usedBy", { uses: invite.uses })
          : t("invites.usedOf", { uses: invite.uses, max: invite.maxUses }),
    },
    {
      key: "revoke",
      header: "",
      align: "right",
      cell: (invite) => (
        <Button
          size="small"
          color="error"
          data-testid={TID.inviteRevoke}
          onClick={() => void revoke(invite.code)}
        >
          {t("invites.admin.revoke")}
        </Button>
      ),
    },
  ];

  return (
    <AdminPage
      title={t("invites.admin.tab")}
      hint={t("invites.admin.intro")}
      wide
      toolbar={
        <Button size="small" variant="outlined" disabled={loading} onClick={() => void refresh()}>
          {t("invites.admin.refresh")}
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={invites}
        rowKey={(invite) => invite.code}
        rowAttrs={(invite) => ({ "data-testid": TID.inviteRow, "data-invite-code": invite.code })}
        empty={notice ?? t("invites.admin.empty")}
      />
    </AdminPage>
  );
}
