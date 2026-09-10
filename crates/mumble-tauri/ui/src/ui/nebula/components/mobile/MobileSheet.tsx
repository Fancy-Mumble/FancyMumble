/**
 * The one way a panel arrives on a phone.
 *
 * On a window the roster, the channel's details and the server's details are
 * *columns*: siblings of the conversation that squeeze it. There is nothing to
 * squeeze at 390px, so the same panels come up from the bottom instead - and
 * they come up through one host rather than each growing a phone mode of its
 * own, which is how three panels end up with three different top corners.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, IconButton, Typography } from "@mui/material";
import { CloseIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { floatingSurface } from "../../theme";
import { radius } from "../../tokens";

interface MobileSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * How much of the screen it takes. A roster is a list you scroll, so it
   * takes nearly all of it; a short panel would leave a sheet of empty ground
   * under its last row.
   */
  height?: "full" | "half";
  testId?: string;
}

export function MobileSheet({
  open,
  title,
  onClose,
  children,
  height = "full",
  testId = "nebula-mobile-sheet",
}: Readonly<MobileSheetProps>) {
  const { t } = useTranslation("common");
  if (!open) return null;
  return (
    <>
      {/* The conversation stays visible behind it - a sheet is a thing you
          pull up over what you were reading, not a page you left for. */}
      <Box
        aria-hidden
        onClick={onClose}
        sx={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(0,0,0,.42)" }}
      />
      <Stack
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        sx={(theme) => ({
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 41,
          maxHeight: height === "full" ? "92%" : "58%",
          minHeight: 0,
          // Only the top corners: the other two are off the bottom of the
          // screen, and rounding them leaves two notches of window under it.
          borderRadius: `${radius("xl")} ${radius("xl")} 0 0`,
          clipPath: "var(--nebula-clip-window, none)",
          overflow: "hidden",
          ...floatingSurface(theme),
        })}
      >
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={(theme) => ({
            flex: "none",
            px: "14px",
            height: 52,
            borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
          })}
        >
          {/* The grab handle every sheet on a phone has, which is what says
              this can be pushed back down. */}
          <Box
            aria-hidden
            sx={(theme) => ({
              position: "absolute",
              top: 7,
              left: "50%",
              transform: "translateX(-50%)",
              width: 34,
              height: 4,
              borderRadius: "var(--nebula-radius-pill, 999px)",
              background: theme.palette.nebula.line2,
            })}
          />
          <Typography component="div" noWrap sx={{ fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
          <IconButton aria-label={t("actions.close")} onClick={onClose} sx={{ flex: "none" }}>
            <CloseIcon width={15} height={15} />
          </IconButton>
        </Stack>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
            pb: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {children}
        </Box>
      </Stack>
    </>
  );
}
