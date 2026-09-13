import { useTranslation } from "react-i18next";
import { Box, Popover, Switch, TextField, Typography } from "@mui/material";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { weekdayShortNames } from "@core/features/chat/calendar/calendarFormat";
import { radius } from "../../tokens";
import { Stack } from "../primitives";
import { floatingPaper } from "./calendarSurface";

const toHHmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map((part) => Number.parseInt(part, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Your working hours, which the time grid shades. Kept on this machine, as
 *  Standard keeps them, so the two packs shade the same band. */
export function WorkHoursPopover({ anchorEl, onClose }: Readonly<{ anchorEl: HTMLElement; onClose: () => void }>) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
  const workHours = useCalendarStore((s) => s.workHours);
  const setWorkHours = useCalendarStore((s) => s.setWorkHours);
  const dayNames = weekdayShortNames();

  const toggleDay = (index: number) => {
    const days = workHours.days.slice();
    days[index] = !days[index];
    setWorkHours({ days });
  };

  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{ paper: { sx: (theme) => ({ ...floatingPaper(theme), width: 290, p: "14px", mt: "6px" }) } }}
    >
      <Stack gap={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{t("chat:calendar.workHours.enable")}</Typography>
          <Switch
            size="small"
            checked={workHours.enabled}
            onChange={() => setWorkHours({ enabled: !workHours.enabled })}
            slotProps={{ input: { "aria-label": t("chat:calendar.workHours.enable") } }}
          />
        </Stack>
        <Stack direction="row" gap={1}>
          <TextField
            size="small"
            type="time"
            label={t("chat:calendar.workHours.from")}
            value={toHHmm(workHours.startMinutes)}
            disabled={!workHours.enabled}
            onChange={(e) => setWorkHours({ startMinutes: toMinutes(e.target.value) })}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            type="time"
            label={t("chat:calendar.workHours.to")}
            value={toHHmm(workHours.endMinutes)}
            disabled={!workHours.enabled}
            onChange={(e) => setWorkHours({ endMinutes: toMinutes(e.target.value) })}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: 1 }}
          />
        </Stack>
        <Box
          role="group"
          aria-label={t("nebulaChat:calendar.workDays")}
          sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px" }}
        >
          {dayNames.map((name, index) => {
            const on = workHours.days[index];
            return (
              <Box
                key={name}
                component="button"
                type="button"
                aria-pressed={on}
                disabled={!workHours.enabled}
                onClick={() => toggleDay(index)}
                sx={(theme) => ({
                  all: "unset",
                  cursor: "pointer",
                  textAlign: "center",
                  py: "5px",
                  borderRadius: radius("sm"),
                  fontSize: 11,
                  fontWeight: on ? 600 : 400,
                  color: on ? theme.palette.nebula.text : theme.palette.nebula.muted,
                  background: on ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
                  border: `var(--nebula-line-width, 1px) solid ${on ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
                  "&:disabled": { opacity: 0.5, cursor: "default" },
                  "&:focus-visible": { outline: `2px solid ${theme.palette.nebula.accent}` },
                })}
              >
                {name}
              </Box>
            );
          })}
        </Box>
      </Stack>
    </Popover>
  );
}
