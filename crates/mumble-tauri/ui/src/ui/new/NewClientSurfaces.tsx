import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { addServer, getSavedServers, removeServer, updateServer } from "@core/serverStorage";
import { useChannelDescription, useUserAvatar, useUserComment } from "@core/lazyBlobs";
import { useAppStore } from "@core/store";
import type { ChannelEntry, LinkEmbed, SavedServer, ServerInfo, UserEntry, UserPreferences } from "@core/types";
import {
  AttachIcon,
  CheckIcon,
  CloseIcon,
  CodeIcon,
  InfoIcon,
  Link2Icon,
  SendIcon,
  ServerIcon,
  SparklesIcon,
  TrashIcon,
  UsersGroupIcon,
  WebcamIcon,
} from "@ui/icons";
import styles from "./NewClientSurfaces.module.css";
import { Stepper, type StepperStep } from "./components";

export type Surface = "servers" | "settings" | "server-info" | "channel-info" | "screen-share" | null;

export function OnboardingStepper({ onComplete }: { onComplete: (server: SavedServer, connectNow: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(64738);
  const [saving, setSaving] = useState(false);
  const steps: readonly StepperStep[] = [
    { id: "welcome", label: "Welcome", description: "A quick introduction" },
    { id: "profile", label: "Your profile", description: "Choose how you appear" },
    { id: "server", label: "First server", description: "Save a connection" },
    { id: "ready", label: "Ready", description: "Start talking" },
  ];
  const canContinue = step === 0 || step === 3 || (step === 1 ? username.trim().length > 0 : host.trim().length > 0);

  const finish = async (connectNow: boolean) => {
    if (!host.trim() || !username.trim() || saving) return;
    setSaving(true);
    try {
      const server = await addServer({ label: label.trim() || host.trim(), host: host.trim(), port, username: username.trim(), cert_label: null, favorite: true });
      onComplete(server, connectNow);
    } finally { setSaving(false); }
  };

  return <section className={styles.onboarding}>
    <header><span className={styles.onboardingMark}><SparklesIcon /></span><div><small>WELCOME TO FANCY MUMBLE</small><h1>Let’s get you connected.</h1><p>A short setup keeps the client personal without getting in your way.</p></div></header>
    <Stepper steps={steps} activeStep={step} ariaLabel="Onboarding progress" />
    <div className={styles.stepContent}>
      {step === 0 && <div className={styles.welcomeStep}><span><UsersGroupIcon /></span><h2>Voice chat, made calmer.</h2><p>Fancy Mumble brings servers, channels, rich chat, and screen sharing into one focused desktop experience.</p><div><b>Private by design</b><b>Native voice</b><b>Multiple servers</b></div></div>}
      {step === 1 && <div className={styles.formStep}><small>STEP 2 OF 4</small><h2>How should people see you?</h2><p>You can change this independently for every saved server later.</p><label>Display name<input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your display name" /></label></div>}
      {step === 2 && <div className={styles.formStep}><small>STEP 3 OF 4</small><h2>Add your first server</h2><p>Enter the connection details provided by your community or team.</p><label>Server name <em>Optional</em><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="My community" /></label><label>Server address<input autoFocus value={host} onChange={(event) => setHost(event.target.value)} placeholder="voice.example.com" /></label><label>Port<input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} /></label></div>}
      {step === 3 && <div className={styles.readyStep}><span><CheckIcon /></span><h2>You’re ready, {username}.</h2><p><strong>{label.trim() || host}</strong> will be saved to your server sidebar. Connect now or explore the launcher first.</p><div><button type="button" className={styles.secondary} disabled={saving} onClick={() => void finish(false)}>Finish setup</button><button type="button" className={styles.primary} disabled={saving} onClick={() => void finish(true)}>{saving ? "Saving…" : "Save & connect"}</button></div></div>}
    </div>
    {step < 3 && <footer><button type="button" className={styles.secondary} disabled={step === 0} onClick={() => setStep((current) => current - 1)}>Back</button><span>{step + 1} / {steps.length}</span><button type="button" className={styles.primary} disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>Continue</button></footer>}
  </section>;
}

function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

function Overlay({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.surface} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><small>{subtitle}</small><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close"><CloseIcon /></button></header>
        <div className={styles.surfaceBody}>{children}</div>
      </section>
    </div>
  );
}

export function ServerBrowser({ onClose }: { onClose: () => void }) {
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [editing, setEditing] = useState<SavedServer | null>(null);
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(64738);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => void getSavedServers().then(setServers).catch(() => setServers([]));
  useEffect(reload, []);

  const clearForm = () => { setEditing(null); setLabel(""); setHost(""); setPort(64738); };
  const edit = (server: SavedServer) => {
    setEditing(server); setLabel(server.label); setHost(server.host); setPort(server.port); setUsername(server.username);
  };
  const save = async () => {
    if (!host.trim() || !username.trim()) return;
    setBusy(true);
    try {
      const values = { label: label.trim() || host.trim(), host: host.trim(), port, username: username.trim(), cert_label: editing?.cert_label ?? null, favorite: editing?.favorite ?? false };
      if (editing) await updateServer(editing.id, values);
      else await addServer(values);
      clearForm(); reload();
    } finally { setBusy(false); }
  };
  const connectSaved = async (server: SavedServer) => {
    setBusy(true);
    try { await useAppStore.getState().connect(server.host, server.port, server.username, server.cert_label); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title="Servers" subtitle="CONNECTION LIBRARY" onClose={onClose}>
      <div className={styles.split}>
        <div className={styles.serverList}>
          {servers.length === 0 && <div className={styles.blank}><ServerIcon /><strong>No saved servers</strong><span>Add your first connection on the right.</span></div>}
          {servers.map((server) => <article key={server.id} className={editing?.id === server.id ? styles.selectedCard : styles.card}>
            <span className={styles.cardIcon}><ServerIcon /></span><div><strong>{server.label}</strong><small>{server.host}:{server.port} · {server.username}</small></div>
            <button type="button" onClick={() => edit(server)}>Edit</button><button type="button" className={styles.primarySmall} disabled={busy} onClick={() => void connectSaved(server)}>Connect</button>
          </article>)}
        </div>
        <div className={styles.editorPane}>
          <small>{editing ? "EDIT CONNECTION" : "NEW CONNECTION"}</small><h3>{editing ? editing.label : "Add a server"}</h3>
          <label>Name<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="My community" /></label>
          <label>Address<input value={host} onChange={(event) => setHost(event.target.value)} placeholder="voice.example.com" /></label>
          <div className={styles.twoCols}><label>Port<input type="number" value={port} min={1} max={65535} onChange={(event) => setPort(Number(event.target.value))} /></label><label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} /></label></div>
          <button type="button" className={styles.primary} onClick={() => void save()} disabled={busy || !host.trim() || !username.trim()}>{editing ? "Save changes" : "Add server"}</button>
          {editing && <><button type="button" className={styles.secondary} onClick={clearForm}>Cancel editing</button><button type="button" className={styles.danger} onClick={() => void removeServer(editing.id).then(() => { clearForm(); reload(); })}><TrashIcon /> Remove server</button></>}
        </div>
      </div>
    </Overlay>
  );
}

const settingRows: Array<{ key: keyof UserPreferences; title: string; detail: string }> = [
  { key: "enableNotifications", title: "Desktop notifications", detail: "Show native notifications for messages and calls." },
  { key: "autoReconnect", title: "Automatic reconnect", detail: "Reconnect when a server connection is interrupted." },
  { key: "disableTypingIndicators", title: "Disable typing indicators", detail: "Do not send or display typing activity." },
  { key: "disableLinkPreviews", title: "Disable link previews", detail: "Hide rich metadata cards below messages." },
  { key: "enableExternalEmbeds", title: "Allow external media", detail: "Permit remote players after preview metadata arrives." },
  { key: "streamerMode", title: "Streamer mode", detail: "Hide sensitive connection information while recording." },
  { key: "hideEmptyChannels", title: "Hide empty channels", detail: "Reduce channel lists to active rooms." },
  { key: "persistDms", title: "Keep direct-message history", detail: "Store encrypted DM history on this device." },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [section, setSection] = useState<"general" | "voice" | "notifications" | "privacy" | "appearance">("general");
  useEffect(() => { void getPreferences().then(setPrefs).catch(() => undefined); }, []);
  const toggle = async (key: keyof UserPreferences) => {
    if (!prefs || typeof prefs[key] !== "boolean") return;
    const next = await updatePreferences({ [key]: !prefs[key] });
    setPrefs(next);
    if (key === "disableLinkPreviews") useAppStore.setState({ disableLinkPreviews: next.disableLinkPreviews ?? false });
    if (key === "enableExternalEmbeds") useAppStore.setState({ enableExternalEmbeds: next.enableExternalEmbeds ?? false });
    if (key === "streamerMode") useAppStore.setState({ streamerMode: next.streamerMode ?? false });
  };
  const visibleKeys: Record<typeof section, Array<keyof UserPreferences>> = {
    general: ["autoReconnect", "hideEmptyChannels"], voice: [], notifications: ["enableNotifications"],
    privacy: ["disableTypingIndicators", "disableLinkPreviews", "enableExternalEmbeds", "streamerMode", "persistDms"], appearance: [],
  };
  const title = section === "voice" ? "Voice & audio" : section[0].toUpperCase() + section.slice(1);
  const voiceState = useAppStore((state) => state.voiceState);
  return <Overlay title="Settings" subtitle="CLIENT PREFERENCES" onClose={onClose}><div className={styles.settingsGrid}>
    <nav>{(["general", "voice", "notifications", "privacy", "appearance"] as const).map((item) => <button key={item} type="button" className={section === item ? styles.settingsActive : undefined} onClick={() => setSection(item)}>{item === "voice" ? "Voice & audio" : item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
    <div className={styles.settingRows}><h3>{title}</h3><p>Preferences apply to both visual implementations.</p>{prefs ? <>
      {settingRows.filter((row) => visibleKeys[section].includes(row.key)).map((row) => <button type="button" className={styles.settingRow} key={row.key} onClick={() => void toggle(row.key)}><span><strong>{row.title}</strong><small>{row.detail}</small></span><i className={prefs[row.key] ? styles.toggleOn : styles.toggle}><b /></i></button>)}
      {section === "voice" && <><div className={styles.settingsFeature}><span><strong>Microphone state</strong><small>Control the native capture pipeline.</small></span><button type="button" onClick={() => void (voiceState === "inactive" ? useAppStore.getState().enableVoice() : useAppStore.getState().disableVoice())}>{voiceState === "inactive" ? "Enable voice" : "Disable voice"}</button></div><div className={styles.settingsFeature}><span><strong>Mute microphone</strong><small>Remain connected to voice without transmitting.</small></span><button type="button" disabled={voiceState === "inactive"} onClick={() => void useAppStore.getState().toggleMute()}>{voiceState === "muted" ? "Unmute" : "Mute"}</button></div></>}
      {section === "appearance" && <><div className={styles.settingsFeature}><span><strong>Interface</strong><small>The redesigned client is currently active.</small></span><b>New UI</b></div><div className={styles.settingsFeature}><span><strong>Visual language</strong><small>Neutral glass with blue interaction highlights.</small></span><b>2026 Glass</b></div></>}
    </> : <div className={styles.blank}>Loading preferences…</div>}</div>
  </div></Overlay>;
}

export function InfoPanel({ kind, channel, onClose }: { kind: "server" | "channel"; channel: ChannelEntry | null; onClose: () => void }) {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const active = useAppStore((state) => state.sessions.find((session) => session.id === state.activeServerId));
  const description = useChannelDescription(channel?.id, channel?.description_size);
  useEffect(() => { if (kind === "server") void invoke<ServerInfo>("get_server_info").then(setServer).catch(() => setServer(null)); }, [kind]);
  return <Overlay title={kind === "server" ? active?.label ?? "Server information" : `#${channel?.name ?? "Channel"}`} subtitle={kind === "server" ? "SERVER DETAILS" : "CHANNEL DETAILS"} onClose={onClose}>
    <div className={styles.infoHero}><span><InfoIcon /></span><div><h3>{kind === "server" ? active?.label ?? server?.host : channel?.name}</h3><p>{kind === "server" ? `${server?.host ?? active?.host ?? ""}:${server?.port ?? active?.port ?? ""}` : plainText(description) || "No channel description has been set."}</p></div></div>
    <div className={styles.factGrid}>{kind === "server" ? <><Fact label="Users" value={`${server?.user_count ?? "—"}${server?.max_users ? ` / ${server.max_users}` : ""}`} /><Fact label="Version" value={server?.release ?? server?.protocol_version ?? "Unknown"} /><Fact label="Platform" value={server?.os ?? "Unknown"} /><Fact label="Codec" value={server?.opus ? "Opus" : "Legacy"} /><Fact label="Connection" value={active?.status ?? "Disconnected"} /><Fact label="Transport" value={useAppStore.getState().udpActive ? "UDP" : "TCP tunnel"} /></> : <><Fact label="Members" value={String(channel?.user_count ?? 0)} /><Fact label="Capacity" value={channel?.max_users ? String(channel.max_users) : "Unlimited"} /><Fact label="Persistent chat" value={channel?.pchat_protocol === "none" || !channel?.pchat_protocol ? "Off" : "Enabled"} /><Fact label="Temporary" value={channel?.temporary ? "Yes" : "No"} /><Fact label="Restricted" value={channel?.is_enter_restricted ? "Yes" : "No"} /><Fact label="Retention" value={channel?.pchat_retention_days ? `${channel.pchat_retention_days} days` : "Forever"} /></>}</div>
  </Overlay>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className={styles.fact}><small>{label}</small><strong>{value}</strong></div>; }

export function UserCard({ user, onClose }: { user: UserEntry; onClose: () => void }) {
  const avatar = useUserAvatar(user.session, user.texture_size);
  const comment = useUserComment(user.session, user.comment_size);
  const channel = useAppStore((state) => state.channels.find((item) => item.id === user.channel_id));
  const muted = user.mute || user.self_mute || user.suppress;
  return <aside className={styles.userCard} aria-label={`${user.name} profile`}><header><button type="button" onClick={onClose}><CloseIcon /></button></header><div className={styles.profileBody}>{avatar ? <img src={avatar} alt="" /> : <span className={styles.profileAvatar}>{user.name.slice(0, 2).toUpperCase()}</span>}<i className={styles.online} /><h2>{user.name}</h2><small>{muted ? "Muted" : "Online"} · #{channel?.name ?? "Unknown"}</small><p>{plainText(user.comment ?? comment) || "This user has not added a profile description yet."}</p><div className={styles.profileFacts}><Fact label="Account" value={user.user_id == null ? "Guest" : "Registered"} /><Fact label="Voice" value={muted ? "Muted" : "Available"} /></div><button type="button" className={styles.primary}><UsersGroupIcon /> Open direct message</button></div></aside>;
}

export function UserHoverCard({ user }: { user: UserEntry }) {
  const avatar = useUserAvatar(user.session, user.texture_size);
  const comment = useUserComment(user.session, user.comment_size);
  const channel = useAppStore((state) => state.channels.find((item) => item.id === user.channel_id));
  const muted = user.mute || user.self_mute || user.suppress;
  return <aside className={styles.userHoverCard} role="tooltip">
    <div className={styles.hoverBanner} />
    <div className={styles.hoverProfile}>
      {avatar ? <img src={avatar} alt="" /> : <span>{user.name.slice(0, 2).toUpperCase()}</span>}
      <i />
      <h3>{user.name}</h3>
      <small>{muted ? "Muted" : "Online"} · #{channel?.name ?? "Unknown"}</small>
      <p>{plainText(user.comment ?? comment) || "No profile description."}</p>
      <footer>Click the member to open their full profile</footer>
    </div>
  </aside>;
}

export function LinkPreviews({ embeds, allowExternal }: { embeds: LinkEmbed[]; allowExternal: boolean }) {
  return <div className={styles.previews}>{embeds.map((embed) => {
    const image = embed.image?.preview?.data_url ?? embed.thumbnail?.preview?.data_url ?? (allowExternal ? embed.image?.url ?? embed.thumbnail?.url : undefined);
    let host = embed.url;
    try { host = new URL(embed.url).hostname; } catch { /* retain the original value */ }
    return <a key={`${embed.url}-${embed.title}`} className={styles.preview} href={embed.url} target="_blank" rel="noreferrer"><div><small>{embed.site_name ?? embed.provider?.name ?? host}</small><strong>{embed.title ?? embed.url}</strong>{embed.description && <p>{embed.description}</p>}</div>{image && <img src={image} alt="" loading="lazy" />}</a>;
  })}</div>;
}

export function RichComposer({ channel, onSend }: { channel: ChannelEntry | null; onSend: (html: string) => Promise<void> }) {
  const [sending, setSending] = useState(false);
  const editor = useEditor({ extensions: [StarterKit, Underline, Link.configure({ openOnClick: false }), Placeholder.configure({ placeholder: channel ? `Message #${channel.name}` : "Select a channel" })], content: "", editable: !!channel });
  useEffect(() => { editor?.setEditable(!!channel); }, [editor, channel]);
  const send = async () => {
    if (!editor || editor.isEmpty || !channel || sending) return;
    setSending(true);
    try { await onSend(editor.getHTML()); editor.commands.clearContent(); }
    finally { setSending(false); }
  };
  const setLink = () => { const href = globalThis.prompt("Link URL"); if (href) editor?.chain().focus().extendMarkRange("link").setLink({ href }).run(); };
  return <div className={styles.richComposer}><div className={styles.toolbar}>
    <button type="button" className={editor?.isActive("bold") ? styles.toolActive : undefined} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
    <button type="button" className={editor?.isActive("italic") ? styles.toolActive : undefined} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
    <button type="button" className={editor?.isActive("underline") ? styles.toolActive : undefined} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
    <button type="button" onClick={setLink}><Link2Icon /></button><button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()}>• List</button><button type="button" onClick={() => editor?.chain().focus().toggleCodeBlock().run()}><CodeIcon /></button>
  </div><div className={styles.editorRow}><button type="button" aria-label="Attach file"><AttachIcon /></button><EditorContent editor={editor} className={styles.editorContent} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><button type="button" className={styles.send} onClick={() => void send()} disabled={!channel || sending}><SendIcon /></button></div></div>;
}

type CaptureSource = { id: number; kind: "screen" | "window" | "device"; title: string; width: number; height: number };
function sharePayload(source: CaptureSource): string { return JSON.stringify({ v: 1, tracks: [{ mid: "0", content: source.kind === "device" ? "camera" : "screen" }] }); }

export function ScreenSharePanel({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selected, setSelected] = useState<CaptureSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSharing = useAppStore((state) => state.isSharingOwn);
  const broadcasters = useAppStore((state) => [...state.broadcastingSessions]);
  const users = useAppStore((state) => state.users);
  useEffect(() => { void invoke<CaptureSource[]>("list_capture_sources").then((items) => { setSources(items); setSelected(items[0] ?? null); }).catch((reason) => setError(String(reason))); }, []);
  const start = async () => {
    if (!selected) return; setBusy(true); setError(null);
    const state = useAppStore.getState();
    try {
      await state.sendWebRtcSignal(0, 0, sharePayload(selected), state.activeServerId);
      await invoke("start_screen_broadcast", { sources: [{ kind: selected.kind, id: selected.id }], serverId: state.activeServerId, maxDimension: 1920, maxFps: 60, reusePortalSource: false });
      useAppStore.setState((current) => ({ isSharingOwn: true, broadcastingOwnSession: current.ownSession, broadcastingSessions: new Set(current.ownSession == null ? current.broadcastingSessions : [...current.broadcastingSessions, current.ownSession]) }));
      onClose();
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const stop = async () => { const state = useAppStore.getState(); await invoke("stop_screen_broadcast"); await state.sendWebRtcSignal(0, 1, "", state.activeServerId); useAppStore.setState((current) => { const next = new Set(current.broadcastingSessions); if (current.ownSession != null) next.delete(current.ownSession); return { isSharingOwn: false, broadcastingOwnSession: null, broadcastingSessions: next }; }); onClose(); };
  return <Overlay title="Share your screen" subtitle="SCREEN & CAMERA" onClose={onClose}><div className={styles.shareLayout}>
    {broadcasters.length > 0 && <section><small>LIVE NOW</small><div className={styles.liveRows}>{broadcasters.map((session) => <button type="button" key={session} onClick={() => useAppStore.setState({ watchingSession: session, watchingOwnSession: useAppStore.getState().ownSession })}><span><SparklesIcon /></span><strong>{users.find((user) => user.session === session)?.name ?? "A member"}</strong><small>is sharing · Watch</small></button>)}</div></section>}
    <section><small>CHOOSE A SOURCE</small><div className={styles.sourceGrid}>{sources.map((source) => <button type="button" key={`${source.kind}-${source.id}`} className={selected?.id === source.id && selected.kind === source.kind ? styles.sourceActive : styles.source} onClick={() => setSelected(source)}><span>{source.kind === "device" ? <WebcamIcon /> : <ServerIcon />}</span><strong>{source.title}</strong><small>{source.width} × {source.height}</small>{selected?.id === source.id && selected.kind === source.kind && <i><CheckIcon /></i>}</button>)}</div></section>
    {error && <div className={styles.error}>{error}</div>}<footer>{isSharing ? <button type="button" className={styles.danger} onClick={() => void stop()}><TrashIcon /> Stop sharing</button> : <button type="button" className={styles.primary} disabled={!selected || busy} onClick={() => void start()}><WebcamIcon /> {busy ? "Starting…" : "Go live"}</button>}</footer>
  </div></Overlay>;
}
