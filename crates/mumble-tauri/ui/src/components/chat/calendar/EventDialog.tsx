import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../elements/Modal";
import { MemberPicker } from "../../elements/MemberPicker";
import { Toggle } from "../../../pages/settings/SharedControls";
import { useAppStore } from "../../../store";
import { getCachedUserAvatar } from "../../../lazyBlobs";
import {
  CalendarClockIcon,
  ClockIcon,
  CloseIcon,
  MapPinIcon,
  RepeatIcon,
  TrashIcon,
  UsersGroupIcon,
} from "../../../icons";
import { useCalendarStore } from "./calendarStore";
import { useCalendarFormatPreferences } from "./useCalendarFormatPreferences";
import { DateInput } from "./DateInput";
import { TimeInput } from "./TimeInput";
import {
  fromDateInput,
  startOfDay,
  toDateInput,
  toTimeInput,
  withTime,
  MS_PER_HOUR,
} from "./calendarDates";
import {
  CALENDAR_COLORS,
  REMINDER_OPTIONS,
  type Participant,
  type RepeatFreq,
  type RepeatUnit,
} from "./types";
import { TIMEZONES, defaultTimezoneId } from "./timezones";
import { TID } from "../../../testids";
import styles from "./EventDialog.module.css";

const DescriptionEditor = lazy(() => import("./DescriptionEditor"));

const REPEAT_FREQS: RepeatFreq[] = [
  "none",
  "weekdays",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "custom",
];

/** Round `ms` up to the next whole hour (used for sensible new-event defaults). */
function nextHour(ms: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

export default function EventDialog() {
  const { t } = useTranslation("chat");
  const editingId = useCalendarStore((s) => s.editingEventId);
  const draftStart = useCalendarStore((s) => s.draftStart);
  const closeDialog = useCalendarStore((s) => s.closeDialog);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);
  const existing = useCalendarStore((s) =>
    editingId ? s.events.find((e) => e.id === editingId) : undefined,
  );

  const users = useAppStore((s) => s.users);
  const ownSession = useAppStore((s) => s.ownSession);
  const formatPrefs = useCalendarFormatPreferences();

  // Invitee suggestion pool: every registered user we can see (online list +
  // anyone already on the event). MemberPicker keys on a stable user_id.
  // Registered ids are >= 0 (SuperUser is 0); guests carry -1, so gate on >= 0
  // rather than > 0 or SuperUser could never be invited.
  const candidates = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of users) {
      if (u.user_id != null && u.user_id >= 0) map.set(u.user_id, u.name);
    }
    for (const p of existing?.participants ?? []) map.set(p.userId, p.name);
    return [...map.entries()].map(([user_id, name]) => ({ user_id, name }));
  }, [users, existing]);

  // Avatar resolver for the picker: map a registered user_id to the live online
  // user's cached avatar (mirrors RoleMembersPanel).
  const getAvatar = (id: number): string | null => {
    const live = users.find((u) => u.user_id === id);
    return live ? getCachedUserAvatar(live.session, live.texture_size) : null;
  };

  const initialStart = existing?.start ?? draftStart ?? nextHour(Date.now());
  const initialEnd = existing?.end ?? initialStart + MS_PER_HOUR;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [invitees, setInvitees] = useState<number[]>(
    existing?.participants.map((p) => p.userId) ?? [],
  );
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
  const [reminder, setReminder] = useState<number | null>(
    existing?.reminderMinutes ?? 15,
  );

  const reminderLabel = (m: number | null): string => {
    if (m === null) return t("calendar.reminders.none");
    if (m === 0) return t("calendar.reminders.atStart");
    if (m < 60) return t("calendar.reminders.minutes", { count: m });
    if (m < 1440) return t("calendar.reminders.hours", { count: Math.round(m / 60) });
    return t("calendar.reminders.days", { count: Math.round(m / 1440) });
  };

  const handleSave = () => {
    const sDay = fromDateInput(startDate);
    const eDay = fromDateInput(endDate);
    const start = allDay ? startOfDay(sDay) : withTime(sDay, startTime);
    let end = allDay ? startOfDay(eDay) + 86_400_000 : withTime(eDay, endTime);
    if (end <= start) end = start + (allDay ? 86_400_000 : MS_PER_HOUR);

    const organizer = users.find((u) => u.session === ownSession);
    const participants: Participant[] = invitees.map((userId) => {
      const prev = existing?.participants.find((p) => p.userId === userId);
      return {
        userId,
        name: prev?.name ?? candidates.find((c) => c.user_id === userId)?.name ?? `#${userId}`,
        status: prev?.status ?? "invited",
      };
    });

    upsertEvent({
      id: existing?.id,
      organizerId: organizer?.user_id ?? existing?.organizerId ?? 0,
      organizerName: organizer?.name ?? existing?.organizerName ?? t("calendar.you"),
      title: title.trim() || t("calendar.untitled"),
      location: location.trim(),
      description,
      start,
      end,
      allDay,
      timezone,
      repeat: {
        freq: repeat,
        interval: repeat === "custom" ? Math.max(1, customInterval) : undefined,
        unit: repeat === "custom" ? customUnit : undefined,
      },
      color,
      participants,
      reminderMinutes: reminder,
    });
    closeDialog();
  };

  const handleDelete = () => {
    if (existing) deleteEvent(existing.id);
    closeDialog();
  };

  return (
    <Modal onClose={closeDialog} zIndex={300}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} data-testid={TID.calendarDialog}>
        <div className={styles.dialogHeader}>
          <h3 className={styles.dialogTitle}>
            <CalendarClockIcon width={18} height={18} />
            {existing ? t("calendar.editMeeting") : t("calendar.newMeeting")}
          </h3>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={closeDialog}
            aria-label={t("calendar.cancel")}
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className={styles.form}>
          <input
            className={styles.titleInput}
            placeholder={t("calendar.fields.title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid={TID.calendarTitleInput}
            autoFocus
          />

          <label className={styles.fieldLabel}>
            <UsersGroupIcon width={14} height={14} />
            {t("calendar.fields.invitees")}
          </label>
          <MemberPicker
            value={invitees}
            candidates={candidates}
            onChange={setInvitees}
            getAvatar={getAvatar}
            placeholder={t("calendar.fields.inviteesPlaceholder")}
            inputTestId={TID.calendarInviteeInput}
          />

          <div className={styles.row}>
            <span className={styles.fieldLabel}>{t("calendar.fields.allDay")}</span>
            <Toggle checked={allDay} onChange={() => setAllDay(!allDay)} />
          </div>

          <div className={styles.row}>
            <ClockIcon width={14} height={14} className={styles.rowIcon} />
            <DateInput
              value={startDate}
              onChange={setStartDate}
              dateFormat={formatPrefs.dateFormat}
            />
            {!allDay && (
              <TimeInput
                value={startTime}
                onChange={setStartTime}
                timeFormat={formatPrefs.timeFormat}
              />
            )}
            <span className={styles.arrow}>→</span>
            <DateInput
              value={endDate}
              onChange={setEndDate}
              dateFormat={formatPrefs.dateFormat}
            />
            {!allDay && (
              <TimeInput
                value={endTime}
                onChange={setEndTime}
                timeFormat={formatPrefs.timeFormat}
              />
            )}
          </div>

          <div className={styles.row}>
            <span className={styles.fieldLabel}>{t("calendar.fields.timezone")}</span>
            <select
              className={styles.input}
              style={{ flex: 1, minWidth: 0 }}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <RepeatIcon width={14} height={14} className={styles.rowIcon} />
            <select
              className={styles.input}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as RepeatFreq)}
            >
              {REPEAT_FREQS.map((f) => (
                <option key={f} value={f}>
                  {t(`calendar.repeat.${f}`)}
                </option>
              ))}
            </select>
            {repeat === "custom" && (
              <>
                <span className={styles.muted}>{t("calendar.repeat.every")}</span>
                <input
                  type="number"
                  min={1}
                  className={styles.numInput}
                  value={customInterval}
                  onChange={(e) => setCustomInterval(Number.parseInt(e.target.value, 10) || 1)}
                />
                <select
                  className={styles.input}
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value as RepeatUnit)}
                >
                  {(["day", "week", "month", "year"] as RepeatUnit[]).map((u) => (
                    <option key={u} value={u}>
                      {t(`calendar.repeat.units.${u}`)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div className={styles.row}>
            <MapPinIcon width={14} height={14} className={styles.rowIcon} />
            <input
              className={styles.input}
              style={{ flex: 1 }}
              placeholder={t("calendar.fields.location")}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <label className={styles.fieldLabel}>{t("calendar.fields.description")}</label>
          <Suspense fallback={<div className={styles.editorWrap} />}>
            <DescriptionEditor
              value={description}
              onChange={setDescription}
              placeholder={t("calendar.fields.descriptionPlaceholder")}
            />
          </Suspense>

          <div className={styles.row}>
            <span className={styles.fieldLabel}>{t("calendar.fields.color")}</span>
            <div className={styles.swatches}>
              {CALENDAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.swatch} ${c === color ? styles.swatchActive : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={c}
                />
              ))}
              <input
                type="color"
                className={styles.colorInput}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label={t("calendar.fields.customColor")}
              />
            </div>
          </div>

          <div className={styles.row}>
            <span className={styles.fieldLabel}>{t("calendar.fields.reminder")}</span>
            <select
              className={styles.input}
              value={reminder === null ? "none" : String(reminder)}
              onChange={(e) =>
                setReminder(e.target.value === "none" ? null : Number.parseInt(e.target.value, 10))
              }
            >
              {REMINDER_OPTIONS.map((m) => (
                <option key={m === null ? "none" : m} value={m === null ? "none" : String(m)}>
                  {reminderLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.dialogFooter}>
          {existing && (
            <button type="button" className={styles.deleteBtn} onClick={handleDelete}>
              <TrashIcon width={14} height={14} />
              {t("calendar.delete")}
            </button>
          )}
          <div className={styles.spacer} />
          <button type="button" className={styles.cancelBtn} onClick={closeDialog}>
            {t("calendar.cancel")}
          </button>
          <button type="button" className={styles.saveBtn} onClick={handleSave} data-testid={TID.calendarSave}>
            {t("calendar.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
