import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { initEventListeners, useAppStore } from "@core/store";
import {
  ArrowLeftIcon,
  AttachIcon,
  HashIcon,
  HeadphonesIcon,
  KebabMenuIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  ServerIcon,
  SettingsIcon,
  SparklesIcon,
  UsersGroupIcon,
  VolumeIcon,
} from "@ui/icons";
import { getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import type { ChannelEntry, ChatMessage, UserEntry } from "@core/types";
import styles from "./NewClientApp.module.css";

type NewClientAppProps = {
  onOpenDesignSheet: () => void;
};

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function messageText(body: string): string {
  const doc = new DOMParser().parseFromString(body, "text/html");
  return doc.body.textContent ?? body;
}

function formatTime(timestamp?: number | null): string {
  if (!timestamp) return "now";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function ChannelRow({
  channel,
  selected,
  current,
  unread,
  onSelect,
}: {
  channel: ChannelEntry;
  selected: boolean;
  current: boolean;
  unread: number;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={selected ? styles.channelActive : styles.channel} onClick={onSelect}>
      <HashIcon />
      <span>{channel.name}</span>
      {current && <i className={styles.currentDot} title="Your current channel" />}
      {unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}
    </button>
  );
}

function MemberRow({ user, own, talking }: { user: UserEntry; own: boolean; talking: boolean }) {
  const muted = user.self_mute || user.mute || user.suppress;
  return (
    <button type="button" className={styles.member} onClick={() => useAppStore.getState().selectUser(user.session)}>
      <span className={`${styles.avatar} ${talking ? styles.avatarTalking : ""}`}>{initials(user.name)}</span>
      <span><strong>{user.name}{own ? " (you)" : ""}</strong><small>{talking ? "Speaking" : muted ? "Muted" : "Listening"}</small></span>
      {muted ? <MicOffIcon /> : <MicIcon />}
    </button>
  );
}

function Message({ message }: { message: ChatMessage }) {
  return (
    <article className={`${styles.message} ${message.is_own ? styles.ownMessage : ""}`}>
      <span className={styles.avatar}>{initials(message.sender_name || "Server")}</span>
      <div>
        <header><strong>{message.sender_name || "Server"}</strong><time>{formatTime(message.timestamp)}</time></header>
        <p>{messageText(message.body)}</p>
      </div>
    </article>
  );
}

export default function NewClientApp({ onOpenDesignSheet }: NewClientAppProps) {
  const navigate = useNavigate();
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(64738);
  const [username, setUsername] = useState("");
  const [draft, setDraft] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [switchingBack, setSwitchingBack] = useState(false);
  const override = getUiDesignOverride();

  const status = useAppStore((state) => state.status);
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const selectedChannel = useAppStore((state) => state.selectedChannel);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const ownSession = useAppStore((state) => state.ownSession);
  const messages = useAppStore((state) => state.messages);
  const unreadCounts = useAppStore((state) => state.unreadCounts);
  const voiceState = useAppStore((state) => state.voiceState);
  const inCall = useAppStore((state) => state.inCall);
  const talkingSessions = useAppStore((state) => state.talkingSessions);
  const error = useAppStore((state) => state.error);
  const bootstrapStage = useAppStore((state) => state.bootstrapStage);

  const activeSession = sessions.find((session) => session.id === activeServerId);
  const activeChannel = channels.find((channel) => channel.id === selectedChannel) ?? null;
  const channelUsers = useMemo(
    () => users.filter((user) => user.channel_id === selectedChannel),
    [users, selectedChannel],
  );
  const channelMessages = useMemo(
    () => messages.filter((message) => message.channel_id === selectedChannel && !message.dm_session),
    [messages, selectedChannel],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisteners: (() => void)[] = [];
    void initEventListeners(navigate).then((listeners) => {
      if (cancelled) listeners.forEach((unlisten) => unlisten());
      else unlisteners = listeners;
    }).catch((reason) => console.error("New UI event bootstrap failed:", reason));
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [navigate]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!host.trim() || !username.trim() || connecting) return;
    setConnecting(true);
    try {
      await useAppStore.getState().connect(host.trim(), port, username.trim());
    } finally {
      setConnecting(false);
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || selectedChannel === null) return;
    setDraft("");
    try {
      await useAppStore.getState().sendMessage(selectedChannel, body);
    } catch {
      setDraft(body);
    }
  };

  const switchToLegacy = async () => {
    if (switchingBack || override) return;
    setSwitchingBack(true);
    try {
      await setSelectedUiDesign("legacy");
    } catch (reason) {
      setSwitchingBack(false);
      console.error("Failed to switch to the legacy UI:", reason);
    }
  };

  if (status === "disconnected" && sessions.length === 0) {
    return (
      <div className={styles.root} data-testid="new-client-root">
        <header className={styles.titlebar} data-tauri-drag-region>
          <span className={styles.appMark}><SparklesIcon /></span><strong>Fancy Mumble</strong>
          <div className={styles.titleActions}>
            <button type="button" onClick={onOpenDesignSheet}><SparklesIcon /> Design system</button>
            <button type="button" onClick={() => void switchToLegacy()} disabled={switchingBack || override !== null}><ArrowLeftIcon /> Old UI</button>
          </div>
        </header>
        <main className={styles.connectPage}>
          <section className={styles.connectCard}>
            <span className={styles.connectIcon}><ServerIcon /></span>
            <small>NEW CLIENT</small>
            <h1>Join a conversation</h1>
            <p>Connect to a Mumble server. The same trusted client logic now drives a calmer, consistent interface.</p>
            <form onSubmit={(event) => void connect(event)}>
              <label>Server address<input value={host} onChange={(event) => setHost(event.target.value)} placeholder="voice.example.com" /></label>
              <div className={styles.formRow}>
                <label>Port<input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} /></label>
                <label>Display name<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your name" /></label>
              </div>
              {error && <div className={styles.error}>{error}</div>}
              <button className={styles.connectButton} type="submit" disabled={connecting || !host.trim() || !username.trim()}>
                {connecting ? "Connecting…" : "Connect to server"}
              </button>
            </form>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.root} data-testid="new-client-root">
      <header className={styles.titlebar} data-tauri-drag-region>
        <span className={styles.appMark}><SparklesIcon /></span><strong>Fancy Mumble</strong>
        <span className={styles.serverTitle}>{activeSession?.label ?? "Connecting"}</span>
        <div className={styles.titleActions}>
          <button type="button" onClick={onOpenDesignSheet}><SparklesIcon /> Design system</button>
          <button type="button" aria-label="Settings"><SettingsIcon /></button>
          <button type="button" onClick={() => void useAppStore.getState().disconnect()}><ArrowLeftIcon /> Disconnect</button>
        </div>
      </header>

      <aside className={styles.servers} aria-label="Connected servers">
        {sessions.map((session) => (
          <button key={session.id} type="button" className={session.id === activeServerId ? styles.serverActive : styles.server} onClick={() => void useAppStore.getState().switchServer(session.id)} title={session.label}>
            {initials(session.label)}
          </button>
        ))}
        <button type="button" className={styles.addServer} title="Add server"><PlusIcon /></button>
      </aside>

      <aside className={styles.channels}>
        <div className={styles.panelHeader}><div><small>SERVER</small><strong>{activeSession?.label ?? activeSession?.host ?? "Fancy server"}</strong></div><button type="button"><KebabMenuIcon /></button></div>
        <label className={styles.search}><SearchIcon /><input placeholder="Search channels" /></label>
        <div className={styles.sectionLabel}><span>CHANNELS</span><button type="button" aria-label="Create channel"><PlusIcon /></button></div>
        <nav>
          {channels.filter((channel) => !channel.detached).map((channel) => (
            <ChannelRow key={channel.id} channel={channel} selected={channel.id === selectedChannel} current={channel.id === currentChannel} unread={unreadCounts[channel.id] ?? 0} onSelect={() => void useAppStore.getState().selectChannel(channel.id)} />
          ))}
        </nav>
        <div className={styles.voiceDock}>
          <div><span className={styles.avatar}>{initials(users.find((user) => user.session === ownSession)?.name ?? username ?? "You")}</span><span><strong>{users.find((user) => user.session === ownSession)?.name ?? (username || "You")}</strong><small>{inCall ? "Voice connected" : "Voice available"}</small></span></div>
          <button type="button" className={voiceState === "muted" ? styles.controlActive : undefined} onClick={() => void (voiceState === "inactive" ? useAppStore.getState().enableVoice() : useAppStore.getState().toggleMute())} aria-label={voiceState === "muted" ? "Unmute" : "Mute"}>{voiceState === "muted" ? <MicOffIcon /> : <MicIcon />}</button>
          <button type="button" onClick={() => void useAppStore.getState().toggleDeafen()} aria-label="Toggle deafen"><HeadphonesIcon /></button>
        </div>
      </aside>

      <main className={styles.conversation}>
        <header className={styles.conversationHeader}>
          <span className={styles.channelGlyph}><HashIcon /></span>
          <div><h1>{activeChannel?.name ?? "Choose a channel"}</h1><p>{activeChannel ? `${activeChannel.user_count} member${activeChannel.user_count === 1 ? "" : "s"}` : "Select a channel to start"}</p></div>
          {activeChannel && currentChannel !== activeChannel.id && <button type="button" className={styles.joinButton} onClick={() => void useAppStore.getState().joinChannel(activeChannel.id)}><VolumeIcon /> Join voice</button>}
        </header>
        {bootstrapStage ? <div className={styles.emptyState}><span className={styles.spinner} /><strong>{bootstrapStage}</strong></div> : channelMessages.length === 0 ? (
          <div className={styles.emptyState}><span><HashIcon /></span><strong>This is the start of #{activeChannel?.name ?? "this channel"}</strong><p>Messages and shared moments will appear here.</p></div>
        ) : (
          <section className={styles.messageList}>{channelMessages.map((message, index) => <Message key={message.message_id ?? `${message.timestamp}-${index}`} message={message} />)}</section>
        )}
        <form className={styles.composer} onSubmit={(event) => void send(event)}>
          <button type="button" aria-label="Attach file"><AttachIcon /></button>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={activeChannel ? `Message #${activeChannel.name}` : "Select a channel"} disabled={!activeChannel} rows={1} />
          <button type="submit" className={styles.sendButton} disabled={!draft.trim() || !activeChannel} aria-label="Send message"><SendIcon /></button>
        </form>
      </main>

      <aside className={styles.members}>
        <div className={styles.panelHeader}><div><small>IN THIS CHANNEL</small><strong>{channelUsers.length} online</strong></div><UsersGroupIcon /></div>
        <div className={styles.memberList}>{channelUsers.map((user) => <MemberRow key={user.session} user={user} own={user.session === ownSession} talking={talkingSessions.has(user.session)} />)}</div>
      </aside>
    </div>
  );
}
