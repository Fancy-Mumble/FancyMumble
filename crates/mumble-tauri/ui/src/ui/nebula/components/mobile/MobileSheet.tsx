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
import { floatingSurface } from "../../theme";
import { SAFE_AREA, radius } from "../../tokens";

/** How long the sheet takes to come up, and to go back down. */
const ENTER_MS = 220;
const EXIT_MS = 170;
const EASE = "cubic-bezier(.2,.8,.2,1)";
/** A pull released past this, or flicked, puts the sheet away. */
const DISMISS_PX = 90;
const DISMISS_PX_PER_MS = 0.45;

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
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

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
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!present || !sheet) return;
    let drag: {
      y: number;
      x: number;
      live: boolean;
      off: boolean;
      v: number;
      lastY: number;
      lastT: number;
    } | null = null;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      drag = {
        y: touch.clientY,
        x: touch.clientX,
        live: false,
        off: false,
        v: 0,
        lastY: touch.clientY,
        lastT: event.timeStamp,
      };
    };
    const move = (event: TouchEvent) => {
      if (!drag || drag.off) return;
      const touch = event.touches[0];
      const dy = touch.clientY - drag.y;
      if (!drag.live) {
        if (Math.abs(dy) < 8 && Math.abs(touch.clientX - drag.x) < 8) return;
        const scroller = scrollRef.current;
        const inList = scroller?.contains(event.target as Node) ?? false;
        const atTop = !scroller || scroller.scrollTop <= 0;
        if (dy <= 0 || Math.abs(touch.clientX - drag.x) > dy || (inList && !atTop)) {
          drag.off = true;
          return;
        }
        drag.live = true;
        drag.y = touch.clientY;
      }
      if (event.cancelable) event.preventDefault();
      const pulled = Math.max(0, touch.clientY - drag.y);
      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) drag.v = (touch.clientY - drag.lastY) / dt;
      drag.lastY = touch.clientY;
      drag.lastT = event.timeStamp;
      sheet.style.transition = "none";
      sheet.style.transform = `translate3d(0,${pulled}px,0)`;
    };
    const end = (event: TouchEvent) => {
      const current = drag;
      drag = null;
      if (!current?.live) return;
      const pulled = (event.changedTouches[0]?.clientY ?? current.y) - current.y;
      if (pulled > DISMISS_PX || current.v > DISMISS_PX_PER_MS) {
        closeRef.current();
        return;
      }
      sheet.style.transition = `transform ${ENTER_MS}ms ${EASE}`;
      sheet.style.transform = "translate3d(0,0,0)";
    };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
    return () => {
      sheet.removeEventListener("touchstart", start);
      sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
    };
  }, [present]);

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
        ref={sheetRef}
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
