import { Box, Button, MenuItem, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useRecoveryPhrase } from "@core/features/identity/useRecoveryPhrase";
import { TID } from "@core/testids";
import { Stack } from "../primitives";
import { Banner, GroupRule, GroupTitle, SettingsCard } from "./controls";

/**
 * The recovery phrase of an identity: the 24 words that bring its encrypted
 * conversations back on a new install, and the box to type them into there.
 */
export function RecoveryPhraseSection({
  identities,
  preferred,
}: Readonly<{ identities: readonly string[]; preferred: string | null }>) {
  const { t } = useTranslation("settings");
  const recovery = useRecoveryPhrase(identities, preferred);
  if (identities.length === 0) return null;

  return (
    <>
      <GroupRule />
      <GroupTitle hint={t("identities.recovery.hint")}>{t("identities.recovery.title")}</GroupTitle>
      {identities.length > 1 && (
        <TextField
          select
          size="small"
          sx={{ mb: "10px", minWidth: 220 }}
          label={t("identities.recovery.identity")}
          value={recovery.label}
          onChange={(event) => recovery.choose(event.target.value)}
        >
          {identities.map((label) => (
            <MenuItem key={label} value={label}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      )}

      {recovery.phrase ? (
        <SettingsCard testId={TID.recoveryPhrase}>
          <Banner tone="warn" title={t("identities.recovery.warning")} />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "6px 12px",
              my: "12px",
              fontFamily: "monospace",
              fontSize: 13,
            }}
          >
            {recovery.phrase.split(" ").map((word, index) => (
              <span key={index}>
                {index + 1}. {word}
              </span>
            ))}
          </Box>
          <Button size="small" onClick={recovery.hide}>
            {t("identities.recovery.hide")}
          </Button>
        </SettingsCard>
      ) : (
        <Button
          size="small"
          variant="outlined"
          data-testid={TID.recoveryPhraseShow}
          onClick={() => void recovery.show()}
        >
          {t("identities.recovery.show")}
        </Button>
      )}

      <Typography sx={{ fontSize: 12.5, fontWeight: 600, mt: "16px", mb: "4px" }}>
        {t("identities.recovery.restoreTitle")}
      </Typography>
      <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "8px" })}>
        {t("identities.recovery.restoreHint")}
      </Typography>
      <TextField
        multiline
        minRows={3}
        fullWidth
        size="small"
        value={recovery.draft}
        placeholder={t("identities.recovery.restorePlaceholder")}
        onChange={(event) => recovery.setDraft(event.target.value)}
        slotProps={{
          htmlInput: {
            "aria-label": t("identities.recovery.restoreTitle"),
            "data-testid": TID.recoveryPhraseInput,
            autoCapitalize: "off",
            autoCorrect: "off",
            spellCheck: false,
          },
        }}
      />
      <Stack direction="row" gap={1} alignItems="center" sx={{ mt: "8px" }}>
        <Button
          size="small"
          variant="contained"
          color="warning"
          data-testid={TID.recoveryPhraseRestore}
          disabled={recovery.wordCount !== 24}
          onClick={() => void recovery.restore()}
        >
          {t("identities.recovery.restore")}
        </Button>
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {t("identities.recovery.words", { count: recovery.wordCount })}
        </Typography>
      </Stack>
      {recovery.restored && <Banner tone="ok" title={t("identities.recovery.restored")} />}
      {recovery.error && <Banner tone="danger">{recovery.error}</Banner>}
    </>
  );
}
