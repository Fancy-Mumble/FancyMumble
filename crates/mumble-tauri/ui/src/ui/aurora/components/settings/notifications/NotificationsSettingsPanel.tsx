import { useEffect, useState } from "react";
import type {
  NotificationEvent,
  NotificationEventConfig,
  NotificationSoundSettings,
  UserPreferences,
  WelcomeMessageDisplay,
} from "@core/types";
import { DEFAULT_NOTIFICATION_SOUNDS, NOTIFICATION_EVENT_KEYS } from "@core/features/notifications/sounds";
import { getNotificationSounds, saveNotificationSounds } from "@core/preferencesStorage";
import { Button } from "../../primitives";
import { SettingsGroup, SettingsRow, SettingsSelect } from "../layout";
import PreferenceToggleList from "../PreferenceToggleList";
import { SettingsToggleRow } from "../layout";
import { sectionPreferenceKeys, type PreferenceToggleHandler } from "../settingsModel";
import NotificationSoundRow from "./NotificationSoundRow";
import { NOTIFICATION_EVENT_COPY, WELCOME_MESSAGE_OPTIONS } from "./notificationCopy";
import { useSoundPreview } from "./useSoundPreview";
import styles from "./Notifications.module.css";

export interface NotificationsSettingsPanelProps {
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
  onPatch: (change: Partial<UserPreferences>) => Promise<void> | void;
}

/**
 * Native notifications, the server welcome message, and per-event sounds.
 *
 * Sounds are stored separately from the rest of the preferences (they have
 * their own storage helper, which broadcasts to the running client so a change
 * takes effect without a reconnect), so this panel owns that slice of state
 * rather than routing it through the settings controller.
 */
export default function NotificationsSettingsPanel({
  prefs,
  onToggle,
  onPatch,
}: NotificationsSettingsPanelProps) {
  const [sounds, setSounds] = useState<NotificationSoundSettings>(DEFAULT_NOTIFICATION_SOUNDS);
  const preview = useSoundPreview();

  useEffect(() => {
    void getNotificationSounds()
      .then((stored) => {
        if (stored) setSounds(stored);
      })
      .catch(() => undefined);
  }, []);

  const persist = (next: NotificationSoundSettings) => {
    setSounds(next);
    void saveNotificationSounds(next).catch(() => undefined);
  };

  const patchEvent = (key: NotificationEvent, patch: Partial<NotificationEventConfig>) =>
    persist({ ...sounds, events: { ...sounds.events, [key]: { ...sounds.events[key], ...patch } } });

  const setAllEnabled = (enabled: boolean) => {
    const events = { ...sounds.events };
    for (const key of NOTIFICATION_EVENT_KEYS) events[key] = { ...events[key], enabled };
    persist({ ...sounds, events });
  };

  const configFor = (key: NotificationEvent) => sounds.events[key] ?? DEFAULT_NOTIFICATION_SOUNDS.events[key];
  const allOn = NOTIFICATION_EVENT_KEYS.every((key) => configFor(key).enabled);
  const allOff = NOTIFICATION_EVENT_KEYS.every((key) => !configFor(key).enabled);

  return (
    <>
      <PreferenceToggleList
        title="Alerts"
        description="What the client may surface outside its own window."
        keys={sectionPreferenceKeys.notifications}
        prefs={prefs}
        onToggle={onToggle}
      />

      <SettingsGroup title="On connect">
        <SettingsRow
          title="Welcome message"
          detail="Show the server's welcome message after connecting."
          wide
        >
          <SettingsSelect
            label="Welcome message"
            value={prefs.welcomeMessageDisplay ?? "once"}
            onChange={(event) =>
              void onPatch({ welcomeMessageDisplay: event.target.value as WelcomeMessageDisplay })
            }
          >
            {WELCOME_MESSAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SettingsSelect>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Sounds"
        description="A cue per event, so you can tell what happened without looking."
      >
        <SettingsToggleRow
          title="Notification sounds"
          detail="Play a sound for the events selected below."
          checked={sounds.masterEnabled}
          onToggle={() => persist({ ...sounds, masterEnabled: !sounds.masterEnabled })}
        />

        {sounds.masterEnabled && (
          <>
            <div className={styles.bulkActions}>
              <Button onClick={() => setAllEnabled(true)} disabled={allOn}>
                Enable all
              </Button>
              <Button onClick={() => setAllEnabled(false)} disabled={allOff}>
                Disable all
              </Button>
            </div>

            {NOTIFICATION_EVENT_COPY.map((copy) => (
              <NotificationSoundRow
                key={copy.key}
                copy={copy}
                config={configFor(copy.key)}
                onChange={(patch) => patchEvent(copy.key, patch)}
                onPreview={preview}
              />
            ))}
          </>
        )}
      </SettingsGroup>
    </>
  );
}
