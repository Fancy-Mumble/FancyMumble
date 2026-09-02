import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, MenuItem, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { getNotificationSounds, saveNotificationSounds } from "@core/preferencesStorage";
import {
  DEFAULT_NOTIFICATION_SOUNDS,
  NOTIFICATION_EVENT_KEYS,
  findSoundUrl,
} from "@core/features/notifications/sounds";
import type {
  NotificationEvent,
  NotificationEventConfig,
  NotificationSoundSettings,
  WelcomeMessageDisplay,
} from "@core/types";
import { PlayIcon } from "@ui/icons";
import { Stack } from "../primitives";
import {
  GroupRule,
  GroupTitle,
  PageTitle,
  SelectField,
  SettingsCard,
  SliderRow,
  ToggleRow,
} from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";

const SOUND_IDS = [
  "none",
  "dragon-3",
  "univ-033",
  "univ-036",
  "univ-040",
  "univ-051",
  "univ-057",
  "univ-09",
] as const;

/**
 * The label key for each sound id, so the picker reads as names not catalogue
 * numbers. Written out rather than derived, because the i18n keys are a typed
 * union - a key assembled from a template is `string`, which is exactly the
 * type that cannot be checked against the catalogue.
 */
const SOUND_LABEL_KEYS = {
  none: "notifications.soundNone",
  "dragon-3": "notifications.soundChime",
  "univ-033": "notifications.soundBubble",
  "univ-036": "notifications.soundPop",
  "univ-040": "notifications.soundDing",
  "univ-051": "notifications.soundPing",
  "univ-057": "notifications.soundDrop",
  "univ-09": "notifications.soundBell",
} as const satisfies Record<(typeof SOUND_IDS)[number], string>;

/** Likewise for the events: one entry per key in `NOTIFICATION_EVENT_KEYS`. */
const EVENT_KEYS = {
  chatMessage: ["notifications.evtChatMessage", "notifications.evtChatMessageDesc"],
  directMessage: ["notifications.evtDirectMessage", "notifications.evtDirectMessageDesc"],
  mention: ["notifications.evtMention", "notifications.evtMentionDesc"],
  userJoin: ["notifications.evtUserJoin", "notifications.evtUserJoinDesc"],
  userLeave: ["notifications.evtUserLeave", "notifications.evtUserLeaveDesc"],
  userJoinChannel: ["notifications.evtUserJoinChannel", "notifications.evtUserJoinChannelDesc"],
  userLeaveChannel: ["notifications.evtUserLeaveChannel", "notifications.evtUserLeaveChannelDesc"],
  streamStart: ["notifications.evtStreamStart", "notifications.evtStreamStartDesc"],
  voiceActivity: ["notifications.evtVoiceActivity", "notifications.evtVoiceActivityDesc"],
  selfMuted: ["notifications.evtSelfMuted", "notifications.evtSelfMutedDesc"],
} as const satisfies Record<NotificationEvent, readonly [string, string]>;

/**
 * The Notifications page.
 *
 * The sound settings are their own record rather than a preference, so this
 * page loads and debounces them itself; the two switches beside them
 * (native notifications, welcome message) are preferences and come from the
 * shared hook. Per-event sound and volume are expert-only, as in Standard - in
 * normal mode an event is on or off and uses its default sound.
 */
export function NotificationsSettings() {
  const { t } = useTranslation(["settings", "nebulaSettings"]);
  const { prefs, set, toggle } = usePreferenceSettings();
  const [sounds, setSounds] = useState<NotificationSoundSettings | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  // Skips the save that would otherwise fire on the load itself.
  const loaded = useRef(false);

  useEffect(() => {
    let active = true;
    void getNotificationSounds()
      .then((stored) => {
        if (active) setSounds(stored ?? DEFAULT_NOTIFICATION_SOUNDS);
      })
      .catch(() => {
        if (active) setSounds(DEFAULT_NOTIFICATION_SOUNDS);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sounds) return;
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    const timer = setTimeout(() => void saveNotificationSounds(sounds).catch(() => undefined), 400);
    return () => clearTimeout(timer);
  }, [sounds]);

  const patchEvent = useCallback((key: NotificationEvent, patch: Partial<NotificationEventConfig>) => {
    setSounds((prev) =>
      prev ? { ...prev, events: { ...prev.events, [key]: { ...prev.events[key], ...patch } } } : prev,
    );
  }, []);

  const setAll = useCallback((enabled: boolean) => {
    setSounds((prev) => {
      if (!prev) return prev;
      const events = { ...prev.events };
      for (const key of NOTIFICATION_EVENT_KEYS) events[key] = { ...events[key], enabled };
      return { ...prev, events };
    });
  }, []);

  // One preview at a time: starting a second while the first is still playing
  // is two sounds overlapping, which is not what either of them sounds like.
  const preview = useCallback((soundId: string, volume: number) => {
    const url = findSoundUrl(soundId);
    if (!url) return;
    previewAudio.current?.pause();
    const audio = new Audio(url);
    audio.volume = volume;
    previewAudio.current = audio;
    audio.play().catch(() => undefined);
  }, []);

  if (!prefs || !sounds) return null;

  const isExpert = prefs.userMode !== "normal";
  const configFor = (key: NotificationEvent) => sounds.events[key] ?? DEFAULT_NOTIFICATION_SOUNDS.events[key];
  const allEnabled = NOTIFICATION_EVENT_KEYS.every((key) => configFor(key).enabled);
  const allDisabled = NOTIFICATION_EVENT_KEYS.every((key) => !configFor(key).enabled);

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("notifications.panelTitle")} />

      <ToggleRow
        title={t("notifications.sounds")}
        hint={t("notifications.soundsHint")}
        checked={sounds.masterEnabled}
        onChange={() => setSounds({ ...sounds, masterEnabled: !sounds.masterEnabled })}
      />

      <ToggleRow
        title={t("notifications.native")}
        hint={t("notifications.nativeHint")}
        checked={prefs.enableNotifications}
        onChange={() => toggle("enableNotifications")}
      />

      <SelectField
        label={t("notifications.welcomeMessage", { defaultValue: "Welcome message" })}
        hint={t("notifications.welcomeMessageHint", {
          defaultValue: "Show the server's welcome message in a popup after connecting.",
        })}
        value={prefs.welcomeMessageDisplay}
        onChange={(welcomeMessageDisplay: WelcomeMessageDisplay) => set({ welcomeMessageDisplay })}
        options={[
          { id: "hide", label: t("notifications.welcomeHide", { defaultValue: "Hide" }) },
          { id: "once", label: t("notifications.welcomeOnce", { defaultValue: "Show once" }) },
          { id: "always", label: t("notifications.welcomeAlways", { defaultValue: "Always show" }) },
        ]}
      />

      {sounds.masterEnabled && (
        <>
          <GroupRule />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: "6px" }}>
            <GroupTitle>{t("notifications.panelTitle")}</GroupTitle>
            <Stack direction="row" gap={0.75}>
              <Button size="small" variant="outlined" disabled={allEnabled} onClick={() => setAll(true)}>
                {t("notifications.enableAll")}
              </Button>
              <Button size="small" variant="outlined" disabled={allDisabled} onClick={() => setAll(false)}>
                {t("notifications.disableAll")}
              </Button>
            </Stack>
          </Stack>

          {NOTIFICATION_EVENT_KEYS.map((key) => {
            const config = configFor(key);
            const [labelKey, descriptionKey] = EVENT_KEYS[key];
            const label = t(labelKey);
            return (
              <ToggleRow
                key={key}
                title={label}
                hint={t(descriptionKey)}
                checked={config.enabled}
                onChange={() => patchEvent(key, { enabled: !config.enabled })}
              >
                {config.enabled && isExpert && (
                  <SettingsCard sx={{ mt: "8px" }}>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <TextField
                        select
                        size="small"
                        value={config.sound}
                        onChange={(event) => patchEvent(key, { sound: event.target.value })}
                        sx={{ flex: 1 }}
                        slotProps={{
                          htmlInput: { "aria-label": t("nebulaSettings:notifications.soundFor", { label }) },
                        }}
                      >
                        {SOUND_IDS.map((id) => (
                          <MenuItem key={id} value={id}>
                            {t(SOUND_LABEL_KEYS[id])}
                          </MenuItem>
                        ))}
                      </TextField>
                      <IconButton
                        size="small"
                        disabled={config.sound === "none"}
                        title={t("notifications.previewTitle")}
                        aria-label={t("notifications.previewTitle")}
                        onClick={() => preview(config.sound, config.volume)}
                      >
                        <PlayIcon width={15} height={15} />
                      </IconButton>
                    </Stack>
                    <Box sx={{ mt: "10px" }}>
                      <SliderRow
                        label={t("notifications.volume")}
                        value={config.volume}
                        display={`${Math.round(config.volume * 100)}%`}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(volume) => patchEvent(key, { volume })}
                      />
                    </Box>
                  </SettingsCard>
                )}
              </ToggleRow>
            );
          })}
        </>
      )}

      {!sounds.masterEnabled && (
        <Typography sx={(theme) => ({ mt: "6px", fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {t("notifications.soundsHint")}
        </Typography>
      )}
    </Box>
  );
}
