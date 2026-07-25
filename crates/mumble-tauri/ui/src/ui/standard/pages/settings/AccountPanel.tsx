/**
 * "Account" settings panel: self-service management of the *own* server-side
 * registration. Only rendered for registered users (see SettingsPage tab
 * gating). Everything here round-trips through the server:
 *
 *  - password auth on/off + password change  (SET_PASSWORD / CLEAR_PASSWORD)
 *  - self-rename                             (RENAME)
 *  - contact email                           (SET_EMAIL)
 *  - TOTP two-factor authentication          (TOTP_BEGIN / _VERIFY / _DISABLE)
 *  - self-unregister (danger zone)           (UNREGISTER)
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useAccountStore } from "@core/features/settings/accountStore";
import { ACCOUNT_ACTION_IDS, type AccountAck, type AccountSettingsEvent } from "@core/types";
import { TID } from "@core/testids";
import styles from "./SettingsPage.module.css";
import { registerSettings } from "@core/features/settings/settingsSearchRegistry";
import { TextField } from "../../components/elements/TextField";

registerSettings("account")
  .add("account.password.title", ["password", "authentication", "login", "certificate"])
  .add("account.rename.title", ["rename", "username", "account name"])
  .add("account.email.title", ["email", "mail", "recovery"])
  .add("account.totp.title", ["2fa", "totp", "two-factor", "authenticator", "mfa"])
  .add("account.unregister.title", ["unregister", "delete account", "remove account"]);

const MIN_PASSWORD_LENGTH = 8;

/** Loosely-typed translate for dynamic keys (server error codes). Keeps the
 *  typed `t` out of generic signatures - the huge TFunction overload set
 *  crashes tsc 5.9 when checked against a plain function type. */
type DynamicT = (key: string, options?: Record<string, unknown>) => string;

/** Localise a machine-readable ack error code (fall back to the raw code). */
function errorText(t: DynamicT, code: string): string {
  const localised = t(`account.errors.${code}`, { defaultValue: "" });
  return localised || t("account.errors.unknown", { code });
}

export function AccountPanel() {
  const { t } = useTranslation("settings");
  const tDynamic = t as unknown as DynamicT;
  const snapshot = useAccountStore((s) => s.snapshot);
  const pending = useAccountStore((s) => s.pending);
  const errorCode = useAccountStore((s) => s.errorCode);
  const errorAction = useAccountStore((s) => s.errorAction);
  const lastSuccessAction = useAccountStore((s) => s.lastSuccessAction);
  const totpEnroll = useAccountStore((s) => s.totpEnroll);
  const setSnapshot = useAccountStore((s) => s.setSnapshot);
  const handleAck = useAccountStore((s) => s.handleAck);
  const load = useAccountStore((s) => s.load);
  const query = useAccountStore((s) => s.query);
  const send = useAccountStore((s) => s.send);

  // Form state
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [newName, setNewName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpDisableCode, setTotpDisableCode] = useState("");
  const [unregisterConfirm, setUnregisterConfirm] = useState("");
  const [showUnregister, setShowUnregister] = useState(false);
  const [copied, setCopied] = useState<"secret" | "uri" | null>(null);

  useEffect(() => {
    void load();
    void query();
    const unSettings = listen<AccountSettingsEvent>("account-settings", (e) =>
      setSnapshot(e.payload.settings),
    );
    const unAck = listen<AccountAck>("account-ack", (e) => handleAck(e.payload));
    return () => {
      void unSettings.then((f) => f());
      void unAck.then((f) => f());
    };
  }, [load, query, setSnapshot, handleAck]);

  // Clear one-shot form fields after their action succeeded.
  useEffect(() => {
    if (lastSuccessAction === ACCOUNT_ACTION_IDS.set_password) {
      setPassword("");
      setPasswordConfirm("");
    }
    if (lastSuccessAction === ACCOUNT_ACTION_IDS.rename) setNewName("");
    if (lastSuccessAction === ACCOUNT_ACTION_IDS.totp_verify) setTotpCode("");
    if (lastSuccessAction === ACCOUNT_ACTION_IDS.totp_disable) setTotpDisableCode("");
    if (lastSuccessAction === ACCOUNT_ACTION_IDS.unregister) {
      setShowUnregister(false);
      setUnregisterConfirm("");
    }
  }, [lastSuccessAction]);

  const copy = useCallback((what: "secret" | "uri", text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  const feedbackFor = (action: keyof typeof ACCOUNT_ACTION_IDS) => {
    const id = ACCOUNT_ACTION_IDS[action];
    if (errorCode !== null && errorAction === id) {
      return <p className={styles.error}>{errorText(tDynamic, errorCode)}</p>;
    }
    if (lastSuccessAction === id) {
      return <p className={styles.fieldHint}>{t("account.saved")}</p>;
    }
    return null;
  };

  if (!snapshot) {
    return (
      <>
        <h2 className={styles.panelTitle}>{t("account.panelTitle")}</h2>
        <p className={styles.fieldHint}>{t("account.loading")}</p>
      </>
    );
  }

  if (!snapshot.registered) {
    return (
      <>
        <h2 className={styles.panelTitle}>{t("account.panelTitle")}</h2>
        <div className={styles.warningBannerMuted}>
          <span>{t("account.notRegistered")}</span>
          <p>{t("account.notRegisteredPara")}</p>
        </div>
      </>
    );
  }

  const passwordValid = password.length >= MIN_PASSWORD_LENGTH && password === passwordConfirm;
  const busy = pending !== null;

  return (
    <>
      <h2 className={styles.panelTitle}>{t("account.panelTitle")}</h2>

      {/* -- Overview -------------------------------------------------- */}
      <section className={styles.section} data-testid={TID.accountOverview}>
        <h3 className={styles.sectionTitle}>{t("account.overview.title")}</h3>
        <p className={styles.fieldHint}>
          {t("account.overview.identity", {
            name: snapshot.name ?? "",
            id: snapshot.user_id ?? 0,
          })}
        </p>
        <p className={styles.fieldHint}>
          {snapshot.has_password ? t("account.overview.authPassword") : t("account.overview.authCert")}
          {" · "}
          {snapshot.totp_enabled ? t("account.overview.totpOn") : t("account.overview.totpOff")}
        </p>
      </section>

      {/* -- Password authentication ----------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("account.password.title")}</h3>
        <p className={styles.fieldHint}>
          {snapshot.has_password ? t("account.password.hintEnabled") : t("account.password.hintDisabled")}
        </p>
        {!snapshot.has_password && (
          <div className={styles.warningBanner}>
            <span>{t("account.password.enableWarning")}</span>
            <p>{t("account.password.enableWarningPara")}</p>
          </div>
        )}
        <TextField
          id="account-password"
          className={styles.field}
          label={t("account.password.newLabel")}
          data-testid={TID.accountPasswordInput}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder={t("account.password.placeholder", {
            min: MIN_PASSWORD_LENGTH,
          })}
        />
        <div className={styles.field}>
          <TextField
            id="account-password-confirm"
            label={t("account.password.confirmLabel")}
            data-testid={TID.accountPasswordConfirmInput}
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
          <p className={styles.fieldHint}>{t("account.password.tooShort", { min: MIN_PASSWORD_LENGTH })}</p>
        )}
        {passwordConfirm.length > 0 && password !== passwordConfirm && (
          <p className={styles.fieldHint}>{t("account.password.mismatch")}</p>
        )}
        <button
          type="button"
          data-testid={TID.accountPasswordSave}
          className={styles.applyBtn}
          disabled={busy || !passwordValid}
          onClick={() => void send("set_password", password)}
        >
          {snapshot.has_password ? t("account.password.change") : t("account.password.enable")}
        </button>
        {feedbackFor("set_password")}

        {snapshot.has_password && (
          <>
            <p className={styles.fieldHint}>
              {snapshot.cert_matches_session
                ? t("account.password.disableHint")
                : t("account.password.disableBlocked")}
            </p>
            <button
              type="button"
              data-testid={TID.accountPasswordClear}
              className={styles.ghostBtn}
              disabled={busy || !snapshot.cert_matches_session}
              onClick={() => void send("clear_password")}
            >
              {t("account.password.disable")}
            </button>
            {feedbackFor("clear_password")}
          </>
        )}
      </section>

      {/* -- Rename ----------------------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("account.rename.title")}</h3>
        <p className={styles.fieldHint}>{t("account.rename.hint")}</p>
        <TextField
          className={styles.field}
          data-testid={TID.accountRenameInput}
          inputClassName={styles.input}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={snapshot.name ?? ""}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          data-testid={TID.accountRenameSave}
          className={styles.applyBtn}
          disabled={busy || !newName.trim() || newName.trim() === snapshot.name}
          onClick={() => void send("rename", newName.trim())}
        >
          {t("account.rename.apply")}
        </button>
        {feedbackFor("rename")}
      </section>

      {/* -- Email ------------------------------------------------------ */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("account.email.title")}</h3>
        <p className={styles.fieldHint}>{t("account.email.hint")}</p>
        <div className={styles.warningBanner}>
          <span>{t("account.email.warning")}</span>
          <p>{t("account.email.warningPara")}</p>
        </div>
        <TextField
          className={styles.field}
          data-testid={TID.accountEmailInput}
          inputClassName={styles.input}
          type="email"
          value={email ?? snapshot.email ?? ""}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("account.email.placeholder")}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          data-testid={TID.accountEmailSave}
          className={styles.applyBtn}
          disabled={busy || email === null || email === (snapshot.email ?? "")}
          onClick={() => void send("set_email", (email ?? "").trim())}
        >
          {t("account.email.apply")}
        </button>
        {feedbackFor("set_email")}
      </section>

      {/* -- Two-factor authentication ---------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("account.totp.title")}</h3>
        {snapshot.totp_enabled ? (
          <>
            <p className={styles.fieldHint}>{t("account.totp.enabledHint")}</p>
            <TextField
              className={styles.field}
              label={t("account.totp.codeLabel")}
              id="account-totp-disable"
              data-testid={TID.accountTotpDisableInput}
              inputClassName={styles.input}
              inputMode="numeric"
              maxLength={6}
              value={totpDisableCode}
              onChange={(e) => setTotpDisableCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
            />
            <button
              type="button"
              data-testid={TID.accountTotpDisable}
              className={styles.dangerBtn}
              disabled={busy || totpDisableCode.length !== 6}
              onClick={() => void send("totp_disable", totpDisableCode)}
            >
              {t("account.totp.disable")}
            </button>
            {feedbackFor("totp_disable")}
          </>
        ) : totpEnroll ? (
          <>
            <p className={styles.fieldHint}>{t("account.totp.enrollHint")}</p>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>{t("account.totp.secretLabel")}</label>
              <div className={styles.fieldRow}>
                <input
                  data-testid={TID.accountTotpSecret}
                  className={styles.input}
                  type="text"
                  readOnly
                  value={totpEnroll.secret}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => copy("secret", totpEnroll.secret)}
                >
                  {copied === "secret" ? t("account.copied") : t("account.copy")}
                </button>
              </div>
              <p className={styles.fieldHint}>{t("account.totp.secretHint")}</p>
            </div>
            {totpEnroll.uri && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>{t("account.totp.uriLabel")}</label>
                <div className={styles.fieldRow}>
                  <input
                    className={styles.input}
                    type="text"
                    readOnly
                    value={totpEnroll.uri}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => copy("uri", totpEnroll.uri)}
                  >
                    {copied === "uri" ? t("account.copied") : t("account.copy")}
                  </button>
                </div>
              </div>
            )}
            <TextField
              className={styles.field}
              label={t("account.totp.codeLabel")}
              id="account-totp-code"
              data-testid={TID.accountTotpCodeInput}
              inputClassName={styles.input}
              inputMode="numeric"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
            />
            <button
              type="button"
              data-testid={TID.accountTotpVerify}
              className={styles.applyBtn}
              disabled={busy || totpCode.length !== 6}
              onClick={() => void send("totp_verify", totpCode)}
            >
              {t("account.totp.verify")}
            </button>
            {feedbackFor("totp_verify")}
          </>
        ) : (
          <>
            <p className={styles.fieldHint}>{t("account.totp.disabledHint")}</p>
            <button
              type="button"
              data-testid={TID.accountTotpBegin}
              className={styles.applyBtn}
              disabled={busy}
              onClick={() => void send("totp_begin")}
            >
              {t("account.totp.begin")}
            </button>
            {feedbackFor("totp_begin")}
          </>
        )}
      </section>

      {/* -- Danger zone: unregister ------------------------------------ */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("account.unregister.title")}</h3>
        <div className={styles.warningBannerDanger}>
          <span>{t("account.unregister.warning")}</span>
          <p>{t("account.unregister.warningPara")}</p>
        </div>
        {showUnregister ? (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>
              {t("account.unregister.confirmPrompt", { name: snapshot.name ?? "" })}
            </p>
            <div className={styles.field}>
              <input
                data-testid={TID.accountUnregisterConfirmInput}
                className={styles.input}
                type="text"
                value={unregisterConfirm}
                onChange={(e) => setUnregisterConfirm(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className={styles.confirmBtns}>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => {
                  setShowUnregister(false);
                  setUnregisterConfirm("");
                }}
              >
                {t("account.unregister.cancel")}
              </button>
              <button
                type="button"
                data-testid={TID.accountUnregisterConfirm}
                className={styles.dangerBtn}
                disabled={busy || unregisterConfirm !== (snapshot.name ?? "")}
                onClick={() => void send("unregister")}
              >
                {t("account.unregister.confirm")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid={TID.accountUnregisterBegin}
            className={styles.dangerBtn}
            disabled={busy}
            onClick={() => setShowUnregister(true)}
          >
            {t("account.unregister.begin")}
          </button>
        )}
        {feedbackFor("unregister")}
      </section>
    </>
  );
}

export default AccountPanel;
