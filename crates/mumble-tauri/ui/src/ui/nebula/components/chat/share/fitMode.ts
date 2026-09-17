/**
 * How the picture is scaled into the well.
 *
 * `actual` is the one that changes the layout rather than just the element: at
 * 1:1 the well scrolls, because that is the whole point of asking for the
 * broadcaster's real pixels on a screen smaller than theirs.
 *
 * It lives apart from the stage because the stage's toolbar and its menu both
 * offer the choice, and the menu is a component of its own.
 */
import type { MediaFit } from "@standard/components/chat/drawing/DrawingOverlay";

export type FitMode = "fit" | "fill" | "actual";

/** The modes the pill offers, in the order it draws them. */
export const FIT_MODES = ["fit", "fill", "actual"] as const satisfies readonly FitMode[];

/** How each fit mode is named. `1:1` is a ratio, so it is not translated. */
export const FIT_LABEL_KEYS = {
  fit: "share.fit",
  fill: "share.fill",
} as const satisfies Record<Exclude<FitMode, "actual">, string>;

/** How each fit mode lays the source out inside the media element's box -
 *  what the annotation canvas has to know to put a stroke where the pointer
 *  was. See `DrawingOverlay`'s `mediaContentRect`. */
export const ANNOTATION_FIT = {
  fit: "contain",
  fill: "cover",
  actual: "none",
} as const satisfies Record<FitMode, MediaFit>;

/** The mock's three scaling modes, as the style the media element wears. */
export const MEDIA_STYLE: Record<FitMode, React.CSSProperties> = {
  fit: {
    display: "block",
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  },
  fill: {
    display: "block",
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "cover",
  },
  // Intrinsic size, scrolled by the well: `auto` resolves to the video's or the
  // canvas's own pixel dimensions, which is what "1:1" means.
  actual: {
    display: "block",
    width: "auto",
    height: "auto",
    objectFit: "none",
    margin: "auto",
    flex: "none",
  },
};
