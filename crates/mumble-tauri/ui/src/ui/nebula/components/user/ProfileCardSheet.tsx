import { useCallback, useRef, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { SAFE_AREA } from "../../tokens";
import { SHEET_EASE, SHEET_ENTER_MS, usePullToDismiss } from "../primitives/usePullToDismiss";

const EXIT_MS = 170;
const rise = keyframes`from { transform: translate3d(0,100%,0); } to { transform: none; }`;
const fade = keyframes`from { opacity: 0; } to { opacity: 1; }`;

/**
 * The profile card on a phone: up from the bottom, the full width of the
 * screen, and pulled back down to put it away - the way every other sheet on
 * a phone behaves. On a window the card floats beside the row it came from;
 * at 390px there is no "beside", and a card floating over the middle of the
 * roster looks lost.
 *
 * `children` gets the dismiss to hand its own close button, so every way out
 * - the button, the backdrop, the pull - slides the sheet down first rather
 * than letting it vanish mid-screen.
 */
export function ProfileCardSheet({
  onClose,
  children,
}: Readonly<{ onClose: () => void; children: (dismiss: () => void) => ReactNode }>) {
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);

  const dismiss = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (sheet) {
      sheet.style.transition = `transform ${EXIT_MS}ms ${SHEET_EASE}`;
      sheet.style.transform = "translate3d(0,100%,0)";
    }
    if (backdrop.current) {
      backdrop.current.style.transition = `opacity ${EXIT_MS}ms linear`;
      backdrop.current.style.opacity = "0";
    }
    setTimeout(onClose, EXIT_MS);
  }, [sheet, onClose]);

  // The card's own list scrolls; a pull that starts inside it only closes the
  // sheet once the list is back at its top.
  usePullToDismiss(sheet, () => sheet?.querySelector<HTMLElement>(".fpc-scroll") ?? null, dismiss);

  return (
    <>
      <Box
        ref={backdrop}
        aria-hidden
        onClick={dismiss}
        sx={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          background: "rgba(0,0,0,.42)",
          animation: `${fade} ${SHEET_ENTER_MS}ms linear`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
      <Box
        ref={setSheet}
        data-testid="nebula-profile-sheet"
        sx={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 41,
          maxHeight: "92%",
          display: "flex",
          flexDirection: "column",
          animation: `${rise} ${SHEET_ENTER_MS}ms ${SHEET_EASE}`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        {/* The grab handle every sheet on a phone has. */}
        <Box
          aria-hidden
          sx={(theme) => ({
            position: "absolute",
            top: 7,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1,
            width: 34,
            height: 4,
            borderRadius: "var(--nebula-radius-pill, 999px)",
            background: theme.palette.nebula.line2,
          })}
        />
        {children(dismiss)}
      </Box>
    </>
  );
}

/** How the shared card is dressed inside the sheet: edge to edge, flat at the bottom. */
export const PROFILE_SHEET_CARD_STYLE = {
  position: "relative" as const,
  width: "100%",
  maxHeight: "100%",
  borderRadius: "22px 22px 0 0",
  borderBottom: "none",
  paddingBottom: SAFE_AREA.bottom,
};
