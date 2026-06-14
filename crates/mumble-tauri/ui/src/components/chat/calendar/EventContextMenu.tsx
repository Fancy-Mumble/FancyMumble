import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CheckIcon, EditIcon, TrashIcon } from "../../../icons";
import { useCalendarStore } from "./calendarStore";
import { CALENDAR_COLORS, SHOW_AS_OPTIONS, type RsvpStatus } from "./types";
import styles from "./CalendarPanel.module.css";

const MENU_W = 224;

/** Acceptance responses (Propose-new-time is a separate action below). */
const RESPONSES: ReadonlyArray<{ status: RsvpStatus; key: "accept" | "tentative" | "decline" }> = [
  { status: "accepted", key: "accept" },
  { status: "tentative", key: "tentative" },
  { status: "declined", key: "decline" },
];

/** Right-click menu for an event: RSVP, Show-as, Edit / Delete / Re-color. */
export default function EventContextMenu() {
  const { t } = useTranslation("chat");
  const menu = useCalendarStore((s) => s.menu);
  const event = useCalendarStore((s) =>
    menu ? s.events.find((e) => e.id === menu.eventId) : undefined,
  );
  const closeMenu = useCalendarStore((s) => s.closeMenu);
  const openEditEvent = useCalendarStore((s) => s.openEditEvent);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeMenu]);

  if (!menu || !event) return null;

  const left = Math.min(menu.x, window.innerWidth - MENU_W - 8);
  const top = Math.min(menu.y, window.innerHeight - 460);
  const showAs = event.showAs ?? "busy";

  /** A menu row with a left check slot (so active rows align). */
  const checkItem = (active: boolean, label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      className={`${styles.contextItem} ${danger ? styles.contextDanger : ""}`}
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
    >
      <span className={styles.contextCheck}>{active && <CheckIcon width={13} height={13} />}</span>
      {label}
    </button>
  );

  return createPortal(
    <>
      <div
        className={styles.detailBackdrop}
        onClick={closeMenu}
        onContextMenu={(e) => {
          e.preventDefault();
          closeMenu();
        }}
      />
      <div className={styles.contextMenu} style={{ left, top, width: MENU_W }} role="menu">
        <div className={styles.contextRecolorLabel}>{t("calendar.response.title")}</div>
        {RESPONSES.map((r) =>
          checkItem(event.myStatus === r.status, t(`calendar.response.${r.key}`), () => {
            upsertEvent({ ...event, myStatus: r.status });
            closeMenu();
          }),
        )}
        <button
          type="button"
          className={styles.contextItem}
          role="menuitem"
          onClick={() => {
            openEditEvent(event.id);
            closeMenu();
          }}
        >
          <span className={styles.contextCheck} />
          {t("calendar.response.proposeNewTime")}
        </button>

        <div className={styles.contextSep} />
        <div className={styles.contextRecolorLabel}>{t("calendar.showAs.title")}</div>
        {SHOW_AS_OPTIONS.map((opt) =>
          checkItem(showAs === opt, t(`calendar.showAs.${opt}`), () => {
            upsertEvent({ ...event, showAs: opt });
            closeMenu();
          }),
        )}

        <div className={styles.contextSep} />
        <button
          type="button"
          className={styles.contextItem}
          role="menuitem"
          onClick={() => {
            openEditEvent(event.id);
            closeMenu();
          }}
        >
          <EditIcon width={14} height={14} />
          {t("calendar.edit")}
        </button>
        <button
          type="button"
          className={`${styles.contextItem} ${styles.contextDanger}`}
          role="menuitem"
          onClick={() => {
            deleteEvent(event.id);
            closeMenu();
          }}
        >
          <TrashIcon width={14} height={14} />
          {t("calendar.delete")}
        </button>

        <div className={styles.contextSep} />
        <div className={styles.contextRecolorLabel}>{t("calendar.recolor")}</div>
        <div className={styles.contextSwatches}>
          {CALENDAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.swatchSmall} ${c === event.color ? styles.swatchActive : ""}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => {
                upsertEvent({ ...event, color: c });
                closeMenu();
              }}
            />
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
