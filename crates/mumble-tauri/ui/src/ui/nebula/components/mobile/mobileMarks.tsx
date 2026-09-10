/**
 * The marks the handheld layout draws, in whichever voice the skin speaks.
 *
 * The reference artboards are Nimbus: hazard stripes above the tab bar, a gold
 * bar under the open server, poster type set in condensed italic caps, every
 * plate leaning twelve degrees. None of that is Nimbus-specific *here* - each
 * one is either a token every palette names or a `chrome: "stencil"` branch,
 * which is the idiom ten components in this pack already use. A skin that does
 * not draw extra marks gets the plain half: a hairline where the stripes were,
 * no bar, upright type, an unclipped plate.
 *
 * Every mark that only one half draws stamps `data-nebula-mark`, so a test can
 * say which half a skin took without reading a colour back out of the DOM.
 */
import type { ReactNode } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { chamferedSurface } from "../../theme";
import { radius } from "../../tokens";

/** Whether this skin draws the reference's extra marks at all. */
export function useStencil(): boolean {
  return useTheme().palette.nebulaSkin.chrome === "stencil";
}

/**
 * The rule between two bands of chrome.
 *
 * A stencil skin draws the artboard's diagonal hazard tape; everything else
 * draws the hairline it draws everywhere else. Both are the same object - a
 * band that says one region has ended - so they are one component and the
 * layout above never asks which theme it is in.
 */
export function HazardRule() {
  const stencil = useStencil();
  if (!stencil)
    return (
      <Box
        data-testid="nebula-mobile-rule"
        sx={(theme) => ({
          flex: "none",
          height: "var(--nebula-line-width, 1px)",
          background: theme.palette.nebula.line,
        })}
      />
    );
  return (
    <Box
      data-nebula-mark="hazard"
      aria-hidden
      sx={(theme) => ({
        flex: "none",
        height: 8,
        // The artboard's own angle and pitch: 12px of tape, 12px of window.
        background: `repeating-linear-gradient(115deg,${theme.palette.nebula.accent2} 0 12px,transparent 12px 24px)`,
        opacity: 0.55,
      })}
    />
  );
}

/**
 * How far along a scrolling strip the reader is.
 *
 * The artboard puts it under the server row, because a row that scrolls
 * sideways with no scrollbar gives no sign there is more of it.
 */
export function ScrollProgress({ value }: Readonly<{ value: number }>) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: "absolute",
        left: 0,
        right: 10,
        bottom: 6,
        height: 3,
        background: theme.palette.nebula.railLine,
        borderRadius: radius("pill"),
      })}
    >
      <Box
        sx={(theme) => ({
          position: "absolute",
          inset: 0,
          // Never nothing: a strip that fits shows a full bar rather than an
          // empty track, which would read as "scrolled to the start of more".
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          background: theme.palette.nebula.accent2,
          borderRadius: radius("pill"),
        })}
      />
    </Box>
  );
}

export type PlateTone = "plain" | "accent" | "danger" | "quiet";

interface PlateProps {
  tone?: PlateTone;
  /**
   * Which ground the plate is standing on.
   *
   * `card` and `line2` are the window's colours, and a plate wearing them on
   * the rail is a white box on a navy screen - the voice screen and the call
   * bar are drawn on the rail, so they say so and get the rail's own.
   */
  on?: "window" | "rail";
  onClick?: () => void;
  label?: string;
  testId?: string;
  pressed?: boolean;
  children: ReactNode;
  /** Laid across a row of equal plates rather than sized by its content. */
  grow?: boolean;
  height?: number;
}

/**
 * One control, on the plate the skin cuts.
 *
 * `chamferedSurface` is what makes this work in both halves: it paints the
 * stroke as a background under an inset fill, so the edge survives a
 * `clip-path` - and where the skin cuts nothing, the same recipe is an
 * ordinary bordered box.
 */
export function PlateButton({
  tone = "plain",
  on = "window",
  onClick,
  label,
  testId,
  pressed,
  children,
  grow = false,
  height = 48,
}: Readonly<PlateProps>) {
  return (
    <Box
      component={onClick ? "button" : "div"}
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-nebula-plate=""
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      sx={(theme) => {
        const n = theme.palette.nebula;
        const rail = on === "rail";
        const quiet = rail ? n.railTile : n.card2;
        const plain = rail ? n.railTile : n.card;
        const edge = rail ? n.railLine : n.line2;
        const fill = tone === "accent" ? n.accent : tone === "danger" ? n.bad : tone === "quiet" ? quiet : plain;
        const line =
          tone === "accent" ? n.accent : tone === "danger" ? n.bad : tone === "quiet" ? edge : edge;
        // A filled accent has a token for its ink; a filled danger does not,
        // because until now nothing in the pack filled anything with `bad` -
        // it has only ever been a foreground. Derived rather than guessed at:
        // `bad` is a deep red in one skin and a hot pink in another, and white
        // is unreadable on one of those.
        const ink =
          tone === "accent"
            ? n.onAccent
            : tone === "danger"
              ? theme.palette.getContrastText(fill)
              : rail
                ? n.railText
                : n.text;
        return {
          all: "unset",
          boxSizing: "border-box",
          cursor: onClick ? "pointer" : "default",
          flex: grow ? 1 : "none",
          minWidth: grow ? 0 : height,
          height,
          display: "grid",
          placeItems: "center",
          fontSize: 15,
          color: ink,
          borderRadius: radius("md"),
          ...chamferedSurface(theme, fill, line, "var(--nebula-clip-plate, none)"),
        };
      }}
    >
      {children}
    </Box>
  );
}

/**
 * The poster voice: the one place a skin's `display` face is used.
 *
 * A skin that names no display face means "set it in my body face", which is
 * why the fallback is `font` and not a family this file picked.
 */
export function DisplayText({
  children,
  size = 15,
  colour,
  testId,
  caps = true,
}: Readonly<{
  children: ReactNode;
  size?: number;
  colour?: string;
  testId?: string;
  /**
   * Whether the skin's shouting applies. It does for a label this file wrote;
   * it does not for something a person typed - a channel called "Green is
   * fucked" is not called "GREEN IS FUCKED".
   */
  caps?: boolean;
}>) {
  const stencil = useStencil();
  return (
    <Box
      component="div"
      data-testid={testId}
      data-nebula-mark={stencil ? "poster" : undefined}
      sx={(theme) => ({
        fontFamily: theme.palette.nebulaSkin.display ?? theme.palette.nebulaSkin.font,
        fontStyle: stencil ? "italic" : "normal",
        fontWeight: stencil ? 800 : 700,
        fontSize: size,
        letterSpacing: stencil && caps ? ".16em" : theme.palette.nebulaSkin.track,
        textTransform: !caps ? "none" : stencil ? "uppercase" : theme.palette.nebulaSkin.caps,
        lineHeight: 1.15,
        color: colour ?? theme.palette.nebula.text,
      })}
    >
      {children}
    </Box>
  );
}
