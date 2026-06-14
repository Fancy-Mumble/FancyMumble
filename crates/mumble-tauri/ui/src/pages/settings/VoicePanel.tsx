import { useTranslation } from "react-i18next";
import type { AudioSettings } from "../../types";
import { Toggle, SliderField, ShortcutRecorder } from "./SharedControls";
import styles from "./SettingsPage.module.css";
import panelStyles from "./VoicePanel.module.css";

export function VoicePanel({
  settings,
  onChange,
  isExpert,
}: {
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  isExpert: boolean;
}) {
  const { t } = useTranslation("settings");
  return (
    <>
      <h2 className={styles.panelTitle}>{t("voice.panelTitle")}</h2>

      <section className={styles.section}>
        <SliderField
          label={t("voice.vadThreshold")}
          hint={t("voice.vadThresholdHint")}
          min={0}
          max={1}
          step={0.01}
          value={settings.vad_threshold}
          onChange={(v) => onChange({ vad_threshold: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </section>

      {isExpert && (
        <>
          <section className={styles.section}>
            <SliderField
              label={t("voice.noiseGateClose")}
              hint={t("voice.noiseGateCloseHint")}
              min={0.1}
              max={1}
              step={0.05}
              value={settings.noise_gate_close_ratio}
              onChange={(v) => onChange({ noise_gate_close_ratio: v })}
              format={(v) => v.toFixed(2)}
            />
          </section>

          <section className={styles.section}>
            <SliderField
              label={t("voice.holdFrames")}
              hint={t("voice.holdFramesHint")}
              min={1}
              max={50}
              step={1}
              value={settings.hold_frames}
              onChange={(v) => onChange({ hold_frames: v })}
            />
          </section>

          <section className={styles.section}>
            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <h3 className={styles.sectionTitle}>{t("voice.pushToTalk")}</h3>
                <p className={styles.fieldHint}>
                  {t("voice.pushToTalkHint")}
                </p>
              </div>
              <Toggle
                checked={settings.push_to_talk}
                onChange={() =>
                  onChange({ push_to_talk: !settings.push_to_talk })
                }
              />
            </div>
            {settings.push_to_talk && (
              <div className={panelStyles.pttKeyRow}>
                <ShortcutRecorder
                  label={t("voice.pttKey")}
                  value={settings.push_to_talk_key ?? ""}
                  onChange={(key) =>
                    onChange({ push_to_talk_key: key || null })
                  }
                />
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

