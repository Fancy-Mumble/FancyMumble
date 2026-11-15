import { useEffect, useMemo, useRef, useState } from "react";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { expandEvents } from "@core/features/chat/calendar/recurrence";
import {
  addDays,
  daySpan,
  isToday,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  startOfDay,
  startOfWeek,
} from "@core/features/chat/calendar/calendarDates";
import type { EventOccurrence } from "@core/features/chat/calendar/types";
import {
  eventVisualStyle,
  shortTimeFormatted,
  weekdayShortNames,
} from "@core/features/chat/calendar/calendarFormat";
import { layoutDay } from "@core/features/chat/calendar/timeGrid";
import { CAL_EVENT_ATTR, useTimeGridDrag } from "@core/features/chat/calendar/useTimeGridDrag";
import { useCalendarFormatPreferences } from "@core/features/chat/calendar/useCalendarFormatPreferences";
import { TID } from "@core/testids";
import styles from "./CalendarPanel.module.css";

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Day / Work-week / Week time grid, parametrised by how many days it spans. */
export default function WeekView({ dayCount }: { readonly dayCount: 1 | 5 | 7 }) {
  const anchor = useCalendarStore((s) => s.anchor);
  const events = useCalendarStore((s) => s.events);
  const workHours = useCalendarStore((s) => s.workHours);
  const openNewEvent = useCalendarStore((s) => s.openNewEvent);
  const openDetail = useCalendarStore((s) => s.openDetail);
  const openMenu = useCalendarStore((s) => s.openMenu);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);
  const formatPrefs = useCalendarFormatPreferences();

  const colsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { preview, beginDrag, onPointerMove, onPointerUp, onPointerCancel } = useTimeGridDrag({
    dayCount,
    pxPerMinute: PX_PER_MIN,
    columnsRef: colsRef,
    events,
    onChange: (event, next) => upsertEvent({ ...event, ...next }),
    onOpen: openDetail,
  });

  // Current-time indicator; refresh each minute.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const firstDay = dayCount === 1 ? startOfDay(anchor) : startOfWeek(anchor);
  const days = useMemo(() => daySpan(firstDay, dayCount), [firstDay, dayCount]);
  const weekdayNames = weekdayShortNames();
  const nowTop = ((now - startOfDay(now)) / MS_PER_HOUR) * HOUR_PX;
  const todayVisible = days.some((d) => isToday(d));

  // On open / view change / navigation, scroll the grid to the current time
  // (or work-hours start when today isn't shown) so the now-line is in view -
  // the grid otherwise opens at 00:00 with the marker far below the fold.
  useEffect(() => {
    // Defer to the next frame: the split panel measures its height asynchronously,
    // so setting scrollTop synchronously on mount can hit a 0-height container.
    const id = requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      const todayMid = startOfDay(Date.now());
      const todayIn = todayMid >= firstDay && todayMid < addDays(firstDay, dayCount);
      const minutes = todayIn ? (Date.now() - todayMid) / MS_PER_MINUTE : workHours.startMinutes;
      el.scrollTop = Math.max(0, (minutes / 60) * HOUR_PX - 100);
    });
    return () => cancelAnimationFrame(id);
  }, [firstDay, dayCount, workHours.startMinutes]);

  const byDay = useMemo(() => {
    const windowStart = days[0];
    const windowEnd = addDays(days[days.length - 1], 1);
    const map = new Map<number, EventOccurrence[]>();
    for (const occ of expandEvents(events, windowStart, windowEnd)) {
      const key = startOfDay(occ.start);
      (map.get(key) ?? map.set(key, []).get(key)!).push(occ);
    }
    return map;
  }, [events, days]);

  const colsStyle = { gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` };

  return (
    <div ref={bodyRef} className={styles.body}>
      <div className={styles.timeGrid}>
        <div className={styles.timeGutterHead} />
        <div className={styles.timeColHead}>
          <div className={styles.dayColsHead} style={colsStyle}>
            {days.map((day) => {
              const wd = weekdayNames[(new Date(day).getDay() + 6) % 7];
              return (
                <div key={day} className={styles.colHead}>
                  <div className={styles.colHeadName}>{wd}</div>
                  <div className={`${styles.colHeadNum} ${isToday(day) ? styles.colHeadNumToday : ""}`}>
                    {new Date(day).getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.gutter}>
          {HOURS.map((h) => (
            <div key={h} className={styles.hourLabel}>
              {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
            </div>
          ))}
        </div>
        <div ref={colsRef} className={styles.dayCols} style={colsStyle}>
          {days.map((day) => {
            const weekday = (new Date(day).getDay() + 6) % 7;
            const showBand =
              workHours.enabled && workHours.days[weekday] && workHours.endMinutes > workHours.startMinutes;
            const dayOccs = (byDay.get(day) ?? []).filter(
              (o) => !o.event.allDay && o.event.myStatus !== "declined",
            );
            const layout = layoutDay(dayOccs);
            return (
              <div key={day} className={styles.dayCol}>
                {showBand && (
                  <div
                    className={styles.workBand}
                    style={{
                      top: (workHours.startMinutes / 60) * HOUR_PX,
                      height: ((workHours.endMinutes - workHours.startMinutes) / 60) * HOUR_PX,
                    }}
                  />
                )}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className={styles.hourLine}
                    onClick={() => openNewEvent(day + h * MS_PER_HOUR)}
                  />
                ))}
                {dayOccs.map((o) => {
                  const isThis = preview?.key === o.key;
                  const moving = isThis && preview!.mode === "move";
                  const start = isThis ? preview!.start : o.start;
                  const end = isThis ? preview!.end : o.end;
                  // Move keeps the original box + a transform (preserves pointer
                  // capture); resize changes the box directly.
                  const baseStart = moving ? o.start : start;
                  const baseEnd = moving ? o.end : end;
                  const top = ((baseStart - day) / MS_PER_HOUR) * HOUR_PX;
                  const height = Math.max(18, ((baseEnd - baseStart) / MS_PER_HOUR) * HOUR_PX);
                  // Side-by-side lanes for overlapping events.
                  const pos = layout.get(o.key) ?? { lane: 0, lanes: 1 };
                  const widthPct = 100 / pos.lanes;
                  const leftPct = pos.lane * widthPct;

                  // For very short events, hide content to avoid overflow
                  // 40px: enough for title + time, 25px: only title, 18px: nothing
                  const showMeta = height >= 40;
                  const showTitle = height >= 25;

                  return (
                    <div
                      key={o.key}
                      className={`${styles.timedEvent} ${isThis ? styles.timedEventDragging : ""}`}
                      style={{
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        right: "auto",
                        transform: moving ? `translate(${preview!.dx}px, ${preview!.dy}px)` : undefined,
                        ...eventVisualStyle(o.event).style,
                      }}
                      title={o.event.title}
                      {...{ [CAL_EVENT_ATTR]: "" }}
                      data-testid={TID.calendarEvent}
                      data-event-title={o.event.title}
                      onPointerDown={(e) => beginDrag(e, o, "move")}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerCancel}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openMenu(o.event.id, e.clientX, e.clientY);
                      }}
                    >
                      <span
                        className={styles.resizeEdgeTop}
                        onPointerDown={(e) => beginDrag(e, o, "resize-start")}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                      >
                        <span className={styles.resizeHandle} aria-hidden="true" />
                      </span>
                      {showTitle && <div className={styles.timedTitle}>{o.event.title || "(untitled)"}</div>}
                      {showMeta && (
                        <div className={styles.timedMeta}>
                          {shortTimeFormatted(start, formatPrefs.timeFormat)} –{" "}
                          {shortTimeFormatted(end, formatPrefs.timeFormat)}
                          {o.event.location ? ` · ${o.event.location}` : ""}
                        </div>
                      )}
                      <span
                        className={styles.resizeEdgeBottom}
                        onPointerDown={(e) => beginDrag(e, o, "resize-end")}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                      >
                        <span className={styles.resizeHandle} aria-hidden="true" />
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {todayVisible && (
            <div className={styles.nowLine} style={{ top: nowTop }}>
              <span className={styles.nowDot} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
