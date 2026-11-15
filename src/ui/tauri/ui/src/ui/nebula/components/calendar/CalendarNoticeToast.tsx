import { useTranslation } from "react-i18next";
import { Box, Button, IconButton, Snackbar, Typography } from "@mui/material";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { eventColor, formatRangeFormatted } from "@core/features/chat/calendar/calendarFormat";
import { useCalendarFormatPreferences } from "@core/features/chat/calendar/useCalendarFormatPreferences";
import { CloseIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { Stack } from "../primitives";
import { joinFromCalendar, type CalendarNotice } from "./useCalendarNotices";

interface CalendarNoticeToastProps {
  readonly notice: CalendarNotice | null;
  readonly onDismiss: () => void;
  /** Open the calendar on this occurrence's card. */
  readonly onOpen: (eventId: string, occStart: number) => void;
  /** Centred along the bottom, as a phone wants it. */
  readonly handheld?: boolean;
}

/**
 * The meeting behind a reminder or a meeting link.
 *
 * The OS notification says a meeting is starting and then goes, and a link
 * drops you into a room without saying what for. This is the in-window half:
 * which meeting, when, and a way to its card - plus Join, for a reminder,
 * since joining is what a reminder is usually for.
 *
 * A reminder stays until it is answered; a room notice is confirmation of
 * something that already happened, so it leaves on its own.
 */
export function CalendarNoticeToast({ notice, onDismiss, onOpen, handheld = false }: CalendarNoticeToastProps) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const event = useCalendarStore((s) => (notice ? s.events.find((e) => e.id === notice.eventId) : undefined));
  const formatPrefs = useCalendarFormatPreferences();
  if (!notice || !event) return null;

  const occEnd = notice.occStart + (event.end - event.start);
  const when = formatRangeFormatted(
    notice.occStart,
    occEnd,
    event.allDay,
    formatPrefs.timeFormat,
    formatPrefs.dateFormat,
  );

  return (
    <Snackbar
      key={notice.key}
      open
      anchorOrigin={{ vertical: "bottom", horizontal: handheld ? "center" : "right" }}
      autoHideDuration={notice.kind === "room" ? 10_000 : null}
      onClose={(_, reason) => {
        // A reminder is not dismissed by clicking somewhere else in the window.
        if (reason !== "clickaway") onDismiss();
      }}
    >
      <Box
        role="status"
        sx={(theme) => ({
          display: "flex",
          width: 340,
          maxWidth: "calc(100vw - 24px)",
          overflow: "hidden",
          borderRadius: radius("lg"),
          background: theme.palette.nebula.card,
          border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line2}`,
          boxShadow: theme.palette.nebula.shadow,
        })}
      >
        <Box sx={{ width: 4, flex: "none", background: eventColor(event) }} />
        <Stack gap={0.25} sx={{ flex: 1, minWidth: 0, p: "10px 10px 12px 14px" }}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Typography
              sx={(theme) => ({
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: theme.palette.nebula.muted,
              })}
              noWrap
            >
              {notice.kind === "reminder"
                ? t("nebulaChat:calendar.notice.upcoming")
                : t("nebulaChat:calendar.notice.inRoom")}
            </Typography>
            <IconButton
              size="small"
              sx={{ ml: "auto", my: "-4px" }}
              aria-label={t("common:actions.close")}
              onClick={onDismiss}
            >
              <CloseIcon width={12} height={12} />
            </IconButton>
          </Stack>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
            {event.title || t("chat:calendar.untitled")}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })} noWrap>
            {event.location ? `${when} · ${event.location}` : when}
          </Typography>
          <Stack direction="row" gap={1} sx={{ mt: "8px" }}>
            {notice.kind === "reminder" && (
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  joinFromCalendar(event.id);
                  onDismiss();
                }}
              >
                {t("nebulaChat:calendar.join")}
              </Button>
            )}
            <Button
              size="small"
              variant={notice.kind === "reminder" ? "text" : "contained"}
              onClick={() => {
                onOpen(event.id, notice.occStart);
                onDismiss();
              }}
            >
              {t("nebulaChat:calendar.notice.details")}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Snackbar>
  );
}
