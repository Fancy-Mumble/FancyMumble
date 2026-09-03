/**
 * The glass the stage's controls are cut from.
 *
 * The chrome over the picture is drawn in fixed dark colours in both themes.
 * Everything else in Nebula follows the user's scheme; these controls sit on an
 * arbitrary video frame, where a light panel is a bright hole in someone's
 * game. The well behind them is likewise always near-black.
 *
 * It lives apart from the stage because the annotation toolbar is drawn in the
 * same glass and mounted from inside Standard's drawing overlay - so both
 * would otherwise have to import from each other.
 */
import { Box } from "@mui/material";
import { radius } from "../../../tokens";

export const WELL_BG = "#05070c";
export const GLASS_BG = "rgba(12,16,24,.55)";
export const GLASS_BG_HOVER = "rgba(20,26,38,.8)";
export const GLASS_LINE = "1px solid rgba(255,255,255,.09)";
export const GLASS_BLUR = "blur(10px)";
export const OVERLAY_TEXT = "#cfd5e0";

/** One square icon button on that glass. */
export function OverlayButton({
  title,
  onClick,
  active = false,
  pressed,
  testId,
  children,
}: Readonly<{
  title: string;
  onClick: () => void;
  active?: boolean;
  /** Set on a button that is a toggle rather than an action, so the state
   *  the colour shows is also readable to a screen reader. */
  pressed?: boolean;
  testId?: string;
  children: React.ReactNode;
}>) {
  return (
    <Box
      component="button"
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      sx={{
        width: 26,
        height: 26,
        flex: "none",
        padding: 0,
        borderRadius: radius("md"),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        border: GLASS_LINE,
        backdropFilter: GLASS_BLUR,
        background: active ? GLASS_BG_HOVER : GLASS_BG,
        color: active ? "#fff" : OVERLAY_TEXT,
        "&:hover": { color: "#fff", background: GLASS_BG_HOVER },
      }}
    >
      {children}
    </Box>
  );
}
