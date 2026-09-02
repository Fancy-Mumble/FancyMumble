import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { AdminScreen } from "@nebula/components/admin/AdminScreen";
import type { AdminCapabilities } from "@nebula/components/admin/capabilities";

/**
 * The Welcome message page, in the shell it actually lives in.
 *
 * `AdminScreen` is mounted rather than `WelcomeAdmin`, because the thing being
 * checked here is the *pane*: whether the canvas reaches the sidebar and the
 * window edge, which is a property of the padding `AdminScreen` applies and not
 * of the page at all. A preview that mounted the page alone would look right
 * while the real pane framed it in a lighter panel.
 */
const CAPABILITIES: AdminCapabilities = {
  canAdminister: true,
  canManageEmotes: true,
  canManageFileServer: true,
  canViewAudit: true,
  onboardingSupported: true,
};

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box
      sx={(theme) => ({
        display: "flex",
        height: "100vh",
        background: theme.palette.nebula.bg0,
      })}
    >
      {/* Stands in for the settings sidebar, so the seam the canvas has to
          meet is visible in the screenshot. */}
      <Box
        sx={(theme) => ({
          width: 240,
          flex: "none",
          background: theme.palette.nebula.panel,
          borderRight: `1px solid ${theme.palette.nebula.line}`,
        })}
      />
      <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
        <AdminScreen page="welcome" capabilities={CAPABILITIES} onNavigate={() => undefined} />
      </Box>
    </Box>
  </ThemeProvider>,
);

// `?browse` opens the block browser, which is a click rather than a route and
// so cannot be reached by a screenshot on its own.
if (window.location.search.includes("browse")) {
  const open = () => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.trim().startsWith("Browse blocks"),
    );
    if (button) button.click();
    else window.setTimeout(open, 50);
  };
  window.setTimeout(open, 80);
}

// `?drag` carries the OS block from the browser onto the middle of the canvas,
// so a screenshot can show a drop actually landing rather than a static panel.
if (window.location.search.includes("drag")) {
  const at = (x: number, y: number, type: string) =>
    window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
  const run = () => {
    const card = [...document.querySelectorAll("div")].find(
      (el) =>
        el.firstElementChild &&
        el.textContent?.startsWith("OS") &&
        el.textContent.includes("operating system"),
    );
    if (!card) {
      window.setTimeout(run, 60);
      return;
    }
    const box = card.getBoundingClientRect();
    card.dispatchEvent(
      new MouseEvent("pointerdown", {
        clientX: box.left + 40,
        clientY: box.top + 14,
        button: 0,
        bubbles: true,
      }),
    );
    at(box.left + 80, box.top + 60, "pointermove");
    window.setTimeout(() => at(900, 300, "pointermove"), 40);
    window.setTimeout(() => at(1150, 420, "pointermove"), 90);
    window.setTimeout(() => at(1150, 420, "pointerup"), 140);
  };
  window.setTimeout(run, 300);
}
