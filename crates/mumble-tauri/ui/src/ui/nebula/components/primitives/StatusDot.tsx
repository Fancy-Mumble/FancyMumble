import { Box } from "@mui/material";

export type Status = "online" | "idle" | "offline" | "muted";

const TONE: Record<Status, (palette: { ok: string; warn: string; dim: string; bad: string }) => string> = {
  online: (p) => p.ok,
  idle: (p) => p.warn,
  offline: (p) => p.dim,
  muted: (p) => p.bad,
};

/** Presence pip. Sized to sit inline with 10-13px text, as in the mock. */
export function StatusDot({ status = "online", size = 6 }: { status?: Status; size?: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        background: TONE[status](theme.palette.nebula),
      })}
    />
  );
}
