import { useTranslation } from "react-i18next";
import { InfoFilledIcon, MaximizeIcon, MinimizeIcon, WindowCloseIcon } from "../../icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopPlatform } from "../../utils/platform";
import ServerTabsBar from "./ServerTabsBar";
import styles from "./TitleBar.module.css";

export default function TitleBar() {
  const { t } = useTranslation("common");

  // On mobile (Android/iOS) there is no custom title bar - the OS
  // provides its own status bar and navigation.
  if (!isDesktopPlatform()) {
    return null;
  }

  const appWindow = getCurrentWindow();

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
  };

  const handleClose = async () => {
    await appWindow.close();
  };

  return (
    <div className={styles.titleBar} data-tauri-drag-region>
      <div className={styles.titleSection} data-tauri-drag-region>
        <div className={styles.logo}>
          <InfoFilledIcon width={20} height={20} />
        </div>
        <span className={styles.title}>{t("brand")}</span>
      </div>

      <div className={styles.tabsSection} data-tauri-drag-region>
        <ServerTabsBar />
      </div>

      <div className={styles.controls}>
        <button
          className={styles.controlBtn}
          onClick={handleMinimize}
          aria-label={t("actions.minimize")}
        >
          <MinimizeIcon width={12} height={12} />
        </button>
        <button
          className={styles.controlBtn}
          onClick={handleMaximize}
          aria-label={t("actions.maximize")}
        >
          <MaximizeIcon width={12} height={12} />
        </button>
        <button
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          onClick={handleClose}
          aria-label={t("actions.close")}
        >
          <WindowCloseIcon width={12} height={12} />
        </button>
      </div>
    </div>
  );
}
