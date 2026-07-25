import type { CSSProperties, ElementType, ReactNode } from "react";
import { space, type SpaceStep } from "./spacing";
import styles from "./Container.module.css";

/**
 * Reading-width ceilings.
 *
 * `md` is the default because the client's panels are already narrow; `full`
 * exists for surfaces that manage their own width (the connected grid) but
 * still want the shared gutter.
 */
export const CONTAINER_WIDTHS = {
  sm: "480px",
  md: "720px",
  lg: "1024px",
  xl: "1280px",
  full: "100%",
} as const;

export type ContainerWidth = keyof typeof CONTAINER_WIDTHS;

export interface ContainerProps {
  maxWidth?: ContainerWidth;
  /** Horizontal gutter, as a spacing step. Defaults to 16px. */
  gutter?: SpaceStep;
  /** Stretch to fill a flex parent and allow inner scrolling. */
  fill?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Centres content at a readable width with uniform gutters. */
export default function Container({
  maxWidth = "md", gutter, fill, as: Component = "div", className, style, children,
}: ContainerProps) {
  const vars = {
    "--container-max": CONTAINER_WIDTHS[maxWidth],
    "--container-gutter": space(gutter),
  } as CSSProperties;

  const classes = [styles.container, fill && styles.fill, className].filter(Boolean).join(" ");
  return <Component className={classes} style={{ ...vars, ...style }}>{children}</Component>;
}
