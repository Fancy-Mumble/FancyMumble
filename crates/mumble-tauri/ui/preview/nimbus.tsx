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
// Every other preview page boots these; this one mounts the real ChannelList,
// ChatHeader, VoiceDock and TitleBar, all of which translate - without them
// the page prints raw keys, and a key is not the length of the word it stands
// for, so the layout it screenshots is not the layout the app draws.
import i18n from "@core/i18n";
import "@core/i18n/nebula";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { useNebulaTheme } from "@nebula/useNebulaAppearance";
import { ChannelList } from "@nebula/components/sidebar/ChannelList";
import { ServerRail } from "@nebula/components/sidebar/ServerRail";
import { TitleBar } from "@nebula/components/chrome/TitleBar";
import { WindowControls } from "@nebula/components/chrome/WindowControls";
import { SidebarShell } from "@nebula/components/sidebar/SidebarShell";
import { VoiceDock } from "@nebula/components/sidebar/VoiceDock";
import { BRAND_WORDMARK } from "@nebula/brand";
import { SearchBox } from "@nebula/components/primitives/SearchBox";
import { Composer } from "@nebula/components/chat/Composer";
import { ChatHeader } from "@nebula/components/chat/ChatHeader";
import { MessageRow } from "@nebula/components/chat/MessageRow";
import { ChatBackdrop } from "@nebula/components/chat/ChatBackdrop";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { useEffect, useState } from "react";
import "@standard/theme.css";
import { applyColorMode, applyTheme, type ThemeId } from "@standard/themes";

const params = new URLSearchParams(location.search);
void i18n.changeLanguage(params.get("lang") ?? "en");
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
  // The backdrop reads the open room's name off the store to set its wordmark.
  channels: CHANNELS as never,
  currentChannel: 1,
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

const GROUP = {
  key: "magical.rocks:64738",
  label: "Magical Rocks",
  host: "magical.rocks",
  port: 64738,
  identities: [],
  favorite: true,
  sessionId: "s1",
};

const RAIL_ENTRIES = [
  { group: GROUP, session: { label: "Magical Rocks" }, status: "connected", unread: 0 },
  {
    group: { ...GROUP, key: "sd.example:64738", label: "Study Diary", sessionId: null },
    session: null,
    status: "idle",
    unread: 0,
  },
];

function Shell() {
  // Through `applyTheme`, which is what the picker calls - and after mount, so
  // nothing that restores a stored preference can land on top of it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    applyTheme(THEME);
    applyColorMode(MODE);
    setReady(true);
    // `?draft=` types into the composer after mount, so a screenshot can show
    // Send in its lit state rather than its empty-draft one.
    const draft = params.get("draft");
    if (draft) {
      setTimeout(() => {
        const field = document.querySelector<HTMLTextAreaElement>("[data-nebula-composer] textarea");
        if (!field) return;
        // React installs its own value setter on the element; going through
        // the prototype's is what makes it see the change.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(field, draft);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }, 400);
    }
  }, []);
  const theme = useNebulaTheme(null);
  if (!ready) return null;
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          width: Number(params.get("w") ?? 1240),
          height: Number(params.get("h") ?? 720),
          display: "flex",
          overflow: "hidden",
          background: theme.palette.nebula.bg0,
          backgroundImage: theme.palette.nebula.window,
          fontFamily: theme.palette.nebulaSkin.font,
          boxShadow: "0 24px 60px rgba(0,0,0,.5)",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <TitleBar
          serverLabel="Magical Rocks"
          friendsActive={false}
          onOpenFriends={noop}
          quickConnectOpen={false}
          entries={RAIL_ENTRIES as never}
          activeKey={GROUP.key}
          tabs
        />
        {theme.palette.nebulaSkin.chromeSlots.windowControls === "corner" && (
          <Box sx={{ position: "absolute", top: 0, right: 0, zIndex: 60, display: "flex" }}>
            <WindowControls variant="corner" label="Magical Rocks" />
          </Box>
        )}
        <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <ServerRail
          entries={RAIL_ENTRIES as never}
          activeKey={GROUP.key}
          expanded={false}
          onToggleExpanded={noop}
          onSelect={noop}
          onAddServer={noop}
          onDisconnect={noop}
        />
        <SidebarShell
          brand={BRAND_WORDMARK}
          heading={{ label: "Magical Rocks", count: CHANNELS.length }}
          search={
            <Box data-probe="SearchBox-wrapper">
              <SearchBox value="" onChange={noop} placeholder="Search channels" hint="Ctrl+F" />
            </Box>
          }
          footer={
            <VoiceDock
              name="Sebi"
              session={1}
              textureSize={null}
              channelName="[ 💚 ] Green is fucked"
              latencyMs={18}
              hideEmpty={false}
              onToggleHideEmpty={noop}
              onOpenSettings={noop}
              onShareScreen={noop}
              onOpenProfile={noop}
              serverName="Magical Rocks"
            />
          }
        >
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
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
        </SidebarShell>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <ChatHeader
            title="[ 💚 ] Green is fucked"
            subtitle="2 in voice / Opus 48kHz"
            memberCount={2}
            canJoinVoice
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
              // Same as the app's chat pane: `zIndex: 0` establishes the
              // stacking context the backdrop's `zIndex: -1` sits inside.
              // Without it the layer escapes to an ancestor and paints behind
              // the whole window. The backdrop paints the wash itself, so this
              // Box no longer carries one.
              zIndex: 0,
            }}
          >
            <ChatBackdrop />
            {THREAD.map((m) => (
              <MessageRow key={m.message_id} message={m} bubbleStyle="bubbles" />
            ))}
          </Box>
          <Composer target="#[ 💚 ] Green is fucked" onSend={noop} />
        </Box>
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
