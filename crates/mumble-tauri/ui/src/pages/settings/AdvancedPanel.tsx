import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { UserMode } from "../../types";
import { Toggle } from "./SharedControls";
import { registerSettings } from "./settingsSearchRegistry";
import styles from "./SettingsPage.module.css";

registerSettings("advanced")
  .add("advanced.expertMode", ["expert"])
  .add("advanced.klipyApiKey", ["gif", "klipy", "api key"])
  .add("advanced.developerMode", ["developer", "debug"])
  .add("advanced.logLevel", ["logging", "log"])
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
  autoReconnect,
  autoUpdateOnStartup,
  persistDms,
  showDisconnectWarning,
  onToggleMode,
  onKlipyApiKeyChange,
  onLogLevelChange,
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
  autoReconnect: boolean;
  autoUpdateOnStartup: boolean;
  persistDms: boolean;
  showDisconnectWarning: boolean;
  onToggleMode: () => void;
  onKlipyApiKeyChange: (key: string) => void;
  onLogLevelChange: (level: string) => void;
  onToggleAutoReconnect: () => void;
  onToggleAutoUpdate: () => void;
  onTogglePersistDms: () => void;
  onToggleDisconnectWarning: () => void;
  onToggleDeveloperMode: () => void;
  onReset: () => void;
}>) {
  const [confirming, setConfirming] = useState(false);
  const { t } = useTranslation(["settings", "common"]);

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
          <input
            type="password"
            className={styles.input}
            value={klipyApiKey}
            onChange={(e) => onKlipyApiKeyChange(e.target.value)}
            placeholder="klipy_xxxxxxxx..."
            autoComplete="off"
            spellCheck={false}
          />
        </section>
      )}

      {userMode !== "normal" && (
        <section className={styles.section}>
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <h3 className={styles.sectionTitle}>{t("advanced.developerMode")}</h3>
              <p className={styles.fieldHint}>
                {t("advanced.developerModeHint")}
              </p>
            </div>
            <Toggle
              checked={userMode === "developer"}
              onChange={onToggleDeveloperMode}
            />
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
          <Toggle
            checked={autoUpdateOnStartup}
            onChange={onToggleAutoUpdate}
          />
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
            <h3 className={styles.sectionTitle}>{t("advanced.disconnectWarning", { defaultValue: "Disconnect confirmation" })}</h3>
            <p className={styles.fieldHint}>{t("advanced.disconnectWarningHint", { defaultValue: "Ask for confirmation before disconnecting from a server." })}</p>
          </div>
          <Toggle checked={showDisconnectWarning} onChange={onToggleDisconnectWarning} />
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("advanced.dangerZone")}</h3>
        <p className={styles.fieldHint}>{t("advanced.dangerZoneHint")}</p>
        {confirming ? (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>
              {t("advanced.dangerConfirmText")}
            </p>
            <div className={styles.confirmBtns}>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={onReset}
              >
                {t("advanced.dangerConfirmBtn")}
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => setConfirming(false)}
              >
                {t("common:actions.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => setConfirming(true)}
          >
            {t("advanced.dangerResetBtn")}
          </button>
        )}
      </section>
    </>
  );
}
