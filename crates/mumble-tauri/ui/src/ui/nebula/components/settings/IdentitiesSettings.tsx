import { useCallback, useEffect, useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { deleteProfileData } from "@core/features/settings/profileData";
import { useAppStore } from "@core/store";
import { Stack } from "../primitives";
import { Banner, EmptyState, GroupRule, GroupTitle, PageTitle, SettingsCard } from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";

/**
 * The Identities page.
 *
 * An identity is a client certificate plus the profile stored against it, so
 * deleting one deletes both - a certificate removed on its own would leave an
 * orphaned profile that the next identity of the same name would inherit.
 *
 * Deletion is irreversible and the button sits beside Export, so the confirm
 * step is inline and per-row rather than a dialog: the row being confirmed is
 * the one the user is looking at.
 */
export function IdentitiesSettings({
  onEditProfile,
}: Readonly<{ onEditProfile?: (label: string) => void }>) {
  const { t } = useTranslation(["settings", "common"]);
  const { prefs } = usePreferenceSettings();
  const connectedCertLabel = useAppStore((state) => state.connectedCertLabel);
  const [identities, setIdentities] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void invoke<string[]>("list_certificates")
      .then(setIdentities)
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setError(null);
      try {
        await action();
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const create = () => {
    const label = newLabel.trim();
    if (!label) return;
    void run(async () => {
      await invoke("generate_certificate", { label });
      setNewLabel("");
    });
  };

  const remove = (label: string) =>
    void run(async () => {
      await invoke("delete_certificate", { label });
      await deleteProfileData(label);
      setConfirmDelete(null);
    });

  const exportIdentity = (label: string) =>
    void run(async () => {
      const destPath = await save({
        defaultPath: `${label}.fmid`,
        filters: [{ name: "Fancy Mumble Identity", extensions: ["fmid"] }],
      });
      if (destPath) await invoke("export_certificate", { label, destPath });
    });

  const importIdentity = () =>
    void run(async () => {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Fancy Mumble Identity", extensions: ["fmid"] }],
      });
      if (selected) await invoke("import_certificate", { srcPath: selected });
    });

  const isExpert = prefs !== null && prefs.userMode !== "normal";

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("identities.panelTitle")} hint={t("identities.description")} />

      {error && (
        <Banner tone="danger">
          <Box component="span" sx={{ wordBreak: "break-word" }}>
            {error}
          </Box>
        </Banner>
      )}

      {identities.length === 0 ? (
        <EmptyState>{t("identities.noIdentities")}</EmptyState>
      ) : (
        <Stack gap={1}>
          {identities.map((label) => {
            const connected = label === connectedCertLabel;
            return (
              <SettingsCard
                key={label}
                sx={
                  connected
                    ? (theme: { palette: { nebula: { accentLine: string } } }) => ({
                        borderColor: theme.palette.nebula.accentLine,
                      })
                    : undefined
                }
              >
                <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
                  <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
                      {label}
                    </Typography>
                    {connected && (
                      <Box
                        component="span"
                        sx={(theme) => ({
                          flex: "none",
                          px: "7px",
                          py: "2px",
                          borderRadius: "999px",
                          fontSize: 10,
                          fontWeight: 600,
                          color: theme.palette.nebula.accent,
                          background: theme.palette.nebula.accentSoft,
                        })}
                      >
                        {t("identities.connectedBadge")}
                      </Box>
                    )}
                  </Stack>

                  {confirmDelete === label ? (
                    <Stack direction="row" gap={0.75} sx={{ flex: "none" }}>
                      <Button size="small" color="error" variant="contained" onClick={() => remove(label)}>
                        {t("identities.confirmDelete")}
                      </Button>
                      <Button size="small" onClick={() => setConfirmDelete(null)}>
                        {t("common:actions.cancel")}
                      </Button>
                    </Stack>
                  ) : (
                    <Stack direction="row" gap={0.75} sx={{ flex: "none" }}>
                      {isExpert && onEditProfile && (
                        <Button size="small" variant="outlined" onClick={() => onEditProfile(label)}>
                          {t("identities.editProfile")}
                        </Button>
                      )}
                      <Button size="small" variant="outlined" onClick={() => exportIdentity(label)}>
                        {t("identities.export")}
                      </Button>
                      <Button size="small" color="error" onClick={() => setConfirmDelete(label)}>
                        {t("identities.delete")}
                      </Button>
                    </Stack>
                  )}
                </Stack>
              </SettingsCard>
            );
          })}
        </Stack>
      )}

      <GroupRule />

      <GroupTitle>{t("identities.createNew")}</GroupTitle>
      <Stack direction="row" gap={1}>
        <TextField
          size="small"
          sx={{ flex: 1 }}
          value={newLabel}
          placeholder={t("identities.createPlaceholder")}
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && create()}
          slotProps={{ htmlInput: { "aria-label": t("identities.createNew") } }}
        />
        <Button variant="contained" disabled={!newLabel.trim()} onClick={create}>
          {t("identities.createBtn")}
        </Button>
      </Stack>

      <Box sx={{ mt: "14px" }}>
        <Button size="small" variant="outlined" onClick={importIdentity}>
          {t("identities.importBtn")}
        </Button>
      </Box>
    </Box>
  );
}
