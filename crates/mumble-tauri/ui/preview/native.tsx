/**
 * The whole client on a small server that exists only here: what the native
 * view (`src/ui/gpui`) is measured against.
 *
 * The server is the native view's own plain demo (`FANCY_GPUI_DEMO=plain`):
 * the same two channels, five people and five messages, so a screenshot of
 * this page and one of that view differ only in how they are drawn. See
 * "Measuring the look" in `src/ui/gpui/README.md`.
 *
 * `?mode=light` for the light scheme; `?dump` writes every box's place,
 * type and paint into `#dbg` after a few seconds, for `--dump-dom`.
 */
export {};
const wantDark = new URLSearchParams(location.search).get("mode") !== "light";
document.documentElement.setAttribute("data-color-mode", wantDark ? "dark" : "light");
const realMM = window.matchMedia.bind(window);
window.matchMedia = ((q: string) => {
  if (q.includes("prefers-color-scheme")) {
    const light = q.includes("light");
    return { matches: light ? !wantDark : wantDark, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as any;
  }
  return realMM(q);
}) as any;
const FIRST = 1_760_045_820_000;
const MIN = 60_000;
const chan = (id: number, parent_id: number | null, name: string) => ({
  id, parent_id, name, description_size: null, user_count: 0, permissions: 0xffffffff >>> 0, temporary: false, position: 0, max_users: 0,
});
const user = (session: number, name: string) => ({
  session, name, channel_id: 1, user_id: null, texture_size: null, comment_size: null,
  mute: false, deaf: false, suppress: false, self_mute: false, self_deaf: false, priority_speaker: false, hash: "h" + session,
});
const said = (minute: number, session: number, name: string, body: string) => ({
  sender_session: session, sender_name: name, sender_hash: "h" + session, body, channel_id: 1, is_own: session === 1,
  message_id: "demo-" + minute, timestamp: FIRST + minute * MIN,
});
const channels = [chan(0, null, "Root"), chan(1, 0, "lounge")];
const users = [user(1, "Alex"), user(2, "Flora"), user(3, "Rin"), user(4, "Scout"), user(5, "Torque")];
const messages = [
  said(0, 1, "Alex", "Welcome to our creative lounge!"),
  said(1, 3, "Rin", "Sketching a new character design tonight."),
  said(2, 5, "Torque", "My coastal drive was beautiful. Sharing photos soon."),
  said(3, 2, "Flora", "The dahlias are blooming in the garden."),
  said(4, 4, "Scout", "Scout says hello from our walk!"),
];
const session = { id: "sess", label: "magical.rocks", host: "magical.rocks", port: 64738, username: "Alex", certLabel: null, status: "connected" };
const server = { id: "s1", label: "magical.rocks", host: "magical.rocks", port: 64738, username: "Alex", cert_label: null };
const seen = new Set<string>();
const stores: string[] = [];
const answers: Record<string, (args: any) => unknown> = {
  get_channels: () => channels,
  get_users: () => users,
  get_messages: () => messages,
  get_messages_page: () => ({ rows: messages, moreBefore: false, moreAfter: false, atTail: true }),
  get_current_channel: () => 1,
  get_own_session: () => 1,
  get_status: () => "connected",
  list_servers: () => [session],
  get_active_server: () => "sess",
  get_unread_counts: () => ({}),
  get_dm_unread_counts: () => ({}),
  get_listened_channels: () => [],
  get_push_subscribed_channels: () => [],
  get_server_config: () => ({ max_message_length: 5000, max_image_message_length: 131072, allow_html: true, webrtc_sfu_available: false, fancy_rest_api_url: null }),
  get_server_info: () => ({ host: "magical.rocks", port: 64738, user_count: 5, max_users: 101, protocol_version: "1.6.0", fancy_version: null, fancy_protocol: null, release: "1.6.0", os: "Linux", max_bandwidth: 144000, opus: true }),
  get_welcome_text: () => null,
  get_voice_state: () => "inactive",
  get_audio_settings: () => ({}),
  "plugin:store|load": (a: any) => { stores.push(String(a?.path ?? "")); return stores.length; },
  "plugin:store|get": (a: any) => {
    const file = stores[(a?.rid ?? 0) - 1] ?? "";
    if (file.endsWith("servers.json") && a?.key === "servers") return [[{ ...server, favorite: false }], true];
    return null;
  },
  "plugin:event|listen": () => 1,
  "plugin:event|unlisten": () => null,
  get_system_clock_format: () => "24h",
};
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: unknown) => {
    if (!(cmd in answers) && !seen.has(cmd)) {
      seen.add(cmd);
      const dbg = document.getElementById("dbg");
      if (dbg) dbg.textContent += cmd + "\n";
    }
    return cmd in answers ? answers[cmd](args) : null;
  },
  transformCallback: (cb: unknown) => cb,
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
};
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
window.addEventListener("error", (e) => { const d = document.getElementById("dbg"); if (d) d.textContent += "ERR " + e.message + "\n"; });
window.addEventListener("unhandledrejection", (e) => { const d = document.getElementById("dbg"); if (d) d.textContent += "REJ " + String((e as any).reason) + "\n"; });
const { createRoot } = await import("react-dom/client");
await import("@core/i18n");
const { useAppStore } = await import("@core/store");
useAppStore.setState({
  status: "connected", sessions: [session], activeServerId: "sess",
  channels, users, messages, pollMessages: [], dmMessages: [],
  selectedChannel: 1, selectedDmUser: null, selectedUser: null, currentChannel: 1, ownSession: 1,
} as any);
const { default: NebulaApp } = await import("@nebula/index");
createRoot(document.getElementById("root")!).render(<NebulaApp />);
if (new URLSearchParams(location.search).has("dump")) {
  setTimeout(() => {
    const out: string[] = [];
    const walk = (el: Element, depth: number) => {
      if (el.id === "dbg") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { for (const child of el.children) walk(child, depth + 1); return; }
      const c = getComputedStyle(el);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join(" ").slice(0, 40);
      const bits = [
        `${"  ".repeat(depth)}${el.tagName.toLowerCase()}`,
        `[${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}]`,
      ];
      if (own) bits.push(`"${own}" ${c.fontSize}/${c.lineHeight} w${c.fontWeight} ls${c.letterSpacing} ${c.color}`);
      if (c.backgroundColor !== "rgba(0, 0, 0, 0)") bits.push(`bg ${c.backgroundColor}`);
      if (c.backgroundImage !== "none") bits.push(`bgi ${c.backgroundImage.slice(0, 160)}`);
      if (c.borderTopWidth !== "0px") bits.push(`bt ${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`);
      if (c.borderLeftWidth !== "0px") bits.push(`bl ${c.borderLeftWidth} ${c.borderLeftColor}`);
      if (c.borderRightWidth !== "0px") bits.push(`br ${c.borderRightWidth} ${c.borderRightColor}`);
      if (c.borderBottomWidth !== "0px") bits.push(`bb ${c.borderBottomWidth} ${c.borderBottomColor}`);
      if (c.borderTopLeftRadius !== "0px") bits.push(`rad ${c.borderTopLeftRadius} ${c.borderTopRightRadius} ${c.borderBottomRightRadius} ${c.borderBottomLeftRadius}`);
      if (c.boxShadow !== "none") bits.push(`sh ${c.boxShadow}`);
      if (c.opacity !== "1") bits.push(`op ${c.opacity}`);
      if (el.tagName === "svg") bits.push(`svg ${el.getAttribute("class") ?? ""} sw${c.strokeWidth} ${c.color}`);
      if (own) bits.push(`ff ${c.fontFamily.slice(0, 40)}`);
      out.push(bits.join(" "));
      if (el.tagName === "svg") return;
      for (const child of el.children) walk(child, depth + 1);
    };
    walk(document.body, 0);
    const d = document.getElementById("dbg")!;
    d.textContent = out.join("\n");
  }, 7000);
}
