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

/**
 * The shadow the identity row's text wears where it overlaps a sheet's banner.
 *
 * The banner is whatever the user or room picked, so no text colour reads on
 * all of them; a hard 1px drop in the window colour edges dark text in the
 * light theme and light text in the dark one alike.
 */
export function bannerTextShadow(ground: string): string {
  return `1px 1px 0 ${ground}`;
}

/**
 * Where a sheet has room to spread out. Past this window width it grows and
 * its cards flow into two columns, rather than one tall stack that scrolls.
 */
const WIDE_SHEET = "@media (min-width: 1000px)";

/** Where a card sits in the wide layout: whole, one under the next. */
const COLUMN_ITEM = { breakInside: "avoid", marginBottom: "12px" };

/** A sheet's width: the mock's 560, and 900 where the window allows. */
export const infoSheetFrame = { width: 560, maxWidth: "100%", [WIDE_SHEET]: { width: 900 } };

/** The cards: stacked, and in two balanced columns on a wide sheet. */
export const infoSheetColumns = {
  display: "grid",
  gap: "12px",
  [WIDE_SHEET]: {
    display: "block",
    columnCount: 2,
    columnGap: "12px",
    marginBottom: "-12px",
    "& > *": COLUMN_ITEM,
  },
};

/**
 * Two cards side by side. In the wide layout a half-column is too narrow for
 * them, so they join the columns as two cards of their own.
 */
export const infoSheetPair = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "12px",
  [WIDE_SHEET]: { display: "contents", "& > *": COLUMN_ITEM },
};

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
        border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
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
  tone?: "ok" | "warn" | "muted";
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
