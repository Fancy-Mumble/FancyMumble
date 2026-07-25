import type { CSSProperties, ElementType, ReactNode } from "react";
import { space, type SpaceStep } from "./spacing";
import styles from "./Box.module.css";

export type BoxDisplay = "flex" | "inline-flex" | "grid" | "block";
export type BoxAlign = "start" | "center" | "end" | "stretch" | "baseline";
export type BoxJustify = "start" | "center" | "end" | "between" | "around";

export interface BoxProps {
  /** Padding on every side. */
  p?: SpaceStep;
  /** Horizontal padding; wins over `p`. */
  px?: SpaceStep;
  /** Vertical padding; wins over `p`. */
  py?: SpaceStep;
  /** Margin on every side. */
  m?: SpaceStep;
  /** Horizontal margin; wins over `m`. */
  mx?: SpaceStep;
  /** Vertical margin; wins over `m`. */
  my?: SpaceStep;
  /** Space between children. */
  gap?: SpaceStep;
  display?: BoxDisplay;
  direction?: "row" | "column";
  align?: BoxAlign;
  justify?: BoxJustify;
  wrap?: boolean;
  /** Take the remaining space along the parent's main axis. */
  grow?: boolean;
  /** Element to render. Use it to keep the markup semantic. */
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const DISPLAY = {
  flex: styles.flex,
  "inline-flex": styles.inlineFlex,
  grid: styles.grid,
  block: styles.block,
} as const;
const ALIGN = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: styles.alignStretch,
  baseline: styles.alignBaseline,
} as const;
const JUSTIFY = {
  start: styles.justifyStart,
  center: styles.justifyCenter,
  end: styles.justifyEnd,
  between: styles.justifyBetween,
  around: styles.justifyAround,
} as const;

/**
 * Layout wrapper carrying spacing from the shared scale.
 *
 * Deliberately layout-only: no colour, border or typography. Anything visual
 * belongs to the component being laid out, so Box never becomes a second place
 * to look for a component's appearance.
 */
export default function Box({
  p, px, py, m, mx, my, gap,
  display, direction, align, justify, wrap, grow,
  as: Component = "div", className, style, children,
}: BoxProps) {
  const vars = {
    "--box-p": space(p),
    "--box-px": space(px),
    "--box-py": space(py),
    "--box-m": space(m),
    "--box-mx": space(mx),
    "--box-my": space(my),
    "--box-gap": space(gap),
  } as CSSProperties;

  const classes = [
    styles.box,
    display && DISPLAY[display],
    direction === "column" ? styles.column : direction === "row" ? styles.row : undefined,
    align && ALIGN[align],
    justify && JUSTIFY[justify],
    wrap && styles.wrap,
    grow && styles.grow,
    className,
  ].filter(Boolean).join(" ");

  return <Component className={classes} style={{ ...vars, ...style }}>{children}</Component>;
}
