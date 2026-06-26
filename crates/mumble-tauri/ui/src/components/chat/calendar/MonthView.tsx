import { useMemo, useRef } from "react";
import { useCalendarStore } from "./calendarStore";
import { expandEvents } from "./recurrence";
import {
  addDays,
  isToday,
  monthGridDays,
  MS_PER_DAY,
  startOfDay,
  startOfMonth,
} from "./calendarDates";
import type { CalendarEvent, EventOccurrence } from "./types";
import { eventVisualStyle, shortTimeFormatted, weekdayShortNames } from "./calendarFormat";
import { useCalendarFormatPreferences } from "./useCalendarFormatPreferences";
import { TID } from "../../../testids";
import styles from "./CalendarPanel.module.css";

const MAX_CHIPS_PER_DAY = 3;

interface DragPayload {
  eventId: string;
  occStart: number;
}

export default function MonthView() {
  const anchor = useCalendarStore((s) => s.anchor);
  const events = useCalendarStore((s) => s.events);
  const openNewEvent = useCalendarStore((s) => s.openNewEvent);
  const openDetail = useCalendarStore((s) => s.openDetail);
  const openMenu = useCalendarStore((s) => s.openMenu);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);
  const formatPrefs = useCalendarFormatPreferences();

  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const monthStart = startOfMonth(anchor);
  const nextMonthStart = startOfMonth(addDays(monthStart, 40));

  const byDay = useMemo(() => {
    const windowStart = days[0];
    const windowEnd = addDays(days[days.length - 1], 1);
    const map = new Map<number, EventOccurrence[]>();
    for (const occ of expandEvents(events, windowStart, windowEnd)) {
      const key = startOfDay(occ.start);
      const list = map.get(key);
      if (list) list.push(occ);
      else map.set(key, [occ]);
    }
    return map;
  }, [events, days]);

  const handleDrop = (targetDay: number, raw: string) => {
    try {
      const { eventId, occStart } = JSON.parse(raw) as DragPayload;
      const ev = events.find((e) => e.id === eventId);
      if (!ev) return;
      const deltaDays = Math.round((targetDay - startOfDay(occStart)) / MS_PER_DAY);
      if (deltaDays === 0) return;
      upsertEvent({ ...ev, start: addDays(ev.start, deltaDays), end: addDays(ev.end, deltaDays) });
    } catch {
      /* ignore malformed payloads */
    }
  };

  return (
    <div className={styles.body}>
      <div className={styles.weekdayHead}>
        {weekdayShortNames().map((name) => (
          <div key={name} className={styles.weekdayCell}>
            {name}
          </div>
        ))}
      </div>
      <div className={styles.monthGrid}>
        {days.map((day) => {
          const outside = day < monthStart || day >= nextMonthStart;
          // Declined meetings are removed from the grid.
          const occ = (byDay.get(day) ?? []).filter((o) => o.event.myStatus !== "declined");
          return (
            <div
              key={day}
              className={`${styles.dayCell} ${outside ? styles.dayCellOutside : ""}`}
              onClick={() => openNewEvent(day + 9 * 3_600_000)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(day, e.dataTransfer.getData("text/plain"));
              }}
            >
              <span className={`${styles.dayNum} ${isToday(day) ? styles.dayNumToday : ""}`}>
                {new Date(day).getDate()}
              </span>
              {occ.slice(0, MAX_CHIPS_PER_DAY).map((o) => (
                <MonthChip key={o.key} event={o.event} start={o.start} timeFormat={formatPrefs.timeFormat} onDetail={openDetail} onMenu={openMenu} />
              ))}
              {occ.length > MAX_CHIPS_PER_DAY && (
                <span className={styles.moreLink}>+{occ.length - MAX_CHIPS_PER_DAY}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface MonthChipProps {
  readonly event: CalendarEvent;
  readonly start: number;
  readonly timeFormat: ReturnType<typeof useCalendarFormatPreferences>["timeFormat"];
  readonly onDetail: (id: string, occStart: number, rect: { top: number; left: number; bottom: number; right: number }) => void;
  readonly onMenu: (id: string, x: number, y: number) => void;
}

function MonthChip({
  event,
  start,
  timeFormat,
  onDetail,
  onMenu,
}: MonthChipProps) {
  const downRef = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className={styles.chip}
      style={eventVisualStyle(event).style}
      title={event.title}
      data-testid={TID.calendarEvent}
      data-event-title={event.title}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ eventId: event.id, occStart: start }),
        );
        e.dataTransfer.effectAllowed = "move";
      }}
      onPointerDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        // Always stop the click from reaching the day cell (which would open a
        // "new event"); only open the detail card when this was a real click,
        // not a small drag that didn't trigger a native drag-and-drop.
        e.stopPropagation();
        const d = downRef.current;
        downRef.current = null;
        if (d && (Math.abs(e.clientX - d.x) > 4 || Math.abs(e.clientY - d.y) > 4)) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onDetail(event.id, start, { top: r.top, left: r.left, bottom: r.bottom, right: r.right });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(event.id, e.clientX, e.clientY);
      }}
    >
      {!event.allDay && <span className={styles.chipTime}>{shortTimeFormatted(start, timeFormat)}</span>}
      <span className={styles.chipTitle}>{event.title || "(untitled)"}</span>
    </div>
  );
}
