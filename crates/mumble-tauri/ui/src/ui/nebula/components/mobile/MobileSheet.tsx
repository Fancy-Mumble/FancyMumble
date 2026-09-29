/**
 * The one way a panel arrives on a phone.
 *
 * On a window the roster, the channel's details and the server's details are
 * *columns*: siblings of the conversation that squeeze it. There is nothing to
 * squeeze at 390px, so the same panels come up from the bottom instead - and
 * they come up through one host rather than each growing a phone mode of its
 * own, which is how three panels end up with three different top corners.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, IconButton, Typography } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { CloseIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { SHEET_EASE, SHEET_ENTER_MS, usePullToDismiss } from "../primitives/usePullToDismiss";
import { floatingSurface } from "../../theme";
import { SAFE_AREA, radius } from "../../tokens";

/** How long the sheet takes to come up, and to go back down. */
const ENTER_MS = SHEET_ENTER_MS;
const EXIT_MS = 170;
const EASE = SHEET_EASE;

const rise = keyframes`from { transform: translate3d(0,100%,0); } to { transform: none; }`;
const fade = keyframes`from { opacity: 0; } to { opacity: 1; }`;

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
  // Still drawn for the length of the way down after `open` goes false.
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Also as state, for the pull: the ref is still empty in the effect of the
  // render that first draws the sheet.
  const [sheetEl, setSheetEl] = useState<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open || !present) return;
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    if (sheet) {
      sheet.style.transition = `transform ${EXIT_MS}ms ${EASE}`;
      sheet.style.transform = "translate3d(0,100%,0)";
    }
    if (backdrop) {
      backdrop.style.transition = `opacity ${EXIT_MS}ms linear`;
      backdrop.style.opacity = "0";
    }
    const timer = setTimeout(() => setPresent(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, present]);

  // Pull it down to put it away: from the header anywhere, and from the list
  // once the list is at its top - past that, the pull is a scroll.
  usePullToDismiss(present ? sheetEl : null, () => scrollRef.current, onClose);

  if (!present) return null;
  return (
    <>
      {/* The conversation stays visible behind it - a sheet is a thing you
          pull up over what you were reading, not a page you left for. */}
      <Box
        ref={backdropRef}
        aria-hidden
        onClick={onClose}
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 40,
          background: "rgba(0,0,0,.42)",
          animation: `${fade} ${ENTER_MS}ms linear`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
      <Stack
        ref={(el: HTMLDivElement | null) => {
          sheetRef.current = el;
          setSheetEl(el);
        }}
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
          animation: `${rise} ${ENTER_MS}ms ${EASE}`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
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
          <IconButton
            aria-label={t("actions.close")}
            onClick={onClose}
            sx={{ flex: "none", width: 40, height: 40 }}
          >
            <CloseIcon width={18} height={18} />
          </IconButton>
        </Stack>
        <Box
          ref={scrollRef}
          sx={{
            flex: 1,
            minHeight: 0,
            overscrollBehaviorY: "contain",
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
            pb: SAFE_AREA.bottom,
          }}
        >
          {children}
        </Box>
      </Stack>
    </>
  );
}
