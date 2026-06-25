/**
 * Meeting-room transport: the client-side half of server-provisioned meeting
 * rooms (detached, end-to-end-encrypted `signal_v1` channels).
 *
 * Rooms are created server-authoritatively by the `fancy-calendar` plugin (at a
 * meeting's start time, or on first join). The client only:
 *   - asks to join a meeting (`calendar.join`) and is told the room channel id
 *     back via `calendar.room`, then navigates into it;
 *   - asks (as organiser) for a Teams-style invite link (`calendar.inviteLink`).
 *
 * Inbound `calendar.room` / `calendar.inviteLink` are dispatched as DOM events
 * (see {@link EVT_MEETING_ROOM} / {@link EVT_MEETING_INVITE_LINK}) so the join
 * navigation and link-copy UI can react without an import cycle, and so e2e
 * tests can observe them.
 */

import { sendCalendar } from "./calendarSync";

/** Plugin message types exchanged with the `fancy-calendar` relay. */
export const MSG_MEETING_JOIN = "calendar.join";
export const MSG_MEETING_ROOM = "calendar.room";
export const MSG_MEETING_INVITE_LINK = "calendar.inviteLink";

/** DOM events surfaced to the UI / e2e harness. */
export const EVT_MEETING_ROOM = "fancy:meeting-room";
export const EVT_MEETING_INVITE_LINK = "fancy:meeting-invite-link";

export interface MeetingRoomDetail {
  readonly eventId?: string;
  readonly channelId: number;
}

export interface MeetingInviteLinkDetail {
  readonly eventId?: string;
  readonly url: string;
}

/** Ask the server to create-or-return a meeting's room and admit us to it.
 *  `token` is the invite-link token when joining via a shared link. */
export function requestJoinMeeting(eventId: string, token?: string): void {
  sendCalendar(MSG_MEETING_JOIN, token ? { eventId, token } : { eventId });
}

/** Ask the server (organiser only) to mint a shareable invite link. */
export function requestMeetingInviteLink(eventId: string): void {
  sendCalendar(MSG_MEETING_INVITE_LINK, { eventId });
}

/** Dispatch the inbound `calendar.room` as a DOM event. Returns false when the
 *  payload is malformed. */
export function dispatchMeetingRoom(data: Record<string, unknown>): boolean {
  const channelId = typeof data.channelId === "number" ? data.channelId : undefined;
  if (channelId == null) return false;
  const eventId = typeof data.eventId === "string" ? data.eventId : undefined;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<MeetingRoomDetail>(EVT_MEETING_ROOM, { detail: { eventId, channelId } }),
    );
  }
  return true;
}

/** Dispatch the inbound `calendar.inviteLink` as a DOM event. */
export function dispatchMeetingInviteLink(data: Record<string, unknown>): boolean {
  const url = typeof data.url === "string" ? data.url : undefined;
  if (!url) return false;
  const eventId = typeof data.eventId === "string" ? data.eventId : undefined;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<MeetingInviteLinkDetail>(EVT_MEETING_INVITE_LINK, {
        detail: { eventId, url },
      }),
    );
  }
  return true;
}
