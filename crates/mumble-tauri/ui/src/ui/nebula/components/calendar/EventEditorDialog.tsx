/**
 * Creating and editing a meeting.
 *
 * Every field Standard's dialog has, in the same order, and the same answers
 * underneath: the typed dates are read by `calendarInputs`, the saved range and
 * participants come from `eventDraft`, the invitee pool from
 * `useInviteCandidates`. The selects are native, as Standard's are - a list of
 * a hundred and forty time zones is what a native select's type-ahead is for.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import type { DateFormat, TimeFormat } from "@core/types";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { MS_PER_HOUR, toDateInput, toTimeInput } from "@core/features/chat/calendar/calendarDates";
import {
  datePlaceholder,
  formatDateText,
  formatTimeText,
  parseDateText,
  parseTimeText,
  timePlaceholder,
} from "@core/features/chat/calendar/calendarInputs";
import { draftParticipants, draftRange, nextHour } from "@core/features/chat/calendar/eventDraft";
import { defaultTimezoneId, TIMEZONES } from "@core/features/chat/calendar/timezones";
import {
  CALENDAR_COLORS,
  REMINDER_OPTIONS,
  type RepeatFreq,
  type RepeatUnit,
} from "@core/features/chat/calendar/types";
import { useCalendarFormatPreferences } from "@core/features/chat/calendar/useCalendarFormatPreferences";
import { useInviteCandidates } from "@core/features/chat/calendar/useInviteCandidates";
import { CalendarPlusIcon, CloseIcon, EditIcon, MapPinIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { RichTextField, Stack } from "../primitives";
import { MemberPicker } from "../admin/MemberPicker";
import { reminderLabel } from "./calendarModel";

const REPEAT_FREQS: readonly RepeatFreq[] = ["none", "weekdays", "daily", "weekly", "monthly", "yearly", "custom"];
const REPEAT_UNITS: readonly RepeatUnit[] = ["day", "week", "month", "year"];
const NATIVE_SELECT = { select: { native: true } } as const;

/** A caption over a group of fields. */
function Label({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Typography
      component="div"
      sx={(theme) => ({ fontSize: 11.5, fontWeight: 600, color: theme.palette.nebula.muted, mb: "6px" })}
    >
      {children}
    </Typography>
  );
}

interface DateTimeFieldProps {
  readonly kind: "date" | "time";
  /** ISO date or 24-hour time. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly dateFormat: DateFormat;
  readonly timeFormat: TimeFormat;
  readonly ariaLabel: string;
  readonly testId?: string;
}

/**
 * A date or a time, typed in the user's format.
 *
 * What is on screen is the text as typed; the value only moves once the text
 * names a real date or time, so a half-typed "04/0" never becomes a meeting in
 * April of year 0.
 */
function DateTimeField({ kind, value, onChange, dateFormat, timeFormat, ariaLabel, testId }: DateTimeFieldProps) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(kind === "date" ? formatDateText(value, dateFormat) : formatTimeText(value, timeFormat));
  }, [kind, value, dateFormat, timeFormat]);

  return (
    <TextField
      size="small"
      value={text}
      placeholder={kind === "date" ? datePlaceholder(dateFormat) : timePlaceholder(timeFormat)}
      onChange={(e) => {
        setText(e.target.value);
        const parsed =
          kind === "date" ? parseDateText(e.target.value, dateFormat) : parseTimeText(e.target.value, timeFormat);
        if (parsed) onChange(parsed);
      }}
      slotProps={{ htmlInput: { "aria-label": ariaLabel, "data-testid": testId } }}
      sx={{ width: kind === "date" ? 132 : 112, flex: "none" }}
    />
  );
}

interface EventEditorDialogProps {
  readonly fullScreen?: boolean;
  /** Delete asks first, and the question is the calendar's to show. */
  readonly onDelete: (eventId: string) => void;
}

export function EventEditorDialog({ fullScreen = false, onDelete }: Readonly<EventEditorDialogProps>) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const { t: tChat } = useTranslation("chat");
  const editingId = useCalendarStore((s) => s.editingEventId);
  const draftStart = useCalendarStore((s) => s.draftStart);
  const closeDialog = useCalendarStore((s) => s.closeDialog);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);
  const existing = useCalendarStore((s) => (editingId ? s.events.find((e) => e.id === editingId) : undefined));
  const users = useAppStore((s) => s.users);
  const ownSession = useAppStore((s) => s.ownSession);
  const formatPrefs = useCalendarFormatPreferences();
  const { candidates, avatarFor } = useInviteCandidates(existing?.participants);

  const initialStart = existing?.start ?? draftStart ?? nextHour(Date.now());
  const initialEnd = existing?.end ?? initialStart + MS_PER_HOUR;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [invitees, setInvitees] = useState<number[]>(existing?.participants.map((p) => p.userId) ?? []);
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [startDate, setStartDate] = useState(toDateInput(initialStart));
  const [startTime, setStartTime] = useState(toTimeInput(initialStart));
  const [endDate, setEndDate] = useState(toDateInput(initialEnd));
  const [endTime, setEndTime] = useState(toTimeInput(initialEnd));
  const [repeat, setRepeat] = useState<RepeatFreq>(existing?.repeat.freq ?? "none");
  const [customInterval, setCustomInterval] = useState(existing?.repeat.interval ?? 1);
  const [customUnit, setCustomUnit] = useState<RepeatUnit>(existing?.repeat.unit ?? "week");
  const [timezone, setTimezone] = useState(existing?.timezone ?? defaultTimezoneId());
  const [location, setLocation] = useState(existing?.location ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [color, setColor] = useState(existing?.color ?? CALENDAR_COLORS[0]);
  const [reminder, setReminder] = useState<number | null>(existing?.reminderMinutes ?? 15);

  const save = () => {
    const organizer = users.find((u) => u.session === ownSession);
    upsertEvent({
      id: existing?.id,
      organizerId: organizer?.user_id ?? existing?.organizerId ?? 0,
      organizerName: organizer?.name ?? existing?.organizerName ?? t("chat:calendar.you"),
      title: title.trim() || t("chat:calendar.untitled"),
      location: location.trim(),
      description,
      ...draftRange({ allDay, startDate, startTime, endDate, endTime }),
      allDay,
      timezone,
      repeat: {
        freq: repeat,
        interval: repeat === "custom" ? Math.max(1, customInterval) : undefined,
        unit: repeat === "custom" ? customUnit : undefined,
      },
      color,
      participants: draftParticipants(invitees, existing?.participants, candidates),
      reminderMinutes: reminder,
    });
    closeDialog();
  };

  const dateTime = (kind: "date" | "time", which: "start" | "end") => {
    const date = which === "start" ? startDate : endDate;
    const time = which === "start" ? startTime : endTime;
    const label = which === "start" ? t("nebulaChat:calendar.start") : t("nebulaChat:calendar.end");
    return (
      <DateTimeField
        kind={kind}
        value={kind === "date" ? date : time}
        onChange={
          kind === "date"
            ? which === "start"
              ? setStartDate
              : setEndDate
            : which === "start"
              ? setStartTime
              : setEndTime
        }
        dateFormat={formatPrefs.dateFormat}
        timeFormat={formatPrefs.timeFormat}
        ariaLabel={label}
        testId={
          which === "start" ? (kind === "date" ? TID.calendarStartDate : TID.calendarStartTime) : undefined
        }
      />
    );
  };

  return (
    <Dialog open onClose={closeDialog} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <Stack data-testid={TID.calendarDialog} sx={{ minHeight: 0, flex: 1 }}>
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={(theme) => ({
            height: 52,
            flex: "none",
            px: "16px",
            borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
          })}
        >
          {existing ? <EditIcon width={14} height={14} /> : <CalendarPlusIcon width={14} height={14} />}
          <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
            {existing ? t("chat:calendar.editMeeting") : t("chat:calendar.newMeeting")}
          </Typography>
          <IconButton size="small" sx={{ ml: "auto" }} aria-label={t("common:actions.close")} onClick={closeDialog}>
            <CloseIcon width={13} height={13} />
          </IconButton>
        </Stack>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: "18px", pt: "16px !important" }}>
          <TextField
            autoFocus
            fullWidth
            placeholder={t("chat:calendar.fields.title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            slotProps={{
              htmlInput: {
                "aria-label": t("chat:calendar.fields.title"),
                "data-testid": TID.calendarTitleInput,
                style: { fontSize: 16, fontWeight: 600 },
              },
            }}
          />

          <Box>
            <Label>{t("chat:calendar.fields.invitees")}</Label>
            <MemberPicker
              value={invitees}
              candidates={candidates}
              onChange={setInvitees}
              getAvatar={avatarFor}
              placeholder={t("chat:calendar.fields.inviteesPlaceholder")}
              emptyLabel={t("nebulaChat:calendar.noInvitees")}
              inputTestId={TID.calendarInviteeInput}
            />
          </Box>

          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Label>{t("nebulaChat:calendar.when")}</Label>
              <FormControlLabel
                labelPlacement="start"
                control={<Switch size="small" checked={allDay} onChange={() => setAllDay(!allDay)} />}
                label={t("chat:calendar.fields.allDay")}
                slotProps={{ typography: { sx: { fontSize: 12.5 } } }}
                sx={{ mr: 0, mt: "-6px" }}
              />
            </Stack>
            <Stack gap={1}>
              <Stack direction="row" alignItems="center" gap={1} sx={{ flexWrap: "wrap" }}>
                <Typography sx={(theme) => ({ width: 44, fontSize: 12, color: theme.palette.nebula.muted })}>
                  {t("nebulaChat:calendar.start")}
                </Typography>
                {dateTime("date", "start")}
                {!allDay && dateTime("time", "start")}
              </Stack>
              <Stack direction="row" alignItems="center" gap={1} sx={{ flexWrap: "wrap" }}>
                <Typography sx={(theme) => ({ width: 44, fontSize: 12, color: theme.palette.nebula.muted })}>
                  {t("nebulaChat:calendar.end")}
                </Typography>
                {dateTime("date", "end")}
                {!allDay && dateTime("time", "end")}
              </Stack>
              <TextField
                select
                size="small"
                fullWidth
                label={t("chat:calendar.fields.timezone")}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                slotProps={{ ...NATIVE_SELECT, inputLabel: { shrink: true } }}
                sx={{ mt: "6px" }}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label}
                  </option>
                ))}
              </TextField>
            </Stack>
          </Box>

          <Stack direction="row" gap={1} sx={{ flexWrap: "wrap" }}>
            <TextField
              select
              size="small"
              label={t("nebulaChat:calendar.repeats")}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as RepeatFreq)}
              slotProps={{ ...NATIVE_SELECT, inputLabel: { shrink: true } }}
              sx={{ flex: "1 1 200px" }}
            >
              {REPEAT_FREQS.map((freq) => (
                <option key={freq} value={freq}>
                  {t(`chat:calendar.repeat.${freq}`)}
                </option>
              ))}
            </TextField>
            {repeat === "custom" && (
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
                  {t("chat:calendar.repeat.every")}
                </Typography>
                <TextField
                  size="small"
                  type="number"
                  value={customInterval}
                  onChange={(e) => setCustomInterval(Number.parseInt(e.target.value, 10) || 1)}
                  slotProps={{ htmlInput: { min: 1, "aria-label": t("chat:calendar.repeat.every") } }}
                  sx={{ width: 72 }}
                />
                <TextField
                  select
                  size="small"
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value as RepeatUnit)}
                  slotProps={NATIVE_SELECT}
                >
                  {REPEAT_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {t(`chat:calendar.repeat.units.${unit}`)}
                    </option>
                  ))}
                </TextField>
              </Stack>
            )}
            <TextField
              select
              size="small"
              label={t("chat:calendar.fields.reminder")}
              value={reminder === null ? "none" : String(reminder)}
              onChange={(e) =>
                setReminder(e.target.value === "none" ? null : Number.parseInt(e.target.value, 10))
              }
              slotProps={{
                ...NATIVE_SELECT,
                inputLabel: { shrink: true },
                htmlInput: { "data-testid": TID.calendarReminderSelect },
              }}
              sx={{ flex: "1 1 180px" }}
            >
              {REMINDER_OPTIONS.map((minutes) => (
                <option key={minutes ?? "none"} value={minutes === null ? "none" : String(minutes)}>
                  {reminderLabel(tChat, minutes)}
                </option>
              ))}
            </TextField>
          </Stack>

          <TextField
            size="small"
            fullWidth
            placeholder={t("chat:calendar.fields.location")}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            slotProps={{
              htmlInput: { "aria-label": t("chat:calendar.fields.location") },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MapPinIcon width={14} height={14} />
                  </InputAdornment>
                ),
              },
            }}
          />

          <Box>
            <Label>{t("chat:calendar.fields.description")}</Label>
            {/* `document`, not the default `prose`: prose has no lists, and a
                description written in Standard - whose editor is the full
                StarterKit - would lose them the first time it was saved here. */}
            <RichTextField
              value={description}
              onChange={setDescription}
              placeholder={t("chat:calendar.fields.descriptionPlaceholder")}
              preset="document"
              tools={["bold", "italic", "lists"]}
              maxLength={8000}
              ariaLabel={t("chat:calendar.fields.description")}
            />
          </Box>

          <Box>
            <Label>{t("chat:calendar.fields.color")}</Label>
            <Stack direction="row" alignItems="center" gap={0.75} sx={{ flexWrap: "wrap" }}>
              {CALENDAR_COLORS.map((swatch) => (
                <Box
                  key={swatch}
                  component="button"
                  type="button"
                  aria-label={swatch}
                  aria-pressed={swatch === color}
                  onClick={() => setColor(swatch)}
                  sx={(theme) => ({
                    all: "unset",
                    cursor: "pointer",
                    width: 22,
                    height: 22,
                    borderRadius: radius("sm"),
                    background: swatch,
                    boxShadow:
                      swatch === color
                        ? `0 0 0 2px ${theme.palette.nebula.bg0}, 0 0 0 4px ${theme.palette.nebula.text}`
                        : "none",
                    "&:focus-visible": { outline: `2px solid ${theme.palette.nebula.accent}`, outlineOffset: 3 },
                  })}
                />
              ))}
              <Box
                component="input"
                type="color"
                value={color}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(e.target.value)}
                aria-label={t("chat:calendar.fields.customColor")}
                sx={(theme) => ({
                  width: 22,
                  height: 22,
                  p: 0,
                  border: `var(--nebula-line-width, 1px) dashed ${theme.palette.nebula.line2}`,
                  borderRadius: radius("sm"),
                  background: "none",
                  cursor: "pointer",
                  "&::-webkit-color-swatch-wrapper": { p: "2px" },
                  "&::-webkit-color-swatch": { border: "none", borderRadius: "4px" },
                })}
              />
            </Stack>
          </Box>
        </DialogContent>

        <DialogActions
          sx={(theme) => ({ borderTop: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}` })}
        >
          {existing && (
            <Button color="error" onClick={() => onDelete(existing.id)}>
              {t("chat:calendar.delete")}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeDialog}>{t("chat:calendar.cancel")}</Button>
          <Button variant="contained" onClick={save} data-testid={TID.calendarSave}>
            {t("chat:calendar.save")}
          </Button>
        </DialogActions>
      </Stack>
    </Dialog>
  );
}
