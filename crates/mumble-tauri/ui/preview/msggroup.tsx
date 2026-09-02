/**
 * The river, drawn as a run of messages rather than as one of each kind.
 *
 * `msgstyle` shows what a single message looks like in each of the three
 * styles; this shows what happens when somebody sends six in a row, which is
 * the case the block header and the group spacing exist for and the one that
 * looked worst before them.
 */
import { createRoot } from "react-dom/client";
import { CssBaseline, Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { MessageList } from "@nebula/components/chat/MessageList";
import { MessageRow } from "@nebula/components/chat/MessageRow";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import "@standard/theme.css";
import { initializeStandardAppearance } from "@standard/appearance";

initializeStandardAppearance();

useAppStore.setState({
  ownSession: 1,
  users: [
    { session: 1, name: "You", channel_id: 1, texture_size: null },
    { session: 7, name: "Sebi", channel_id: 1, texture_size: null },
  ] as never,
  polls: new Map(),
  linkEmbeds: new Map(),
  disableLinkPreviews: true,
  readReceiptVersion: 0,
  reactionVersion: 0,
});

const DAY = Date.UTC(2026, 8, 1, 20, 25) as number;
let clock = DAY;

function msg(body: string, own: boolean, gapMs = 4_000): ChatMessage {
  clock += gapMs;
  return {
    sender_session: own ? 1 : 7,
    sender_name: own ? "You" : "Sebi",
    body,
    channel_id: 1,
    is_own: own,
    message_id: Math.random().toString(36).slice(2),
    timestamp: clock,
  } as ChatMessage;
}

const THREAD: ChatMessage[] = [
  msg("btw finally sorted the NYC photos from last week", false),
  msg("the ferry ones came out great", false),
  msg("nice, queue is up in 5 - check this while we wait", true, 40_000),
  msg("sdf", true),
  msg("sdf", true),
  msg("sdf", true),
  msg("sdfsd", true),
  msg("job", false, 90_000),
  msg("xzx+", false),
  msg("gizg", false),
  msg("save me a slot, 20 min out. jonas don't dodge the first lobby this time", true, 120_000),
];

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ p: "24px", background: "#0a0e1a" }}>
      <Box
        sx={(theme) => ({
          width: 760,
          height: 760,
          display: "flex",
          borderRadius: "16px",
          overflow: "hidden",
          background: theme.palette.nebula.bg0,
          border: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <MessageList
          messages={THREAD}
          users={[]}
          renderMessage={(message, avatar, grouped, restoring, endsGroup) => (
            <MessageRow
              message={message}
              avatar={avatar}
              grouped={grouped}
              endsGroup={endsGroup}
              restoring={restoring}
              onOpenProfile={() => {}}
            />
          )}
        />
      </Box>
    </Box>
  </ThemeProvider>,
);
