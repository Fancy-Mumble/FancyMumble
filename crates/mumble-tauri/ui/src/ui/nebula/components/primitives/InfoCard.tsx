/**
 * The blocks an information sheet is built from.
 *
 * The mock draws the User information sheet and the Channel information sheet
 * with one vocabulary: a raised card under a tracked-out title, rows of
 * label-and-value inside it, and a smaller caption for the groups a card
 * subdivides into. These lived privately in `UserInfoSheet` until the channel
 * sheet needed the same three, and two copies of a card is exactly how the two
 * sheets start drifting a pixel apart.
 */

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { NEBULA_MONO, radius } from "../../tokens";
import { SectionLabel } from "./SectionLabel";
import { Stack } from "./Stack";

/** One of a sheet's blocks: a raised card with a tracked-out title. */
export function InfoCard({
  title,
  chip,
  children,
}: Readonly<{ title: string; chip?: ReactNode; children: ReactNode }>) {
  return (
    <Box
      sx={(theme) => ({
        p: "14px 16px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Stack direction="row" alignItems="center" gap={1.25} sx={{ mb: "10px" }}>
        <SectionLabel sx={{ fontSize: 10.5, letterSpacing: ".1em", fontWeight: 600, lineHeight: 1.4 }}>
          {title}
        </SectionLabel>
        {chip}
      </Stack>
      {children}
    </Box>
  );
}

/** The smaller caption a card's own groups are headed with. */
export function InfoCaps({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Typography
      component="span"
      sx={(theme) => ({
        fontSize: 10,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        fontWeight: 600,
        color: theme.palette.nebula.dim,
      })}
    >
      {children}
    </Typography>
  );
}

/** A label on the left, its value on the right, as every row on the mock. */
export function InfoFact({
  label,
  value,
  mono,
  tone,
}: Readonly<{
  label: string;
  value: string | number;
  mono?: boolean;
  tone?: "ok" | "warn";
}>) {
  return (
    <Stack direction="row" alignItems="baseline" gap={2} sx={{ py: "3px" }}>
      <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted, flex: "none" })}>
        {label}
      </Typography>
      <Typography
        sx={(theme) => ({
          ml: "auto",
          textAlign: "right",
          fontSize: mono ? 11.5 : 12,
          fontWeight: 500,
          fontFamily: mono ? NEBULA_MONO : "inherit",
          wordBreak: "break-all",
          color: tone ? theme.palette.nebula[tone] : theme.palette.nebula.text,
        })}
      >
        {String(value)}
      </Typography>
    </Stack>
  );
}
