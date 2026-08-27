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
 * One composer per page load, chosen by query string.
 *
 * The bar is only drawn over a *focused* editor - a textarea keeps its
 * selection through a blur, and the overlay stops drawing the selected run
 * once it is not the thing being typed in - so two panes on one page would
 * fight over the focus and neither would show what is being looked at.
 *
 *   ?word=jbkljb&scheme=dark
 */
const params = new URLSearchParams(location.search);
const WORD = params.get("word") ?? "jbkljb";
const SCHEME = params.get("scheme") === "light" ? "light" : "dark";

const DRAFT =
  "jbkljb asdasdasd asdasdasda asd asd asdas dasd asd asd asdasd asd asd asd asd asdasd asd asd asd asd";

/** Type the draft into the real editor and select one run of it. */
function drive(word: string) {
  const field = document.querySelector("textarea");
  if (!field) return;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setValue?.call(field, DRAFT);
  field.dispatchEvent(new Event("input", { bubbles: true }));

  const at = DRAFT.indexOf(word);
  setTimeout(() => {
    field.focus();
    field.setSelectionRange(at, at + word.length);
    // React synthesises onSelect from keyup/mouseup and friends, never from a
    // dispatched "select" - so that is the event to fake.
    field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }, 200);
}

function Pane() {
  useEffect(() => drive(WORD), []);
  return (
    <ThemeProvider theme={createNebulaTheme(SCHEME)}>
      <Box
        sx={{
          width: 760,
          paddingTop: "80px",
          paddingBottom: "12px",
          background:
            SCHEME === "dark"
              ? "linear-gradient(180deg,#232a48 0%,#443c68 52%,#211d3a 100%)"
              : "linear-gradient(180deg,#dfe4f5 0%,#cfc8ea 52%,#e6e2f2 100%)",
        }}
      >
        <Composer target="#Gaming" onSend={() => {}} onAttach={() => {}} />
      </Box>
    </ThemeProvider>
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
