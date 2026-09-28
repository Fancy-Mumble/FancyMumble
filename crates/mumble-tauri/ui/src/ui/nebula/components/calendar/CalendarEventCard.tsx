import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, IconButton, Popover, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { placeBesideAnchor } from "@shared/profilecard/placement";
import { useCalendarStore, type AnchorRect } from "@core/features/chat/calendar/calendarStore";
import { eventColor, formatRangeFormatted } from "@core/features/chat/calendar/calendarFormat";
import {
  EVT_MEETING_INVITE_LINK,
  requestMeetingInviteLink,
  type MeetingInviteLinkDetail,
} from "@core/features/chat/calendar/meetings";
import type { CalendarEvent, RsvpStatus } from "@core/features/chat/calendar/types";
import { useCalendarFormatPreferences } from "@core/features/chat/calendar/useCalendarFormatPreferences";
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  EditIcon,
  KebabMenuIcon,
  MapPinIcon,
  RepeatIcon,
  TrashIcon,
  UsersGroupIcon,
} from "@ui/icons";
import { Stack, UserAvatar } from "../primitives";
import { PillGroup } from "../settings/controls";
import { floatingPaper } from "./calendarSurface";
import { isUnanchored, RSVP_CHOICES } from "./calendarModel";
import { joinFromCalendar } from "./useCalendarNotices";

const CARD_WIDTH = 340;
// Placement needs a height before the card has one; this is a typical card's.
const CARD_HEIGHT_GUESS = 300;
// How long a requested invite link is waited for before the button gives up.
const LINK_WAIT_MS = 10_000;

interface CalendarEventCardProps {
  /** Always centre the card - a phone has no side to put it on. */
  readonly centred?: boolean;
  /** Joining takes you to the room, so whoever opened the calendar puts it away. */
  readonly onJoined: () => void;
  readonly onDelete: (eventId: string) => void;
}

/**
 * A meeting, opened from its block: when, where, who, and what you can do.
 *
 * It sits beside the block it came from, the way the profile card sits beside a
 * row, and centres itself when it came from nowhere - a reminder, a room. An
 * invitee answers here rather than only through a right-click, which a phone
 * does not have; the kebab opens the same menu the right-click does.
 */
export function CalendarEventCard(props: Readonly<CalendarEventCardProps>) {
  const detail = useCalendarStore((s) => s.detail);
  const event = useCalendarStore((s) => (s.detail ? s.events.find((e) => e.id === s.detail?.eventId) : undefined));
  if (!detail || !event) return null;
  // Keyed, so a link-copy under way for one meeting never reports on another.
  return (
    <EventCard
      key={`${detail.eventId}:${detail.occStart}`}
      event={event}
      occStart={detail.occStart}
      rect={detail.rect}
      {...props}
    />
  );
}

interface EventCardProps extends CalendarEventCardProps {
  readonly event: CalendarEvent;
  readonly occStart: number;
  readonly rect: AnchorRect;
}

function Row({ icon, children }: Readonly<{ icon: ReactNode; children: ReactNode }>) {
  return (
    <Stack direction="row" alignItems="flex-start" gap={1.25} sx={{ fontSize: 12.5, lineHeight: 1.45 }}>
      <Box sx={(theme) => ({ display: "flex", pt: "2px", flex: "none", color: theme.palette.nebula.muted })}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{children}</Box>
    </Stack>
  );
}

function EventCard({ event, occStart, rect, centred = false, onJoined, onDelete }: EventCardProps) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const { nebula } = useTheme().palette;
  const closeDetail = useCalendarStore((s) => s.closeDetail);
  const openEditEvent = useCalendarStore((s) => s.openEditEvent);
  const openMenu = useCalendarStore((s) => s.openMenu);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);
  const users = useAppStore((s) => s.users);
  const ownUserId = useAppStore((s) => s.users.find((u) => u.session === s.ownSession)?.user_id ?? null);
  const formatPrefs = useCalendarFormatPreferences();
  const [link, setLink] = useState<"idle" | "waiting" | "copied">("idle");
  const stopWaiting = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWaiting.current?.(), []);

  const organizer = users.find((u) => u.user_id === event.organizerId);
  const isOrganizer = ownUserId !== null && ownUserId === event.organizerId;
  const statusColor: Record<RsvpStatus, string> = {
    accepted: nebula.ok,
    tentative: nebula.warn,
    declined: nebula.bad,
    invited: nebula.dim,
  };

  const place = centred || isUnanchored(rect)
    ? null
    : placeBesideAnchor(
        rect,
        { width: CARD_WIDTH, height: CARD_HEIGHT_GUESS },
        { width: window.innerWidth, height: window.innerHeight },
        { gap: 8 },
      );

  const join = () => {
    joinFromCalendar(event.id);
    closeDetail();
    onJoined();
  };

  // The server mints the link and sends it back over the plugin channel; it is
  // copied when it arrives, and the button says so.
  const copyLink = () => {
    const eventId = event.id;
    const onLink = (e: Event) => {
      const arrived = (e as CustomEvent<MeetingInviteLinkDetail>).detail;
      if (arrived?.eventId !== eventId || !arrived.url) return;
      stopWaiting.current?.();
      void navigator.clipboard
        ?.writeText(arrived.url)
        .then(() => setLink("copied"))
        .catch(() => setLink("idle"));
    };
    stopWaiting.current?.();
    const timer = setTimeout(() => {
      stopWaiting.current?.();
      setLink((state) => (state === "waiting" ? "idle" : state));
    }, LINK_WAIT_MS);
    stopWaiting.current = () => {
      clearTimeout(timer);
      globalThis.removeEventListener(EVT_MEETING_INVITE_LINK, onLink);
      stopWaiting.current = null;
    };
    globalThis.addEventListener(EVT_MEETING_INVITE_LINK, onLink);
    setLink("waiting");
    requestMeetingInviteLink(eventId);
  };

  const description = event.description ? sanitizeHtml(event.description) : "";
  const line = `var(--nebula-line-width, 1px) solid ${nebula.line}`;

  return (
    <Popover
      open
      onClose={closeDetail}
      anchorReference="anchorPosition"
      anchorPosition={
        place ? { top: place.top, left: place.left } : { top: window.innerHeight / 2, left: window.innerWidth / 2 }
      }
      transformOrigin={place ? { vertical: "top", horizontal: "left" } : { vertical: "center", horizontal: "center" }}
      slotProps={{
        paper: {
          sx: (theme) => ({
            ...floatingPaper(theme),
            width: CARD_WIDTH,
            maxWidth: "calc(100vw - 24px)",
            overflow: "hidden",
          }),
        },
      }}
    >
      <Stack data-testid={TID.calendarDetailCard}>
        <Box sx={{ height: 5, flex: "none", background: eventColor(event) }} />
        <Stack direction="row" alignItems="flex-start" gap={0.25} sx={{ p: "12px 8px 4px 16px" }}>
          <Typography sx={{ flex: 1, minWidth: 0, pt: "3px", fontSize: 15, fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" }}>
            {event.title || t("chat:calendar.untitled")}
          </Typography>
          <Tooltip title={t("common:actions.more")}>
            <IconButton
              size="small"
              aria-label={t("common:actions.more")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openMenu(event.id, r.left, r.bottom + 4);
              }}
            >
              <KebabMenuIcon width={13} height={13} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" aria-label={t("common:actions.close")} onClick={closeDetail}>
            <CloseIcon width={13} height={13} />
          </IconButton>
        </Stack>

        <Stack gap={1} sx={{ px: "16px", pt: "4px", pb: "14px" }}>
          <Row icon={<ClockIcon width={13} height={13} />}>
            {formatRangeFormatted(
              occStart,
              occStart + (event.end - event.start),
              event.allDay,
              formatPrefs.timeFormat,
              formatPrefs.dateFormat,
            )}
          </Row>
          {event.repeat.freq !== "none" && (
            <Row icon={<RepeatIcon width={13} height={13} />}>{t(`chat:calendar.repeat.${event.repeat.freq}`)}</Row>
          )}
          {event.location && <Row icon={<MapPinIcon width={13} height={13} />}>{event.location}</Row>}
          <Row icon={<UsersGroupIcon width={13} height={13} />}>
            <Stack direction="row" alignItems="center" gap={0.75}>
              <UserAvatar
                name={event.organizerName || "?"}
                session={organizer?.session}
                textureSize={organizer?.texture_size}
                size={20}
              />
              <Box component="span" sx={{ minWidth: 0 }}>
                {event.organizerName}
              </Box>
              <Box component="span" sx={{ fontSize: 11.5, color: nebula.dim }}>
                {t("chat:calendar.organizer")}
              </Box>
            </Stack>
            {event.participants.length > 0 && (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: "4px", mt: "6px" }}>
                {event.participants.map((p) => (
                  <Box
                    key={p.userId}
                    title={t(`nebulaChat:calendar.status.${p.status}`)}
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      px: "7px",
                      py: "1px",
                      borderRadius: "999px",
                      fontSize: 11.5,
                      background: nebula.card,
                      border: line,
                    }}
                  >
                    <Box
                      component="span"
                      aria-label={t(`nebulaChat:calendar.status.${p.status}`)}
                      sx={{ width: 6, height: 6, borderRadius: "50%", background: statusColor[p.status] }}
                    />
                    {p.name}
                  </Box>
                ))}
              </Box>
            )}
          </Row>
          {description && (
            <Box
              sx={{
                maxHeight: 140,
                overflowY: "auto",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: nebula.muted,
                overflowWrap: "anywhere",
                "& p": { m: 0 },
                "& ul, & ol": { my: "4px", pl: "18px" },
                "& a": { color: nebula.accent },
              }}
              dangerouslySetInnerHTML={{ __html: description }}
            />
          )}
          {!isOrganizer && (
            <Box sx={{ pt: "4px" }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: nebula.muted, mb: "6px" }}>
                {t("chat:calendar.response.title")}
              </Typography>
              <PillGroup
                options={RSVP_CHOICES.map((choice) => ({
                  id: choice.status,
                  label: t(`chat:calendar.response.${choice.key}`),
                }))}
                value={event.myStatus ?? "invited"}
                onChange={(status) => upsertEvent({ ...event, myStatus: status })}
                ariaLabel={t("chat:calendar.response.title")}
              />
            </Box>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" gap={0.75} sx={{ px: "12px", py: "10px", borderTop: line }}>
          <Button variant="contained" size="small" data-testid={TID.calendarJoinMeeting} onClick={join}>
            {t("nebulaChat:calendar.join")}
          </Button>
          {isOrganizer && (
            <Button
              size="small"
              data-testid={TID.calendarCopyInviteLink}
              disabled={link === "waiting"}
              startIcon={
                link === "copied" ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />
              }
              onClick={copyLink}
            >
              {link === "copied" ? t("nebulaChat:calendar.linkCopied") : t("nebulaChat:calendar.copyLink")}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t("chat:calendar.edit")}>
            <IconButton
              size="small"
              aria-label={t("chat:calendar.edit")}
              onClick={() => {
                openEditEvent(event.id);
                closeDetail();
              }}
            >
              <EditIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("chat:calendar.delete")}>
            <IconButton size="small" aria-label={t("chat:calendar.delete")} onClick={() => onDelete(event.id)}>
              <TrashIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
    </Popover>
  );
}
