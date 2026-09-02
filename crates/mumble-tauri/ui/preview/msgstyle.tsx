import { createRoot } from "react-dom/client";
import { CssBaseline, Box, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { MessageRow } from "@nebula/components/chat/MessageRow";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import type { BubbleStyle } from "@standard/personalizationStorage";
import "@standard/theme.css";
import { initializeStandardAppearance } from "@standard/appearance";

initializeStandardAppearance();

useAppStore.setState({
  ownSession: 1,
  users: [
    { session: 1, name: "You", channel_id: 1, texture_size: null },
    { session: 7, name: "Jonas", channel_id: 1, texture_size: null },
  ] as never,
  polls: new Map(),
  linkEmbeds: new Map(),
  disableLinkPreviews: true,
  readReceiptVersion: 0,
  reactionVersion: 0,
});

function msg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    sender_session: 7,
    sender_name: "Jonas",
    body: "hello",
    channel_id: 1,
    is_own: false,
    message_id: Math.random().toString(36).slice(2),
    timestamp: 1_700_000_000_000,
    ...partial,
  } as ChatMessage;
}

const THREAD: ChatMessage[] = [
  msg({ body: "Beyond the Unicorn? Job Roles in Data Science: J. Gunklach et al." }),
  msg({ body: "Reading it now - the taxonomy in section 3 is the useful part.", is_own: true, sender_session: 1, sender_name: "You" }),
  msg({ body: "sec", is_own: true, sender_session: 1, sender_name: "You" }),
  msg({ body: "It cites the 2021 survey, which is where the role split comes from." }),
];

function Pane({ style }: { style: BubbleStyle }) {
  return (
    <Box sx={{ width: 460 }}>
      <Typography sx={{ mb: "10px", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.6 }}>
        {style.toUpperCase()}
      </Typography>
      <Box
        sx={(theme) => ({
          p: "18px",
          borderRadius: "16px",
          background: theme.palette.nebula.bg,
          border: `1px solid ${theme.palette.nebula.line}`,
          display: "flex",
          flexDirection: "column",
          gap: style === "compact" ? "9px" : "19px",
          fontSize: "14px",
        })}
      >
        {THREAD.map((message, index) => (
          <MessageRow
            key={message.message_id}
            message={message}
            grouped={index > 0 && THREAD[index - 1].sender_session === message.sender_session}
            bubbleStyle={style}
            onOpenProfile={() => {}}
          />
        ))}
      </Box>
    </Box>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ display: "flex", gap: "24px", p: "24px", background: "#0a0e1a", alignItems: "flex-start" }}>
      <Pane style="bubbles" />
      <Pane style="flat" />
      <Pane style="compact" />
    </Box>
  </ThemeProvider>,
);
