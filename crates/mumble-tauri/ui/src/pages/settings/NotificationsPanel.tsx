import { PlayIcon } from "../../icons";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  NotificationSoundSettings,
  NotificationEvent,
  NotificationEventConfig,
} from "../../types";
import { Toggle } from "./SharedControls";
import styles from "./SettingsPage.module.css";
import ns from "./NotificationsPanel.module.css";

import sndDragon3 from "../../assets/audio/dragon-studio-new-notification-3-398649.mp3";
import sndUniv033 from "../../assets/audio/universfield-new-notification-033-480571.mp3";
import sndUniv036 from "../../assets/audio/universfield-new-notification-036-485897.mp3";
import sndUniv040 from "../../assets/audio/universfield-new-notification-040-493469.mp3";
import sndUniv051 from "../../assets/audio/universfield-new-notification-051-494246.mp3";
import sndUniv057 from "../../assets/audio/universfield-new-notification-057-494255.mp3";
import sndUniv09 from "../../assets/audio/universfield-new-notification-09-352705.mp3";

export interface SoundOption {
  id: string;
  label: string;
  url: string;
}

const SOUND_URLS: Record<string, string> = {
  "none": "",
  "dragon-3": sndDragon3,
  "univ-033": sndUniv033,
  "univ-036": sndUniv036,
  "univ-040": sndUniv040,
  "univ-051": sndUniv051,
  "univ-057": sndUniv057,
  "univ-09": sndUniv09,
};

export const SOUND_OPTIONS: SoundOption[] = [
  { id: "none", label: "None", url: "" },
  { id: "dragon-3", label: "Chime", url: sndDragon3 },
  { id: "univ-033", label: "Bubble", url: sndUniv033 },
  { id: "univ-036", label: "Pop", url: sndUniv036 },
  { id: "univ-040", label: "Ding", url: sndUniv040 },
  { id: "univ-051", label: "Ping", url: sndUniv051 },
  { id: "univ-057", label: "Drop", url: sndUniv057 },
  { id: "univ-09", label: "Bell", url: sndUniv09 },
];

const EVENT_KEYS: readonly NotificationEvent[] = [
  "chatMessage",
  "directMessage",
  "mention",
  "userJoin",
  "userLeave",
  "userJoinChannel",
  "userLeaveChannel",
  "streamStart",
  "voiceActivity",
  "selfMuted",
];

function buildEventDefs(t: (key: string) => string): Array<{ key: NotificationEvent; label: string; description: string }> {
  return [
    { key: "chatMessage", label: t("notifications.evtChatMessage"), description: t("notifications.evtChatMessageDesc") },
    { key: "directMessage", label: t("notifications.evtDirectMessage"), description: t("notifications.evtDirectMessageDesc") },
    { key: "mention", label: t("notifications.evtMention"), description: t("notifications.evtMentionDesc") },
    { key: "userJoin", label: t("notifications.evtUserJoin"), description: t("notifications.evtUserJoinDesc") },
    { key: "userLeave", label: t("notifications.evtUserLeave"), description: t("notifications.evtUserLeaveDesc") },
    { key: "userJoinChannel", label: t("notifications.evtUserJoinChannel"), description: t("notifications.evtUserJoinChannelDesc") },
    { key: "userLeaveChannel", label: t("notifications.evtUserLeaveChannel"), description: t("notifications.evtUserLeaveChannelDesc") },
    { key: "streamStart", label: t("notifications.evtStreamStart"), description: t("notifications.evtStreamStartDesc") },
    { key: "voiceActivity", label: t("notifications.evtVoiceActivity"), description: t("notifications.evtVoiceActivityDesc") },
    { key: "selfMuted", label: t("notifications.evtSelfMuted"), description: t("notifications.evtSelfMutedDesc") },
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

export const DEFAULT_NOTIFICATION_SOUNDS: NotificationSoundSettings = {
  masterEnabled: false,
  events: {
    chatMessage: { enabled: true, sound: "dragon-3", volume: 0.5 },
    directMessage: { enabled: true, sound: "univ-033", volume: 0.7 },
    mention: { enabled: true, sound: "univ-09", volume: 0.7 },
    userJoin: { enabled: true, sound: "univ-036", volume: 0.4 },
    userLeave: { enabled: true, sound: "univ-040", volume: 0.4 },
    userJoinChannel: { enabled: true, sound: "univ-036", volume: 0.5 },
    userLeaveChannel: { enabled: true, sound: "univ-040", volume: 0.5 },
    streamStart: { enabled: true, sound: "univ-051", volume: 0.5 },
    voiceActivity: { enabled: false, sound: "none", volume: 0.3 },
    selfMuted: { enabled: true, sound: "univ-057", volume: 0.4 },
  },
};

function findSoundUrl(id: string): string {
  return SOUND_URLS[id] ?? "";
}

export function NotificationsPanel({
  settings,
  onChange,
  enableNativeNotifications,
  onToggleNativeNotifications,
  isExpert,
}: {
  settings: NotificationSoundSettings;
  onChange: (patch: Partial<NotificationSoundSettings>) => void;
  enableNativeNotifications: boolean;
  onToggleNativeNotifications: () => void;
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

  const allEnabled = EVENT_KEYS.every((key) => settings.events[key]?.enabled ?? DEFAULT_NOTIFICATION_SOUNDS.events[key].enabled);
  const allDisabled = EVENT_KEYS.every((key) => !(settings.events[key]?.enabled ?? DEFAULT_NOTIFICATION_SOUNDS.events[key].enabled));

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
          <Toggle
            checked={enableNativeNotifications}
            onChange={onToggleNativeNotifications}
          />
        </div>
      </section>

      {settings.masterEnabled && (
        <section className={styles.section}>
          <div className={ns.bulkActions}>
            <button
              type="button"
              className={ns.bulkBtn}
              onClick={enableAll}
              disabled={allEnabled}
            >
              {t("notifications.enableAll")}
            </button>
            <button
              type="button"
              className={ns.bulkBtn}
              onClick={disableAll}
              disabled={allDisabled}
            >
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
                      onChange={(e) =>
                        patchEvent(def.key, { sound: e.target.value })
                      }
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
                    <span className={ns.volumeValue}>
                      {Math.round(cfg.volume * 100)}%
                    </span>
                  </div>
                </div>
              )}
            </section>
          );
        })}
    </>
  );
}
