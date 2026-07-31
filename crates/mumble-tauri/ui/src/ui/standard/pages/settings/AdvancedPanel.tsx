import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { UserMode } from "@core/types";
import { Toggle } from "./SharedControls";
import { registerSettings } from "@core/features/settings/settingsSearchRegistry";
import { StreamViewerBackendSetting } from "./StreamViewerBackendSetting";
import styles from "./SettingsPage.module.css";
import { TextField } from "../../components/elements/TextField";

registerSettings("advanced")
  .add("advanced.expertMode", ["expert"])
  .add("advanced.uiMode", ["minimal", "lightweight", "qt", "interface", "ram", "memory"])
  .add("advanced.klipyApiKey", ["gif", "klipy", "api key"])
  .add("advanced.developerMode", ["developer", "debug"])
  .add("advanced.logLevel", ["logging", "log"])
  .add("advanced.logToFile", ["logging", "log", "file"])
  .add("advanced.terminalLogging", ["logging", "log", "terminal", "console", "stdout"])
  .add("advanced.autoZipLogs", ["logging", "log", "zip", "compress", "zstd"])
  .add("advanced.logFiles", ["logging", "log", "export", "view", "folder"])
  .add("advanced.translationHelper")
  .add("advanced.autoReconnect", ["reconnect"])
  .add("advanced.autoUpdate", ["update", "auto update"])
  .add("advanced.persistDms", ["direct messages", "history"])
  .add("advanced.disconnectWarning", ["disconnect", "confirmation"])
  .add("advanced.dangerZone", ["reset", "delete"]);

export function AdvancedPanel({
  userMode,
  klipyApiKey,
  logLevel,
  logToFile,
  terminalLogging,
  autoZipLogs,
  autoReconnect,
  autoUpdateOnStartup,
  persistDms,
  showDisconnectWarning,
  onToggleMode,
  onKlipyApiKeyChange,
  onLogLevelChange,
  onToggleLogToFile,
  onToggleTerminalLogging,
  onToggleAutoZipLogs,
  onToggleAutoReconnect,
  onToggleAutoUpdate,
  onTogglePersistDms,
  onToggleDisconnectWarning,
  onToggleDeveloperMode,
  onReset,
}: Readonly<{
  userMode: UserMode;
  klipyApiKey: string;
  logLevel: string;
  logToFile: boolean;
  terminalLogging: boolean;
  autoZipLogs: boolean;
  autoReconnect: boolean;
  autoUpdateOnStartup: boolean;
  persistDms: boolean;
  showDisconnectWarning: boolean;
  onToggleMode: () => void;
  onKlipyApiKeyChange: (key: string) => void;
  onLogLevelChange: (level: string) => void;
  onToggleLogToFile: () => void;
  onToggleTerminalLogging: () => void;
  onToggleAutoZipLogs: () => void;
  onToggleAutoReconnect: () => void;
  onToggleAutoUpdate: () => void;
  onTogglePersistDms: () => void;
  onToggleDisconnectWarning: () => void;
  onToggleDeveloperMode: () => void;
  onReset: () => void;
}>) {
  const [confirming, setConfirming] = useState(false);
  const [logBusy, setLogBusy] = useState(false);
  // Interface mode (full Tauri UI vs. minimal native qt6ui client). The
  // marker lives in a file both binaries share, so it is read/written via
  // invoke instead of the preferences store.
  const [minimalUi, setMinimalUi] = useState(false);
  const [confirmingMinimal, setConfirmingMinimal] = useState(false);
  const { t } = useTranslation(["settings", "common"]);

  useEffect(() => {
    invoke<string>("get_ui_mode")
      .then((mode) => setMinimalUi(mode === "minimal"))
      .catch(() => undefined);
  }, []);

  const handleUiModeToggle = () => {
    if (minimalUi) {
      // Turning minimal OFF while the full app runs (the marker was left
      // on "minimal", e.g. after a fallback start): just persist "full".
      invoke("set_ui_mode", { mode: "full" })
        .then(() => setMinimalUi(false))
        .catch((e) => console.error("set_ui_mode failed:", e));
    } else {
      setConfirmingMinimal(true);
    }
  };

  const handleSwitchToMinimal = async () => {
    try {
      await invoke("set_ui_mode", { mode: "minimal" });
      setMinimalUi(true);
      setConfirmingMinimal(false);
      // Hands off to qt6ui and exits this app; on error we roll back so
      // the toggle never lies about the active mode.
      await invoke("relaunch_in_minimal_mode");
    } catch (e) {
      console.error("switch to minimal mode failed:", e);
      await invoke("set_ui_mode", { mode: "full" }).catch(() => undefined);
      setMinimalUi(false);
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(t("advanced.uiModeError", { error: String(e) }), {
        kind: "error",
      });
    }
  };

  const handleExportLogs = async () => {
    setLogBusy(true);
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
      console.error("export_logs failed:", e);
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(t("advanced.exportLogsError", { error: String(e) }), {
        kind: "error",
      });
    } finally {
      setLogBusy(false);
    }
  };

  const handleViewLogs = async () => {
    try {
      const dir = await invoke<string>("get_log_directory");
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(dir);
    } catch (e) {
      console.error("open log directory failed:", e);
    }
  };

  return (
    <>
      <h2 className={styles.panelTitle}>{t("advanced.panelTitle")}</h2>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("advanced.expertMode")}</h3>
            <p className={styles.fieldHint}>
              {userMode === "normal"
                ? t("advanced.expertModeHintNormal")
                : t("advanced.expertModeHintExpert")}
            </p>
          </div>
          <Toggle checked={userMode !== "normal"} onChange={onToggleMode} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("advanced.uiMode")}</h3>
            <p className={styles.fieldHint}>{t("advanced.uiModeHint")}</p>
          </div>
          <Toggle checked={minimalUi} onChange={handleUiModeToggle} />
        </div>
        {confirmingMinimal && (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>{t("advanced.uiModeConfirmText")}</p>
            <div className={styles.confirmBtns}>
              <button type="button" className={styles.ghostBtn} onClick={() => void handleSwitchToMinimal()}>
                {t("advanced.uiModeConfirmBtn")}
              </button>
              <button type="button" className={styles.ghostBtn} onClick={() => setConfirmingMinimal(false)}>
                {t("common:actions.cancel")}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Stream viewer backend (renders only where >= 2 families exist). */}
      <StreamViewerBackendSetting />

      {userMode !== "normal" && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("advanced.klipyApiKey")}</h3>
          <p className={styles.fieldHint}>
            {t("advanced.klipyApiKeyHintBefore")}{" "}
            <a
              href="https://klipy.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)" }}
            >
              Klipy
            </a>{" "}
            {t("advanced.klipyApiKeyHintAfter")}
          </p>
          <TextField
            type="password"
            value={klipyApiKey}
            onChange={(e) => onKlipyApiKeyChange(e.target.value)}
            placeholder="klipy_xxxxxxxx..."
            autoComplete="off"
            spellCheck={false}
            aria-label={t("advanced.klipyApiKeyLabel", { defaultValue: "Klipy API key" })}
          />
        </section>
      )}

      {userMode !== "normal" && (
        <section className={styles.section}>
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <h3 className={styles.sectionTitle}>{t("advanced.developerMode")}</h3>
              <p className={styles.fieldHint}>{t("advanced.developerModeHint")}</p>
            </div>
            <Toggle checked={userMode === "developer"} onChange={onToggleDeveloperMode} />
          </div>
        </section>
      )}

      {userMode === "developer" && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("advanced.logLevel")}</h3>
          <p className={styles.fieldHint}>{t("advanced.logLevelHint")}</p>
          <select
            className={styles.select}
            value={logLevel}
            onChange={(e) => onLogLevelChange(e.target.value)}
          >
            <option value="error">{t("advanced.logLevelError")}</option>
            <option value="warn">{t("advanced.logLevelWarn")}</option>
            <option value="info">{t("advanced.logLevelInfo")}</option>
            <option value="debug">{t("advanced.logLevelDebug")}</option>
            <option value="trace">{t("advanced.logLevelTrace")}</option>
          </select>
        </section>
      )}

      {userMode === "developer" && (
        <section className={styles.section}>
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <h3 className={styles.sectionTitle}>{t("advanced.logToFile")}</h3>
              <p className={styles.fieldHint}>{t("advanced.logToFileHint")}</p>
            </div>
            <Toggle checked={logToFile} onChange={onToggleLogToFile} />
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <h3 className={styles.sectionTitle}>{t("advanced.autoZipLogs")}</h3>
              <p className={styles.fieldHint}>{t("advanced.autoZipLogsHint")}</p>
            </div>
            <Toggle checked={autoZipLogs} disabled={!logToFile} onChange={onToggleAutoZipLogs} />
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <h3 className={styles.sectionTitle}>{t("advanced.terminalLogging")}</h3>
              <p className={styles.fieldHint}>{t("advanced.terminalLoggingHint")}</p>
            </div>
            <Toggle checked={terminalLogging} onChange={onToggleTerminalLogging} />
          </div>

          <p className={styles.fieldHint} style={{ marginTop: "0.75rem" }}>
            {t("advanced.logFilesHint")}
          </p>
          <div className={styles.confirmBtns}>
            <button type="button" className={styles.ghostBtn} onClick={() => void handleViewLogs()}>
              {t("advanced.viewLogsBtn")}
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={logBusy}
              onClick={() => void handleExportLogs()}
            >
              {t("advanced.exportLogsBtn")}
            </button>
          </div>
        </section>
      )}

      {userMode === "developer" && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("advanced.translationHelper")}</h3>
          <p className={styles.fieldHint}>{t("advanced.translationHelperHint")}</p>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => {
              invoke("open_translation_popout").catch((e) => {
                console.error("open_translation_popout failed:", e);
              });
            }}
          >
            {t("advanced.translationHelperOpen")}
          </button>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("advanced.autoReconnect")}</h3>
            <p className={styles.fieldHint}>{t("advanced.autoReconnectHint")}</p>
          </div>
          <Toggle checked={autoReconnect} onChange={onToggleAutoReconnect} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("advanced.autoUpdate")}</h3>
            <p className={styles.fieldHint}>{t("advanced.autoUpdateHint")}</p>
          </div>
          <Toggle checked={autoUpdateOnStartup} onChange={onToggleAutoUpdate} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("advanced.persistDms")}</h3>
            <p className={styles.fieldHint}>{t("advanced.persistDmsHint")}</p>
          </div>
          <Toggle checked={persistDms} onChange={onTogglePersistDms} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>
              {t("advanced.disconnectWarning", { defaultValue: "Disconnect confirmation" })}
            </h3>
            <p className={styles.fieldHint}>
              {t("advanced.disconnectWarningHint", {
                defaultValue: "Ask for confirmation before disconnecting from a server.",
              })}
            </p>
          </div>
          <Toggle checked={showDisconnectWarning} onChange={onToggleDisconnectWarning} />
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("advanced.dangerZone")}</h3>
        <p className={styles.fieldHint}>{t("advanced.dangerZoneHint")}</p>
        {confirming ? (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>{t("advanced.dangerConfirmText")}</p>
            <div className={styles.confirmBtns}>
              <button type="button" className={styles.dangerBtn} onClick={onReset}>
                {t("advanced.dangerConfirmBtn")}
              </button>
              <button type="button" className={styles.ghostBtn} onClick={() => setConfirming(false)}>
                {t("common:actions.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={styles.dangerBtn} onClick={() => setConfirming(true)}>
            {t("advanced.dangerResetBtn")}
          </button>
        )}
      </section>
    </>
  );
}
