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
// `?links=<variant>`: Scout's last message is a link and nothing else, as a
// link pasted into the composer is, and the server's card for it is one of
// these made-up ones, each a different poster. The same cards,
// pictures and words as the native demo's `FANCY_GPUI_DEMO_LINKS=<variant>`
// (`src/ui/gpui/src/demo/link_cards.rs`): change the two together. The
// pictures are `preview/linkcards/`; nothing reaches the network.
const LINK_VARIANT = new URLSearchParams(location.search).get("links");
const media = (file: string, width: number, height: number) => ({
  url: "", width, height, preview: { data_url: `/linkcards/${file}`, mime: "image/png", width, height },
});
const LINK_CARDS: Record<string, Record<string, unknown>> = {
  full: {
    url: "https://www.reddit.com/r/LinkCards/comments/1abc2d/where_to_buy_tickets/", type: "link",
    title: "From the LinkCards community on Reddit",
    description: "I've tried to buy tickets online but the shop would not take my card. Does anyone know where else to buy them?",
    site_name: "Reddit", author: { name: "quiet_heron_204" }, favicon: media("icon.png", 32, 32), image: media("wide.png", 1200, 630),
  },
  video: {
    url: "https://vimeo.com/104729384", type: "video", title: "Night drive along the coast",
    site_name: "Vimeo", author: { name: "Coastline Films" }, media_duration: "4:12", image: media("wide.png", 1200, 630),
  },
  contained: {
    url: "https://art.example.com/works/2817", type: "image", title: "Two by the water",
    site_name: "art.example.com", author: { name: "ame" }, fields: [{ name: "likes", value: "12.4K", inline: true }],
    image: media("tall.png", 600, 850),
  },
  native: {
    url: "https://pictures.example.net/posts/1", type: "image", title: "Summer beach, a study",
    site_name: "pictures.example.net", image: media("small.png", 360, 253),
  },
  article: {
    url: "https://example.org/posts/the-long-way-round", type: "article",
    title: "The long way round: a field report on latency, jitter and the people who notice",
    description: "Why the numbers that look fine on a graph still sound wrong in a room.",
    site_name: "example.org", image: media("wide.png", 1200, 630),
  },
  bare: {
    url: "https://docs.example.org/reference/acl", type: "link", title: "Access control lists",
    description: "Rules, groups, and the order they are applied in.", site_name: "docs.example.org",
  },
  title: { url: "https://notes.example.org/today", type: "link", title: "Notes for today" },
  shop: {
    url: "https://deals.example.de/deals/the-c64-maxi", type: "product", title: "THE C64 Maxi, a Commodore remake",
    site_name: "deals.example.de", price: { amount: "89.99", currency: "EUR", was: "129.99", availability: "instock" },
    fields: [{ name: "shipping", value: "Free", inline: true }], image: media("product.png", 600, 600),
  },
  compare: {
    url: "https://prices.example.de/compare/headphones-x", type: "product", title: "Headphones X, wireless",
    site_name: "prices.example.de", price: { amount: "149", currency: "EUR", was: "", availability: "" },
    fields: [{ name: "sellers", value: "14", inline: true }],
  },
};
const LINK_CARD = LINK_VARIANT ? LINK_CARDS[LINK_VARIANT] : undefined;
if (LINK_CARD) messages[4] = said(4, 4, "Scout", String(LINK_CARD.url));
// `?share=1`: Alex shares `preview/shares/card.png` by a public link that
// lasts a week; `?album=<count>`: that many of `preview/shares/aNN.png` in
// one message. As the native demo's `FANCY_GPUI_DEMO_SHARE=<files>` does
// with the same files: change the two together.
const SHARE_SIZES: Record<string, [number, number, number]> = {
  "card.png": [38_642, 2000, 1200],
  "a01.png": [5_294, 600, 900], "a02.png": [6_502, 900, 600], "a03.png": [7_211, 900, 600],
  "a04.png": [5_861, 600, 900], "a05.png": [6_613, 900, 600], "a06.png": [7_278, 900, 600],
  "a07.png": [6_135, 600, 900], "a08.png": [7_489, 900, 600], "a09.png": [7_244, 900, 600],
  "a10.png": [7_956, 600, 900], "a11.png": [4_900, 900, 600],
};
const shareParams = new URLSearchParams(location.search);
const sharedNames = shareParams.has("share")
  ? ["card.png"]
  : Array.from({ length: Number(shareParams.get("album") ?? 0) }, (_, n) => `a${String(n + 1).padStart(2, "0")}.png`);
if (sharedNames.length > 0) {
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86_400;
  const marks = sharedNames.map((filename) => {
    const [sizeBytes, width, height] = SHARE_SIZES[filename] ?? [0, 0, 0];
    const info = { url: `/shares/${filename}`, filename, sizeBytes, mode: "public", expiresAt, width, height };
    return `<!-- FANCY_FILE:${btoa(JSON.stringify(info))} -->`;
  });
  messages.push(said(5, 1, "Alex", marks.join("\n")));
}
// The native demo's servers, by name: here and nowhere else in this file,
// to change together with the demo's (`src/ui/gpui/src/demo.rs`).
// `?host=<name>` names the home server otherwise, as the native demo's
// `FANCY_GPUI_DEMO_NAME` does: for pictures nobody can take for a real one.
const HOSTS = {
  home: new URLSearchParams(location.search).get("host") ?? "magical.rocks", other: "kumo.jp", local: "localhost",
} as const;
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
  // The card for `?links`, answered at once as a card held on this machine is.
  request_link_preview: (a: any) =>
    LINK_CARD ? (a?.urls ?? []).filter((url: string) => url === LINK_CARD.url).map((url: string) => ({ requested_url: url, embed: LINK_CARD })) : [],
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
  adminAnswers();
}
// The server-admin pages, on the native demo's made-up register (the
// `connected` demo: `registered_of` and `roles` in `src/ui/gpui/src/demo.rs`):
// whoever is here was seen just now in the lounge, Wren twelve days ago,
// Otto never; Rin is a moderator. Their answers come as events, as the
// engine's do, to whatever listens for them.
function adminAnswers() {
  const heard: Record<string, ((event: unknown) => void)[]> = {};
  const tell = (event: string, payload: unknown) =>
    setTimeout(() => (heard[event] ?? []).forEach((handler) => handler({ event, id: 0, payload })), 0);
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19) + "Z";
  const account = (user_id: number, name: string, days: number | null, last_channel: number | null) => ({
    user_id, name, last_seen: days === null ? null : ago(days), last_channel, texture_size: null,
  });
  const accounts = [
    account(101, "Alex", 0, 1), account(102, "Flora", 0, 1), account(103, "Rin", 0, 1),
    account(105, "Torque", 0, 1), account(120, "Wren", 12, 1), account(121, "Otto", null, null),
  ];
  const group = (name: string, add: number[], color: string | null) => ({
    name, inherited: false, inherit: true, inheritable: true, add, remove: [], inherited_members: [], color,
  });
  Object.assign(answers, {
    "plugin:event|listen": (a: any) => {
      (heard[a?.event] ??= []).push(a?.handler);
      return heard[a?.event].length;
    },
    request_user_list: () => tell("user-list", accounts),
    // The demo's two bans (`seeded_bans`), as the wire counts their masks:
    // one IPv4 address is 128 there, a /24 is 120.
    request_ban_list: () =>
      tell("ban-list", [
        { address: "203.0.113.7", mask: 128, name: "Mallory", hash: "", reason: "spam", start: "2026-01-02", duration: 0 },
        { address: "198.51.100.0", mask: 120, name: "", hash: "", reason: "", start: "2026-02-03", duration: 7200 },
      ]),
    request_acl: (a: any) =>
      tell("acl", {
        channel_id: a?.channelId ?? 0, inherit_acls: true, acls: [],
        groups: (a?.channelId ?? 0) === 0 ? [group("moderators", [103], "#e09a4b")] : [],
      }),
  });
}
// `?stage=<n>`: the first n of the preview's own pictures (`preview/pictures/`)
// chosen to send once the client is up, as the native view's
// `FANCY_GPUI_STAGE=<folder>` stages a folder, on a server that keeps files
// as the native demo's does. With `&upload` they are sent, and the first is
// held three quarters of the way up.
const stageCount = Number(new URLSearchParams(location.search).get("stage") ?? 0);
const holdUpload = new URLSearchParams(location.search).has("upload");
const PICTURES: Record<string, number> = {
  "dawn.png": 31017, "harbour.png": 31381, "meadow.png": 27556,
  "night.png": 29759, "sand.png": 27233, "storm.png": 28959,
};
function stageAnswers() {
  const heard: Record<string, ((event: unknown) => void)[]> = {};
  const tell = (event: string, payload: unknown) =>
    (heard[event] ?? []).forEach((handler) => handler({ event, id: 0, payload }));
  const named = (path: unknown) => String(path ?? "").split("/").pop() ?? "";
  Object.assign(answers, {
    "plugin:event|listen": (a: any) => {
      (heard[a?.event] ??= []).push(a?.handler);
      return heard[a?.event].length;
    },
    "plugin:dialog|open": () => Object.keys(PICTURES).slice(0, stageCount).map((name) => `/pictures/${name}`),
    file_size: (a: any) => PICTURES[named(a?.path)] ?? 0,
    // Never done: a second and a half in, three quarters of it has gone.
    starling_upload_file: (a: any) => {
      const total = PICTURES[named(a?.filePath ?? a?.path)] ?? 30_000;
      setTimeout(
        () => tell("upload-progress", { uploadId: a?.uploadId, bytesSent: Math.round(total * 0.76), totalBytes: total }),
        1500,
      );
      return new Promise(() => {});
    },
  });
}
if (stageCount > 0) stageAnswers();
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
if (stageCount > 0) {
  // A picture chosen is shown from where the dev server serves it.
  (window as any).__TAURI_INTERNALS__.convertFileSrc = (path: string) => path;
  useAppStore.setState({
    fileServerConfig: { canShareFiles: true, canShareFilesPublic: true, deleteOnTtl: true },
    fileServerKind: "canon",
  } as any);
}
const { default: NebulaApp } = await import("@nebula/index");
createRoot(document.getElementById("root")!).render(<NebulaApp />);
if (stageCount > 0) {
  const press = (selector: string) => {
    const target = document.querySelector(selector);
    for (const kind of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      target?.dispatchEvent(new MouseEvent(kind, { bubbles: true, cancelable: true, view: window }));
  };
  setTimeout(() => press('[aria-label="Attach files"]'), 2500);
  if (holdUpload) setTimeout(() => press('[data-testid="chat-send"]'), 4000);
}
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
