/**
 * The handheld layout, at 390x844, in whichever skin is asked for.
 *
 * Modelled on `nimbus.tsx`: real components, the real `useNebulaTheme`, and
 * `applyTheme`/`applyColorMode` after mount, so what renders here is what the
 * app renders rather than a second drawing of it.
 *
 * `?frame=390` is not optional. Headless Edge refuses to give a *window* a
 * viewport below about 504px, and `useIsHandheld` asks a media query - so a
 * shell merely sized to 390px in a wide window would take the desktop branch
 * and the screenshot would be a lie. An iframe is a real viewport as far as
 * media queries are concerned, which is the trick `firstrun.tsx` already uses.
 *
 *   ?theme=nimbus &mode=light|dark &pane=nav|content &sheet=members &lang=en
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
// Without these the components print raw keys, and a key is not the length of
// the word it stands for - so the layout screenshotted is not the layout drawn.
import i18n from "@core/i18n";
import "@core/i18n/nebula";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { useNebulaTheme } from "@nebula/useNebulaAppearance";
import { HANDHELD_ATTR } from "@nebula/useIsHandheld";
import { MobileShell } from "@nebula/components/mobile";
import { MessageRow } from "@nebula/components/chat/MessageRow";
import { BRAND_WORDMARK } from "@nebula/brand";
import { serverTint } from "@nebula/selectors";
import type { MobileShellModel } from "@nebula/shellModel";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import "@standard/theme.css";
import { applyColorMode, applyTheme, type ThemeId } from "@standard/themes";

const params = new URLSearchParams(location.search);

// The frame goes up before anything else does: the inner document is the one
// that mounts, and it is the one whose viewport the media query reads.
const frame = params.get("frame");
if (frame) {
  const inner = new URLSearchParams(params);
  inner.delete("frame");
  const iframe = document.createElement("iframe");
  iframe.src = `${location.pathname}?${inner.toString()}`;
  iframe.width = frame;
  iframe.height = params.get("frameHeight") ?? "844";
  iframe.style.border = "0";
  iframe.style.display = "block";
  document.body.replaceChildren(iframe);
  // The probe has to run at 390px, which is inside the frame - Edge will not
  // give the *window* a viewport that narrow. Same origin, so the outer
  // document can simply lift the answer out and let `--dump-dom` carry it.
  if (params.has("probe"))
    setTimeout(() => {
      const found = iframe.contentDocument?.getElementById("probe");
      const out = document.createElement("pre");
      out.id = "probe";
      out.textContent = found?.textContent ?? "inner probe missing";
      document.body.appendChild(out);
    }, 1600);
}

void i18n.changeLanguage(params.get("lang") ?? "en");
const THEME = (params.get("theme") ?? "nimbus") as ThemeId;
const MODE = (params.get("mode") ?? "light") as "light" | "dark";
const PANE = params.get("pane") === "content" ? "content" : "nav";
const SHEET = params.get("sheet");
const VOICE = params.get("pane") === "voice";
const START = params.get("pane") === "servers" || params.get("pane") === "connect";
const CONNECT = params.get("pane") === "connect";

// Belt and braces: inside a 390px frame the media query is already true, but
// the outer window is not, and a `?handheld=1` capture without the frame is
// how the overflow probe is read.
document.documentElement.setAttribute(HANDHELD_ATTR, "on");

function channel(id: number, name: string, parent = 0) {
  return {
    id,
    parent_id: parent,
    name,
    description_size: null,
    user_count: 0,
    permissions: null,
    temporary: false,
  };
}

const CHANNELS = [
  channel(1, "[ \u{1F49A} ] Green is fucked"),
  channel(2, "general"),
  channel(3, "homelab-ops"),
  channel(4, "sound-check"),
];

const USERS = [
  { session: 1, name: "Sebi", channel_id: 1, texture_size: null },
  { session: 7, name: "ZewiLinux", channel_id: 1, texture_size: null },
  { session: 9, name: "Kivi", channel_id: 3, texture_size: null },
];

useAppStore.setState({
  ownSession: 1,
  channels: CHANNELS as never,
  currentChannel: 1,
  selectedChannel: 1,
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
    body: "the green board is genuinely cooked — dropping tonight's debug clips.",
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
    body: "links live for 23h. if it still won't post after the reflow we requisition a new board.",
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

const ENTRIES = [
  { group: GROUP, session: { label: "Magical Rocks" }, status: "connected", unread: 0 },
  {
    group: { ...GROUP, key: "sd.example:64738", label: "Study Diary", sessionId: null },
    session: null,
    status: "idle",
    unread: 0,
  },
  {
    group: { ...GROUP, key: "ab.example:64738", label: "Aoba Base", sessionId: null },
    session: null,
    status: "idle",
    unread: 7,
  },
  {
    group: { ...GROUP, key: "gh.example:64738", label: "Grid House", sessionId: null },
    session: null,
    status: "idle",
    unread: 0,
  },
];

const MODEL: MobileShellModel = {
  servers: {
    rows: [
      {
        key: GROUP.key,
        label: "magical.rocks",
        favorite: true,
        online: true,
        usersLabel: "2/101 online",
        identitiesLabel: "5 identities",
        initials: "MR",
        tint: serverTint(GROUP.key),
      },
      {
        key: "ip",
        label: "141.94.42.166",
        favorite: false,
        online: false,
        identitiesLabel: "Offline · 2 identities",
        initials: "19",
        tint: serverTint("141.94.42.166"),
      },
      {
        key: "local",
        label: "localhost",
        favorite: false,
        online: false,
        identitiesLabel: "Offline · 3 identities",
        initials: "L",
        tint: serverTint("localhost"),
      },
    ],
    activeKey: GROUP.key,
    search: { value: "", onChange: noop, placeholder: "Search servers" },
    onOpen: noop,
    onAddServer: noop,
    onOpenFriends: noop,
    lastSession: "Last session · magical.rocks · 41m",
  },
  connect: {
    server: {
      label: "magical.rocks",
      address: "mumble://magical.rocks",
      initials: "MR",
      online: true,
      tint: serverTint(GROUP.key),
    },
    stats: [
      { label: "2/101", tone: "ok" },
      { label: "35 ms" },
      { label: "v1.6.0" },
    ],
    identities: [
      { id: "zewi", name: "Zewi", detail: "Certificate · default" },
      { id: "my", name: "MyUser", detail: "Certificate · default" },
      { id: "sebi", name: "Sebi", detail: "Certificate · id4" },
      { id: "su", name: "SuperUser", detail: "Certificate · default", disabled: true },
    ],
    selectedIdentity: "zewi",
    onSelectIdentity: noop,
    onAddIdentity: noop,
    onConnect: noop,
    onBack: noop,
    autoConnect: true,
    onAutoConnectChange: noop,
  },
  voice: {
    channelName: CHANNELS[0].name,
    participants: USERS.slice(0, 2) as never,
    talkingSessions: new Set([7]),
    ownSession: 1,
    micLive: false,
    deafened: false,
    onToggleMic: noop,
    onToggleDeafen: noop,
    onLeave: noop,
    onShareScreen: noop,
    elapsedLabel: "00:41",
    codecLabel: "Magical Rocks / Opus 48kHz",
  },
  serverStrip: {
    entries: ENTRIES as never,
    activeKey: GROUP.key,
    onSelect: noop,
    onAddServer: noop,
    ownName: "Sebi",
  },
  channels: {
    // `ChannelList` takes the tree already flattened and indented, not the
    // raw rooms - the same `OrderedChannel[]` the window hands it.
    channels: CHANNELS.map((entry) => ({ channel: entry as never, depth: 0 })),
    users: USERS as never,
    selectedChannel: 1,
    currentChannel: 1,
    talkingSessions: new Set([7]),
    unreadCounts: { 3: 4 },
    ownSession: 1,
    onSelect: noop,
    onJoin: noop,
    onContextMenu: noop,
    onSelectUser: noop,
    onHoverUser: noop,
    onLeaveUser: noop,
  },
  chatHeader: {
    title: "[ \u{1F49A} ] Green is fucked",
    subtitle: "2 in voice · 3 members",
    memberCount: 3,
    canJoinVoice: true,
    onJoinVoice: noop,
    onToggleSearch: noop,
    onShowMembers: noop,
    onShareScreen: noop,
    onShowPinned: noop,
    onShowInfo: noop,
    onShowDownloads: noop,
  },
  messageList: {
    messages: THREAD,
    users: USERS as never,
    renderMessage: (message, avatar, grouped, restoring, endsGroup) => (
      <MessageRow
        message={message}
        avatar={avatar}
        grouped={grouped}
        endsGroup={endsGroup}
        restoring={restoring}
        stickyAvatar
      />
    ),
  },
  composer: { target: "#green-is-fucked", onSend: noop },
  voiceDock: {
    name: "Sebi",
    session: 1,
    textureSize: null,
    channelName: "[ \u{1F49A} ] Green is fucked",
    latencyMs: 21,
    hideEmpty: false,
    onToggleHideEmpty: noop,
    onOpenSettings: noop,
    onOpenProfile: noop,
  },
  members: {
    groups: [
      {
        key: "channel",
        kind: "channel",
        label: "",
        color: null,
        members: USERS.slice(0, 2).map((user) => ({ user, roles: [], priority: false })),
      },
    ] as never,
    query: "",
    onQueryChange: noop,
    talkingSessions: new Set([7]),
    ownSession: 1,
    showOffline: false,
    onShowOfflineChange: noop,
    onSelect: noop,
    onHover: noop,
    onLeave: noop,
    onClose: noop,
  },
  membersOpen: SHEET === "members",
  onCloseMembers: noop,
  emptyLabel: "Pick a channel to start reading.",
  channelSearch: { value: "", onChange: noop, placeholder: "Search channels" },
  brand: BRAND_WORDMARK,
  serverName: "Magical Rocks",
  screen: "chat",
  onScreen: noop,
  unread: { chats: 6, people: 0 },
};

function Shell() {
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
        sx={(muiTheme) => ({
          height: "100vh",
          "@supports (height: 100dvh)": { height: "100dvh" },
          width: "100%",
          overflow: "hidden",
          background: `${muiTheme.palette.nebula.window},${muiTheme.palette.nebula.bg0}`,
          color: muiTheme.palette.nebula.text,
          fontFamily: muiTheme.palette.nebulaSkin.font,
          fontSize: 13,
        })}
      >
        <MobileShell
          model={START ? { ...MODEL, screen: "connect" } : MODEL}
          initialPane={VOICE || CONNECT ? "content" : PANE}
          openVoice={VOICE}
        />
      </Box>
    </ThemeProvider>
  );
}

if (!frame) createRoot(document.getElementById("root")!).render(<Shell />);

/**
 * What still does not fit.
 *
 * jsdom cannot answer this - it lays nothing out - so the only honest reading
 * of "does the handheld layout overflow 390px" comes from a real engine. Dump
 * it into the DOM so `--dump-dom` can carry it back.
 */
if (!frame && params.has("probe")) {
  setTimeout(() => {
    const seen: string[] = [
      `viewport ${window.innerWidth}x${window.innerHeight}`,
      `document scrollWidth ${document.documentElement.scrollWidth}`,
      `body scrollWidth ${document.body.scrollWidth}`,
    ];
    // `?measure=<selector>` walks up from that element instead, which is how a
    // single misbehaving band is read rather than the whole page.
    const focus = params.get("measure");
    if (focus) {
      const target = document.querySelector<HTMLElement>(focus);
      for (let node = target; node; node = node.parentElement) {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        seen.push(
          `${node.tagName}[${node.dataset.testid ?? node.className?.toString().slice(0, 26)}] ` +
            `x=${box.left.toFixed(1)} w=${box.width.toFixed(1)} h=${box.height.toFixed(1)} ` +
            `display=${style.display} flex=${style.flex} minW=${style.minWidth} ws=${style.whiteSpace}`,
        );
      }
    }
    for (const node of document.querySelectorAll<HTMLElement>("*")) {
      // A strip that is *meant* to scroll sideways is not an overflow.
      if (node.closest("[data-testid='nebula-mobile-server-strip']")) continue;
      const box = node.getBoundingClientRect();
      const over = box.right > window.innerWidth + 0.5 || box.left < -0.5;
      if (!over && node.scrollWidth <= node.clientWidth + 1) continue;
      const id = node.dataset.testid ?? node.dataset.nebulaMark ?? node.className?.toString().slice(0, 30);
      seen.push(
        `${node.tagName}[${id}] left=${box.left.toFixed(1)} right=${box.right.toFixed(1)} ` +
          `scroll=${node.scrollWidth} client=${node.clientWidth}`,
      );
    }
    const out = document.createElement("pre");
    out.id = "probe";
    out.textContent = seen.join("\n");
    document.body.appendChild(out);
  }, 700);
}
