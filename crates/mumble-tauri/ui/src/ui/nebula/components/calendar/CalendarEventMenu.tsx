import { useTranslation } from "react-i18next";
import { Box, Divider, ListSubheader, Menu, MenuItem } from "@mui/material";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { CALENDAR_COLORS, SHOW_AS_OPTIONS } from "@core/features/chat/calendar/types";
import { CheckIcon, EditIcon, TrashIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { contextMenuRootSlot, CONTEXT_MENU_PROPS } from "../contextMenuRoot";
import { RSVP_CHOICES } from "./calendarModel";

const ITEM = { fontSize: 12.5, gap: "8px", minHeight: 30 } as const;
const HEADING = { fontSize: 10.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", lineHeight: "26px" } as const;

/** A check that holds its column whether or not it is showing. */
function Tick({ on }: Readonly<{ on: boolean }>) {
  return (
    <Box component="span" sx={{ width: 13, display: "inline-flex" }}>
      {on && <CheckIcon width={13} height={13} />}
    </Box>
  );
}

/**
 * Right-clicking a meeting: your answer, how it shows on your free/busy, and
 * its colour - the personal things, which Standard keeps in the same menu.
 *
 * Delete is handed up rather than done here, because it asks first and the
 * question has to outlive the menu that raised it.
 */
export function CalendarEventMenu({ onDelete }: Readonly<{ onDelete: (eventId: string) => void }>) {
  const { t } = useTranslation(["chat"]);
  const menu = useCalendarStore((s) => s.menu);
  const event = useCalendarStore((s) => (s.menu ? s.events.find((e) => e.id === s.menu?.eventId) : undefined));
  const closeMenu = useCalendarStore((s) => s.closeMenu);
  const upsertEvent = useCalendarStore((s) => s.upsertEvent);
  const openEditEvent = useCalendarStore((s) => s.openEditEvent);

  if (!menu || !event) return null;
  const showAs = event.showAs ?? "busy";
  const act = (action: () => void) => () => {
    closeMenu();
    action();
  };

  // Menu wants its entries as direct children, not fragments, or keyboard
  // focus skips whole sections.
  return (
    <Menu
      open
      onClose={closeMenu}
      {...CONTEXT_MENU_PROPS}
      anchorReference="anchorPosition"
      anchorPosition={{ top: menu.y, left: menu.x }}
      slotProps={{ root: contextMenuRootSlot(closeMenu), list: { dense: true }, paper: { sx: { minWidth: 220 } } }}
    >
      <ListSubheader sx={HEADING}>{t("chat:calendar.response.title")}</ListSubheader>
      {RSVP_CHOICES.map((choice) => (
        <MenuItem
          key={choice.status}
          sx={ITEM}
          role="menuitemradio"
          aria-checked={event.myStatus === choice.status}
          onClick={act(() => upsertEvent({ ...event, myStatus: choice.status }))}
        >
          <Tick on={event.myStatus === choice.status} />
          {t(`chat:calendar.response.${choice.key}`)}
        </MenuItem>
      ))}
      <MenuItem sx={ITEM} onClick={act(() => openEditEvent(event.id))}>
        <Tick on={false} />
        {t("chat:calendar.response.proposeNewTime")}
      </MenuItem>
      <Divider />
      <ListSubheader sx={HEADING}>{t("chat:calendar.showAs.title")}</ListSubheader>
      {SHOW_AS_OPTIONS.map((option) => (
        <MenuItem
          key={option}
          sx={ITEM}
          role="menuitemradio"
          aria-checked={showAs === option}
          onClick={act(() => upsertEvent({ ...event, showAs: option }))}
        >
          <Tick on={showAs === option} />
          {t(`chat:calendar.showAs.${option}`)}
        </MenuItem>
      ))}
      <Divider />
      <MenuItem sx={ITEM} onClick={act(() => openEditEvent(event.id))}>
        <EditIcon width={13} height={13} />
        {t("chat:calendar.edit")}
      </MenuItem>
      <MenuItem
        sx={(theme) => ({ ...ITEM, color: theme.palette.nebula.bad })}
        onClick={act(() => onDelete(event.id))}
      >
        <TrashIcon width={13} height={13} />
        {t("chat:calendar.delete")}
      </MenuItem>
      <Divider />
      <ListSubheader sx={HEADING}>{t("chat:calendar.recolor")}</ListSubheader>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px", px: "16px", pb: "8px", pt: "2px" }}>
        {CALENDAR_COLORS.map((color) => (
          <Box
            key={color}
            component="button"
            type="button"
            aria-label={color}
            aria-pressed={color === event.color}
            onClick={act(() => upsertEvent({ ...event, color }))}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              width: 18,
              height: 18,
              borderRadius: radius("sm"),
              background: color,
              boxShadow:
                color === event.color
                  ? `0 0 0 2px ${theme.palette.nebula.card}, 0 0 0 4px ${theme.palette.nebula.text}`
                  : "none",
              "&:focus-visible": { outline: `2px solid ${theme.palette.nebula.accent}`, outlineOffset: 2 },
            })}
          />
        ))}
      </Box>
    </Menu>
  );
}
