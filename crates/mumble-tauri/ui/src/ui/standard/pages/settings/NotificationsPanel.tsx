import { PlayIcon } from "../../icons";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  NotificationSoundSettings,
  NotificationEvent,
  NotificationEventConfig,
  WelcomeMessageDisplay,
} from "@core/types";
import { Toggle } from "./SharedControls";
import { registerSettings } from "@core/features/settings/settingsSearchRegistry";
import styles from "./SettingsPage.module.css";
import ns from "./NotificationsPanel.module.css";

import {
  DEFAULT_NOTIFICATION_SOUNDS,
  NOTIFICATION_EVENT_KEYS,
  SOUND_OPTIONS,
  findSoundUrl,
  type SoundOption,
} from "@core/features/notifications/sounds";

// The catalogue moved to core so every pack can read it; re-exported here
// because App.tsx, the sound hook, and the tests all import it from this path.
export { DEFAULT_NOTIFICATION_SOUNDS, SOUND_OPTIONS };
export type { SoundOption };

registerSettings("notifications")
  .add("notifications.sounds", ["sound", "audio alert"])
  .add("notifications.native", ["os notifications", "desktop"])
  .add("notifications.welcomeMessage", ["welcome", "motd", "popup"]);

const EVENT_KEYS = NOTIFICATION_EVENT_KEYS;

function buildEventDefs(
  t: (key: string) => string,
): Array<{ key: NotificationEvent; label: string; description: string }> {
  return [
    {
      key: "chatMessage",
      label: t("notifications.evtChatMessage"),
      description: t("notifications.evtChatMessageDesc"),
    },
    {
      key: "directMessage",
      label: t("notifications.evtDirectMessage"),
      description: t("notifications.evtDirectMessageDesc"),
    },
    { key: "mention", label: t("notifications.evtMention"), description: t("notifications.evtMentionDesc") },
    {
      key: "userJoin",
      label: t("notifications.evtUserJoin"),
      description: t("notifications.evtUserJoinDesc"),
    },
    {
      key: "userLeave",
      label: t("notifications.evtUserLeave"),
      description: t("notifications.evtUserLeaveDesc"),
    },
    {
      key: "userJoinChannel",
      label: t("notifications.evtUserJoinChannel"),
      description: t("notifications.evtUserJoinChannelDesc"),
    },
    {
      key: "userLeaveChannel",
      label: t("notifications.evtUserLeaveChannel"),
      description: t("notifications.evtUserLeaveChannelDesc"),
    },
    {
      key: "streamStart",
      label: t("notifications.evtStreamStart"),
      description: t("notifications.evtStreamStartDesc"),
    },
    {
      key: "voiceActivity",
      label: t("notifications.evtVoiceActivity"),
      description: t("notifications.evtVoiceActivityDesc"),
    },
    {
      key: "selfMuted",
      label: t("notifications.evtSelfMuted"),
      description: t("notifications.evtSelfMutedDesc"),
    },
  ];
}

function buildSoundOptions(t: (key: string) => string): Array<{ id: string; label: string }> {
  return [
    { id: "none", label: t("notifications.soundNone") },
    { id: "dragon-3", label: t("notifications.soundChime") },
    { id: "univ-033", label: t("notifications.soundBubble") },
    { id: "univ-036", label: t("notifications.soundPop") },
    { id: "univ-040", label: t("notifications.soundDing") },
    { id: "univ-051", label: t("notifications.soundPing") },
    { id: "univ-057", label: t("notifications.soundDrop") },
    { id: "univ-09", label: t("notifications.soundBell") },
  ];
}

export function NotificationsPanel({
  settings,
  onChange,
  enableNativeNotifications,
  onToggleNativeNotifications,
  welcomeMessageDisplay,
  onWelcomeMessageDisplayChange,
  isExpert,
}: {
  settings: NotificationSoundSettings;
  onChange: (patch: Partial<NotificationSoundSettings>) => void;
  enableNativeNotifications: boolean;
  onToggleNativeNotifications: () => void;
  welcomeMessageDisplay: WelcomeMessageDisplay;
  onWelcomeMessageDisplayChange: (value: WelcomeMessageDisplay) => void;
  isExpert: boolean;
}) {
  const { t } = useTranslation("settings");
  const tStr = t as (key: string) => string;
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const eventDefs = buildEventDefs(tStr);
  const soundOptions = buildSoundOptions(tStr);

  const patchEvent = useCallback(
    (key: NotificationEvent, patch: Partial<NotificationEventConfig>) => {
      onChange({
        events: {
          ...settings.events,
          [key]: { ...settings.events[key], ...patch },
        },
      });
    },
    [settings.events, onChange],
  );

  const toggleMaster = useCallback(() => {
    onChange({ masterEnabled: !settings.masterEnabled });
  }, [settings.masterEnabled, onChange]);

  const enableAll = useCallback(() => {
    const updated = { ...settings.events };
    for (const key of EVENT_KEYS) {
      updated[key] = { ...updated[key], enabled: true };
    }
    onChange({ events: updated });
  }, [settings.events, onChange]);

  const disableAll = useCallback(() => {
    const updated = { ...settings.events };
    for (const key of EVENT_KEYS) {
      updated[key] = { ...updated[key], enabled: false };
    }
    onChange({ events: updated });
  }, [settings.events, onChange]);

  const preview = useCallback((soundId: string, volume: number) => {
    const url = findSoundUrl(soundId);
    if (!url) return;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
    }
    const audio = new Audio(url);
    audio.volume = volume;
    previewAudioRef.current = audio;
    audio.play().catch(() => {});
  }, []);

  const allEnabled = EVENT_KEYS.every(
    (key) => settings.events[key]?.enabled ?? DEFAULT_NOTIFICATION_SOUNDS.events[key].enabled,
  );
  const allDisabled = EVENT_KEYS.every(
    (key) => !(settings.events[key]?.enabled ?? DEFAULT_NOTIFICATION_SOUNDS.events[key].enabled),
  );

  return (
    <>
      <h2 className={styles.panelTitle}>{t("notifications.panelTitle")}</h2>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("notifications.sounds")}</h3>
            <p className={styles.fieldHint}>{t("notifications.soundsHint")}</p>
          </div>
          <Toggle checked={settings.masterEnabled} onChange={toggleMaster} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <h3 className={styles.sectionTitle}>{t("notifications.native")}</h3>
            <p className={styles.fieldHint}>{t("notifications.nativeHint")}</p>
          </div>
          <Toggle checked={enableNativeNotifications} onChange={onToggleNativeNotifications} />
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          {t("notifications.welcomeMessage", { defaultValue: "Welcome message" })}
        </h3>
        <p className={styles.fieldHint}>
          {t("notifications.welcomeMessageHint", {
            defaultValue: "Show the server's welcome message in a popup after connecting.",
          })}
        </p>
        <select
          className={styles.select}
          value={welcomeMessageDisplay}
          onChange={(e) => onWelcomeMessageDisplayChange(e.target.value as WelcomeMessageDisplay)}
        >
          <option value="hide">{t("notifications.welcomeHide", { defaultValue: "Hide" })}</option>
          <option value="once">{t("notifications.welcomeOnce", { defaultValue: "Show once" })}</option>
          <option value="always">{t("notifications.welcomeAlways", { defaultValue: "Always show" })}</option>
        </select>
      </section>

      {settings.masterEnabled && (
        <section className={styles.section}>
          <div className={ns.bulkActions}>
            <button type="button" className={ns.bulkBtn} onClick={enableAll} disabled={allEnabled}>
              {t("notifications.enableAll")}
            </button>
            <button type="button" className={ns.bulkBtn} onClick={disableAll} disabled={allDisabled}>
              {t("notifications.disableAll")}
            </button>
          </div>
        </section>
      )}

      {settings.masterEnabled &&
        eventDefs.map((def) => {
          const cfg = settings.events[def.key] ?? DEFAULT_NOTIFICATION_SOUNDS.events[def.key];
          return (
            <section key={def.key} className={styles.section}>
              <div className={styles.toggleRow}>
                <div className={styles.toggleInfo}>
                  <h3 className={styles.sectionTitle}>{def.label}</h3>
                  <p className={styles.fieldHint}>{def.description}</p>
                </div>
                <Toggle
                  checked={cfg.enabled}
                  onChange={() => patchEvent(def.key, { enabled: !cfg.enabled })}
                />
              </div>

              {cfg.enabled && isExpert && (
                <div className={ns.eventConfig}>
                  <div className={ns.soundRow}>
                    <select
                      className={styles.select}
                      value={cfg.sound}
                      onChange={(e) => patchEvent(def.key, { sound: e.target.value })}
                    >
                      {soundOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={ns.previewBtn}
                      onClick={() => preview(cfg.sound, cfg.volume)}
                      disabled={cfg.sound === "none"}
                      title={t("notifications.previewTitle")}
                    >
                      <PlayIcon width={16} height={16} />
                    </button>
                  </div>

                  <div className={ns.volumeRow}>
                    <span className={ns.volumeLabel}>{t("notifications.volume")}</span>
                    <input
                      type="range"
                      className={styles.slider}
                      min={0}
                      max={1}
                      step={0.05}
                      value={cfg.volume}
                      onChange={(e) =>
                        patchEvent(def.key, {
                          volume: parseFloat(e.target.value),
                        })
                      }
                    />
                    <span className={ns.volumeValue}>{Math.round(cfg.volume * 100)}%</span>
                  </div>
                </div>
              )}
            </section>
          );
        })}
    </>
  );
}
