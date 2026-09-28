import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { useAppStore } from "@core/store";
import { MessageMenu } from "@nebula/components/chat/MessageMenu";

useAppStore.setState({ channels: [{ id: 1, name: "Gaming", parent_id: 0 } as never] });

const message = {
  message_id: "m1",
  channel_id: 1,
  body: "dfsdf",
  is_own: true,
  pinned: false,
} as never;

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box
      sx={{
        height: "100vh",
        background: "linear-gradient(140deg,#2b3a5c,#1a2440 60%,#101a30)",
      }}
    >
      <MessageMenu
        target={{ message, x: 40, y: 30, editable: true }}
        onClose={() => {}}
        onReact={() => {}}
        onQuickReact={() => {}}
        onQuote={() => {}}
        onEdit={() => {}}
        onSelect={() => {}}
      />
    </Box>
  </ThemeProvider>,
);
