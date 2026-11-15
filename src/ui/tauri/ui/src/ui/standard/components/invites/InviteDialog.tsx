import { useTranslation } from "react-i18next";
import { TID } from "@core/testids";
import { lifetimeKey } from "@core/features/invites/inviteOptions";
import { useCreateInvite } from "@core/features/invites/useCreateInvite";
import { CheckIcon, CopyIcon } from "../../icons";
import { Modal } from "../elements/Modal";
import styles from "./InviteDialog.module.css";

interface InviteDialogProps {
  /** Where the invite lands people; the root (id 0) invites to the server. */
  readonly target: { id: number; name: string };
  readonly onClose: () => void;
}

/**
 * Minting an invite link: two choices cut to the server's ceilings, one
 * button, and the link to copy in its place. The logic is shared with the
 * other shells through `useCreateInvite`; this is only the markup.
 */
export function InviteDialog({ target, onClose }: InviteDialogProps) {
  const { t } = useTranslation(["server", "common"]);
  const state = useCreateInvite(target.id, true);
  const place = target.id === 0 ? t("server:invites.thisServer") : target.name;

  return (
    <Modal onClose={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <h3 id="invite-title" className={styles.title}>
          {t("server:invites.title", { place })}
        </h3>
        <div className={styles.row}>
          <label className={styles.field}>
            {t("server:invites.lifetime")}
            <select
              data-testid={TID.inviteLifetime}
              value={String(state.lifetime)}
              disabled={state.link !== null}
              onChange={(event) => state.setLifetime(Number(event.target.value))}
            >
              {state.lifetimes.map((seconds) => {
                const key = lifetimeKey(seconds);
                return (
                  <option key={seconds} value={String(seconds)}>
                    {key ? t(key as "server:invites.never") : `${Math.round(seconds / 3600)} h`}
                  </option>
                );
              })}
            </select>
          </label>
          <label className={styles.field}>
            {t("server:invites.uses")}
            <select
              data-testid={TID.inviteMaxUses}
              value={String(state.maxUses)}
              disabled={state.link !== null}
              onChange={(event) => state.setMaxUses(Number(event.target.value))}
            >
              {state.useLimits.map((count) => (
                <option key={count} value={String(count)}>
                  {count === 0 ? t("server:invites.noLimit") : t("server:invites.usesCount", { count })}
                </option>
              ))}
            </select>
          </label>
        </div>

        {state.link && (
          <div className={styles.link}>
            <input
              readOnly
              aria-label={t("server:invites.link")}
              data-testid={TID.inviteLink}
              value={state.link}
              onFocus={(event) => event.target.select()}
            />
            <button
              type="button"
              className={styles.secondary}
              data-testid={TID.inviteCopy}
              onClick={() => void state.copy()}
            >
              {state.copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}{" "}
              {state.copied ? t("server:invites.copied") : t("server:invites.copy")}
            </button>
          </div>
        )}

        <p className={styles.note}>
          {state.support.skipsPassword
            ? t("server:invites.skipsPassword")
            : t("server:invites.needsPassword")}
        </p>
        {state.error && <p className={styles.error}>{state.error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>
            {t("common:actions.close", { defaultValue: "Close" })}
          </button>
          {!state.link && (
            <button
              type="button"
              className={styles.primary}
              disabled={state.busy}
              data-testid={TID.inviteCreate}
              onClick={() => void state.create()}
            >
              {state.busy ? t("server:invites.creating") : t("server:invites.create")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
