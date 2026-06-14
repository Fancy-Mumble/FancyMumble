import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Toggle } from "../../../pages/settings/SharedControls";
import { useCalendarStore } from "./calendarStore";
import { weekdayShortNames } from "./calendarFormat";
import type { AnchorRect } from "./calendarStore";
import styles from "./CalendarPanel.module.css";

const POPOVER_W = 280;

function toHHmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function toMinutes(value: string): number {
  const [h, m] = value.split(":").map((s) => Number.parseInt(s, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Popover (anchored to the toolbar button) to configure personal work hours. */
export default function WorkHoursPopover({
  anchor,
  onClose,
}: {
  readonly anchor: AnchorRect;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation("chat");
  const workHours = useCalendarStore((s) => s.workHours);
  const setWorkHours = useCalendarStore((s) => s.setWorkHours);
  const dayNames = weekdayShortNames();

  const left = Math.min(anchor.left, window.innerWidth - POPOVER_W - 8);
  const top = anchor.bottom + 6;

  const toggleDay = (i: number) => {
    const days = workHours.days.slice();
    days[i] = !days[i];
    setWorkHours({ days });
  };

  return createPortal(
    <>
      <div className={styles.detailBackdrop} onClick={onClose} />
      <div className={styles.workPopover} style={{ left, top, width: POPOVER_W }}>
        <div className={styles.workRow}>
          <span className={styles.fieldLabelInline}>{t("calendar.workHours.enable")}</span>
          <Toggle checked={workHours.enabled} onChange={() => setWorkHours({ enabled: !workHours.enabled })} />
        </div>
        <div className={styles.workRow}>
          <span className={styles.fieldLabelInline}>{t("calendar.workHours.from")}</span>
          <input
            type="time"
            className={styles.input}
            value={toHHmm(workHours.startMinutes)}
            onChange={(e) => setWorkHours({ startMinutes: toMinutes(e.target.value) })}
          />
          <span className={styles.fieldLabelInline}>{t("calendar.workHours.to")}</span>
          <input
            type="time"
            className={styles.input}
            value={toHHmm(workHours.endMinutes)}
            onChange={(e) => setWorkHours({ endMinutes: toMinutes(e.target.value) })}
          />
        </div>
        <div className={styles.workDays}>
          {dayNames.map((name, i) => (
            <button
              key={name}
              type="button"
              className={`${styles.dayPill} ${workHours.days[i] ? styles.dayPillOn : ""}`}
              onClick={() => toggleDay(i)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
