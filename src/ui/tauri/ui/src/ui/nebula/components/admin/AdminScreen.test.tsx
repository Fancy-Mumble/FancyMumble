import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { DEFAULT_SKIN } from "@nebula/themeCatalog";
import { AdminScreen } from "./AdminScreen";
import type { AdminCapabilities } from "./capabilities";

/**
 * Nothing this session may open.
 *
 * The pane itself is what these tests are about, and a page it is allowed to
 * draw would pull a lazy chunk - the greeting editor, its store, its network
 * calls - in to answer a question about padding.
 */
const NOTHING: AdminCapabilities = {
  canAdminister: false,
  canManageEmotes: false,
  canManageFileServer: false,
  canViewAudit: false,
  onboardingSupported: false,
};

/** The administration pane under a skin, as the top-level element. */
function paneUnder(windowControls: "band" | "corner"): HTMLElement {
  const theme = createNebulaTheme("dark", null, null, {
    ...DEFAULT_SKIN,
    chromeSlots: { ...DEFAULT_SKIN.chromeSlots, windowControls },
  });
  const { container } = render(
    <ThemeProvider theme={theme}>
      <AdminScreen page="welcome" capabilities={NOTHING} onNavigate={() => undefined} />
    </ThemeProvider>,
  );
  return container.firstElementChild as HTMLElement;
}

afterEach(cleanup);

describe("the administration pane", () => {
  it("leaves the floating window controls room above a full-bleed page", () => {
    // The greeting editor's own toolbar is the first thing in the pane, so on a
    // skin with no title strip the corner plate sat on top of Undo, Redo and
    // Reset - and the drag strip beside it took the clicks that did land.
    expect(parseFloat(getComputedStyle(paneUnder("corner")).paddingTop)).toBeGreaterThan(0);
  });

  it("gives a full-bleed page the whole pane where the controls are in a strip", () => {
    expect(getComputedStyle(paneUnder("band")).paddingTop).toBe("0px");
  });
});
