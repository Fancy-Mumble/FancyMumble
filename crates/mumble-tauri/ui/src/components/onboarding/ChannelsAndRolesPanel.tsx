import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

import { useAppStore } from "../../store";
import {
  computeRoleLabels,
  computeVisibleChannels,
  isOnboardingSupported,
  useOnboardingStore,
} from "./onboardingStore";
import styles from "./ChannelsAndRolesPanel.module.css";

/**
 * Post-join self-service editor.  Shows the user's current selections
 * (channels + roles) and offers a "Change my answers" button that
 * re-opens the OnboardingModal pre-filled with the previous response.
 */
export default function ChannelsAndRolesPanel() {
  const config = useOnboardingStore((s) => s.config);
  const response = useOnboardingStore((s) => s.response);
  const setModalOpen = useOnboardingStore((s) => s.setModalOpen);
  const setResponse = useOnboardingStore((s) => s.setResponse);

  const channels = useAppStore((s) => s.channels);
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const supported = isOnboardingSupported(serverFancyVersion);
  const { t } = useTranslation("settings");

  // Refresh the user's stored response whenever the panel mounts so
  // edits made on another device propagate without a full reconnect.
  useEffect(() => {
    if (!supported) return;
    invoke<boolean | null>("request_onboarding_response").catch(() => {});
  }, [supported]);

  const channelLookup = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of channels) map.set(c.id, c.name);
    return map;
  }, [channels]);

  const visibleChannels = useMemo(
    () => [...computeVisibleChannels(config, response)],
    [config, response],
  );
  const roleLabels = useMemo(
    () => computeRoleLabels(config, response),
    [config, response],
  );

  if (!supported) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.heading}>{t("onboarding.channelsAndRoles.heading")}</h3>
        <div className={styles.empty}>
          {t("onboarding.channelsAndRoles.unsupportedServer")}
        </div>
      </div>
    );
  }

  if (!config?.enabled) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.heading}>{t("onboarding.channelsAndRoles.heading")}</h3>
        <div className={styles.empty}>
          {t("onboarding.channelsAndRoles.notEnabled")}
        </div>
      </div>
    );
  }

  const handleClear = () => {
    setResponse(null);
    setModalOpen(true);
  };

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>{t("onboarding.channelsAndRoles.heading")}</h3>
      <p className={styles.subtle}>
        {t("onboarding.channelsAndRoles.subtitle")}
      </p>

      <section className={styles.section}>
        <p className={styles.sectionTitle}>{t("onboarding.channelsAndRoles.visibleChannels")}</p>
        {visibleChannels.length === 0 ? (
          <p className={styles.subtle}>{t("onboarding.channelsAndRoles.noChannels")}</p>
        ) : (
          <div className={styles.chipList}>
            {visibleChannels.map((id) => (
              <span key={id} className={styles.chip}>
                #{channelLookup.get(id) ?? id}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <p className={styles.sectionTitle}>{t("onboarding.channelsAndRoles.yourRoles")}</p>
        {roleLabels.length === 0 ? (
          <p className={styles.subtle}>{t("onboarding.channelsAndRoles.noRoles")}</p>
        ) : (
          <div className={styles.chipList}>
            {roleLabels.map((g) => (
              <span key={g} className={`${styles.chip} ${styles.chipActive}`}>
                {g}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className={styles.actions}>
        <button className={styles.btn} onClick={handleClear}>
          {t("onboarding.channelsAndRoles.resetBtn")}
        </button>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => setModalOpen(true)}
        >
          {t("onboarding.channelsAndRoles.changeAnswersBtn")}
        </button>
      </div>
    </div>
  );
}
