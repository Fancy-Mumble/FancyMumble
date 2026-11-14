/**
 * The whole client on a small server that exists only here: what the native
 * view (`src/ui/gpui`) is measured against.
 *
 * The server is the native view's own plain demo (`FANCY_GPUI_DEMO=plain`):
 * the same two channels, five people and five messages, so a screenshot of
 * this page and one of that view differ only in how they are drawn. See
 * "Measuring the look" in `src/ui/gpui/README.md`.
 *
 * `?screen=connect` is the same client before it is on a server, with the
 * demo's saved servers; `?settings=<page>` the settings open on that page;
 * `?mode=light` for the light scheme, `?theme=<id>` for another theme; `?dump` writes every box's place,
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
// `?room=<name>` names the joined channel otherwise (as the native demo's
// `FANCY_GPUI_DEMO_ROOM` does): a way to look at a drawn theme's wordmark.
const channels = [chan(0, null, "Root"), chan(1, 0, new URLSearchParams(location.search).get("room") ?? "lounge")];
const users = [user(1, "Alex"), user(2, "Flora"), user(3, "Rin"), user(4, "Scout"), user(5, "Torque")];
const messages = [
  said(0, 1, "Alex", "Welcome to our creative lounge!"),
  said(1, 3, "Rin", "Sketching a new character design tonight."),
  said(2, 5, "Torque", "My coastal drive was beautiful. Sharing photos soon."),
  said(3, 2, "Flora", "The dahlias are blooming in the garden."),
  said(4, 4, "Scout", "Scout says hello from our walk!"),
];
// The native demo's servers, by name: here and nowhere else in this file,
// to change together with the demo's (`src/ui/gpui/src/demo.rs`).
const HOSTS = { home: "magical.rocks", other: "kumo.jp", local: "localhost" } as const;
const session = { id: "sess", label: HOSTS.home, host: HOSTS.home, port: 64738, username: "Alex", certLabel: null, status: "connected" };
const server = { id: "s1", label: HOSTS.home, host: HOSTS.home, port: 64738, username: "Alex", cert_label: null };
const connecting = new URLSearchParams(location.search).get("screen") === "connect";
const saved = (id: string, host: string, username: string, favorite: boolean) => ({
  id, label: host, host, port: 64738, username, cert_label: null, favorite,
});
// The native demo's saved identities, connected or not (its rail lists the
// ones it is not on too), and what its servers answer a ping with.
const savedServers = [
  saved("home-alex", HOSTS.home, "Alex", true),
  saved("home-work", HOSTS.home, "Alex (work)", true),
  saved("other", HOSTS.other, "Alex", false),
  saved("local", HOSTS.local, "Alex", false),
];
const pong = (users: number, latency: number, version: string) => ({
  online: true, latency_ms: latency, user_count: users, max_user_count: 101, server_version: version,
});
const pings: Record<string, unknown> = {
  [HOSTS.home]: pong(3, 18, "1.6.0"),
  [HOSTS.other]: pong(0, 62, "1.5.7"),
};
const offline = { online: false, latency_ms: null, user_count: null, max_user_count: null, server_version: null };
const seen = new Set<string>();
const stores: string[] = [];
const answers: Record<string, (args: any) => unknown> = {
  get_channels: () => channels,
  get_users: () => users,
  get_messages: () => messages,
  get_messages_page: () => ({ rows: messages, moreBefore: false, moreAfter: false, atTail: true }),
  get_current_channel: () => 1,
  get_own_session: () => 1,
  get_status: () => (connecting ? "disconnected" : "connected"),
  list_servers: () => (connecting ? [] : [session]),
  get_active_server: () => (connecting ? null : "sess"),
  ping_server: (a: any) => pings[a?.host] ?? offline,
  get_unread_counts: () => ({}),
  get_dm_unread_counts: () => ({}),
  get_listened_channels: () => [],
  get_push_subscribed_channels: () => [],
  get_server_config: () => ({ max_message_length: 5000, max_image_message_length: 131072, allow_html: true, webrtc_sfu_available: false, fancy_rest_api_url: null }),
  get_server_info: () => ({ host: HOSTS.home, port: 64738, user_count: 5, max_users: 101, protocol_version: "1.6.0", fancy_version: null, fancy_protocol: null, release: "1.6.0", os: "Linux", max_bandwidth: 144000, opus: true }),
  get_welcome_text: () => null,
  get_voice_state: () => "inactive",
  get_audio_settings: () => ({}),
  "plugin:store|load": (a: any) => { stores.push(String(a?.path ?? "")); return stores.length; },
  // The store as the native demo's state has it, and an empty one rather
  // than a failing one: a failed read leaves the start-up's appearance
  // unapplied, and with it the theme's own typeface (`applyFont`).
  "plugin:store|get": (a: any) => storeAnswer(a),
  "plugin:event|listen": () => 1,
  "plugin:event|unlisten": () => null,
  get_system_clock_format: () => "24h",
};
// The settings pages ask for more: the native demo engine's voice settings,
// devices and certificates, and an empty store rather than a failing one.
if (new URLSearchParams(location.search).has("settings")) {
  const device = (name: string, is_default: boolean) => ({ name, is_default });
  Object.assign(answers, {
    get_audio_settings: () => ({
      selected_device: null, selected_output_device: null, auto_gain: true, vad_threshold: 0.01,
      max_gain_db: 15, noise_gate_close_ratio: 0.8, hold_frames: 15, push_to_talk: false,
      push_to_talk_key: null, bitrate_bps: 72000, frame_size_ms: 20, noise_suppression: true,
      denoiser_algorithm: "rnnoise", denoiser_params: {}, input_volume: 1, output_volume: 1,
      auto_input_sensitivity: false, force_tcp_audio: false, exclusive_input: false,
    }),
    get_audio_devices: () => [device("Built-in Microphone", true), device("USB Headset", false)],
    get_output_devices: () => [device("Built-in Speakers", true), device("USB Headset", false)],
    // What a Windows build of the engine carries, as the native page asks it.
    get_available_denoiser_algorithms: () => ["rnnoise", "deepfilternet", "omlsa_imcra", "spectral_subtraction"],
    get_denoiser_param_specs: () => [],
    get_audio_backend: () => true,
    list_certificates: () => ["alex", "work"],
  });
  // The native client keeps no profile per identity, so its Profile page has
  // no identity to choose between: the web's is shown with none either.
  if (new URLSearchParams(location.search).get("settings") === "profile")
    Object.assign(answers, { list_certificates: () => [] });
}
// What the store holds: set up already, in Nebula; light or dark as asked,
// as the native view is started in one; and the local user's profile as the
// native demo's (`demo/profiles.rs`: pronouns, and the words without their
// picture, which the web keeps elsewhere).
function storeAnswer(a: any): [unknown, boolean] {
  const file = stores[(a?.rid ?? 0) - 1] ?? "";
  if (file.endsWith("servers.json") && a?.key === "servers") return [savedServers, true];
  if (a?.key === "preferences") return [{ hasCompletedSetup: true, uiDesign: "nebula" }, true];
  if (file.endsWith("personalization.json") && a?.key === "data")
    return [{ colorMode: wantDark ? "dark" : "light" }, true];
  if (file.endsWith("profile.json") && a?.key === "_migrated_per_identity") return [true, true];
  if (file.endsWith("profile.json") && a?.key === "data")
    return [{
      profile: { pronouns: "they/them" },
      bio: '<p><strong>Plays</strong> the <em>drums</em>, badly.</p><p>Find me at <a href="https://example.org/alex">example.org/alex</a></p>',
      avatarDataUrl: null,
    }, true];
  return [null, false];
}
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
if (!connecting)
  useAppStore.setState({
    status: "connected", sessions: [session], activeServerId: "sess",
    channels, users, messages, pollMessages: [], dmMessages: [],
    selectedChannel: 1, selectedDmUser: null, selectedUser: null, currentChannel: 1, ownSession: 1,
  } as any);
const { default: NebulaApp } = await import("@nebula/index");
createRoot(document.getElementById("root")!).render(<NebulaApp />);
// After the app's own start-up, which falls back to the default theme when
// it finds no stored choice.
// `?click=<css selector>` presses something once the client is up: a way
// to photograph a menu or a dialog.
const wantClick = new URLSearchParams(location.search).get("click");
if (wantClick)
  setTimeout(() => {
    const target = document.querySelector(wantClick);
    for (const kind of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      target?.dispatchEvent(new MouseEvent(kind, { bubbles: true, cancelable: true, view: window }));
    // What opened is placed against the layout of that moment, and the
    // layout settles after it; a popover places itself again on a resize,
    // as it would on screen by then.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 6000);
  }, 2500);
// `?settings=<page>` opens the settings on that page (`voice`,
// `personalize`, ...), the way Ctrl+, and a click on its entry would.
const wantSettings = new URLSearchParams(location.search).get("settings");
if (wantSettings)
  setTimeout(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    setTimeout(() => document.querySelector<HTMLElement>(`[data-tab-id="${wantSettings}"]`)?.click(), 500);
  }, 2000);
// `&scroll=<px>` with `?settings`: the page scrolled that far down, for the
// part of a long page under the fold (the native view's `settings:<page>@<px>`).
const wantScroll = Number(new URLSearchParams(location.search).get("scroll") ?? 0);
if (wantSettings && wantScroll > 0)
  setTimeout(() => {
    // The page's own scroller: the one right of the column that scrolls furthest.
    const panes = [...document.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const overflow = getComputedStyle(el).overflowY;
      return (overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight
        && el.getBoundingClientRect().left > 300;
    });
    panes.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    if (panes[0]) panes[0].scrollTop = wantScroll;
  }, 4500);
const wantTheme = new URLSearchParams(location.search).get("theme");
if (wantTheme) setTimeout(() => document.documentElement.setAttribute("data-theme", wantTheme), 1500);
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
