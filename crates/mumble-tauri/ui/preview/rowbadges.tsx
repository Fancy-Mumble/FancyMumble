/**
 * The channel tree with two people sharing - one relayed, one peer-to-peer -
 * beside a legacy message and a row with its strip pinned open, so the three
 * marks can be held against each other. `?frame=412` for a phone width.
 */
import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@core/i18n/nebula";
import "@standard/theme.css";
import "@standard/global.css";
import { useAppStore } from "@core/store";
import type { ChannelEntry, ChatMessage, UserEntry } from "@core/types";
import { createNebulaTheme } from "@nebula/theme";
import { ChannelList } from "@nebula/components/sidebar/ChannelList";
import { MessageRow } from "@nebula/components/chat/MessageRow";

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => 0,
};

const params = new URLSearchParams(location.search);
const frame = params.get("frame");
if (frame) {
  const inner = new URLSearchParams(params);
  inner.delete("frame");
  const iframe = document.createElement("iframe");
  iframe.src = `${location.pathname}?${inner.toString()}`;
  iframe.width = frame;
  iframe.height = params.get("frameHeight") ?? "915";
  iframe.style.border = "0";
  document.body.replaceChildren(iframe);
}

const p2p = params.has("p2p");
const channel = (id: number, name: string): ChannelEntry =>
  ({ id, name, parent_id: 0, position: 0, user_count: 3, permissions: null, attributes: 0, is_enter_restricted: false }) as unknown as ChannelEntry;
const member = (session: number, name: string, extra: Partial<UserEntry> = {}): UserEntry =>
  ({ session, name, channel_id: 2, texture_size: null, mute: false, deaf: false, suppress: false, self_mute: false, self_deaf: false, priority_speaker: false, ...extra }) as UserEntry;
const users = [member(4, "Lorelando", { priority_speaker: true }), member(5, "Mirabel", { self_mute: true }), member(9, "Sebi")];

const base = useAppStore.getState();
useAppStore.setState({
  ownSession: 9,
  users,
  polls: new Map(),
  linkEmbeds: new Map(),
  broadcastingSessions: new Set([4, 5]),
  serverConfig: { ...base.serverConfig, webrtc_sfu_available: !p2p },
});

const message = (partial: Partial<ChatMessage>): ChatMessage => ({
  sender_session: 5,
  sender_name: "Mirabel",
  body: "hello",
  channel_id: 2,
  is_own: false,
  message_id: "m1",
  timestamp: Date.now() - 60_000,
  ...partial,
});

if (!frame)
  createRoot(document.getElementById("root")!).render(
    <ThemeProvider theme={createNebulaTheme(params.get("scheme") === "light" ? "light" : "dark")}>
      <CssBaseline />
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "24px", p: "20px", minHeight: 700 }}>
        <Box sx={{ width: 300 }}>
          <ChannelList
            channels={[{ channel: channel(2, "Gaming"), depth: 0 }, { channel: channel(3, "Lounge"), depth: 0 }]}
            users={users}
            selectedChannel={2}
            currentChannel={2}
            talkingSessions={new Set([4])}
            unreadCounts={{}}
            ownSession={9}
            onSelect={() => {}}
            onJoin={() => {}}
            onContextMenu={() => {}}
            onSelectUser={() => {}}
            onHoverUser={() => {}}
            onLeaveUser={() => {}}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 320, maxWidth: 560, display: "flex", flexDirection: "column", gap: "18px", pt: "40px" }}>
          <MessageRow
            message={message({ body: "Joining from my old Mumble 1.4 on the laptop, can you hear me?", is_legacy: true, sender_session: 6, sender_name: "OldClient", message_id: "m0" })}
            grouped={false}
            onOpenProfile={() => {}}
          />
          <MessageRow
            message={message({ body: "Stream is up - the boss fight starts in five." })}
            grouped={false}
            onOpenProfile={() => {}}
            alwaysShowActions
            onContextMenu={() => {}}
          />
        </Box>
      </Box>
    </ThemeProvider>,
  );
