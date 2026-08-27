import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { Composer } from "@nebula/components/chat/Composer";
import "@standard/theme.css";
import { initializeStandardAppearance } from "@standard/appearance";

initializeStandardAppearance();

/**
 * One composer per page load, in one focus state.
 *
 * Focus is a property of the document, not of a component, so two panes on one
 * page cannot both be focused and a strip of them would say nothing.
 *
 *   ?state=idle|focus|typed&scheme=dark|light
 */
const params = new URLSearchParams(location.search);
const STATE = params.get("state") ?? "focus";
const SCHEME = params.get("scheme") === "light" ? "light" : "dark";

/** Focus the lower of the two composers, so the pair reads as before/after. */
function drive() {
  const fields = document.querySelectorAll("textarea");
  const field = fields[1];
  if (!field) return;
  if (STATE === "typed") {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(field, "back in 5, kettle's on");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  field.focus();
}

function Pane() {
  useEffect(() => {
    const id = setTimeout(drive, 100);
    return () => clearTimeout(id);
  }, []);
  return (
    <Box
      sx={{
        width: 760,
        paddingTop: "40px",
        paddingBottom: "12px",
        background:
          SCHEME === "dark"
            ? "linear-gradient(180deg,#232a48 0%,#443c68 52%,#211d3a 100%)"
            : "linear-gradient(180deg,#dfe4f5 0%,#cfc8ea 52%,#e6e2f2 100%)",
      }}
    >
      <Composer target="#Gaming" onSend={() => {}} onAttach={() => {}} />
      <Composer target="#Gaming" onSend={() => {}} onAttach={() => {}} />
    </Box>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme(SCHEME)}>
    <CssBaseline />
    <Box sx={{ background: "#0a0e1a" }}>
      <Pane />
    </Box>
  </ThemeProvider>,
);
