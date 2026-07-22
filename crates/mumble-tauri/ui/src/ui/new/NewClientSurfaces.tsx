import { useEffect, useMemo, useState } from "react";
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
import type { ChannelEntry, SavedServer, ServerInfo, UserEntry, UserPreferences } from "@core/types";
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
import { Button, IconButton, ModalSurface, TextField } from "./components";

export type Surface = "servers" | "settings" | "server-info" | "channel-info" | "screen-share" | null;

function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
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
    <ModalSurface title="Servers" eyebrow="CONNECTION LIBRARY" onClose={onClose}>
      <div className={styles.split}>
        <div className={styles.serverList}>
          {servers.length === 0 && <div className={styles.blank}><ServerIcon /><strong>No saved servers</strong><span>Add your first connection on the right.</span></div>}
          {servers.map((server) => <article key={server.id} className={editing?.id === server.id ? styles.selectedCard : styles.card}>
            <span className={styles.cardIcon}><ServerIcon /></span><div><strong>{server.label}</strong><small>{server.host}:{server.port} · {server.username}</small></div>
            <Button variant="bare" onClick={() => edit(server)}>Edit</Button><Button variant="bare" className={styles.primarySmall} disabled={busy} onClick={() => void connectSaved(server)}>Connect</Button>
          </article>)}
        </div>
        <div className={styles.editorPane}>
          <small>{editing ? "EDIT CONNECTION" : "NEW CONNECTION"}</small><h3>{editing ? editing.label : "Add a server"}</h3>
          <TextField label="Name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="My community" />
          <TextField label="Address" value={host} onChange={(event) => setHost(event.target.value)} placeholder="voice.example.com" />
          <div className={styles.twoCols}><TextField label="Port" type="number" value={port} min={1} max={65535} onChange={(event) => setPort(Number(event.target.value))} /><TextField label="Username" value={username} onChange={(event) => setUsername(event.target.value)} /></div>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !host.trim() || !username.trim()}>{editing ? "Save changes" : "Add server"}</Button>
          {editing && <><Button onClick={clearForm}>Cancel editing</Button><Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => void removeServer(editing.id).then(() => { clearForm(); reload(); })}>Remove server</Button></>}
        </div>
      </div>
    </ModalSurface>
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
  return <ModalSurface title="Settings" eyebrow="CLIENT PREFERENCES" onClose={onClose}><div className={styles.settingsGrid}>
    <nav>{(["general", "voice", "notifications", "privacy", "appearance"] as const).map((item) => <Button variant="bare" key={item} className={section === item ? styles.settingsActive : undefined} onClick={() => setSection(item)}>{item === "voice" ? "Voice & audio" : item[0].toUpperCase() + item.slice(1)}</Button>)}</nav>
    <div className={styles.settingRows}><h3>{title}</h3><p>Preferences apply to both visual implementations.</p>{prefs ? <>
      {settingRows.filter((row) => visibleKeys[section].includes(row.key)).map((row) => <Button variant="bare" wrapLabel={false} className={styles.settingRow} key={row.key} onClick={() => void toggle(row.key)}><span><strong>{row.title}</strong><small>{row.detail}</small></span><i className={prefs[row.key] ? styles.toggleOn : styles.toggle}><b /></i></Button>)}
      {section === "voice" && <><div className={styles.settingsFeature}><span><strong>Microphone state</strong><small>Control the native capture pipeline.</small></span><Button onClick={() => void (voiceState === "inactive" ? useAppStore.getState().enableVoice() : useAppStore.getState().disableVoice())}>{voiceState === "inactive" ? "Enable voice" : "Disable voice"}</Button></div><div className={styles.settingsFeature}><span><strong>Mute microphone</strong><small>Remain connected to voice without transmitting.</small></span><Button disabled={voiceState === "inactive"} onClick={() => void useAppStore.getState().toggleMute()}>{voiceState === "muted" ? "Unmute" : "Mute"}</Button></div></>}
      {section === "appearance" && <><div className={styles.settingsFeature}><span><strong>Interface</strong><small>The redesigned client is currently active.</small></span><b>New UI</b></div><div className={styles.settingsFeature}><span><strong>Visual language</strong><small>Neutral glass with blue interaction highlights.</small></span><b>2026 Glass</b></div></>}
    </> : <div className={styles.blank}>Loading preferences…</div>}</div>
  </div></ModalSurface>;
}

export function InfoPanel({ kind, channel, onClose }: { kind: "server" | "channel"; channel: ChannelEntry | null; onClose: () => void }) {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const active = useAppStore((state) => state.sessions.find((session) => session.id === state.activeServerId));
  const description = useChannelDescription(channel?.id, channel?.description_size);
  useEffect(() => { if (kind === "server") void invoke<ServerInfo>("get_server_info").then(setServer).catch(() => setServer(null)); }, [kind]);
  return <ModalSurface title={kind === "server" ? active?.label ?? "Server information" : `#${channel?.name ?? "Channel"}`} eyebrow={kind === "server" ? "SERVER DETAILS" : "CHANNEL DETAILS"} onClose={onClose}>
    <div className={styles.infoHero}><span><InfoIcon /></span><div><h3>{kind === "server" ? active?.label ?? server?.host : channel?.name}</h3><p>{kind === "server" ? `${server?.host ?? active?.host ?? ""}:${server?.port ?? active?.port ?? ""}` : plainText(description) || "No channel description has been set."}</p></div></div>
    <div className={styles.factGrid}>{kind === "server" ? <><Fact label="Users" value={`${server?.user_count ?? "—"}${server?.max_users ? ` / ${server.max_users}` : ""}`} /><Fact label="Version" value={server?.release ?? server?.protocol_version ?? "Unknown"} /><Fact label="Platform" value={server?.os ?? "Unknown"} /><Fact label="Codec" value={server?.opus ? "Opus" : "Legacy"} /><Fact label="Connection" value={active?.status ?? "Disconnected"} /><Fact label="Transport" value={useAppStore.getState().udpActive ? "UDP" : "TCP tunnel"} /></> : <><Fact label="Members" value={String(channel?.user_count ?? 0)} /><Fact label="Capacity" value={channel?.max_users ? String(channel.max_users) : "Unlimited"} /><Fact label="Persistent chat" value={channel?.pchat_protocol === "none" || !channel?.pchat_protocol ? "Off" : "Enabled"} /><Fact label="Temporary" value={channel?.temporary ? "Yes" : "No"} /><Fact label="Restricted" value={channel?.is_enter_restricted ? "Yes" : "No"} /><Fact label="Retention" value={channel?.pchat_retention_days ? `${channel.pchat_retention_days} days` : "Forever"} /></>}</div>
  </ModalSurface>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className={styles.fact}><small>{label}</small><strong>{value}</strong></div>; }

export function UserCard({ user, onClose }: { user: UserEntry; onClose: () => void }) {
  const avatar = useUserAvatar(user.session, user.texture_size);
  const comment = useUserComment(user.session, user.comment_size);
  const channel = useAppStore((state) => state.channels.find((item) => item.id === user.channel_id));
  const muted = user.mute || user.self_mute || user.suppress;
  return <aside className={styles.userCard} aria-label={`${user.name} profile`}><header><IconButton icon={<CloseIcon />} label="Close profile" onClick={onClose} /></header><div className={styles.profileBody}>{avatar ? <img src={avatar} alt="" /> : <span className={styles.profileAvatar}>{user.name.slice(0, 2).toUpperCase()}</span>}<i className={styles.online} /><h2>{user.name}</h2><small>{muted ? "Muted" : "Online"} · #{channel?.name ?? "Unknown"}</small><p>{plainText(user.comment ?? comment) || "This user has not added a profile description yet."}</p><div className={styles.profileFacts}><Fact label="Account" value={user.user_id == null ? "Guest" : "Registered"} /><Fact label="Voice" value={muted ? "Muted" : "Available"} /></div><Button variant="primary" leadingIcon={<UsersGroupIcon />}>Open direct message</Button></div></aside>;
}

export function UserHoverCard({ user }: { user: UserEntry }) {
  const avatar = useUserAvatar(user.session, user.texture_size);
  const comment = useUserComment(user.session, user.comment_size);
  const channel = useAppStore((state) => state.channels.find((item) => item.id === user.channel_id));
  const muted = user.mute || user.self_mute || user.suppress;
  return <aside className={`${styles.userHoverCard} ${styles.userHoverReadable}`} role="tooltip">
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
    <Button variant="bare" className={editor?.isActive("bold") ? styles.toolActive : undefined} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></Button>
    <Button variant="bare" className={editor?.isActive("italic") ? styles.toolActive : undefined} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></Button>
    <Button variant="bare" className={editor?.isActive("underline") ? styles.toolActive : undefined} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></Button>
    <IconButton icon={<Link2Icon />} label="Add link" onClick={setLink} /><Button variant="bare" onClick={() => editor?.chain().focus().toggleBulletList().run()}>• List</Button><IconButton icon={<CodeIcon />} label="Code block" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
  </div><div className={styles.editorRow}><IconButton icon={<AttachIcon />} label="Attach file" /><EditorContent editor={editor} className={styles.editorContent} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><IconButton icon={<SendIcon />} label="Send message" className={styles.send} onClick={() => void send()} disabled={!channel || sending} /></div></div>;
}

type CaptureSource = { id: number; kind: "screen" | "window" | "device"; title: string; width: number; height: number };
function sharePayload(source: CaptureSource): string { return JSON.stringify({ v: 1, tracks: [{ mid: "0", content: source.kind === "device" ? "camera" : "screen" }] }); }

export function ScreenSharePanel({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selected, setSelected] = useState<CaptureSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSharing = useAppStore((state) => state.isSharingOwn);
  const broadcastingSessions = useAppStore((state) => state.broadcastingSessions);
  const broadcasters = useMemo(() => [...broadcastingSessions], [broadcastingSessions]);
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
  return <ModalSurface title="Share your screen" eyebrow="SCREEN & CAMERA" onClose={onClose}><div className={styles.shareLayout}>
    {broadcasters.length > 0 && <section><small>LIVE NOW</small><div className={styles.liveRows}>{broadcasters.map((session) => <Button variant="bare" wrapLabel={false} key={session} onClick={() => useAppStore.setState({ watchingSession: session, watchingOwnSession: useAppStore.getState().ownSession })}><span><SparklesIcon /></span><strong>{users.find((user) => user.session === session)?.name ?? "A member"}</strong><small>is sharing · Watch</small></Button>)}</div></section>}
    <section><small>CHOOSE A SOURCE</small><div className={styles.sourceGrid}>{sources.map((source) => <Button variant="bare" wrapLabel={false} key={`${source.kind}-${source.id}`} className={selected?.id === source.id && selected.kind === source.kind ? styles.sourceActive : styles.source} onClick={() => setSelected(source)}><span>{source.kind === "device" ? <WebcamIcon /> : <ServerIcon />}</span><strong>{source.title}</strong><small>{source.width} × {source.height}</small>{selected?.id === source.id && selected.kind === source.kind && <i><CheckIcon /></i>}</Button>)}</div></section>
    {error && <div className={styles.error}>{error}</div>}<footer>{isSharing ? <Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => void stop()}>Stop sharing</Button> : <Button variant="primary" leadingIcon={<WebcamIcon />} disabled={!selected || busy} onClick={() => void start()}>{busy ? "Starting…" : "Go live"}</Button>}</footer>
  </div></ModalSurface>;
}
