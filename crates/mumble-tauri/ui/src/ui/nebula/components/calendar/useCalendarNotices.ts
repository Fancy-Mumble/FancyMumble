import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@core/store";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import {
  EVT_MEETING_ROOM,
  requestJoinMeeting,
  type MeetingRoomDetail,
} from "@core/features/chat/calendar/meetings";
import { EVT_CALENDAR_REMINDER, type CalendarReminderDetail } from "@core/features/chat/calendar/types";
import { currentOccurrence } from "./calendarModel";

export interface CalendarNotice {
  /** A reminder fired, or the server has just put us in a meeting's room. */
  readonly kind: "reminder" | "room";
  readonly eventId: string;
  readonly occStart: number;
  /** Changes per notice, so a second one replaces the first instead of merging. */
  readonly key: number;
}

/**
 * Joins this client started from its own calendar, by event, with when.
 *
 * Pressing Join on a meeting and then being told "you are in the meeting" is
 * noise, so a room that arrives for one of these is not announced. A link
 * followed from outside, or a join the server was asked for any other way,
 * still is.
 */
const ownJoins = new Map<string, number>();
const OWN_JOIN_WINDOW_MS = 30_000;

export function joinFromCalendar(eventId: string): void {
  ownJoins.set(eventId, Date.now());
  requestJoinMeeting(eventId);
}

const roomKey = (serverId: string | null, channelId: number) => `${serverId ?? ""}:${channelId}`;

/**
 * What the calendar has to say while the calendar is not open.
 *
 * Reminders and meeting links both arrive with an event behind them and, until
 * now, nowhere to show it. This turns each into a notice, and remembers which
 * room belongs to which meeting so the room's header can open the meeting.
 */
export function useCalendarNotices() {
  const [notice, setNotice] = useState<CalendarNotice | null>(null);
  const [rooms, setRooms] = useState<ReadonlyMap<string, string>>(() => new Map());

  useEffect(() => {
    const onReminder = (event: Event) => {
      const detail = (event as CustomEvent<CalendarReminderDetail>).detail;
      if (!detail?.eventId) return;
      setNotice({ kind: "reminder", eventId: detail.eventId, occStart: detail.occStart, key: Date.now() });
    };
    const onRoom = (event: Event) => {
      const detail = (event as CustomEvent<MeetingRoomDetail>).detail;
      if (!detail?.eventId) return;
      const eventId = detail.eventId;
      const serverId = useAppStore.getState().activeServerId;
      setRooms((previous) => new Map(previous).set(roomKey(serverId, detail.channelId), eventId));

      const own = ownJoins.get(eventId);
      ownJoins.delete(eventId);
      if (own !== undefined && Date.now() - own < OWN_JOIN_WINDOW_MS) {
        // The reminder that prompted the join has done its job too.
        setNotice((current) => (current?.eventId === eventId ? null : current));
        return;
      }
      // A link can admit someone to a meeting that is not on their calendar;
      // there is no event to show them, and the room itself is the answer.
      const known = useCalendarStore.getState().events.find((e) => e.id === eventId);
      if (!known) return;
      setNotice({ kind: "room", eventId, occStart: currentOccurrence(known, Date.now()), key: Date.now() });
    };
    globalThis.addEventListener(EVT_CALENDAR_REMINDER, onReminder);
    globalThis.addEventListener(EVT_MEETING_ROOM, onRoom);
    return () => {
      globalThis.removeEventListener(EVT_CALENDAR_REMINDER, onReminder);
      globalThis.removeEventListener(EVT_MEETING_ROOM, onRoom);
    };
  }, []);

  const dismiss = useCallback(() => setNotice(null), []);
  const meetingInRoom = useCallback(
    (serverId: string | null, channelId: number | null) =>
      channelId === null ? undefined : rooms.get(roomKey(serverId, channelId)),
    [rooms],
  );

  return { notice, dismiss, meetingInRoom };
}
