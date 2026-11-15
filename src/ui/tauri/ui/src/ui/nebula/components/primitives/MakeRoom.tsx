import type { ReactNode } from "react";
import { Box } from "@mui/material";

/**
 * One row of a list that is being rearranged, holding its place or stepping
 * aside so the carried row can drop in between.
 *
 * The offset is drawn rather than laid out: the drag judges the pointer
 * against where the rows sat when the gesture began, so the boxes must stay
 * where they are while the picture of the list rearranges itself.
 */
export function MakeRoom({
  offset = 0,
  /**
   * True while a drag is running. Once it ends the list itself changes, and a
   * row that eased back to zero from there would slide away from the place it
   * had just landed in - so the transition goes with the gesture.
   */
  animate = false,
  children,
}: Readonly<{ offset?: number; animate?: boolean; children: ReactNode }>) {
  return (
    <Box
      sx={{
        flex: "none",
        transform: offset ? `translateY(${offset}px)` : "none",
        transition: animate ? "transform 170ms cubic-bezier(.2,0,0,1)" : "none",
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
      }}
    >
      {children}
    </Box>
  );
}
