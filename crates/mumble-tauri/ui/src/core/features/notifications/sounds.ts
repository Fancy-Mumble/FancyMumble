/**
 * The notification sound catalogue, shared by every UI pack.
 *
 * The audio files, the option list, and the per-event defaults all live here
 * rather than in a pack: a sound id is persisted in `UserPreferences`, so the
 * id -> file mapping is data the whole app agrees on, not presentation. Aurora
 * previously reached into `@ui/standard/pages/settings/NotificationsPanel` for
 * the defaults, which coupled the two packs through a settings screen.
 */

import type { NotificationEvent, NotificationSoundSettings } from "@core/types";

import sndDragon3 from "@core/assets/dragon-studio-new-notification-3-398649.mp3";
import sndUniv033 from "@core/assets/universfield-new-notification-033-480571.mp3";
import sndUniv036 from "@core/assets/universfield-new-notification-036-485897.mp3";
import sndUniv040 from "@core/assets/universfield-new-notification-040-493469.mp3";
import sndUniv051 from "@core/assets/universfield-new-notification-051-494246.mp3";
import sndUniv057 from "@core/assets/universfield-new-notification-057-494255.mp3";
import sndUniv09 from "@core/assets/universfield-new-notification-09-352705.mp3";

export interface SoundOption {
  id: string;
  label: string;
  url: string;
}

/** Every event that can raise a sound, in the order settings screens list them. */
export const NOTIFICATION_EVENT_KEYS: readonly NotificationEvent[] = [
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

/**
 * Labels here are the English fallback; packs that translate should look up
 * `settings:notifications.sound<Label>` and fall back to these.
 */
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

/** Resolve a persisted sound id to a playable URL; `""` when it is "none" or unknown. */
export function findSoundUrl(id: string): string {
  return SOUND_OPTIONS.find((option) => option.id === id)?.url ?? "";
}
