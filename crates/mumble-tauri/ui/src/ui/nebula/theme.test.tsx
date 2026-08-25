import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "./theme";

function baselineCss(): string {
  render(
    <ThemeProvider theme={createNebulaTheme("dark")}>
      <CssBaseline />
    </ThemeProvider>,
  );
  return [...document.querySelectorAll("style")].map((tag) => tag.textContent ?? "").join("\n");
}

describe("nebula form-control baseline", () => {
  // Nebula borrows Standard's pickers but not Standard's global.css, which is
  // where the baseline for unstyled controls lives. Without an equivalent here
  // the emoji picker's search box rendered as a raw browser input in the
  // middle of the mock, which is what this guards against.
  it("styles bare text inputs, which borrowed widgets leave to the host", () => {
    const css = baselineCss();
    expect(css).toContain("input:where(:not(");
    expect(css).toMatch(/padding:\s*8px 12px/);
    expect(css).toMatch(/::placeholder/);
  });

  it("leaves controls that are not text surfaces alone", () => {
    const css = baselineCss();
    for (const type of ["checkbox", "radio", "range", "file", "color", "submit", "button"]) {
      expect(css).toContain(`[type="${type}"]`);
    }
  });

  it("focuses with an outline, which cannot reflow the layout", () => {
    expect(baselineCss()).toMatch(/:focus-visible[^{]*\{[^}]*outline:/);
  });
});
