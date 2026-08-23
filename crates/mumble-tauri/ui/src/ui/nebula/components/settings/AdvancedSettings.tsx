import { useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@core/utils/store";
import type { UserMode } from "@core/types";
// Which viewer family receives screen shares is a platform question, not a
// design one, and the control hides itself where the choice does not exist.
import { StreamViewerBackendSetting } from "@standard/pages/settings/StreamViewerBackendSetting";
import { Stack } from "../primitives";
import {
  ActionRow,
  Banner,
  GroupRule,
  GroupTitle,
  PageTitle,
  SelectField,
  TextRow,
  ToggleRow,
} from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";

/** Backend log levels, each with its label key spelled out - see the note on
 *  `SOUND_LABEL_KEYS`: an assembled key is `string`, which does not typecheck
 *  against the i18n catalogue. */
const LOG_LEVELS = [
  { id: "error", labelKey: "advanced.logLevelError" },
  { id: "warn", labelKey: "advanced.logLevelWarn" },
  { id: "info", labelKey: "advanced.logLevelInfo" },
  { id: "debug", labelKey: "advanced.logLevelDebug" },
  { id: "trace", labelKey: "advanced.logLevelTrace" },
] as const;

/** The files whose plugin-side cache must be dropped for a reset to stick. */
const RESET_STORES = ["preferences.json", "servers.json", "shortcuts.json", "profile.json"];

/**
 * The Advanced page.
 *
 * Three of its controls do not live in the preferences store at all - the
 * interface-mode marker is a file both binaries read, the stream-viewer family
 * is latched from localStorage before React runs, and the reset clears the
 * store plugin's own cache - so each keeps the storage it needs rather than
 * being forced into `usePreferenceSettings`.
 *
 * Expert mode gates the second half of the page and developer mode the logging
 * controls, matching Standard: the switches below them are ones that can leave
 * the app in a state the user cannot explain.
 */
export function AdvancedSettings() {
  const { t } = useTranslation(["settings", "common"]);
  const { prefs, set, toggle } = usePreferenceSettings();
  const [minimalUi, setMinimalUi] = useState(false);
  const [confirmingMinimal, setConfirmingMinimal] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void invoke<string>("get_ui_mode")
      .then((mode) => setMinimalUi(mode === "minimal"))
      .catch(() => undefined);
  }, []);

  if (!prefs) return null;

  const isExpert = prefs.userMode !== "normal";
  const isDeveloper = prefs.userMode === "developer";

  const setUserMode = (userMode: UserMode) => set({ userMode });

  const switchToMinimal = async () => {
    try {
      await invoke("set_ui_mode", { mode: "minimal" });
      setMinimalUi(true);
      setConfirmingMinimal(false);
      // Hands off to qt6ui and exits this app. On error the marker is rolled
      // back, so the switch never claims a mode the app is not in.
      await invoke("relaunch_in_minimal_mode");
    } catch (e) {
      await invoke("set_ui_mode", { mode: "full" }).catch(() => undefined);
      setMinimalUi(false);
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(t("advanced.uiModeError", { error: String(e) }), { kind: "error" });
    }
  };

  const exportLogs = async () => {
    setExporting(true);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({
        defaultPath: "fancy-mumble-logs.log.zst",
        filters: [{ name: "zstd log archive", extensions: ["zst"] }],
      });
      if (!dest) return;
      await invoke("export_logs", { destPath: dest });
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(t("advanced.exportLogsDone"), { kind: "info" });
    } catch (e) {
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(t("advanced.exportLogsError", { error: String(e) }), { kind: "error" });
    } finally {
      setExporting(false);
    }
  };

  const reset = async () => {
    try {
      // The store plugin keeps a Rust-side cache that survives a webview
      // reload, so deleting the files alone leaves the old data in memory.
      for (const file of RESET_STORES) {
        try {
          const store = await load(file, { autoSave: false, defaults: {} });
          await store.clear();
          await store.save();
        } catch {
          // The file may not exist yet.
        }
      }
      await invoke("reset_app_data");
      // Reload so `isFirstRun()` re-evaluates and the welcome page shows.
      window.location.replace("/");
    } catch (e) {
      console.error("reset_app_data error:", e);
    }
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("advanced.panelTitle")} />

      <ToggleRow
        title={t("advanced.expertMode")}
        hint={isExpert ? t("advanced.expertModeHintExpert") : t("advanced.expertModeHintNormal")}
        checked={isExpert}
        onChange={() => setUserMode(isExpert ? "normal" : "expert")}
      />

      {isExpert && (
        <>
          <ToggleRow
            title={t("advanced.uiMode")}
            hint={t("advanced.uiModeHint")}
            checked={minimalUi}
            onChange={() => {
              if (!minimalUi) return setConfirmingMinimal(true);
              // Turning minimal *off* while the full app is running only has to
              // correct the marker - there is nothing to relaunch into.
              void invoke("set_ui_mode", { mode: "full" })
                .then(() => setMinimalUi(false))
                .catch(() => undefined);
            }}
          >
            {confirmingMinimal && (
              <Banner tone="warn">
                {t("advanced.uiModeConfirmText")}
                <Stack direction="row" gap={0.75} sx={{ mt: "9px" }}>
                  <Button size="small" variant="outlined" onClick={() => void switchToMinimal()}>
                    {t("advanced.uiModeConfirmBtn")}
                  </Button>
                  <Button size="small" onClick={() => setConfirmingMinimal(false)}>
                    {t("common:actions.cancel")}
                  </Button>
                </Stack>
              </Banner>
            )}
          </ToggleRow>

          <GroupRule />

          <TextRow
            label={t("advanced.klipyApiKey")}
            hint={`${t("advanced.klipyApiKeyHintBefore")} ${t("advanced.klipyApiKeyHintAfter")}`}
            value={prefs.klipyApiKey}
            onChange={(klipyApiKey) => set({ klipyApiKey })}
          />

          <StreamViewerBackendSetting />

          <GroupRule />

          <ToggleRow
            title={t("advanced.developerMode")}
            hint={t("advanced.developerModeHint")}
            checked={isDeveloper}
            onChange={() => setUserMode(isDeveloper ? "expert" : "developer")}
          />
        </>
      )}

      {isDeveloper && (
        <>
          <GroupRule />
          <GroupTitle>{t("advanced.logLevel")}</GroupTitle>

          <SelectField
            label={t("advanced.logLevel")}
            hint={t("advanced.logLevelHint")}
            value={prefs.logLevel}
            onChange={(logLevel) => set({ logLevel })}
            options={LOG_LEVELS.map(({ id, labelKey }) => ({ id, label: t(labelKey) }))}
          />

          <ToggleRow
            title={t("advanced.logToFile")}
            hint={t("advanced.logToFileHint")}
            checked={prefs.logToFile}
            onChange={() => toggle("logToFile")}
          />
          <ToggleRow
            title={t("advanced.autoZipLogs")}
            hint={t("advanced.autoZipLogsHint")}
            checked={prefs.autoZipLogs}
            // Compressing rotated log files means nothing while nothing is
            // being written to one.
            disabled={!prefs.logToFile}
            onChange={() => toggle("autoZipLogs")}
          />
          <ToggleRow
            title={t("advanced.terminalLogging")}
            hint={t("advanced.terminalLoggingHint")}
            checked={prefs.terminalLogging}
            onChange={() => toggle("terminalLogging")}
          />

          <ActionRow
            title={t("advanced.logFiles", { defaultValue: "Log files" })}
            hint={t("advanced.logFilesHint")}
            action={
              <Stack direction="row" gap={0.75}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    void invoke<string>("get_log_directory")
                      .then(async (dir) => {
                        const { openPath } = await import("@tauri-apps/plugin-opener");
                        await openPath(dir);
                      })
                      .catch(() => undefined)
                  }
                >
                  {t("advanced.viewLogsBtn")}
                </Button>
                <Button size="small" variant="outlined" disabled={exporting} onClick={() => void exportLogs()}>
                  {t("advanced.exportLogsBtn")}
                </Button>
              </Stack>
            }
          />

          <ActionRow
            title={t("advanced.translationHelper")}
            hint={t("advanced.translationHelperHint")}
            action={
              <Button
                size="small"
                variant="outlined"
                onClick={() => void invoke("open_translation_popout").catch(() => undefined)}
              >
                {t("advanced.translationHelperOpen")}
              </Button>
            }
          />
        </>
      )}

      <GroupRule />

      <ToggleRow
        title={t("advanced.autoReconnect")}
        hint={t("advanced.autoReconnectHint")}
        checked={prefs.autoReconnect}
        onChange={() => toggle("autoReconnect")}
      />
      <ToggleRow
        title={t("advanced.autoUpdate")}
        hint={t("advanced.autoUpdateHint")}
        checked={prefs.autoUpdateOnStartup}
        onChange={() => toggle("autoUpdateOnStartup")}
      />
      <ToggleRow
        title={t("advanced.persistDms")}
        hint={t("advanced.persistDmsHint")}
        checked={prefs.persistDms}
        onChange={() => toggle("persistDms")}
      />
      <ToggleRow
        title={t("advanced.disconnectWarning", { defaultValue: "Disconnect confirmation" })}
        hint={t("advanced.disconnectWarningHint", {
          defaultValue: "Ask for confirmation before disconnecting from a server.",
        })}
        checked={prefs.showDisconnectWarning}
        onChange={() => toggle("showDisconnectWarning")}
      />

      <GroupRule />

      <GroupTitle hint={t("advanced.dangerZoneHint")}>{t("advanced.dangerZone")}</GroupTitle>
      {confirmingReset ? (
        <Banner tone="danger">
          {t("advanced.dangerConfirmText")}
          <Stack direction="row" gap={0.75} sx={{ mt: "9px" }}>
            <Button size="small" color="error" variant="contained" onClick={() => void reset()}>
              {t("advanced.dangerConfirmBtn")}
            </Button>
            <Button size="small" onClick={() => setConfirmingReset(false)}>
              {t("common:actions.cancel")}
            </Button>
          </Stack>
        </Banner>
      ) : (
        <Button size="small" color="error" variant="outlined" onClick={() => setConfirmingReset(true)}>
          {t("advanced.dangerResetBtn")}
        </Button>
      )}

      <Typography sx={{ height: 20 }} />
    </Box>
  );
}
