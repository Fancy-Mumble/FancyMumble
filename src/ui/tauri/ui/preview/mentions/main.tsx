/* Scratch preview: renders the message row and its two new panels outside
   Tauri, so the mention chip, the member list and the reader list can be
   eyeballed. Not part of the app - `preview/` is not referenced by index.html. */
import { createRoot } from "react-dom/client";
import { Box, CssBaseline, ThemeProvider } from "@mui/material";
import { useAppStore } from "@core/store";
import { applyReadStates } from "@core/features/chat/readreceipt/readReceiptStore";
import type { ChatMessage, UserEntry } from "@core/types";
import { createNebulaTheme } from "@nebula/theme";
import { MessageRow } from "@nebula/components/chat/MessageRow";
import { MentionPopover } from "@nebula/components/chat/MentionPopover";
import { MessageMenu } from "@nebula/components/chat/MessageMenu";

function user(session: number, name: string): UserEntry {
  return { session, name, channel_id: 1, texture_size: null, hash: `h${session}` } as UserEntry;
}

const USERS = [user(1, "Zewi"), user(2, "Lorelando"), user(3, "Kayo"), user(4, "Nazuna")];

useAppStore.setState({
  users: USERS,
  ownSession: 1,
  selectedChannel: 1,
  channels: [{ id: 1, parent_id: 0, name: "Gaming", permissions: 0 } as never],
  polls: new Map(),
  linkEmbeds: new Map(),
  disableLinkPreviews: true,
  readReceiptVersion: 1,
});

applyReadStates(1, [
  { cert_hash: "h2", name: "Lorelando", is_online: true, last_read_message_id: "m2", timestamp: 1 },
  { cert_hash: "h3", name: "Kayo", is_online: false, last_read_message_id: "m2", timestamp: 1 },
]);

function message(partial: Partial<ChatMessage>): ChatMessage {
  return {
    sender_session: 2,
    sender_name: "Lorelando",
    body: "hello",
    channel_id: 1,
    is_own: false,
    message_id: "m1",
    timestamp: 1_700_000_000_000,
    ...partial,
  } as ChatMessage;
}

const MENTIONS =
  'morning <span class="mention mention-user" data-mention-session="1">@Zewi</span> - ' +
  '<span class="mention mention-role" data-mention-role="mods">@mods</span> should see this too, ' +
  'and <span class="mention mention-everyone" data-mention-everyone="1">@everyone</span> is invited';

function Preview() {
  return (
    <ThemeProvider theme={createNebulaTheme("dark")}>
      <CssBaseline />
      <Box
        sx={(theme) => ({
          minHeight: "100vh",
          p: "34px",
          display: "flex",
          flexDirection: "column",
          gap: "26px",
          background: `${theme.palette.nebula.backdrop},${theme.palette.nebula.bg0}`,
          color: theme.palette.nebula.text,
          fontSize: 14,
        })}
      >
        <MessageRow message={message({ body: MENTIONS })} grouped={false} onOpenProfile={() => {}} />
        <MessageRow
          message={message({ is_own: true, sender_session: 1, sender_name: "Zewi", body: MENTIONS })}
          grouped={false}
          onOpenProfile={() => {}}
          time={{ timeFormat: "12h", localTime: false, systemUses24h: undefined }}
        />
        <MentionPopover target={{ chip: { kind: "everyone" }, at: { x: 60, y: 300 } }} onClose={() => {}} />
        <MessageMenu
          target={{
            message: message({ is_own: true, message_id: "m1", body: '<img src="x.png"> caption here' }),
            x: 470,
            y: 300,
            editable: true,
          }}
          onClose={() => {}}
          onReact={() => {}}
          onQuickReact={() => {}}
          onQuote={() => {}}
          onEdit={() => {}}
          onSelect={() => {}}
          allMessageIds={["m1", "m2"]}
        />
      </Box>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
