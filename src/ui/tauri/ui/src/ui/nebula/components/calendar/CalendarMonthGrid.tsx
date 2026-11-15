import { useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { TID } from "@core/testids";
import { useCalendarStore, type AnchorRect } from "@core/features/chat/calendar/calendarStore";
import {
  addDays,
  isToday,
  monthGridDays,
  MS_PER_HOUR,
  startOfDay,
  startOfMonth,
} from "@core/features/chat/calendar/calendarDates";
import { shortTimeFormatted, weekdayShortNames } from "@core/features/chat/calendar/calendarFormat";
import { expandEvents } from "@core/features/chat/calendar/recurrence";
import { shiftToDay } from "@core/features/chat/calendar/timeGrid";
import type { EventOccurrence } from "@core/features/chat/calendar/types";
import { useCalendarFormatPreferences } from "@core/features/chat/calendar/useCalendarFormatPreferences";
import { radius } from "../../tokens";
import { Stack } from "../primitives";
import { eventBlockStyle } from "./calendarModel";

const rectOf = (el: Element): AnchorRect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
};

interface CalendarMonthGridProps {
  /** Open a day on its own, for a day with more meetings than its cell shows. */
  readonly onShowDay: (day: number) => void;
  /** A phone's cells: two chips, no times. */
  readonly compact?: boolean;
}

/**
 * Six weeks, Monday first.
 *
 * A cell is a place to create a meeting as much as a list of them - clicking
 * its empty part starts one at nine, as Standard's does. A day with more than
 * fits says how many more, and that count opens the day rather than being a
 * dead label.
 */
export function CalendarMonthGrid({ onShowDay, compact = false }: Readonly<CalendarMonthGridProps>) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
  const { nebula } = useTheme().palette;
  const anchor = useCalendarStore((s) => s.anchor);
  const events = useCalendarStore((s) => s.events);
  const openNewEvent = useCalendarStore((s) => s.openNewEvent);
  const openDetail = useCalendarStore((s) => s.openDetail);
  const openMenu = useCalendarStore((s) => s.openMenu);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);
  const formatPrefs = useCalendarFormatPreferences();
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const monthStart = startOfMonth(anchor);
  const nextMonthStart = startOfMonth(addDays(monthStart, 40));
  const maxChips = compact ? 2 : 3;
  const line = `var(--nebula-line-width, 1px) solid ${nebula.line}`;

  const byDay = useMemo(() => {
    const map = new Map<number, EventOccurrence[]>();
    for (const occ of expandEvents(events, days[0], addDays(days[days.length - 1], 1))) {
      if (occ.event.myStatus === "declined") continue;
      const key = startOfDay(occ.start);
      const list = map.get(key);
      if (list) list.push(occ);
      else map.set(key, [occ]);
    }
    return map;
  }, [events, days]);

  const drop = (targetDay: number, raw: string) => {
    try {
      const { eventId, occStart } = JSON.parse(raw) as { eventId: string; occStart: number };
      const event = events.find((e) => e.id === eventId);
      const next = event ? shiftToDay(event, occStart, targetDay) : null;
      if (event && next) upsertEvent({ ...event, ...next });
    } catch {
      /* not one of ours */
    }
  };

  const openChip = (e: MouseEvent | KeyboardEvent, occ: EventOccurrence) => {
    e.stopPropagation();
    openDetail(occ.event.id, occ.start, rectOf(e.currentTarget));
  };

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", flex: "none", borderBottom: line }}>
        {weekdayShortNames().map((name) => (
          <Typography
            key={name}
            noWrap
            sx={{
              px: "8px",
              py: "7px",
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: nebula.dim,
            }}
          >
            {name}
          </Typography>
        ))}
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gridTemplateRows: "repeat(6, minmax(0, 1fr))",
        }}
      >
        {days.map((day, index) => {
          const outside = day < monthStart || day >= nextMonthStart;
          const today = isToday(day);
          const occs = byDay.get(day) ?? [];
          return (
            <Box
              key={day}
              onClick={() => openNewEvent(day + 9 * MS_PER_HOUR)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                drop(day, e.dataTransfer.getData("text/plain"));
              }}
              sx={{
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                p: compact ? "3px" : "4px 5px",
                cursor: "pointer",
                borderRight: index % 7 === 6 ? "none" : line,
                borderBottom: index >= 35 ? "none" : line,
                "&:hover": { background: nebula.hover },
              }}
            >
              <Box
                component="span"
                sx={{
                  alignSelf: compact ? "center" : "flex-start",
                  minWidth: 22,
                  height: 22,
                  px: "5px",
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                  borderRadius: "999px",
                  fontSize: 11.5,
                  fontWeight: today ? 700 : 500,
                  fontVariantNumeric: "tabular-nums",
                  color: today ? nebula.onAccent : outside ? nebula.dim : nebula.text,
                  background: today ? nebula.accent : "transparent",
                }}
              >
                {new Date(day).getDate()}
              </Box>
              {occs.slice(0, maxChips).map((occ) => (
                <Box
                  key={occ.key}
                  role="button"
                  tabIndex={0}
                  title={occ.event.title}
                  data-testid={TID.calendarEvent}
                  data-event-title={occ.event.title}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData("text/plain", JSON.stringify({ eventId: occ.event.id, occStart: occ.start }));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onPointerDown={(e) => {
                    pressRef.current = { x: e.clientX, y: e.clientY };
                  }}
                  onClick={(e) => {
                    // Never let the click reach the cell, which would start a
                    // new meeting; and a small drag that never became a native
                    // one is not a click either.
                    e.stopPropagation();
                    const press = pressRef.current;
                    pressRef.current = null;
                    if (press && (Math.abs(e.clientX - press.x) > 4 || Math.abs(e.clientY - press.y) > 4)) return;
                    openChip(e, occ);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openChip(e, occ);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openMenu(occ.event.id, e.clientX, e.clientY);
                  }}
                  style={eventBlockStyle(occ.event, nebula.text)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    flex: "none",
                    height: 20,
                    px: compact ? "4px" : "6px",
                    borderRadius: radius("sm"),
                    fontSize: 11.5,
                    lineHeight: "20px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    cursor: "pointer",
                    "&:focus-visible": { outline: `2px solid ${nebula.accent}`, outlineOffset: 1 },
                  }}
                >
                  {!compact && !occ.event.allDay && (
                    <Box component="span" sx={{ fontWeight: 600, opacity: 0.85, flex: "none" }}>
                      {shortTimeFormatted(occ.start, formatPrefs.timeFormat)}
                    </Box>
                  )}
                  <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {occ.event.title || t("chat:calendar.untitled")}
                  </Box>
                </Box>
              ))}
              {occs.length > maxChips && (
                <Box
                  component="button"
                  type="button"
                  aria-label={t("nebulaChat:calendar.more", { count: occs.length - maxChips })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowDay(day);
                  }}
                  sx={{
                    all: "unset",
                    cursor: "pointer",
                    flex: "none",
                    px: "6px",
                    fontSize: 11,
                    color: nebula.muted,
                    "&:hover, &:focus-visible": { color: nebula.text, textDecoration: "underline" },
                  }}
                >
                  {/* A phone's cell is a finger wide; the words go in the label. */}
                  {compact ? `+${occs.length - maxChips}` : t("nebulaChat:calendar.more", { count: occs.length - maxChips })}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Stack>
  );
}
