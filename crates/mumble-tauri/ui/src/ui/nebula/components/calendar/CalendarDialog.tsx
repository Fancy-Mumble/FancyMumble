/**
 * The calendar, over the shell.
 *
 * Standard opens it as a split beside the conversation that fills by default,
 * which in practice is a full page. Nebula opens it the way it opens the other
 * things you consult and put away - a large sheet over a scrim, the whole
 * screen on a phone - so the conversation is exactly where it was when it
 * closes. Everything it shows comes from the shared calendar store; this pack
 * draws the grids, the card and the form.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Dialog, IconButton, Tooltip, Typography } from "@mui/material";
import { CALENDAR_VIEW_ATTR, TID } from "@core/testids";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { rangeLabel } from "@core/features/chat/calendar/calendarFormat";
import type { CalendarView } from "@core/features/chat/calendar/types";
import { CalendarIcon, CalendarPlusIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, CloseIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { Stack } from "../primitives";
import { CalendarEventCard } from "./CalendarEventCard";
import { CalendarEventMenu } from "./CalendarEventMenu";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { CalendarWeekGrid } from "./CalendarWeekGrid";
import { DeleteMeetingDialog } from "./DeleteMeetingDialog";
import { WorkHoursPopover } from "./WorkHoursPopover";
import { dayCountFor, VIEW_ORDER } from "./calendarModel";

// The form carries the rich-text editor, which a look at the week should not pay for.
const EventEditorDialog = lazy(() =>
  import("./EventEditorDialog").then((m) => ({ default: m.EventEditorDialog })),
);

interface ViewSwitchProps {
  readonly views: readonly CalendarView[];
  readonly value: CalendarView;
  readonly onChange: (view: CalendarView) => void;
  readonly fullWidth: boolean;
}

/** The grids, as one track. Each half carries the id and view the e2e suite
 *  switches by, which is why this is not the settings `SegmentedGroup`. */
function ViewSwitch({ views, value, onChange, fullWidth }: ViewSwitchProps) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
  return (
    <Stack
      direction="row"
      gap={0.375}
      role="radiogroup"
      aria-label={t("nebulaChat:calendar.viewLabel")}
      sx={(theme) => ({
        display: "inline-flex",
        p: "3px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
        ...(fullWidth ? { width: "100%" } : {}),
      })}
    >
      {views.map((view) => {
        const active = view === value;
        return (
          <Box
            key={view}
            component="button"
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={TID.calendarViewButton}
            {...{ [CALENDAR_VIEW_ATTR]: view }}
            onClick={() => onChange(view)}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              flex: fullWidth ? 1 : undefined,
              textAlign: "center",
              whiteSpace: "nowrap",
              px: "12px",
              py: "5px",
              borderRadius: radius("md"),
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
              background: active ? theme.palette.nebula.card2 : "transparent",
              "&:focus-visible": { outline: `2px solid ${theme.palette.nebula.accent}` },
            })}
          >
            {t(`chat:calendar.views.${view}`)}
          </Box>
        );
      })}
    </Stack>
  );
}

interface CalendarDialogProps {
  /** The whole screen, as every dialog is on a phone. */
  readonly fullScreen?: boolean;
  readonly onClose: () => void;
}

export function CalendarDialog({ fullScreen = false, onClose }: Readonly<CalendarDialogProps>) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const view = useCalendarStore((s) => s.view);
  const anchor = useCalendarStore((s) => s.anchor);
  const dialogOpen = useCalendarStore((s) => s.dialogOpen);
  const setView = useCalendarStore((s) => s.setView);
  const step = useCalendarStore((s) => s.step);
  const goToday = useCalendarStore((s) => s.goToday);
  const openNewEvent = useCalendarStore((s) => s.openNewEvent);
  const [workAnchor, setWorkAnchor] = useState<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Seven columns across a phone leave a letter of each title, and five are
  // hardly better: a phone opens on the day and offers no work week.
  const views = fullScreen ? VIEW_ORDER.filter((entry) => entry !== "workweek") : VIEW_ORDER;
  useEffect(() => {
    if (!fullScreen) return;
    const store = useCalendarStore.getState();
    if (store.view === "week" || store.view === "workweek") store.setView("day");
  }, [fullScreen]);

  // The card, the menu and the form live in the shared store, so putting the
  // calendar away puts them away too - otherwise the next open would find a
  // card from last time already hanging over it.
  const close = () => {
    const store = useCalendarStore.getState();
    store.closeDetail();
    store.closeMenu();
    store.closeDialog();
    onClose();
  };

  const showDay = (day: number) => {
    const store = useCalendarStore.getState();
    store.setAnchor(day);
    store.setView("day");
  };

  const line = "var(--nebula-line-width, 1px) solid";
  const newMeeting = (
    <Button
      variant="contained"
      size="small"
      startIcon={<CalendarPlusIcon width={14} height={14} />}
      onClick={() => openNewEvent()}
      data-testid={TID.calendarNewMeeting}
    >
      {t("chat:calendar.newMeeting")}
    </Button>
  );
  const closeButton = (
    <IconButton size="small" aria-label={t("chat:calendar.close")} onClick={close}>
      <CloseIcon width={14} height={14} />
    </IconButton>
  );
  // On a phone the toolbar is three rows - name and actions, where you are,
  // which grid - and these force the breaks between them.
  const rowBreak = (order: number) =>
    fullScreen ? <Box aria-hidden="true" sx={{ flexBasis: "100%", height: 0, order }} /> : null;

  return (
    <Dialog
      open
      onClose={close}
      maxWidth={false}
      fullScreen={fullScreen}
      slotProps={{
        paper: {
          sx: fullScreen
            ? { overflow: "hidden" }
            : {
                width: "min(1180px, calc(100vw - 48px))",
                height: "min(820px, calc(100vh - 48px))",
                m: "24px",
                overflow: "hidden",
              },
        },
      }}
    >
      <Stack data-testid={TID.calendarPanel} sx={{ height: "100%", minHeight: 0 }}>
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={(theme) => ({
            flex: "none",
            flexWrap: "wrap",
            rowGap: "10px",
            minHeight: 56,
            px: fullScreen ? "12px" : "16px",
            py: "10px",
            borderBottom: `${line} ${theme.palette.nebula.line}`,
          })}
        >
          <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0, mr: fullScreen ? "auto" : "8px" }}>
            <CalendarIcon width={15} height={15} aria-hidden="true" />
            <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
              {t("chat:calendar.title")}
            </Typography>
          </Stack>
          {fullScreen && newMeeting}
          {fullScreen && closeButton}
          {rowBreak(1)}

          <Stack direction="row" alignItems="center" gap={0.5} sx={{ order: 1 }}>
            <Tooltip title={t("chat:calendar.prev")}>
              <IconButton size="small" aria-label={t("chat:calendar.prev")} onClick={() => step(-1)}>
                <ChevronLeftIcon width={15} height={15} />
              </IconButton>
            </Tooltip>
            <Button size="small" variant="outlined" onClick={goToday}>
              {t("chat:calendar.today")}
            </Button>
            <Tooltip title={t("chat:calendar.next")}>
              <IconButton size="small" aria-label={t("chat:calendar.next")} onClick={() => step(1)}>
                <ChevronRightIcon width={15} height={15} />
              </IconButton>
            </Tooltip>
          </Stack>
          <Typography
            aria-live="polite"
            noWrap
            sx={{ order: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
          >
            {rangeLabel(view, anchor)}
          </Typography>
          <Box sx={{ flex: 1, order: 1 }} />
          {rowBreak(2)}

          {!fullScreen && (
            <Button
              size="small"
              startIcon={<ClockIcon width={13} height={13} />}
              aria-pressed={workAnchor !== null}
              title={t("chat:calendar.workHours.title")}
              onClick={(e) => setWorkAnchor(workAnchor ? null : e.currentTarget)}
            >
              {t("chat:calendar.workHours.short")}
            </Button>
          )}
          <Box sx={{ order: 2, ...(fullScreen ? { width: "100%" } : {}) }}>
            <ViewSwitch views={views} value={view} onChange={setView} fullWidth={fullScreen} />
          </Box>
          {!fullScreen && <Box sx={{ order: 2 }}>{newMeeting}</Box>}
          {!fullScreen && <Box sx={{ order: 2 }}>{closeButton}</Box>}
        </Stack>

        {view === "month" ? (
          <CalendarMonthGrid onShowDay={showDay} compact={fullScreen} />
        ) : (
          <CalendarWeekGrid dayCount={dayCountFor(view)} />
        )}
      </Stack>

      <CalendarEventCard centred={fullScreen} onJoined={close} onDelete={setDeleting} />
      <CalendarEventMenu onDelete={setDeleting} />
      {workAnchor && <WorkHoursPopover anchorEl={workAnchor} onClose={() => setWorkAnchor(null)} />}
      {dialogOpen && (
        <Suspense fallback={null}>
          <EventEditorDialog fullScreen={fullScreen} onDelete={setDeleting} />
        </Suspense>
      )}
      <DeleteMeetingDialog eventId={deleting} onClose={() => setDeleting(null)} />
    </Dialog>
  );
}
