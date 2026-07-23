import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { addServer, getSavedServers, getServerPassword, removeServer, updateServer } from "@core/serverStorage";
import { useChannelDescription, useUserAvatar, useUserComment } from "@core/lazyBlobs";
import { useAppStore } from "@core/store";
import { useTypingIndicator } from "@core/features/chat/typing/useTypingIndicator";
import { encodeFileAttachmentMarker } from "@core/features/chat/fileAttachments";
import { fileToDataUrl, fitImage } from "@core/utils/media";
import { PERMISSIONS } from "@core/utils/permissions";
import { load } from "@core/utils/store";
import type { ChannelEntry, PublicServer, SavedServer, ServerInfo, UserEntry, UserPreferences } from "@core/types";
import {
  AttachIcon,
  BoldIcon,
  CloseIcon,
  CodeIcon,
  ImageIcon,
  InfoIcon,
  EmojiPlusIcon,
  Link2Icon,
  RadioIcon,
  SendIcon,
  ServerIcon,
  StarIcon,
  TrashIcon,
  UsersGroupIcon,
} from "@ui/icons";
import styles from "./AuroraClientSurfaces.module.css";
import extensionStyles from "./AuroraClientExtensions.module.css";
import settingsStyles from "./SettingsPanel.module.css";
import { AppearanceSettings, Button, GifPicker, IconButton, ModalSurface, PluginTrustSettings, ProfileIdentitySettings, PublicServerDirectory, SearchField, ShortcutSettings, TextField, UserActions, VoiceAudioSettings } from "./components";

export type Surface = "servers" | "settings" | "admin" | "marketplace" | "workspace" | "friends" | "server-info" | "channel-info" | "screen-share" | null;

function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
export function ServerBrowser({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<"saved" | "public">("saved");
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [editing, setEditing] = useState<SavedServer | null>(null);
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(64738);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

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
    try { await useAppStore.getState().connect(server.host, server.port, server.username, server.cert_label, await getServerPassword(server.id)); onClose(); }
    finally { setBusy(false); }
  };
  const connectDirect = async () => {
    if (!host.trim() || !username.trim()) return;
    setBusy(true);
    try { await useAppStore.getState().connect(host.trim(), port, username.trim(), editing?.cert_label ?? null); onClose(); }
    finally { setBusy(false); }
  };
  const connectPublic = async (server: PublicServer) => {
    setBusy(true);
    try { await useAppStore.getState().connect(server.ip, server.port, username.trim()); onClose(); }
    finally { setBusy(false); }
  };
  const toggleFavorite = async (server: SavedServer) => {
    await updateServer(server.id, { favorite: !server.favorite });
    reload();
  };
  const displayedServers = servers
    .filter((server) => !query.trim() || `${server.label} ${server.host} ${server.username}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => Number(!!right.favorite) - Number(!!left.favorite) || left.label.localeCompare(right.label));

  return <ModalSurface title="Servers" eyebrow="CONNECTION LIBRARY" onClose={onClose}>
    <div className={extensionStyles.serverTabs}><Button variant={view === "saved" ? "secondary" : "bare"} onClick={() => setView("saved")}>Saved & direct</Button><Button variant={view === "public" ? "secondary" : "bare"} onClick={() => setView("public")}>Public directory</Button></div>
    {view === "public" ? <PublicServerDirectory disabled={busy} username={username} onUsernameChange={setUsername} onConnect={connectPublic} /> : <div className={styles.split}>
      <div className={styles.serverList}>
        <TextField className={extensionStyles.serverListSearch} label="Search saved servers" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, address, or identity" />
        {servers.length === 0 && <div className={styles.blank}><ServerIcon /><strong>No saved servers</strong><span>Add your first connection on the right.</span></div>}
        {displayedServers.map((server) => <article key={server.id} className={`${editing?.id === server.id ? styles.selectedCard : styles.card} ${extensionStyles.serverCard}`}>
          <span className={styles.cardIcon}><ServerIcon /></span><div><strong>{server.label}</strong><small>{server.host}:{server.port} · {server.username}</small></div>
          <IconButton icon={<StarIcon fill={server.favorite ? "currentColor" : "none"} />} label={server.favorite ? "Remove favorite" : "Add favorite"} onClick={() => void toggleFavorite(server)} />
          <Button variant="bare" onClick={() => edit(server)}>Edit</Button><Button variant="bare" className={styles.primarySmall} disabled={busy} onClick={() => void connectSaved(server)}>Connect</Button>
        </article>)}
      </div>
      <div className={styles.editorPane}>
        <small>{editing ? "EDIT CONNECTION" : "NEW CONNECTION"}</small><h3>{editing ? editing.label : "Connect to a server"}</h3>
        <TextField label="Name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="My community" />
        <TextField label="Address" value={host} onChange={(event) => setHost(event.target.value)} placeholder="voice.example.com" />
        <div className={styles.twoCols}><TextField label="Port" type="number" value={port} min={1} max={65535} onChange={(event) => setPort(Number(event.target.value))} /><TextField label="Username" value={username} onChange={(event) => setUsername(event.target.value)} /></div>
        <div className={extensionStyles.connectionActions}><Button onClick={() => void connectDirect()} disabled={busy || !host.trim() || !username.trim()}>Connect once</Button><Button variant="primary" onClick={() => void save()} disabled={busy || !host.trim() || !username.trim()}>{editing ? "Save changes" : "Save server"}</Button></div>
        {editing && <><Button onClick={clearForm}>Cancel editing</Button><Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => void removeServer(editing.id).then(() => { clearForm(); reload(); })}>Remove server</Button></>}
      </div>
    </div>}
  </ModalSurface>;
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
  { key: "disableReadReceipts", title: "Disable read receipts", detail: "Do not report when messages have been read." },
  { key: "disableOsmMaps", title: "Disable map requests", detail: "Prevent OpenStreetMap and IP geolocation requests." },
  { key: "autoUpdateOnStartup", title: "Automatic updates", detail: "Download and install client updates on startup." },
  { key: "enableDualPath", title: "Encrypted dual-path messages", detail: "Send encrypted content together with a compatible placeholder." },
  { key: "showDisconnectWarning", title: "Confirm disconnect", detail: "Ask before leaving the active server." },
  { key: "logToFile", title: "Write logs to file", detail: "Keep date-stamped client logs on this device." },
  { key: "terminalLogging", title: "Terminal logging", detail: "Mirror application logs to stdout." },
  { key: "autoZipLogs", title: "Compress old logs", detail: "Compress log files older than one day." },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [section, setSection] = useState<"general" | "profile" | "voice" | "shortcuts" | "notifications" | "localization" | "privacy" | "plugins" | "appearance" | "advanced">("general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { void getPreferences().then(setPrefs).catch(() => undefined); }, []);
  const toggle = async (key: keyof UserPreferences) => {
    if (!prefs || typeof prefs[key] !== "boolean") return;
    const next = await updatePreferences({ [key]: !prefs[key] });
    setPrefs(next);
    if (key === "disableLinkPreviews") useAppStore.setState({ disableLinkPreviews: next.disableLinkPreviews ?? false });
    if (key === "enableExternalEmbeds") useAppStore.setState({ enableExternalEmbeds: next.enableExternalEmbeds ?? false });
    if (key === "streamerMode") useAppStore.setState({ streamerMode: next.streamerMode ?? false });
  };
  const patchPreference = async (change: Partial<UserPreferences>) => setPrefs(await updatePreferences(change));
  const resetApplication = async () => {
    for (const file of ["preferences.json", "servers.json", "shortcuts.json", "profile.json", "personalization.json"]) {
      try { const store = await load(file, { autoSave: false, defaults: {} }); await store.clear(); await store.save(); } catch { /* optional stores may not exist */ }
    }
    await invoke("reset_app_data");
    globalThis.location.replace("/");
  };
  const visibleKeys: Record<typeof section, Array<keyof UserPreferences>> = {
    general: ["autoReconnect", "hideEmptyChannels", "showDisconnectWarning", "autoUpdateOnStartup"], profile: [], voice: [], shortcuts: [], notifications: ["enableNotifications"], localization: [],
    privacy: ["disableTypingIndicators", "disableReadReceipts", "disableOsmMaps", "disableLinkPreviews", "enableExternalEmbeds", "streamerMode", "persistDms", "enableDualPath"], plugins: [], appearance: [],
    advanced: ["logToFile", "terminalLogging", "autoZipLogs"],
  };
  const title = section === "voice" ? "Voice & audio" : section[0].toUpperCase() + section.slice(1);
  const voiceState = useAppStore((state) => state.voiceState);
  return <ModalSurface title="Settings" eyebrow="CLIENT PREFERENCES" onClose={onClose}><div className={styles.settingsGrid}>
    <nav><SearchField value={settingsQuery} onChange={(event) => setSettingsQuery(event.target.value)} placeholder="Search settings" aria-label="Search settings" />{(["general", "profile", "voice", "shortcuts", "notifications", "localization", "privacy", "plugins", "appearance", "advanced"] as const).filter((item) => { const needle = settingsQuery.trim().toLocaleLowerCase(); return !needle || `${item} ${item === "voice" ? "audio microphone" : ""} ${settingRows.filter((row) => visibleKeys[item].includes(row.key)).map((row) => `${row.title} ${row.detail}`).join(" ")}`.toLocaleLowerCase().includes(needle); }).map((item) => <Button variant="bare" key={item} className={section === item ? styles.settingsActive : undefined} onClick={() => { setSection(item); setSettingsQuery(""); }}>{item === "voice" ? "Voice & audio" : item[0].toUpperCase() + item.slice(1)}</Button>)}</nav>
    <div className={styles.settingRows}><h3>{title}</h3><p>Preferences apply to both visual implementations.</p>{prefs ? <>
      {settingRows.filter((row) => visibleKeys[section].includes(row.key)).map((row) => <Button variant="bare" wrapLabel={false} className={styles.settingRow} key={row.key} onClick={() => void toggle(row.key)}><span><strong>{row.title}</strong><small>{row.detail}</small></span><i className={prefs[row.key] ? styles.toggleOn : styles.toggle}><b /></i></Button>)}
      {section === "voice" && <><div className={styles.settingsFeature}><span><strong>Microphone state</strong><small>Control the native capture pipeline.</small></span><Button onClick={() => void (voiceState === "inactive" ? useAppStore.getState().enableVoice() : useAppStore.getState().disableVoice())}>{voiceState === "inactive" ? "Enable voice" : "Disable voice"}</Button></div><div className={styles.settingsFeature}><span><strong>Mute microphone</strong><small>Remain connected to voice without transmitting.</small></span><Button disabled={voiceState === "inactive"} onClick={() => void useAppStore.getState().toggleMute()}>{voiceState === "muted" ? "Unmute" : "Mute"}</Button></div><VoiceAudioSettings /></>}
      {section === "shortcuts" && <ShortcutSettings />}
      {section === "general" && <><TextField label="Default username" value={prefs.defaultUsername} onChange={(event) => setPrefs({ ...prefs, defaultUsername: event.target.value })} onBlur={() => void patchPreference({ defaultUsername: prefs.defaultUsername })} /><label className={settingsStyles.select}>Feature level<select value={prefs.userMode} onChange={(event) => void patchPreference({ userMode: event.target.value as UserPreferences["userMode"] })}><option value="normal">Normal</option><option value="expert">Expert</option><option value="developer">Developer</option></select></label></>}
      {section === "localization" && <div className={settingsStyles.form}><label className={settingsStyles.select}>Time format<select value={prefs.timeFormat} onChange={(event) => void patchPreference({ timeFormat: event.target.value as UserPreferences["timeFormat"] })}><option value="auto">Automatic</option><option value="12h">12 hour</option><option value="24h">24 hour</option></select></label><label className={settingsStyles.select}>Date format<select value={prefs.dateFormat ?? "auto"} onChange={(event) => void patchPreference({ dateFormat: event.target.value as NonNullable<UserPreferences["dateFormat"]> })}><option value="auto">Automatic</option><option value="dmy">Day / month / year</option><option value="mdy">Month / day / year</option><option value="ymd">ISO year-month-day</option></select></label><label className={settingsStyles.select}>Number format<select value={prefs.numberFormat ?? "auto"} onChange={(event) => void patchPreference({ numberFormat: event.target.value as NonNullable<UserPreferences["numberFormat"]> })}><option value="auto">Automatic</option><option value="comma-period">1,234.56</option><option value="period-comma">1.234,56</option><option value="space-comma">1 234,56</option></select></label></div>}
      {section === "profile" && <ProfileIdentitySettings />}
      {section === "plugins" && <PluginTrustSettings />}
      {section === "appearance" && <AppearanceSettings />}
      {section === "advanced" && <div className={settingsStyles.form}><TextField label="Klipy API key" type="password" value={prefs.klipyApiKey ?? ""} onChange={(event) => setPrefs({ ...prefs, klipyApiKey: event.target.value })} onBlur={() => void patchPreference({ klipyApiKey: prefs.klipyApiKey })} /><label className={settingsStyles.select}>Marketplace API URL<input value={prefs.marketplaceBaseUrl ?? ""} placeholder="Use the production marketplace" onChange={(event) => setPrefs({ ...prefs, marketplaceBaseUrl: event.target.value })} onBlur={() => void patchPreference({ marketplaceBaseUrl: prefs.marketplaceBaseUrl || undefined })} /></label><label className={settingsStyles.select}>Log level<select value={prefs.logLevel ?? "info"} onChange={(event) => void patchPreference({ logLevel: event.target.value })}><option value="error">Error</option><option value="warn">Warning</option><option value="info">Information</option><option value="debug">Debug</option><option value="trace">Trace</option></select></label><label className={settingsStyles.select}>Welcome messages<select value={prefs.welcomeMessageDisplay ?? "once"} onChange={(event) => void patchPreference({ welcomeMessageDisplay: event.target.value as NonNullable<UserPreferences["welcomeMessageDisplay"]> })}><option value="hide">Hide</option><option value="once">Once per server</option><option value="always">Every connection</option></select></label><div className={settingsStyles.dangerZone}><span><strong>Reset application data</strong><small>Remove saved servers, identities, preferences, shortcuts and cached profile data.</small></span>{confirmReset ? <><Button onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" onClick={() => void resetApplication()}>Confirm reset</Button></> : <Button variant="danger" onClick={() => setConfirmReset(true)}>Reset…</Button>}</div></div>}
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
  const effectivePermissions = channel?.permissions == null ? "Not reported" : PERMISSIONS.filter((permission) => (channel.permissions! & permission.bit) !== 0).map((permission) => permission.label).join(", ") || "None";
  const openDirectMessage = async () => { await useAppStore.getState().selectDmUser(user.session); onClose(); };
  return <aside className={`${styles.userCard} ${extensionStyles.userCardScrollable}`} aria-label={`${user.name} profile`}><header><IconButton icon={<CloseIcon />} label="Close profile" onClick={onClose} /></header><div className={styles.profileBody}>{avatar ? <img src={avatar} alt="" /> : <span className={styles.profileAvatar}>{user.name.slice(0, 2).toUpperCase()}</span>}<i className={styles.online} /><h2>{user.name}</h2><small>{muted ? "Muted" : "Online"} · #{channel?.name ?? "Unknown"}</small><p>{plainText(user.comment ?? comment) || "This user has not added a profile description yet."}</p><div className={styles.profileFacts}><Fact label="Account" value={user.user_id == null ? "Guest" : `Registered #${user.user_id}`} /><Fact label="Voice" value={muted ? "Muted" : "Available"} /><Fact label="Certificate" value={user.hash || "Not available"} /><Fact label="Your access here" value={effectivePermissions} /></div><Button variant="primary" leadingIcon={<UsersGroupIcon />} onClick={() => void openDirectMessage()}>Open direct message</Button><UserActions user={user} /></div></aside>;
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

/** Human-readable byte limit, so multi-megabyte caps don't read as "10240 KiB". */
function formatByteLimit(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}

export function RichComposer({ channel, targetLabel, onSend }: { channel: ChannelEntry | null; targetLabel?: string; onSend: (html: string) => Promise<void> }) {
  const [sending, setSending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"emoji" | "mention" | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const serverConfig = useAppStore((state) => state.serverConfig);
  // Matches the Standard client: 0 means "no dedicated image cap", so the
  // general message limit applies instead.
  const maxImageBytes = serverConfig.max_image_message_length > 0 ? serverConfig.max_image_message_length : serverConfig.max_message_length;
  const fileServerConfig = useAppStore((state) => state.fileServerConfig);
  const uploadFile = useAppStore((state) => state.uploadFile);
  const users = useAppStore((state) => state.users);
  const { notifyTyping, resetTyping } = useTypingIndicator();
  const enabled = !!channel || !!targetLabel;
  const canShareFiles = !!channel && !!fileServerConfig?.canShareFiles;
  const editor = useEditor({ extensions: [StarterKit, Underline, Link.configure({ openOnClick: false }), Image, Placeholder.configure({ placeholder: targetLabel ? `Message ${targetLabel}` : channel ? `Message #${channel.name}` : "Select a channel" })], content: "", editable: enabled, onUpdate: notifyTyping });
  useEffect(() => { editor?.setEditable(enabled); }, [editor, enabled]);
  useEffect(() => {
    const onQuote = (event: Event) => {
      const detail = (event as CustomEvent<{ sender: string; body: string }>).detail;
      editor?.chain().focus().insertContent(`<blockquote><p><strong>${escapeHtml(detail.sender)}</strong></p>${detail.body}</blockquote><p></p>`).run();
    };
    globalThis.addEventListener("new-ui:quote-message", onQuote);
    return () => globalThis.removeEventListener("new-ui:quote-message", onQuote);
  }, [editor]);
  const send = async () => {
    if (!editor || editor.isEmpty || !enabled || sending) return;
    setSending(true);
    try { await onSend(editor.getHTML()); editor.commands.clearContent(); resetTyping(); }
    finally { setSending(false); }
  };
  const setLink = () => { const href = globalThis.prompt("Link URL"); if (href) editor?.chain().focus().extendMarkRange("link").setLink({ href }).run(); };
  const attachImage = async (file: File | undefined) => {
    if (!file || !editor) return;
    setAttachmentError(null);
    if (!file.type.startsWith("image/")) { setAttachmentError("This first attachment pass supports images. Other files will use the file-server upload flow."); return; }
    setSending(true);
    try {
      const alt = file.name.replace(/["<>]/g, "");
      // Inline images ride inside the text message, so they are bound by the
      // server's imagemessagelength - not the (much larger) file-server limit.
      const original = await fileToDataUrl(file);
      if (original.length <= maxImageBytes) {
        // Insert the node directly: a base64 <img> string round-tripped through
        // HTML parsing lands in the document as literal text.
        editor.chain().focus().insertContent({ type: "image", attrs: { src: original, alt } }).run();
        return;
      }
      if (canShareFiles) {
        // Re-encoding down to the inline cap would visibly wreck the image;
        // the file-server path keeps it intact, so point there instead.
        setAttachmentError(`That image is larger than the ${formatByteLimit(maxImageBytes)} inline limit. Use the paperclip to share it at full quality.`);
        return;
      }
      // No file-server on this channel: recompressing is the only way to send
      // it at all, so do that but say so rather than silently degrading it.
      const fitted = await fitImage(file, maxImageBytes);
      editor.chain().focus().insertContent({ type: "image", attrs: { src: fitted, alt } }).run();
      setAttachmentError(`Image recompressed to fit this server's ${formatByteLimit(maxImageBytes)} inline limit.`);
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };
  const shareFile = async () => {
    if (!channel || !fileServerConfig?.canShareFiles || sending) return;
    setAttachmentError(null);
    const selected = await open({ multiple: false, directory: false });
    if (!selected) return;
    const filename = selected.split(/[\\/]/).pop() || "attachment";
    setSending(true);
    try {
      const response = await uploadFile({ filePath: selected, channelId: channel.id, mode: "session", filename });
      await onSend(encodeFileAttachmentMarker({ url: response.download_url, filename, sizeBytes: response.size_bytes, mode: response.access_mode, expiresAt: response.expires_at }));
    } catch (reason) { setAttachmentError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSending(false); }
  };
  const emoji = ["😀", "😂", "❤️", "👍", "🎉", "👀", "🔥", "✅"];
  const formatActive = (mark: string) => editor?.isActive(mark) ? extensionStyles.composerToolActive : undefined;
  return <div className={extensionStyles.composer}>
    {showGifPicker && <GifPicker onClose={() => setShowGifPicker(false)} onSelect={(gif) => { editor?.chain().focus().insertContent({ type: "image", attrs: { src: gif.url, alt: gif.title } }).run(); setShowGifPicker(false); }} />}
    {picker && <div className={extensionStyles.composerPicker}>{picker === "emoji" ? emoji.map((item) => <Button variant="bare" key={item} onClick={() => { editor?.chain().focus().insertContent(item).run(); setPicker(null); }}>{item}</Button>) : users.filter((user) => !channel || user.channel_id === channel.id).map((user) => <Button variant="bare" key={user.session} onClick={() => { editor?.chain().focus().insertContent(`@${user.name} `).run(); setPicker(null); }}>@{user.name}</Button>)}</div>}
    {/* Formatting lives behind a toggle so the resting state is a single clean bar. */}
    {showFormatting && <div className={extensionStyles.composerFormatBar}>
      <Button variant="bare" className={formatActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></Button>
      <Button variant="bare" className={formatActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></Button>
      <Button variant="bare" className={formatActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></Button>
      <IconButton icon={<Link2Icon />} label="Add link" onClick={setLink} />
      <Button variant="bare" className={formatActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• List</Button>
      <IconButton icon={<CodeIcon />} label="Code block" className={formatActive("codeBlock")} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
    </div>}
    {/* Above the bar: growing upward keeps the input anchored in place. */}
    {attachmentError && <div className={extensionStyles.composerError} role="alert">{attachmentError}</div>}
    <div className={extensionStyles.composerBar}>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => { void attachImage(event.target.files?.[0]); event.target.value = ""; }} />
      {channel && fileServerConfig?.canShareFiles
        ? <IconButton icon={<AttachIcon />} label="Share file" className={extensionStyles.composerLead} disabled={sending} onClick={() => void shareFile()} />
        : <IconButton icon={<ImageIcon />} label="Insert inline image" className={extensionStyles.composerLead} disabled={!enabled} onClick={() => fileInput.current?.click()} />}
      <EditorContent editor={editor} className={extensionStyles.composerInput} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
      <div className={extensionStyles.composerActions}>
        {channel && fileServerConfig?.canShareFiles && <IconButton icon={<ImageIcon />} label="Insert inline image" disabled={!enabled} onClick={() => fileInput.current?.click()} />}
        <IconButton icon={<BoldIcon />} label="Formatting" aria-pressed={showFormatting} className={showFormatting ? extensionStyles.composerToolActive : undefined} onClick={() => setShowFormatting((value) => !value)} />
        <IconButton icon={<UsersGroupIcon />} label="Mention someone" onClick={() => setPicker((current) => current === "mention" ? null : "mention")} />
        <Button variant="bare" className={extensionStyles.composerGif} onClick={() => setShowGifPicker((value) => !value)}>GIF</Button>
        <IconButton icon={<EmojiPlusIcon />} label="Insert emoji" onClick={() => setPicker((current) => current === "emoji" ? null : "emoji")} />
        {channel && <IconButton icon={<RadioIcon />} label="Create poll" onClick={() => globalThis.dispatchEvent(new CustomEvent("new-ui:create-poll"))} />}
        <IconButton icon={<SendIcon />} label="Send message" className={extensionStyles.composerSend} onClick={() => void send()} disabled={!enabled || sending} />
      </div>
    </div>
  </div>;
}
