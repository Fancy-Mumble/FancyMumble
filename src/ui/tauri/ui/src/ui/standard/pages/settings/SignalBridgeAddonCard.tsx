import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSignalBridgeAddon, type SignalBridgeStatus } from "@core/signalBridgeAddon";
import { TID } from "@core/testids";
import styles from "./PluginsPanel.module.css";

type Hint = "hintAddon" | "hintPackaged" | "hintMissing" | "hintUnavailable";

function hintKey(status: SignalBridgeStatus): Hint {
  if (status.installed) return status.source === "addon" ? "hintAddon" : "hintPackaged";
  return status.downloadable ? "hintMissing" : "hintUnavailable";
}

/** The client-side Signal Protocol add-on, above the server's plugins. */
export default function SignalBridgeAddonCard() {
  const { t } = useTranslation("settings");
  const { status, installing, progress, error, refresh, install } = useSignalBridgeAddon();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status) return null;

  const busyLabel =
    progress === null ? t("signalBridge.installing") : t("signalBridge.downloading", { percent: progress });

  return (
    <section className={styles.pluginCard}>
      <header className={styles.pluginHeader}>
        <div>
          <div className={styles.pluginName}>
            {t("signalBridge.title")}
            <span className={styles.pluginVersion}>v{status.version}</span>
          </div>
          <p className={styles.pluginDescription}>
            {error
              ? t("signalBridge.failed", { error })
              : t(`signalBridge.${hintKey(status)}`, { version: status.version })}
          </p>
        </div>
      </header>
      {!status.installed && status.downloadable && (
        <div className={styles.actions}>
          <button
            className={styles.btnSecondary}
            data-testid={TID.signalBridgeSettingsInstall}
            disabled={installing}
            onClick={() => void install()}
          >
            {installing ? busyLabel : t("signalBridge.install")}
          </button>
        </div>
      )}
    </section>
  );
}
