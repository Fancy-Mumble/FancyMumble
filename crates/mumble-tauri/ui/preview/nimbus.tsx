/**
 * The real Nebula surfaces, wearing a catalog theme, through the real path.
 *
 * The `themes.tsx` mock paints its own anatomy from resolved tokens, which is
 * a check on the *palette* and says nothing about whether the components pick
 * the skin up. This page mounts the actual ChannelList, ChatHeader, MessageRow
 * and Composer under `useNebulaTheme`, with `data-theme` stamped on `<html>`
 * exactly as `applyTheme` stamps it - so what renders here is what the app
 * renders. `?theme=` and `?mode=` pick the pair.
 */
import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { useNebulaTheme } from "@nebula/useNebulaAppearance";
import { ChannelList } from "@nebula/components/sidebar/ChannelList";
import { SearchBox } from "@nebula/components/primitives/SearchBox";
import { Composer } from "@nebula/components/chat/Composer";
import { ChatHeader } from "@nebula/components/chat/ChatHeader";
import { MessageRow } from "@nebula/components/chat/MessageRow";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { useEffect, useState } from "react";
import "@standard/theme.css";
import { applyColorMode, applyTheme, type ThemeId } from "@standard/themes";

const params = new URLSearchParams(location.search);
const THEME = (params.get("theme") ?? "nimbus") as ThemeId;
const MODE = (params.get("mode") ?? "light") as "light" | "dark";

function channel(id: number, name: string) {
  return {
    id,
    parent_id: 0,
    name,
    description_size: null,
    user_count: 0,
    permissions: null,
    temporary: false,
  };
}

const CHANNELS = [
  channel(1, "[ 💚 ] Green is fucked"),
  channel(2, "general"),
  channel(3, "homelab-ops"),
];

const USERS = [
  { session: 1, name: "Sebi", channel_id: 1, texture_size: null },
  { session: 7, name: "ZewiLinux", channel_id: 1, texture_size: null },
];

useAppStore.setState({
  ownSession: 1,
  users: USERS as never,
  polls: new Map(),
  linkEmbeds: new Map(),
  disableLinkPreviews: true,
  readReceiptVersion: 0,
  reactionVersion: 0,
});

function msg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    sender_session: 7,
    sender_name: "ZewiLinux",
    body: "the green board is genuinely cooked. capacitors look fine but it won't post — dropping the clips from tonight's debug session.",
    channel_id: 1,
    is_own: false,
    message_id: Math.random().toString(36).slice(2),
    timestamp: 1_757_116_620_000,
    ...partial,
  } as ChatMessage;
}

const THREAD: ChatMessage[] = [
  msg({}),
  msg({
    body: "links are live for 23h. if it still won't post after the reflow I'm calling it — we requisition a new board in the morning.",
    is_own: true,
    sender_session: 1,
    sender_name: "Sebi",
  }),
];

const noop = () => {};

function Shell() {
  // Through `applyTheme`, which is what the picker calls - and after mount, so
  // nothing that restores a stored preference can land on top of it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    applyTheme(THEME);
    applyColorMode(MODE);
    setReady(true);
  }, []);
  const theme = useNebulaTheme(null);
  if (!ready) return null;
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          width: 1240,
          height: 720,
          display: "flex",
          overflow: "hidden",
          background: theme.palette.nebula.bg0,
          backgroundImage: theme.palette.nebula.window,
          fontFamily: theme.palette.nebulaSkin.font,
          boxShadow: "0 24px 60px rgba(0,0,0,.5)",
        }}
      >
        <Box
          sx={{
            width: 300,
            flex: "0 0 300px",
            background: theme.palette.nebula.panel,
            borderRight: `1px solid ${theme.palette.nebula.line2}`,
            overflow: "auto",
            p: "10px",
          }}
        >
          <Box sx={{ pb: "10px" }}>
            <Box data-probe="SearchBox-wrapper">
              <SearchBox value="" onChange={noop} placeholder="Search channels" hint="Ctrl+F" />
            </Box>
          </Box>
          <ChannelList
            channels={CHANNELS.map((channel) => ({ channel, depth: 0 })) as never}
            users={USERS as never}
            selectedChannel={Number(params.get("sel") ?? 1)}
            currentChannel={Number(params.get("cur") ?? 1)}
            talkingSessions={new Set()}
            unreadCounts={{ 3: 4 }}
            ownSession={1}
            onSelect={noop}
            onJoin={noop}
            onContextMenu={noop}
            onSelectUser={noop}
            onHoverUser={noop}
            onLeaveUser={noop}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <ChatHeader
            channelName="[ 💚 ] Green is fucked"
            voiceCount={2}
            inVoice
            onJoinVoice={noop}
            onToggleSearch={noop}
            onShowMembers={noop}
            onShareScreen={noop}
            onShowPinned={noop}
            onShowInfo={noop}
            onShowDownloads={noop}
          />
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              gap: "14px",
              p: "22px 26px",
              background: theme.palette.nebula.backdrop,
            }}
          >
            {THREAD.map((m) => (
              <MessageRow key={m.message_id} message={m} bubbleStyle="bubbles" />
            ))}
          </Box>
          <Composer target="#[ 💚 ] Green is fucked" onSend={noop} />
        </Box>
      </Box>
    </ThemeProvider>
  );
}

/** What the skin actually published, read back off the cascade. */
function RadiusProbe() {
  const [rows, setRows] = useState<string[]>([]);
  useEffect(() => {
    // After the shell has mounted its ThemeProvider, not before: the probe is
    // a sibling of it, and `Shell` renders null until `applyTheme` has run.
    const at = setTimeout(() => {
    const css = getComputedStyle(document.documentElement);
    setRows(
      ["sm", "md", "lg", "xl", "rail", "avatar"]
        .map((k) => `--nebula-radius-${k}: ${css.getPropertyValue(`--nebula-radius-${k}`).trim() || "(unset)"}`)
        .concat(
          // What the DOM actually computed, element by element: the vars can be
          // right while a component hardcodes past them.
          (
            [
              ["SearchBox", '[data-probe="SearchBox-wrapper"] > div'],
              ["Composer panel", "[data-nebula-composer]"],
              ["Send button", '[data-testid="chat-send"]'],
              ["Channel row", '[data-testid="channel-item"]'],
              ["Search plate", '[data-probe="SearchBox-wrapper"] > div'],
            ] as [string, string][]
          ).map(([name, sel]) => {
            const el = document.querySelector<HTMLElement>(sel);
            if (!el) return `${name}: (not found: ${sel})`;
            const cs = getComputedStyle(el);
            return `${name}: radius ${cs.borderRadius} · clip ${cs.clipPath} · border ${cs.borderTopWidth}`;
          }),
        )
        .concat(
          [`--nebula-clip-selection: ${css.getPropertyValue("--nebula-clip-selection").trim() || "(unset)"}`],
          [`--nebula-font: ${css.getPropertyValue("--nebula-font").trim() || "(unset)"}`],
        ),
    );
    }, 400);
    return () => clearTimeout(at);
  }, []);
  return (
    <pre id="probe" style={{ color: "#7fc9ff", font: "12px monospace", padding: "12px 0 0" }}>
      {rows.join("\n")}
    </pre>
  );
}

createRoot(document.getElementById("root")!).render(
  <Box sx={{ p: "40px", background: "#0a121b", minHeight: "100vh" }}>
    <Shell />
    <RadiusProbe />
  </Box>,
);
