import type { NotificationEvent } from "@core/types";

export interface NotificationEventCopy {
  key: NotificationEvent;
  label: string;
  detail: string;
}

/**
 * Display copy for each sound event, in the order the panel lists them.
 *
 * Kept beside the panel rather than in `core` because it is presentation: the
 * event ids are the contract, the wording is Aurora's.
 */
export const NOTIFICATION_EVENT_COPY: NotificationEventCopy[] = [
  { key: "chatMessage", label: "Channel message", detail: "A message arrives in any channel you follow." },
  { key: "directMessage", label: "Direct message", detail: "Someone sends you a private message." },
  { key: "mention", label: "Mention", detail: "A message names you directly." },
  { key: "userJoin", label: "Someone connects", detail: "A user joins the server." },
  { key: "userLeave", label: "Someone disconnects", detail: "A user leaves the server." },
  {
    key: "userJoinChannel",
    label: "Joins your channel",
    detail: "A user enters the channel you are in.",
  },
  {
    key: "userLeaveChannel",
    label: "Leaves your channel",
    detail: "A user leaves the channel you are in.",
  },
  { key: "streamStart", label: "Stream starts", detail: "Someone begins sharing their screen." },
  { key: "voiceActivity", label: "Voice activity", detail: "Someone starts talking. Noisy by design." },
  { key: "selfMuted", label: "Your mic changes", detail: "Confirms when you mute or unmute yourself." },
];

export const WELCOME_MESSAGE_OPTIONS = [
  { value: "hide", label: "Never show" },
  { value: "once", label: "Show once per server" },
  { value: "always", label: "Show on every connect" },
];
