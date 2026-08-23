import type { ReactNode } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "./theme";

/**
 * Nebula components read `palette.nebula`, so they need a Nebula theme rather
 * than MUI's default one. Tests render through this instead of restating the
 * provider each time.
 */
export function withNebulaTheme(children: ReactNode) {
  return <ThemeProvider theme={createNebulaTheme("dark")}>{children}</ThemeProvider>;
}
