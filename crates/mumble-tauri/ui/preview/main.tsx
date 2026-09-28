import { createRoot } from "react-dom/client";
import { CssBaseline, Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { EmojiPopover } from "@nebula/components/chat/popover/EmojiPopover";
import { PollPopover } from "@nebula/components/chat/popover/PollPopover";
import { FileSharePopover } from "@nebula/components/chat/popover/FileSharePopover";
import "@standard/theme.css";
import { initializeStandardAppearance } from "@standard/appearance";

initializeStandardAppearance();

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ position: "relative", width: 520, height: 430, borderRadius: "20px", overflow: "hidden",
      background: "linear-gradient(180deg,#232a48 0%,#443c68 52%,#211d3a 100%)" }}>
      <Box sx={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 1 }}>{children}</Box>
    </Box>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ display: "flex", gap: "20px", padding: "20px", background: "#0a0e1a" }}>
      <Pane><EmojiPopover left={0} onSelect={() => {}} onClose={() => {}} /></Pane>
      <Pane><PollPopover left={0} onSubmit={() => {}} onClose={() => {}} /></Pane>
      <Pane>
        <FileSharePopover left={0} filename="server-notes.pdf" canSharePublic
          onSubmit={() => {}} onClose={() => {}} onBrowse={() => {}} />
      </Pane>
    </Box>
  </ThemeProvider>,
);
