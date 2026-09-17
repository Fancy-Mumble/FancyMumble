/**
 * The hover pill, on a river of short bubbles.
 *
 * `msggroup` shows the river; this one exists for the strip that hangs over
 * it, which is a question about geometry rather than about paint: where the
 * pill lands on somebody else's narrow bubble, and whether the pointer can
 * actually walk from the words up to it without the row losing its hover on
 * the way. Short bodies on purpose - a full-width message hides the bug.
 */
import { createRoot } from "react-dom/client";
import { CssBaseline, Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { MessageList } from "@nebula/components/chat/MessageList";
import { MessageAvatar, MessageRow } from "@nebula/components/chat/MessageRow";
import { useAppStore } from "@core/store";
import type { BubbleStyle } from "@standard/personalizationStorage";
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

let clock = Date.UTC(2026, 8, 1, 20, 25);

function msg(body: string, own: boolean, gapMs = 90_000): ChatMessage {
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
  msg("first", false),
  msg("test", false),
  msg("and one of mine", true),
  msg("ok", false),
  msg("a longer one from the other side, to see where the pill lands on it", false),
  msg("mine again", true),
];

/** `?style=bubbles|flat|compact`, since the pill moves with the style. */
const style = (new URLSearchParams(location.search).get("style") ?? "bubbles") as BubbleStyle;

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ p: "24px", background: "#0a0e1a" }}>
      <Box
        sx={(theme) => ({
          width: 760,
          height: 520,
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
          renderAvatar={(message, avatar) => (
            <MessageAvatar message={message} avatar={avatar} onOpenProfile={() => {}} />
          )}
          renderMessage={(message, avatar, grouped, restoring, endsGroup) => (
            <MessageRow
              message={message}
              avatar={avatar}
              grouped={grouped}
              endsGroup={endsGroup}
              restoring={restoring}
              bubbleStyle={style}
              stickyAvatar
              onOpenProfile={() => {}}
            />
          )}
        />
      </Box>
    </Box>
  </ThemeProvider>,
);
