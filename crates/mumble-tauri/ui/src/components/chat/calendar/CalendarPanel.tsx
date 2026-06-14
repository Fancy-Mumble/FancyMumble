import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarIcon,
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
} from "../../../icons";
import { useCalendarStore, type AnchorRect } from "./calendarStore";
import { rangeLabel } from "./calendarFormat";
import { TID } from "../../../testids";
import type { CalendarView } from "./types";
import MonthView from "./MonthView";
import WeekView from "./WeekView";
import EventDetailCard from "./EventDetailCard";
import EventContextMenu from "./EventContextMenu";
import WorkHoursPopover from "./WorkHoursPopover";
import styles from "./CalendarPanel.module.css";

const EventDialog = lazy(() => import("./EventDialog"));

const VIEW_ORDER: CalendarView[] = ["day", "workweek", "week", "month"];

export default function CalendarPanel() {
  const { t } = useTranslation("chat");
  const view = useCalendarStore((s) => s.view);
  const anchor = useCalendarStore((s) => s.anchor);
  const dialogOpen = useCalendarStore((s) => s.dialogOpen);
  const setView = useCalendarStore((s) => s.setView);
  const step = useCalendarStore((s) => s.step);
  const goToday = useCalendarStore((s) => s.goToday);
  const openNewEvent = useCalendarStore((s) => s.openNewEvent);

  const workBtnRef = useRef<HTMLButtonElement>(null);
  const [workAnchor, setWorkAnchor] = useState<AnchorRect | null>(null);

  const viewLabel: Record<CalendarView, string> = {
    day: t("calendar.views.day"),
    workweek: t("calendar.views.workweek"),
    week: t("calendar.views.week"),
    month: t("calendar.views.month"),
  };

  const toggleWorkHours = () => {
    if (workAnchor) {
      setWorkAnchor(null);
      return;
    }
    const r = workBtnRef.current?.getBoundingClientRect();
    if (r) setWorkAnchor({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
  };

  return (
    <div className={styles.panel} data-testid={TID.calendarPanel}>
      <div className={styles.toolbar}>
        <span className={styles.title}>
          <CalendarIcon width={16} height={16} />
          {t("calendar.title")}
        </span>

        <div className={styles.navGroup}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => step(-1)}
            aria-label={t("calendar.prev")}
          >
            <ChevronLeftIcon width={16} height={16} />
          </button>
          <button type="button" className={styles.todayBtn} onClick={goToday}>
            {t("calendar.today")}
          </button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => step(1)}
            aria-label={t("calendar.next")}
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>

        <span className={styles.rangeLabel}>{rangeLabel(view, anchor)}</span>

        <div className={styles.spacer} />

        <button
          ref={workBtnRef}
          type="button"
          className={styles.todayBtn}
          onClick={toggleWorkHours}
          title={t("calendar.workHours.title")}
        >
          <ClockIcon width={14} height={14} />
          {t("calendar.workHours.short")}
        </button>

        <div className={styles.viewSwitch}>
          {VIEW_ORDER.map((v) => (
            <button
              key={v}
              type="button"
              className={`${styles.viewBtn} ${v === view ? styles.viewBtnActive : ""}`}
              onClick={() => setView(v)}
              data-testid={TID.calendarViewButton}
              data-view={v}
            >
              {viewLabel[v]}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles.newBtn}
          onClick={() => openNewEvent()}
          data-testid={TID.calendarNewMeeting}
        >
          <CalendarPlusIcon width={15} height={15} />
          {t("calendar.newMeeting")}
        </button>
      </div>

      {view === "month" ? (
        <MonthView />
      ) : (
        <WeekView dayCount={view === "day" ? 1 : view === "workweek" ? 5 : 7} />
      )}

      <EventDetailCard />
      <EventContextMenu />
      {workAnchor && <WorkHoursPopover anchor={workAnchor} onClose={() => setWorkAnchor(null)} />}

      {dialogOpen && (
        <Suspense fallback={null}>
          <EventDialog />
        </Suspense>
      )}
    </div>
  );
}
