import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useAccountStore } from "@core/features/settings/accountStore";
import { ACCOUNT_ACTION_IDS, type AccountAck, type AccountSettingsEvent } from "@core/types";
import { TID } from "@core/testids";
import { QrCode } from "@ui/QrCode";
import { Stack } from "../primitives";
import { Banner, Field, GroupRule, GroupTitle, PageTitle, SettingsCard, TextRow } from "./controls";
import { radius } from "../../tokens";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Loosely-typed translate for the server's error codes.
 *
 * The typed `TFunction`'s overload set crashes tsc 5.9 when checked against a
 * plain function type, and these keys are only known at runtime anyway.
 */
type DynamicT = (key: string, options?: Record<string, unknown>) => string;

/**
 * How far down the enrolment fallbacks the user has asked to go.
 *
 * The QR code is the whole happy path. The `otpauth://` link is for a phone
 * that cannot see this screen, and the bare base32 key is for an app that
 * takes neither - each is a step *worse* than the one before, so each is
 * shown only on request, behind the previous.
 */
type TotpFallback = "qr" | "link" | "secret";

function errorText(t: DynamicT, code: string): string {
  return t(`account.errors.${code}`, { defaultValue: "" }) || t("account.errors.unknown", { code });
}

/**
 * The Account page: self-service management of this user's own registration.
 *
 * Every control here is a round trip to the server rather than a local setting,
 * so each one reports the outcome of its *own* last action - a single status
 * line for the page would attribute a rename's error to whatever the user
 * touched next. `feedbackFor` keys that on the action id the ack carries.
 */
export function AccountSettings() {
  const { t } = useTranslation("settings");
  const tDynamic = t as unknown as DynamicT;
  const snapshot = useAccountStore((state) => state.snapshot);
  const queryError = useAccountStore((state) => state.queryError);
  const pending = useAccountStore((state) => state.pending);
  const errorCode = useAccountStore((state) => state.errorCode);
  const errorAction = useAccountStore((state) => state.errorAction);
  const lastSuccessAction = useAccountStore((state) => state.lastSuccessAction);
  const totpEnroll = useAccountStore((state) => state.totpEnroll);
  const setSnapshot = useAccountStore((state) => state.setSnapshot);
  const handleAck = useAccountStore((state) => state.handleAck);
  const load = useAccountStore((state) => state.load);
  const query = useAccountStore((state) => state.query);
  const send = useAccountStore((state) => state.send);

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [newName, setNewName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpDisableCode, setTotpDisableCode] = useState("");
  const [unregisterConfirm, setUnregisterConfirm] = useState("");
  const [showUnregister, setShowUnregister] = useState(false);
  const [copied, setCopied] = useState<"secret" | "uri" | null>(null);
  const [totpFallback, setTotpFallback] = useState<TotpFallback>("qr");

  useEffect(() => {
    void load();
    void query();
    const unSettings = listen<AccountSettingsEvent>("account-settings", (event) =>
      setSnapshot(event.payload.settings),
    );
    const unAck = listen<AccountAck>("account-ack", (event) => handleAck(event.payload));
    return () => {
      void unSettings.then((off) => off());
      void unAck.then((off) => off());
    };
  }, [load, query, setSnapshot, handleAck]);

  // One-shot fields are cleared once their action has actually landed, not on
  // submit - a rejected rename should still have its text to correct.
  useEffect(() => {
    if (lastSuccessAction === ACCOUNT_ACTION_IDS.set_password) {
      setPassword("");
      setPasswordConfirm("");
    }
    if (lastSuccessAction === ACCOUNT_ACTION_IDS.rename) setNewName("");
    // The proof is one-shot on purpose: leaving it in the field is leaving the
    // account's password on screen for as long as the page stays open.
    if (lastSuccessAction !== null) setCurrentPassword("");
    if (lastSuccessAction === ACCOUNT_ACTION_IDS.totp_begin) setTotpFallback("qr");
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
      return <Banner tone="danger">{errorText(tDynamic, errorCode)}</Banner>;
    }
    if (lastSuccessAction === id) return <Banner tone="ok">{t("account.saved")}</Banner>;
    return null;
  };

  if (!snapshot) {
    return (
      <Box sx={{ maxWidth: 640 }}>
        <PageTitle title={t("account.panelTitle")} hint={queryError ? undefined : t("account.loading")} />
        {queryError && (
          <Banner tone="warn" title={errorText(tDynamic, queryError)}>
            <Button variant="outlined" size="small" onClick={() => void query()}>
              {tDynamic("common:retry")}
            </Button>
          </Banner>
        )}
      </Box>
    );
  }

  if (!snapshot.registered) {
    return (
      <Box sx={{ maxWidth: 640 }}>
        <PageTitle title={t("account.panelTitle")} />
        <Banner tone="info" title={t("account.notRegistered")}>
          {t("account.notRegisteredPara")}
        </Banner>
      </Box>
    );
  }

  const passwordValid = password.length >= MIN_PASSWORD_LENGTH && password === passwordConfirm;
  const busy = pending !== null;
  // An account with no password is reached by certificate, and the certificate
  // is what the session already presented - the server asks for no more.
  const unproved = (snapshot.has_password ?? false) && currentPassword.length === 0;
  /** Every mutating control is off until the change has been proved. */
  const blocked = busy || unproved;
  const prove = (action: Parameters<typeof send>[0], value?: string) =>
    void send(action, value, currentPassword);

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("account.panelTitle")} />

      <SettingsCard testId={TID.accountOverview}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: "5px" }}>
          {t("account.overview.title")}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {t("account.overview.identity", { name: snapshot.name ?? "", id: snapshot.user_id ?? 0 })}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {snapshot.has_password ? t("account.overview.authPassword") : t("account.overview.authCert")}
          {" · "}
          {snapshot.totp_enabled ? t("account.overview.totpOn") : t("account.overview.totpOff")}
        </Typography>
      </SettingsCard>

      {(snapshot.has_password ?? false) && (
        <>
          <GroupRule />
          <GroupTitle hint={t("account.confirm.hint")}>{t("account.confirm.label")}</GroupTitle>
          <Box sx={{ mt: "12px" }}>
            <TextRow
              label={t("account.confirm.label")}
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              testId={TID.accountCurrentPasswordInput}
            />
          </Box>
          {unproved && (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
              {t("account.confirm.missing")}
            </Typography>
          )}
        </>
      )}

      <GroupRule />

      <GroupTitle
        hint={snapshot.has_password ? t("account.password.hintEnabled") : t("account.password.hintDisabled")}
      >
        {t("account.password.title")}
      </GroupTitle>
      {!snapshot.has_password && (
        <Banner tone="warn" title={t("account.password.enableWarning")}>
          {t("account.password.enableWarningPara")}
        </Banner>
      )}
      <Box sx={{ mt: "12px" }}>
        <TextRow
          label={t("account.password.newLabel")}
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={t("account.password.placeholder", { min: MIN_PASSWORD_LENGTH })}
          testId={TID.accountPasswordInput}
        />
        <TextRow
          label={t("account.password.confirmLabel")}
          type="password"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
          testId={TID.accountPasswordConfirmInput}
        />
      </Box>
      {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.warn })}>
          {t("account.password.tooShort", { min: MIN_PASSWORD_LENGTH })}
        </Typography>
      )}
      {passwordConfirm.length > 0 && password !== passwordConfirm && (
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.warn })}>
          {t("account.password.mismatch")}
        </Typography>
      )}
      <Button
        variant="contained"
        size="small"
        sx={{ mt: "8px" }}
        data-testid={TID.accountPasswordSave}
        disabled={blocked || !passwordValid}
        onClick={() => prove("set_password", password)}
      >
        {snapshot.has_password ? t("account.password.change") : t("account.password.enable")}
      </Button>
      {feedbackFor("set_password")}

      {snapshot.has_password && (
        <Box sx={{ mt: "14px" }}>
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "7px" })}>
            {snapshot.cert_matches_session
              ? t("account.password.disableHint")
              : t("account.password.disableBlocked")}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            data-testid={TID.accountPasswordClear}
            // Dropping password auth leaves the certificate as the only way
            // back in, so it is refused unless this session is using it.
            disabled={blocked || !snapshot.cert_matches_session}
            onClick={() => prove("clear_password")}
          >
            {t("account.password.disable")}
          </Button>
          {feedbackFor("clear_password")}
        </Box>
      )}

      <GroupRule />

      <GroupTitle hint={t("account.rename.hint")}>{t("account.rename.title")}</GroupTitle>
      <Stack direction="row" gap={0.75}>
        <TextField
          size="small"
          sx={{ flex: 1 }}
          value={newName}
          placeholder={snapshot.name ?? ""}
          onChange={(event) => setNewName(event.target.value)}
          slotProps={{
            htmlInput: {
              "aria-label": t("account.rename.title"),
              "data-testid": TID.accountRenameInput,
              autoCapitalize: "off",
              autoCorrect: "off",
              spellCheck: false,
            },
          }}
        />
        <Button
          variant="contained"
          size="small"
          sx={{ flex: "none" }}
          data-testid={TID.accountRenameSave}
          disabled={blocked || !newName.trim() || newName.trim() === snapshot.name}
          onClick={() => prove("rename", newName.trim())}
        >
          {t("account.rename.apply")}
        </Button>
      </Stack>
      {feedbackFor("rename")}

      <GroupRule />

      <GroupTitle hint={t("account.email.hint")}>{t("account.email.title")}</GroupTitle>
      <Banner tone="warn" title={t("account.email.warning")}>
        {t("account.email.warningPara")}
      </Banner>
      <Stack direction="row" gap={0.75} sx={{ mt: "12px" }}>
        <TextField
          size="small"
          type="email"
          sx={{ flex: 1 }}
          value={email ?? snapshot.email ?? ""}
          placeholder={t("account.email.placeholder")}
          onChange={(event) => setEmail(event.target.value)}
          slotProps={{
            htmlInput: {
              "aria-label": t("account.email.title"),
              "data-testid": TID.accountEmailInput,
              autoCapitalize: "off",
              autoCorrect: "off",
              spellCheck: false,
            },
          }}
        />
        <Button
          variant="contained"
          size="small"
          sx={{ flex: "none" }}
          data-testid={TID.accountEmailSave}
          // `null` means untouched: the field shows the server's value, and
          // re-sending it would be a write that changes nothing.
          disabled={blocked || email === null || email === (snapshot.email ?? "")}
          onClick={() => prove("set_email", (email ?? "").trim())}
        >
          {t("account.email.apply")}
        </Button>
      </Stack>
      {feedbackFor("set_email")}

      <GroupRule />

      <GroupTitle>{t("account.totp.title")}</GroupTitle>
      {snapshot.totp_enabled ? (
        <>
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "10px" })}>
            {t("account.totp.enabledHint")}
          </Typography>
          <TotpCodeField
            label={t("account.totp.codeLabel")}
            testId={TID.accountTotpDisableInput}
            value={totpDisableCode}
            onChange={setTotpDisableCode}
          />
          <Button
            size="small"
            color="error"
            variant="contained"
            sx={{ mt: "8px" }}
            data-testid={TID.accountTotpDisable}
            disabled={blocked || totpDisableCode.length !== 6}
            onClick={() => prove("totp_disable", totpDisableCode)}
          >
            {t("account.totp.disable")}
          </Button>
          {feedbackFor("totp_disable")}
        </>
      ) : totpEnroll ? (
        <>
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "12px" })}>
            {totpEnroll.uri ? t("account.totp.enrollHint") : t("account.totp.secretHint")}
          </Typography>
          <SettingsCard>
            {totpEnroll.uri ? (
              <Box sx={{ display: "flex", justifyContent: "center", mb: "16px" }}>
                <Box sx={{ p: "10px", background: "#ffffff", borderRadius: radius("lg"), lineHeight: 0 }}>
                  <QrCode value={totpEnroll.uri} label={t("account.totp.qrLabel")} testId={TID.accountTotpQr} />
                </Box>
              </Box>
            ) : (
              // A server that sends no provisioning URI leaves nothing to scan;
              // the key is the only way in and takes the front seat.
              <CopyField
                label={t("account.totp.secretLabel")}
                value={totpEnroll.secret}
                testId={TID.accountTotpSecret}
                copyLabel={copied === "secret" ? t("account.copied") : t("account.copy")}
                onCopy={() => copy("secret", totpEnroll.secret)}
              />
            )}
            <TotpCodeField
              label={t("account.totp.codeLabel")}
              testId={TID.accountTotpCodeInput}
              value={totpCode}
              onChange={setTotpCode}
              sx={{ mb: 0 }}
              action={
                <Button
                  variant="contained"
                  size="small"
                  sx={{ flex: "none" }}
                  data-testid={TID.accountTotpVerify}
                  disabled={blocked || totpCode.length !== 6}
                  onClick={() => prove("totp_verify", totpCode)}
                >
                  {t("account.totp.verify")}
                </Button>
              }
            />
            {feedbackFor("totp_verify")}
            {totpEnroll.uri && (
              <Box sx={(theme) => ({ mt: "14px", pt: "12px", borderTop: `1px solid ${theme.palette.nebula.line}` })}>
                {totpFallback === "qr" ? (
                  <DisclosureLink testId={TID.accountTotpCantScan} onClick={() => setTotpFallback("link")}>
                    {t("account.totp.cantScan")}
                  </DisclosureLink>
                ) : (
                  <>
                    <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "10px" })}>
                      {t("account.totp.linkHint")}
                    </Typography>
                    <CopyField
                      label={t("account.totp.uriLabel")}
                      value={totpEnroll.uri}
                      testId={TID.accountTotpUri}
                      copyLabel={copied === "uri" ? t("account.copied") : t("account.copy")}
                      onCopy={() => copy("uri", totpEnroll.uri)}
                      sx={{ mb: totpFallback === "link" ? "10px" : "12px" }}
                    />
                    {totpFallback === "link" ? (
                      <DisclosureLink testId={TID.accountTotpRevealSecret} onClick={() => setTotpFallback("secret")}>
                        {t("account.totp.revealSecret")}
                      </DisclosureLink>
                    ) : (
                      <CopyField
                        label={t("account.totp.secretLabel")}
                        hint={t("account.totp.secretHint")}
                        value={totpEnroll.secret}
                        testId={TID.accountTotpSecret}
                        copyLabel={copied === "secret" ? t("account.copied") : t("account.copy")}
                        onCopy={() => copy("secret", totpEnroll.secret)}
                        sx={{ mb: 0 }}
                      />
                    )}
                  </>
                )}
              </Box>
            )}
          </SettingsCard>
        </>
      ) : (
        <>
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "10px" })}>
            {t("account.totp.disabledHint")}
          </Typography>
          <Button
            variant="contained"
            size="small"
            data-testid={TID.accountTotpBegin}
            disabled={blocked}
            onClick={() => prove("totp_begin")}
          >
            {t("account.totp.begin")}
          </Button>
          {feedbackFor("totp_begin")}
        </>
      )}

      <GroupRule />

      <GroupTitle>{t("account.unregister.title")}</GroupTitle>
      <Banner tone="danger" title={t("account.unregister.warning")}>
        {t("account.unregister.warningPara")}
      </Banner>
      {showUnregister ? (
        <SettingsCard sx={{ mt: "12px" }}>
          <Typography sx={{ fontSize: 12, mb: "9px" }}>
            {t("account.unregister.confirmPrompt", { name: snapshot.name ?? "" })}
          </Typography>
          <TextField
            fullWidth
            size="small"
            value={unregisterConfirm}
            onChange={(event) => setUnregisterConfirm(event.target.value)}
            slotProps={{
              htmlInput: {
                "aria-label": t("account.unregister.title"),
                "data-testid": TID.accountUnregisterConfirmInput,
                autoCapitalize: "off",
                autoCorrect: "off",
                spellCheck: false,
              },
            }}
          />
          <Stack direction="row" gap={0.75} justifyContent="flex-end" sx={{ mt: "10px" }}>
            <Button
              size="small"
              onClick={() => {
                setShowUnregister(false);
                setUnregisterConfirm("");
              }}
            >
              {t("account.unregister.cancel")}
            </Button>
            <Button
              size="small"
              color="error"
              variant="contained"
              data-testid={TID.accountUnregisterConfirm}
              // Typing the name is the confirmation; anything else is a
              // mis-click on the most destructive control in the app.
              disabled={blocked || unregisterConfirm !== (snapshot.name ?? "")}
              onClick={() => prove("unregister")}
            >
              {t("account.unregister.confirm")}
            </Button>
          </Stack>
        </SettingsCard>
      ) : (
        <Button
          size="small"
          color="error"
          variant="outlined"
          sx={{ mt: "12px" }}
          data-testid={TID.accountUnregisterBegin}
          disabled={busy}
          onClick={() => setShowUnregister(true)}
        >
          {t("account.unregister.begin")}
        </Button>
      )}
      {feedbackFor("unregister")}

      <Box sx={{ height: 20 }} />
    </Box>
  );
}

/**
 * A six-digit authenticator code. Non-digits are dropped as they are typed.
 *
 * `action` is the button that consumes the code; given one, it sits at the
 * end of the same row, so typing and confirming read as a single gesture.
 */
function TotpCodeField({
  label,
  value,
  testId,
  onChange,
  action,
  sx,
}: Readonly<{
  label: string;
  value: string;
  testId: string;
  onChange: (value: string) => void;
  action?: ReactNode;
  sx?: object;
}>) {
  return (
    <Field label={label} sx={{ mb: "12px", ...sx }}>
      <Stack direction="row" gap={0.75}>
        <TextField
          size="small"
          sx={{ flex: 1 }}
          value={value}
          placeholder="123456"
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          slotProps={{
            htmlInput: { inputMode: "numeric", maxLength: 6, "data-testid": testId, "aria-label": label },
          }}
        />
        {action}
      </Stack>
    </Field>
  );
}

/**
 * A quiet text link that opens the next fallback. Styled as an afterthought on
 * purpose: nobody who can scan the code should be drawn to it.
 */
function DisclosureLink({
  testId,
  onClick,
  children,
}: Readonly<{ testId: string; onClick: () => void; children: string }>) {
  return (
    <Button
      variant="text"
      size="small"
      data-testid={testId}
      onClick={onClick}
      sx={(theme) => ({
        p: 0,
        minWidth: 0,
        fontSize: 11.5,
        fontWeight: 500,
        textTransform: "none",
        textDecoration: "underline",
        color: theme.palette.nebula.muted,
        "&:hover": { background: "none", textDecoration: "underline" },
      })}
    >
      {children}
    </Button>
  );
}

/** A read-only value that exists to be copied into an authenticator app. */
function CopyField({
  label,
  hint,
  value,
  testId,
  copyLabel,
  onCopy,
  sx,
}: Readonly<{
  label: string;
  hint?: string;
  value: string;
  testId?: string;
  copyLabel: string;
  onCopy: () => void;
  sx?: object;
}>) {
  return (
    <Field label={label} sx={{ mb: "12px", ...sx }}>
      <Stack direction="row" gap={0.75}>
        <TextField
          size="small"
          sx={{ flex: 1 }}
          value={value}
          // Selecting the whole value on focus makes a manual copy one gesture
          // for anyone whose clipboard permission is refused.
          onFocus={(event) => (event.target as HTMLInputElement).select()}
          slotProps={{ htmlInput: { readOnly: true, "data-testid": testId, "aria-label": label } }}
        />
        <Button size="small" variant="outlined" sx={{ flex: "none" }} onClick={onCopy}>
          {copyLabel}
        </Button>
      </Stack>
      {hint && (
        <Typography sx={(theme) => ({ mt: "6px", fontSize: 11, color: theme.palette.nebula.muted })}>
          {hint}
        </Typography>
      )}
    </Field>
  );
}
