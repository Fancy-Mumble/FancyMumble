import { useEffect, useMemo, useRef, useState } from "react";
import { useCalendarStore } from "./calendarStore";
import { expandEvents } from "./recurrence";
import {
  addDays,
  daySpan,
  isToday,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  startOfDay,
  startOfWeek,
} from "./calendarDates";
import type { EventOccurrence } from "./types";
import { eventVisualStyle, shortTime, weekdayShortNames } from "./calendarFormat";
import { TID } from "../../../testids";
import styles from "./CalendarPanel.module.css";

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const SNAP_MIN = 15;
const DRAG_THRESHOLD_PX = 4;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
  key: string;
  eventId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  origStart: number;
  origEnd: number;
  moved: boolean;
}

interface Preview {
  key: string;
  eventId: string;
  mode: DragMode;
  start: number;
  end: number;
  /** Visual translate (px) applied during a "move" so the element stays mounted
   *  in its original column - preserving pointer capture - while following the cursor. */
  dx: number;
  dy: number;
}

function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MIN) * SNAP_MIN;
}

/**
 * Side-by-side layout for overlapping events: greedily packs each occurrence
 * into the first lane whose previous event has ended, and reports the total lane
 * count of its overlap cluster so widths divide evenly.
 */
function layoutDay(occs: EventOccurrence[]): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...occs].sort((a, b) => a.start - b.start || a.end - b.end);
  let cluster: EventOccurrence[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    const laneEnds: number[] = [];
    const assigned: Array<{ key: string; lane: number }> = [];
    for (const o of cluster) {
      let lane = laneEnds.findIndex((end) => end <= o.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(o.end);
      } else {
        laneEnds[lane] = o.end;
      }
      assigned.push({ key: o.key, lane });
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const a of assigned) result.set(a.key, { lane: a.lane, lanes });
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };
  for (const o of sorted) {
    if (cluster.length && o.start >= clusterEnd) flush();
    cluster.push(o);
    clusterEnd = Math.max(clusterEnd, o.end);
  }
  if (cluster.length) flush();
  return result;
}

/** Day / Work-week / Week time grid, parametrised by how many days it spans. */
export default function WeekView({ dayCount }: { readonly dayCount: 1 | 5 | 7 }) {
  const anchor = useCalendarStore((s) => s.anchor);
  const events = useCalendarStore((s) => s.events);
  const workHours = useCalendarStore((s) => s.workHours);
  const openNewEvent = useCalendarStore((s) => s.openNewEvent);
  const openDetail = useCalendarStore((s) => s.openDetail);
  const openMenu = useCalendarStore((s) => s.openMenu);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);

  const colsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

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

  const beginDrag = (e: React.PointerEvent, occ: EventOccurrence, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      key: occ.key,
      eventId: occ.event.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origStart: occ.start,
      origEnd: occ.end,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    const deltaMin = snap(Math.round(dy / PX_PER_MIN));
    const shift = deltaMin * MS_PER_MINUTE;
    if (d.mode === "move") {
      const colW = colsRef.current ? colsRef.current.clientWidth / dayCount : 0;
      const deltaDays = colW ? Math.round(dx / colW) : 0;
      setPreview({
        key: d.key,
        eventId: d.eventId,
        mode: d.mode,
        start: addDays(d.origStart, deltaDays) + shift,
        end: addDays(d.origEnd, deltaDays) + shift,
        dx: deltaDays * colW,
        dy: deltaMin * PX_PER_MIN,
      });
    } else if (d.mode === "resize-start") {
      setPreview({
        key: d.key,
        eventId: d.eventId,
        mode: d.mode,
        start: Math.min(d.origStart + shift, d.origEnd - SNAP_MIN * MS_PER_MINUTE),
        end: d.origEnd,
        dx: 0,
        dy: 0,
      });
    } else {
      setPreview({
        key: d.key,
        eventId: d.eventId,
        mode: d.mode,
        start: d.origStart,
        end: Math.max(d.origEnd + shift, d.origStart + SNAP_MIN * MS_PER_MINUTE),
        dx: 0,
        dy: 0,
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    // Treat it as a drag if EITHER we saw movement during the gesture OR the
    // pointer simply ended away from where it started (covers missed/late
    // pointermove events or a capture hiccup). Only a true stationary press
    // opens the detail card - never the end of a drag.
    const endedFar =
      Math.abs(e.clientX - d.startX) > DRAG_THRESHOLD_PX ||
      Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD_PX;
    if (d.moved || endedFar) {
      if (preview && (preview.start !== d.origStart || preview.end !== d.origEnd)) {
        const ev = events.find((x) => x.id === d.eventId);
        if (ev) {
          upsertEvent({
            ...ev,
            start: ev.start + (preview.start - d.origStart),
            end: ev.end + (preview.end - d.origEnd),
          });
        }
      }
      setPreview(null);
      return;
    }
    // Stationary press/release → a genuine click → open the detail card.
    setPreview(null);
    const el = (e.target as HTMLElement).closest("[data-cal-event]") as HTMLElement | null;
    const r = (el ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    openDetail(d.eventId, d.origStart, { top: r.top, left: r.left, bottom: r.bottom, right: r.right });
  };

  const onPointerCancel = () => {
    dragRef.current = null;
    setPreview(null);
  };

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
                  <div
                    className={`${styles.colHeadNum} ${isToday(day) ? styles.colHeadNumToday : ""}`}
                  >
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
                        data-cal-event=""
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
                        <div className={styles.timedTitle}>{o.event.title || "(untitled)"}</div>
                        <div className={styles.timedMeta}>
                          {shortTime(start)} – {shortTime(end)}
                          {o.event.location ? ` · ${o.event.location}` : ""}
                        </div>
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
