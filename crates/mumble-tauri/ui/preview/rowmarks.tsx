/**
 * The channel tree's row marks: a listened channel, role-coloured names, an
 * unread direct message and someone sharing - `?modern=1` for the stacked
 * faces, where the sharing mark moves onto the channel row.
 */
import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@core/i18n/nebula";
import "@standard/theme.css";
import "@standard/global.css";
import { useAppStore } from "@core/store";
import type { ChannelEntry, UserEntry } from "@core/types";
import { PERSONALIZATION_CHANGED_EVENT } from "@standard/personalizationStorage";
import { createNebulaTheme } from "@nebula/theme";
import { ChannelList } from "@nebula/components/sidebar/ChannelList";

const params = new URLSearchParams(location.search);
const modern = params.has("modern");
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: (cmd: string) =>
    Promise.resolve(cmd.includes("personalization") || cmd.includes("preferences") ? { channelViewerStyle: modern ? "modern" : "flat" } : null),
  transformCallback: () => 0,
};

const channel = (id: number, name: string): ChannelEntry =>
  ({ id, name, parent_id: 0, position: id, user_count: 3, permissions: null, attributes: 0, is_enter_restricted: false }) as unknown as ChannelEntry;
const member = (session: number, name: string, extra: Partial<UserEntry> = {}): UserEntry =>
  ({ session, name, channel_id: 2, texture_size: null, mute: false, deaf: false, suppress: false, self_mute: false, self_deaf: false, priority_speaker: false, ...extra }) as UserEntry;
const users = [
  member(4, "Lorelando", { user_id: 11 } as Partial<UserEntry>),
  member(5, "Mirabel", { user_id: 12 } as Partial<UserEntry>),
  member(6, "Quill"),
  member(9, "Sebi", { user_id: 13 } as Partial<UserEntry>),
  member(7, "Tamsin", { channel_id: 3 }),
];
const base = useAppStore.getState();
useAppStore.setState({
  ownSession: 9,
  users,
  broadcastingSessions: new Set([5]),
  dmUnreadCounts: { 4: 2 },
  serverConfig: { ...base.serverConfig, webrtc_sfu_available: true },
});
setTimeout(() => window.dispatchEvent(new Event(PERSONALIZATION_CHANGED_EVENT)), 50);
const noop = () => {};

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ width: 320, height: 420, display: "flex", p: "12px" }}>
      <ChannelList
        channels={[
          { channel: channel(2, "Gaming"), depth: 0 },
          { channel: channel(3, "Lounge"), depth: 0 },
          { channel: channel(8, "Radio"), depth: 0 },
        ]}
        users={users}
        selectedChannel={2}
        currentChannel={2}
        talkingSessions={new Set([4])}
        unreadCounts={{}}
        ownSession={9}
        listenedChannels={new Set([8])}
        roleColors={new Map([[11, "#ed4245"], [12, "#3ba55d"]])}
        onSelect={noop}
        onJoin={noop}
        onContextMenu={noop}
        onSelectUser={noop}
        onHoverUser={noop}
        onLeaveUser={noop}
      />
    </Box>
  </ThemeProvider>,
);
