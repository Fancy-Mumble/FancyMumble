import { Box, type BoxProps } from "@mui/material";
import { radius } from "../../tokens";

type Tone = "neutral" | "dim" | "ok" | "accent" | "warn" | "bad";

/**
 * The small pill the mock uses for facts: latency, "3/101 online", codec.
 * `Chip` is heavier than this needs to be - these carry no interaction.
 */
export function StatChip({ tone = "neutral", children, sx, ...props }: BoxProps & { tone?: Tone }) {
  return (
    <Box
      component="span"
      {...props}
      sx={[
        (theme) => {
          const { nebula } = theme.palette;
          const tones = {
            neutral: { color: nebula.muted, background: nebula.card2, border: "transparent" },
            dim: { color: nebula.dim, background: nebula.card2, border: "transparent" },
            ok: { color: nebula.ok, background: `${nebula.ok}24`, border: `${nebula.ok}55` },
            accent: { color: nebula.accent, background: nebula.accentSoft, border: nebula.accentLine },
            warn: { color: nebula.warn, background: `${nebula.warn}24`, border: `${nebula.warn}55` },
            bad: { color: nebula.bad, background: `${nebula.bad}24`, border: `${nebula.bad}55` },
          }[tone];
          return {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            px: "11px",
            py: "4px",
            borderRadius: radius("lg"),
            fontSize: 11,
            fontWeight: 500,
            color: tones.color,
            background: tones.background,
            border: `1px solid ${tones.border}`,
          };
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}
