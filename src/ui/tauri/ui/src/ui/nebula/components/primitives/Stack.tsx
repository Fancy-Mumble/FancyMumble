import MuiStack, { type StackProps as MuiStackProps } from "@mui/material/Stack";
import type { ElementType } from "react";

export interface StackProps extends Omit<MuiStackProps, "gap"> {
  component?: ElementType;
  alignItems?: string;
  justifyContent?: string;
  gap?: number | string;
  flexWrap?: "wrap" | "nowrap" | "wrap-reverse";
}

/**
 * `Stack` with the flex shorthands MUI 9 removed from its props.
 *
 * v9 dropped the system props (`alignItems`, `gap`, …) in favour of `sx`, which
 * turns every row in this pack into a two-line `sx` block for two values. The
 * shim folds them back in - same theme-spacing semantics for `gap`, same
 * precedence, with an explicit `sx` still winning.
 */
export function Stack({ alignItems, justifyContent, gap, flexWrap, sx, ...rest }: Readonly<StackProps>) {
  // Only build something when there is something to build. This used to wrap
  // every caller's `sx` in a fresh two-element array whether or not a shorthand
  // had been given - and `Stack` is what nearly seven hundred rows in this pack
  // are made of, so that was an array and an object allocated per row per
  // render, each one a chain emotion then had to merge and re-serialise.
  const shorthands =
    alignItems === undefined && justifyContent === undefined && gap === undefined && flexWrap === undefined
      ? undefined
      : { alignItems, justifyContent, gap, flexWrap };

  const style =
    shorthands === undefined
      ? sx
      : sx === undefined
        ? shorthands
        : [shorthands, ...(Array.isArray(sx) ? sx : [sx])];

  return <MuiStack {...(rest as MuiStackProps)} sx={style} />;
}
