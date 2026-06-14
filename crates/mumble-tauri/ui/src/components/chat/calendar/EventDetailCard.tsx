import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { SafeHtml } from "../../elements/SafeHtml";
import {
  CloseIcon,
  ClockIcon,
  EditIcon,
  MapPinIcon,
  RepeatIcon,
  TrashIcon,
  UsersGroupIcon,
} from "../../../icons";
import { useCalendarStore } from "./calendarStore";
import { useAppStore } from "../../../store";
import { getCachedUserAvatar } from "../../../lazyBlobs";
import { colorFor } from "../../../utils/format";
import { eventColor, formatRange } from "./calendarFormat";
import styles from "./CalendarPanel.module.css";

const CARD_W = 320;

/** Side card shown when an event is clicked: info + Edit/Delete. */
export default function EventDetailCard() {
  const { t } = useTranslation("chat");
  const detail = useCalendarStore((s) => s.detail);
  const event = useCalendarStore((s) =>
    detail ? s.events.find((e) => e.id === detail.eventId) : undefined,
  );
  const closeDetail = useCalendarStore((s) => s.closeDetail);
  const openEditEvent = useCalendarStore((s) => s.openEditEvent);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);
  const users = useAppStore((s) => s.users);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDetail]);

  if (!detail || !event) return null;

  const duration = event.end - event.start;
  const occStart = detail.occStart;
  const occEnd = occStart + duration;

  const organizer = users.find((u) => u.user_id === event.organizerId);
  const organizerAvatar = organizer
    ? getCachedUserAvatar(organizer.session, organizer.texture_size)
    : null;

  // Prefer placing the card to the right of the clicked event; flip left if it
  // would overflow, then clamp vertically to the viewport.
  const spaceRight = window.innerWidth - detail.rect.right;
  const left =
    spaceRight >= CARD_W + 16 ? detail.rect.right + 8 : Math.max(8, detail.rect.left - CARD_W - 8);
  const top = Math.min(detail.rect.top, window.innerHeight - 280);

  return createPortal(
    <>
      <div className={styles.detailBackdrop} onClick={closeDetail} />
      <div className={styles.detailCard} style={{ left, top: Math.max(8, top), width: CARD_W }}>
        <div className={styles.detailHeader}>
          <span className={styles.detailColorDot} style={{ background: eventColor(event) }} />
          <span className={styles.detailTitle}>{event.title || t("calendar.untitled")}</span>
          <button
            type="button"
            className={styles.iconBtnSmall}
            onClick={closeDetail}
            aria-label={t("calendar.cancel")}
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>

        <div className={styles.detailOrganizer}>
          {organizerAvatar ? (
            <img className={styles.detailAvatar} src={organizerAvatar} alt="" />
          ) : (
            <div
              className={styles.detailAvatarFallback}
              style={{ background: colorFor(event.organizerName) }}
            >
              {(event.organizerName || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className={styles.detailOrganizerText}>
            <span className={styles.detailOrganizerName}>{event.organizerName}</span>
            <span className={styles.detailOrganizerRole}>{t("calendar.organizer")}</span>
          </div>
        </div>

        <div className={styles.detailRow}>
          <ClockIcon width={14} height={14} />
          <span>{formatRange(occStart, occEnd, event.allDay)}</span>
        </div>

        {event.repeat.freq !== "none" && (
          <div className={styles.detailRow}>
            <RepeatIcon width={14} height={14} />
            <span>{t(`calendar.repeat.${event.repeat.freq}`)}</span>
          </div>
        )}

        {event.location && (
          <div className={styles.detailRow}>
            <MapPinIcon width={14} height={14} />
            <span>{event.location}</span>
          </div>
        )}

        {event.participants.length > 0 && (
          <div className={styles.detailRow}>
            <UsersGroupIcon width={14} height={14} />
            <span>{event.participants.map((p) => p.name).join(", ")}</span>
          </div>
        )}

        {event.description && (
          <div className={styles.detailDescription}>
            <SafeHtml html={event.description} />
          </div>
        )}

        <div className={styles.detailFooter}>
          <button
            type="button"
            className={styles.detailDeleteBtn}
            onClick={() => {
              deleteEvent(event.id);
              closeDetail();
            }}
          >
            <TrashIcon width={14} height={14} />
            {t("calendar.delete")}
          </button>
          <button
            type="button"
            className={styles.detailEditBtn}
            onClick={() => {
              openEditEvent(event.id);
              closeDetail();
            }}
          >
            <EditIcon width={14} height={14} />
            {t("calendar.edit")}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
