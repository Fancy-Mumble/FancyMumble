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
  return (
    <MuiStack
      {...(rest as MuiStackProps)}
      sx={[{ alignItems, justifyContent, gap, flexWrap }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
}
