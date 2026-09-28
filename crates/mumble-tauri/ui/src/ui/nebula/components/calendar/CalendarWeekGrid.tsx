import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { TID } from "@core/testids";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import {
  addDays,
  daySpan,
  isToday,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  startOfDay,
  startOfWeek,
} from "@core/features/chat/calendar/calendarDates";
import { shortTimeFormatted, weekdayShortNames } from "@core/features/chat/calendar/calendarFormat";
import { expandEvents } from "@core/features/chat/calendar/recurrence";
import { layoutDay } from "@core/features/chat/calendar/timeGrid";
import type { EventOccurrence } from "@core/features/chat/calendar/types";
import { useCalendarFormatPreferences } from "@core/features/chat/calendar/useCalendarFormatPreferences";
import { CAL_EVENT_ATTR, useTimeGridDrag } from "@core/features/chat/calendar/useTimeGridDrag";
import { radius } from "../../tokens";
import { Stack } from "../primitives";
import { eventBlockStyle } from "./calendarModel";

// The same hour height Standard draws, so a drag moves a meeting as far in
// either pack for the same pointer travel.
const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const GUTTER_PX = 52;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The day, work-week and week grids: hours down the side, a column a day.
 *
 * Meetings are dragged to move and pulled at either edge to resize, through the
 * same gesture Standard uses. All-day meetings, which Standard's grid leaves
 * out entirely, get a strip under the day names - a meeting that is on your
 * calendar should be somewhere on the week it happens in.
 */
export function CalendarWeekGrid({ dayCount }: Readonly<{ dayCount: 1 | 5 | 7 }>) {
  const { t } = useTranslation(["chat"]);
  const { nebula } = useTheme().palette;
  const anchor = useCalendarStore((s) => s.anchor);
  const events = useCalendarStore((s) => s.events);
  const workHours = useCalendarStore((s) => s.workHours);
  const openNewEvent = useCalendarStore((s) => s.openNewEvent);
  const openDetail = useCalendarStore((s) => s.openDetail);
  const openMenu = useCalendarStore((s) => s.openMenu);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);
  const formatPrefs = useCalendarFormatPreferences();

  const bodyRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const { preview, beginDrag, onPointerMove, onPointerUp, onPointerCancel } = useTimeGridDrag({
    dayCount,
    pxPerMinute: PX_PER_MIN,
    columnsRef,
    events,
    onChange: (event, next) => upsertEvent({ ...event, ...next }),
    onOpen: openDetail,
  });

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const firstDay = dayCount === 1 ? startOfDay(anchor) : startOfWeek(anchor);
  const days = useMemo(() => daySpan(firstDay, dayCount), [firstDay, dayCount]);
  const weekdayNames = weekdayShortNames();
  const nowTop = ((now - startOfDay(now)) / MS_PER_HOUR) * HOUR_PX;

  // Open on the present rather than on midnight: scrolled to now when today is
  // in view, to the start of the working day when it is not. A frame late,
  // because the dialog has not been given its height on the first one.
  useEffect(() => {
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

  const { timed, allDay } = useMemo(() => {
    const timedByDay = new Map<number, EventOccurrence[]>();
    const allDayByDay = new Map<number, EventOccurrence[]>();
    for (const occ of expandEvents(events, days[0], addDays(days[days.length - 1], 1))) {
      if (occ.event.myStatus === "declined") continue;
      if (occ.event.allDay) {
        // On every day it covers, not only the one it starts on.
        for (const day of days) {
          if (day >= startOfDay(occ.start) && day < occ.end) {
            allDayByDay.set(day, [...(allDayByDay.get(day) ?? []), occ]);
          }
        }
      } else {
        const key = startOfDay(occ.start);
        timedByDay.set(key, [...(timedByDay.get(key) ?? []), occ]);
      }
    }
    return { timed: timedByDay, allDay: allDayByDay };
  }, [events, days]);

  const line = `var(--nebula-line-width, 1px) solid ${nebula.line}`;
  const columns = `repeat(${dayCount}, minmax(0, 1fr))`;
  const frame = { display: "grid", gridTemplateColumns: `${GUTTER_PX}px minmax(0, 1fr)` } as const;

  return (
    <Box ref={bodyRef} sx={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
      <Box sx={{ ...frame, position: "sticky", top: 0, zIndex: 3, background: nebula.bg0, borderBottom: line }}>
        <Box />
        <Box sx={{ display: "grid", gridTemplateColumns: columns }}>
          {days.map((day) => {
            const today = isToday(day);
            return (
              <Stack key={day} alignItems="center" gap={0.25} sx={{ py: "8px", borderLeft: line, minWidth: 0 }}>
                <Typography
                  noWrap
                  sx={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: today ? nebula.accent : nebula.dim,
                  }}
                >
                  {weekdayNames[(new Date(day).getDay() + 6) % 7]}
                </Typography>
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    fontSize: 14,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: today ? nebula.onAccent : nebula.text,
                    background: today ? nebula.accent : "transparent",
                  }}
                >
                  {new Date(day).getDate()}
                </Box>
              </Stack>
            );
          })}
        </Box>
        {allDay.size > 0 && (
          <>
            <Typography sx={{ fontSize: 10, color: nebula.dim, textAlign: "right", pr: "8px", pt: "5px" }} noWrap>
              {t("chat:calendar.fields.allDay")}
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: columns, borderTop: line }}>
              {days.map((day) => (
                <Stack key={day} gap="2px" sx={{ borderLeft: line, p: "3px", minWidth: 0 }}>
                  {(allDay.get(day) ?? []).map((occ) => (
                    <Box
                      key={occ.key}
                      role="button"
                      tabIndex={0}
                      title={occ.event.title}
                      data-testid={TID.calendarEvent}
                      data-event-title={occ.event.title}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        openDetail(occ.event.id, occ.start, { top: r.top, left: r.left, bottom: r.bottom, right: r.right });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openMenu(occ.event.id, e.clientX, e.clientY);
                      }}
                      style={eventBlockStyle(occ.event, nebula.text)}
                      sx={{
                        height: 20,
                        px: "6px",
                        borderRadius: radius("sm"),
                        fontSize: 11.5,
                        lineHeight: "20px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        cursor: "pointer",
                      }}
                    >
                      {occ.event.title || t("chat:calendar.untitled")}
                    </Box>
                  ))}
                </Stack>
              ))}
            </Box>
          </>
        )}
      </Box>

      <Box sx={frame}>
        <Box aria-hidden="true">
          {HOURS.map((h) => (
            <Box key={h} sx={{ height: HOUR_PX, position: "relative" }}>
              {h > 0 && (
                <Typography
                  sx={{
                    position: "absolute",
                    top: -7,
                    right: 8,
                    fontSize: 10.5,
                    color: nebula.dim,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {`${pad(h)}:00`}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
        <Box
          ref={columnsRef}
          sx={{ display: "grid", gridTemplateColumns: columns, height: 24 * HOUR_PX, position: "relative" }}
        >
          {days.map((day) => {
            const weekday = (new Date(day).getDay() + 6) % 7;
            const band =
              workHours.enabled && workHours.days[weekday] && workHours.endMinutes > workHours.startMinutes;
            const occs = timed.get(day) ?? [];
            const layout = layoutDay(occs);
            return (
              <Box key={day} sx={{ position: "relative", borderLeft: line, minWidth: 0 }}>
                {band && (
                  <Box
                    sx={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: (workHours.startMinutes / 60) * HOUR_PX,
                      height: ((workHours.endMinutes - workHours.startMinutes) / 60) * HOUR_PX,
                      background: nebula.hover,
                      pointerEvents: "none",
                    }}
                  />
                )}
                {HOURS.map((h) => (
                  <Box
                    key={h}
                    onClick={() => openNewEvent(day + h * MS_PER_HOUR)}
                    sx={{
                      position: "relative",
                      height: HOUR_PX,
                      borderTop: h ? line : "none",
                      cursor: "pointer",
                      "&:hover": { background: nebula.hover },
                    }}
                  />
                ))}
                {occs.map((occ) => {
                  const dragging = preview?.key === occ.key ? preview : null;
                  const moving = dragging?.mode === "move";
                  const start = dragging ? dragging.start : occ.start;
                  const end = dragging ? dragging.end : occ.end;
                  // A move keeps its box and follows the pointer by transform,
                  // which keeps pointer capture; a resize changes the box.
                  const boxStart = moving ? occ.start : start;
                  const boxEnd = moving ? occ.end : end;
                  const top = ((boxStart - day) / MS_PER_HOUR) * HOUR_PX;
                  const height = Math.max(18, ((boxEnd - boxStart) / MS_PER_HOUR) * HOUR_PX);
                  const lane = layout.get(occ.key) ?? { lane: 0, lanes: 1 };
                  const width = 100 / lane.lanes;
                  const edge = {
                    position: "absolute",
                    left: 0,
                    right: 0,
                    height: 6,
                    cursor: "ns-resize",
                  } as const;
                  return (
                    <Box
                      key={occ.key}
                      {...{ [CAL_EVENT_ATTR]: "" }}
                      title={occ.event.title}
                      data-testid={TID.calendarEvent}
                      data-event-title={occ.event.title}
                      onPointerDown={(e) => beginDrag(e, occ, "move")}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerCancel}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openMenu(occ.event.id, e.clientX, e.clientY);
                      }}
                      style={{
                        top,
                        height,
                        left: `calc(${lane.lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        transform: moving ? `translate(${dragging.dx}px, ${dragging.dy}px)` : undefined,
                        ...eventBlockStyle(occ.event, nebula.text),
                      }}
                      sx={{
                        position: "absolute",
                        zIndex: dragging ? 2 : 1,
                        px: "6px",
                        py: height >= 36 ? "3px" : "2px",
                        borderRadius: radius("sm"),
                        overflow: "hidden",
                        cursor: dragging ? "grabbing" : "grab",
                        userSelect: "none",
                        fontSize: 11.5,
                        lineHeight: 1.3,
                        boxShadow: dragging ? nebula.shadow : "none",
                      }}
                    >
                      <Box
                        component="span"
                        sx={{ ...edge, top: 0 }}
                        onPointerDown={(e) => beginDrag(e, occ, "resize-start")}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                      />
                      {/* A half-hour meeting is 24px, which is most meetings: it
                          gets its name and start on one line rather than being
                          an anonymous bar. Only a sliver shows nothing. */}
                      {height >= 36 ? (
                        <>
                          <Box sx={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {occ.event.title || t("chat:calendar.untitled")}
                          </Box>
                          <Box sx={{ opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {shortTimeFormatted(start, formatPrefs.timeFormat)} –{" "}
                            {shortTimeFormatted(end, formatPrefs.timeFormat)}
                            {occ.event.location ? ` · ${occ.event.location}` : ""}
                          </Box>
                        </>
                      ) : (
                        height >= 16 && (
                          <Box sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", mt: "-1px" }}>
                            <Box component="span" sx={{ fontWeight: 600 }}>
                              {occ.event.title || t("chat:calendar.untitled")}
                            </Box>{" "}
                            <Box component="span" sx={{ opacity: 0.85 }}>
                              {shortTimeFormatted(start, formatPrefs.timeFormat)}
                            </Box>
                          </Box>
                        )
                      )}
                      <Box
                        component="span"
                        sx={{ ...edge, bottom: 0 }}
                        onPointerDown={(e) => beginDrag(e, occ, "resize-end")}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                      />
                    </Box>
                  );
                })}
                {isToday(day) && (
                  <Box
                    aria-hidden="true"
                    sx={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: nowTop,
                      height: 2,
                      zIndex: 2,
                      pointerEvents: "none",
                      background: nebula.bad,
                      "&::before": {
                        content: '""',
                        position: "absolute",
                        left: -4,
                        top: -3,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: nebula.bad,
                      },
                    }}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
