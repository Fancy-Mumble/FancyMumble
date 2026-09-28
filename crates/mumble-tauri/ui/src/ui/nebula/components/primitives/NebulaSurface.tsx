import { Paper, type PaperProps } from "@mui/material";
import { floatingSurface } from "../../theme";

/**
 * The mock's floating surface: the radial tint over the window colour, a
 * stronger hairline, and the long shadow. Menus, profile cards, the mini
 * window and every popover are the same object at different sizes.
 */
export function NebulaSurface({ sx, ...props }: PaperProps) {
  return (
    <Paper
      {...props}
      sx={[
        (theme) => ({ ...floatingSurface(theme), overflow: "hidden" }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
