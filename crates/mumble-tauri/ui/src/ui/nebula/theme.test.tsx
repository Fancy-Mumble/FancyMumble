import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme, handheldChrome, HANDHELD_HEADER_MAX } from "./theme";
import { DEFAULT_SKIN, nebulaThemeDef } from "./themeCatalog";

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

  it("keeps the focus rule weightless so a component's own outline wins", () => {
    // Written as a plain `textarea:focus-visible` this outranks a class that
    // says `outline: none`, and a widget clipping its overflow then shows the
    // outline as specks in its corners.
    const css = baselineCss();
    expect(css).toContain("textarea:where(:focus-visible)");
    expect(css).not.toMatch(/[^)]textarea:focus-visible/);
  });
});

describe("handheld chrome", () => {
  it("passes a skin's own header height through when it already fits", () => {
    // Twelve of the thirteen ask for the pack's 66, which is the cap itself,
    // so what they get back is the measure they asked for rather than a
    // number this function chose.
    const theme = createNebulaTheme("dark", null, null, DEFAULT_SKIN);
    expect(DEFAULT_SKIN.headerHeight).toBeLessThanOrEqual(HANDHELD_HEADER_MAX);
    expect(handheldChrome(theme).headerHeight).toBe(DEFAULT_SKIN.headerHeight);
  });

  it("would keep a shorter header short", () => {
    // No skin draws one today. The clamp is a ceiling rather than a fixed
    // height, and this is what says so.
    const theme = createNebulaTheme("dark", null, null, { ...DEFAULT_SKIN, headerHeight: 48 });
    expect(handheldChrome(theme).headerHeight).toBe(48);
  });

  it("clamps a desktop measure that would eat a tenth of the screen", () => {
    // Nimbus draws a 90px header, which is right in a window and eleven per
    // cent of an 844px phone.
    const skin = nebulaThemeDef("nimbus")!.skin;
    expect(skin.headerHeight).toBeGreaterThan(HANDHELD_HEADER_MAX);
    const theme = createNebulaTheme("dark", null, null, skin);
    expect(handheldChrome(theme).headerHeight).toBe(HANDHELD_HEADER_MAX);
  });

  it("gives the strip and the tab bar one answer for every skin", () => {
    // These two are the phone's furniture rather than the theme's, which is
    // why they are a derivation and not two more fields in the catalog.
    const wide = handheldChrome(createNebulaTheme("dark", null, null, DEFAULT_SKIN));
    const tall = handheldChrome(createNebulaTheme("dark", null, null, nebulaThemeDef("nimbus")!.skin));
    expect(wide.stripHeight).toBe(tall.stripHeight);
    expect(wide.tabBarHeight).toBe(tall.tabBarHeight);
  });
});
