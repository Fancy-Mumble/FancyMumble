import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { addServer, getSavedServers } from "@core/serverStorage";
import type { ParsedInvite } from "@core/features/invites/inviteLink";
import type { SavedServer } from "@core/types";
import { TID } from "@core/testids";
import { Modal } from "../elements/Modal";
import styles from "./InviteDialog.module.css";

/** The certificate the client generates for a fresh profile. */
const DEFAULT_CERT = "default";

interface JoinInviteDialogProps {
  readonly invite: ParsedInvite;
  readonly onClose: () => void;
  /** The saved login, carrying the invite, ready to connect. */
  readonly onJoin: (server: SavedServer) => void;
}

/**
 * Following an invite to a server nothing is saved for: ask for a name - the
 * one thing a link cannot say - and save the login with the invite code on it,
 * so every reconnect presents it again.
 */
export function JoinInviteDialog({ invite, onClose, onJoin }: JoinInviteDialogProps) {
  const { t } = useTranslation(["server", "common"]);
  const [username, setUsername] = useState("");
  const [certLabel, setCertLabel] = useState("");
  const [certificates, setCertificates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverName = invite.name || invite.host;

  useEffect(() => {
    void getSavedServers()
      .then((saved) => {
        const recent = [...saved].sort((a, b) => (b.last_joined ?? 0) - (a.last_joined ?? 0))[0];
        setUsername((current) => current || recent?.username || "");
      })
      .catch(() => undefined);
    void invoke<string[]>("list_certificates")
      .then((names) => {
        setCertificates(names);
        setCertLabel(
          (current) => current || (names.includes(DEFAULT_CERT) ? DEFAULT_CERT : (names[0] ?? "")),
        );
      })
      .catch(() => setCertificates([]));
  }, [invite]);

  const join = async () => {
    if (!username.trim()) return;
    setSaving(true);
    try {
      const server = await addServer({
        label: serverName,
        host: invite.host,
        port: invite.port,
        username: username.trim(),
        cert_label: certLabel || null,
        invite_code: invite.code,
      });
      onJoin(server);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="join-invite-title">
        <h3 id="join-invite-title" className={styles.title}>
          {t("server:invites.join.title", { server: serverName })}
        </h3>
        <p className={styles.note}>{t("server:invites.join.body")}</p>
        <p className={styles.note}>
          {invite.host}:{invite.port}
        </p>
        <label className={styles.field}>
          {t("server:invites.join.name")}
          <input
            autoFocus
            data-testid={TID.connectUsernameInput}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void join();
            }}
          />
        </label>
        <label className={styles.field}>
          {t("server:invites.join.certificate")}
          <select value={certLabel} onChange={(event) => setCertLabel(event.target.value)}>
            <option value="">{t("server:invites.join.anonymous")}</option>
            {certificates.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>
            {t("common:actions.cancel")}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={saving || !username.trim()}
            data-testid={TID.inviteJoin}
            onClick={() => void join()}
          >
            {saving ? t("server:invites.join.joining") : t("server:invites.join.join")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
