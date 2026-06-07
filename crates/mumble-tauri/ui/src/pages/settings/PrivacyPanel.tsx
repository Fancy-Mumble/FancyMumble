import { useTranslation } from "react-i18next";
import { Toggle } from "./SharedControls";
import styles from "./SettingsPage.module.css";
import { registerSettings } from "./settingsSearchRegistry";

registerSettings("privacy")
  .add("privacy.dualPath", ["encryption"])
  .add("privacy.readReceipts")
  .add("privacy.typingIndicators", ["typing"])
  .add("privacy.osmMaps", ["maps", "geolocation", "openstreetmap"])
  .add("privacy.linkPreviews", ["embeds", "previews"])
  .add("privacy.externalEmbeds", ["youtube", "watch together"])
  .add("privacy.streamerMode", ["stream", "hide ip"]);

export function PrivacyPanel({
  enableDualPath,
  disableReadReceipts,
  disableTypingIndicators,
  disableOsmMaps,
  disableLinkPreviews,
  enableExternalEmbeds,
  streamerMode,
  onToggleDualPath,
  onToggleReadReceipts,
  onToggleTypingIndicators,
  onToggleOsmMaps,
  onToggleLinkPreviews,
  onToggleExternalEmbeds,
  onToggleStreamerMode,
}: {
  enableDualPath: boolean;
  disableReadReceipts: boolean;
  disableTypingIndicators: boolean;
  disableOsmMaps: boolean;
  disableLinkPreviews: boolean;
  enableExternalEmbeds: boolean;
  streamerMode: boolean;
  onToggleDualPath: () => void;
  onToggleReadReceipts: () => void;
  onToggleTypingIndicators: () => void;
  onToggleOsmMaps: () => void;
  onToggleLinkPreviews: () => void;
  onToggleExternalEmbeds: () => void;
  onToggleStreamerMode: () => void;
}) {
  const { t } = useTranslation("settings");

  return (
    <>
      <h2 className={styles.panelTitle}>{t("privacy.panelTitle")}</h2>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("privacy.dualPath")}</h3>
            <p className={styles.fieldHint}>{t("privacy.dualPathHint")}</p>
          </div>
          <Toggle checked={enableDualPath} onChange={onToggleDualPath} />
        </div>
        <div className={enableDualPath ? styles.warningBannerDanger : styles.warningBannerMuted}>
          <span>{enableDualPath ? t("privacy.dualPathWarningActive") : t("privacy.dualPathWarningMuted")}</span>
          <p>{t("privacy.dualPathWarningActivePara")}</p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("privacy.readReceipts")}</h3>
            <p className={styles.fieldHint}>{t("privacy.readReceiptsHint")}</p>
          </div>
          <Toggle checked={disableReadReceipts} onChange={onToggleReadReceipts} />
        </div>
        {!disableReadReceipts && (
          <div className={styles.warningBanner}>
            <span>{t("privacy.readReceiptsWarning")}</span>
            <p>{t("privacy.readReceiptsWarningPara")}</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("privacy.typingIndicators")}</h3>
            <p className={styles.fieldHint}>{t("privacy.typingIndicatorsHint")}</p>
          </div>
          <Toggle checked={disableTypingIndicators} onChange={onToggleTypingIndicators} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("privacy.osmMaps")}</h3>
            <p className={styles.fieldHint}>{t("privacy.osmMapsHint")}</p>
          </div>
          <Toggle checked={disableOsmMaps} onChange={onToggleOsmMaps} />
        </div>
        {!disableOsmMaps && (
          <div className={styles.warningBanner}>
            <span>{t("privacy.osmMapsWarning")}</span>
            <p>{t("privacy.osmMapsWarningPara")}</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("privacy.linkPreviews")}</h3>
            <p className={styles.fieldHint}>{t("privacy.linkPreviewsHint")}</p>
          </div>
          <Toggle checked={disableLinkPreviews} onChange={onToggleLinkPreviews} />
        </div>
        {!disableLinkPreviews && (
          <div className={styles.warningBanner}>
            <span>{t("privacy.linkPreviewsWarning")}</span>
            <p>{t("privacy.linkPreviewsWarningPara")}</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("privacy.externalEmbeds")}</h3>
            <p className={styles.fieldHint}>{t("privacy.externalEmbedsHint")}</p>
          </div>
          <Toggle checked={enableExternalEmbeds} onChange={onToggleExternalEmbeds} />
        </div>
        {enableExternalEmbeds && (
          <div className={styles.warningBanner}>
            <span>{t("privacy.externalEmbedsWarning")}</span>
            <p>{t("privacy.externalEmbedsWarningPara")}</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("privacy.streamerMode")}</h3>
            <p className={styles.fieldHint}>{t("privacy.streamerModeHint")}</p>
          </div>
          <Toggle checked={streamerMode} onChange={onToggleStreamerMode} />
        </div>
      </section>
    </>
  );
}
