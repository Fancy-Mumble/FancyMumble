/**
 * The bar across the top of a handheld pane.
 *
 * One component for all three artboards: the channel list leads with a
 * wordmark, the conversation leads with a way back, and the voice screen leads
 * with a way down. What changes between them is which slots are filled, not
 * the anatomy - which is the same argument `SidebarShell` makes for the
 * column it replaces here.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, IconButton, Typography } from "@mui/material";
import { ChevronLeftIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { glassChrome, handheldChrome } from "../../theme";
import { useStencil } from "./mobileMarks";

interface MobileHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  /** Before the title, after any back arrow: a wordmark, an avatar, a menu. */
  leading?: ReactNode;
  trailing?: ReactNode;
  testId?: string;
}

export function MobileHeader({
  title,
  subtitle,
  onBack,
  leading,
  trailing,
  testId = "nebula-mobile-header",
}: Readonly<MobileHeaderProps>) {
  const { t } = useTranslation("nebulaCommon");
  const stencil = useStencil();
  return (
    <Stack
      component="header"
      direction="row"
      alignItems="center"
      gap={1.25}
      data-testid={testId}
      sx={(theme) => ({
        height: handheldChrome(theme).headerHeight,
        flex: "none",
        px: "14px",
        // Chrome, not the conversation: dragging across the name to reach a
        // button should not leave the room's name highlighted.
        userSelect: "none",
        borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
        ...glassChrome(theme),
      })}
    >
      {onBack && (
        <IconButton aria-label={t("app.back")} onClick={onBack} sx={{ flex: "none", ml: "-6px" }}>
          <ChevronLeftIcon width={18} height={18} />
        </IconButton>
      )}
      {/* The artboard's leading accent bar. A skin that draws no extra marks
          leads with whatever the pane put in `leading`, or with the title. */}
      {stencil && !leading && (
        <Box
          aria-hidden
          sx={(theme) => ({
            flex: "none",
            width: 6,
            height: 34,
            transform: "skewX(-12deg)",
            background: theme.palette.nebula.accent,
          })}
        />
      )}
      {leading}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          component="div"
          noWrap
          sx={(theme) => ({
            fontSize: 16,
            fontWeight: stencil ? 900 : 700,
            color: theme.palette.nebula.text,
          })}
        >
          {title}
        </Typography>
        {subtitle && (
          <Box sx={{ mt: "1px", display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
            {subtitle}
          </Box>
        )}
      </Box>
      {trailing}
    </Stack>
  );
}
