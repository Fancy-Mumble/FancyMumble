import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { initEventListeners, useAppStore } from "@core/store";
import { getPreferences } from "@core/preferencesStorage";
import {
  ArrowLeftIcon,
  HashIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  SparklesIcon,
  UsersGroupIcon,
  VolumeIcon,
  InfoIcon,
  WebcamIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@ui/icons";
import { getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import type { ChannelEntry, ChatMessage, SavedServer, UserEntry } from "@core/types";
import { getSavedServers } from "@core/serverStorage";
import styles from "./NewClientApp.module.css";
import {
  InfoPanel,
  LinkPreviews,
  RichComposer,
  ScreenSharePanel,
  ServerBrowser,
  SettingsPanel,
  UserCard,
  UserHoverCard,
  OnboardingStepper,
  type Surface,
} from "./NewClientSurfaces";

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

function MemberRow({ user, own, talking, onHover }: { user: UserEntry; own: boolean; talking: boolean; onHover: (session: number | null) => void }) {
  const muted = user.self_mute || user.mute || user.suppress;
  return (
    <button type="button" className={styles.member} onClick={() => useAppStore.getState().selectUser(user.session)} onMouseEnter={() => onHover(user.session)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(user.session)} onBlur={() => onHover(null)}>
      <span className={`${styles.avatar} ${talking ? styles.avatarTalking : ""}`}>{initials(user.name)}</span>
      <span><strong>{user.name}{own ? " (you)" : ""}</strong><small>{talking ? "Speaking" : muted ? "Muted" : "Listening"}</small></span>
      {muted ? <MicOffIcon /> : <MicIcon />}
    </button>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const embeds = useAppStore((state) => message.message_id ? state.linkEmbeds.get(message.message_id) : undefined);
  const disableLinkPreviews = useAppStore((state) => state.disableLinkPreviews);
  const allowExternal = useAppStore((state) => state.enableExternalEmbeds);
  return (
    <article className={`${styles.message} ${message.is_own ? styles.ownMessage : ""}`}>
      <span className={styles.avatar}>{initials(message.sender_name || "Server")}</span>
      <div>
        <header><strong>{message.sender_name || "Server"}</strong><time>{formatTime(message.timestamp)}</time></header>
        <p>{messageText(message.body)}</p>
        {!disableLinkPreviews && embeds && embeds.length > 0 && <LinkPreviews embeds={embeds} allowExternal={allowExternal} />}
      </div>
    </article>
  );
}

export default function NewClientApp({ onOpenDesignSheet }: NewClientAppProps) {
  const navigate = useNavigate();
  const [surface, setSurface] = useState<Surface>(null);
  const [savedServers, setSavedServers] = useState<SavedServer[] | null>(null);
  const [serverRailExpanded, setServerRailExpanded] = useState(true);
  const [hideEmptyChannels, setHideEmptyChannels] = useState(false);
  const [hoveredUser, setHoveredUser] = useState<number | null>(null);
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
  const selectedUser = useAppStore((state) => state.selectedUser);
  const error = useAppStore((state) => state.error);
  const bootstrapStage = useAppStore((state) => state.bootstrapStage);

  const activeSession = sessions.find((session) => session.id === activeServerId);
  const activeChannel = channels.find((channel) => channel.id === selectedChannel) ?? null;
  const visibleChannels = useMemo(
    () => channels.filter((channel) => !channel.detached && (!hideEmptyChannels || channel.user_count > 0 || channel.id === currentChannel || channel.id === selectedChannel)),
    [channels, hideEmptyChannels, currentChannel, selectedChannel],
  );
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

  useEffect(() => {
    let active = true;
    const apply = (preferences: { hideEmptyChannels?: boolean }) => {
      if (active) setHideEmptyChannels(preferences.hideEmptyChannels ?? false);
    };
    void getPreferences().then(apply).catch(() => undefined);
    const onPreferencesChanged = (event: Event) => apply((event as CustomEvent<{ hideEmptyChannels?: boolean }>).detail);
    globalThis.addEventListener("preferences-changed", onPreferencesChanged);
    return () => { active = false; globalThis.removeEventListener("preferences-changed", onPreferencesChanged); };
  }, []);

  const reloadSavedServers = () => {
    void getSavedServers().then(setSavedServers).catch(() => setSavedServers([]));
  };

  useEffect(() => { reloadSavedServers(); }, []);

  const connectSaved = async (server: SavedServer) => {
    if (connecting) return;
    setConnecting(true);
    try {
      await useAppStore.getState().connect(server.host, server.port, server.username, server.cert_label);
    } finally {
      setConnecting(false);
    }
  };

  const sendRich = async (html: string) => {
    const body = html.trim();
    if (!body || selectedChannel === null) return;
    await useAppStore.getState().sendMessage(selectedChannel, body);
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
    if (savedServers === null || savedServers.length === 0) {
      return (
        <div className={`${styles.root} ${styles.onboardingRoot}`} data-testid="new-client-root">
          <header className={styles.titlebar} data-tauri-drag-region>
            <span className={styles.appMark}><SparklesIcon /></span><strong>Fancy Mumble</strong>
            <div className={styles.titleActions}><button type="button" onClick={onOpenDesignSheet}><SparklesIcon /> Design system</button><button type="button" onClick={() => void switchToLegacy()} disabled={switchingBack || override !== null}><ArrowLeftIcon /> Old UI</button></div>
          </header>
          <main className={styles.onboardingPage}>{savedServers === null ? <span className={styles.spinner} /> : <OnboardingStepper onComplete={(server, connectNow) => { setSavedServers([server]); if (connectNow) void connectSaved(server); }} />}</main>
        </div>
      );
    }
    return (
      <div className={`${styles.root} ${styles.launcherRoot} ${serverRailExpanded ? styles.serverRailExpanded : ""}`} data-testid="new-client-root">
        <header className={styles.titlebar} data-tauri-drag-region>
          <span className={styles.appMark}><SparklesIcon /></span><strong>Fancy Mumble</strong>
          <div className={styles.titleActions}>
            <button type="button" onClick={() => setSurface("servers")}><ServerIcon /> Servers</button>
            <button type="button" onClick={onOpenDesignSheet}><SparklesIcon /> Design system</button>
            <button type="button" onClick={() => void switchToLegacy()} disabled={switchingBack || override !== null}><ArrowLeftIcon /> Old UI</button>
          </div>
        </header>
        <aside className={styles.servers} aria-label="Saved servers">
          <div className={styles.railHeader}><span>YOUR SERVERS</span><button type="button" onClick={() => setServerRailExpanded((value) => !value)} aria-label={serverRailExpanded ? "Collapse server sidebar" : "Expand server sidebar"}>{serverRailExpanded ? <ChevronLeftIcon /> : <ChevronRightIcon />}</button></div>
          <div className={styles.serverLibrary}>{savedServers.map((server) => <button key={server.id} type="button" className={styles.savedServer} disabled={connecting} onClick={() => void connectSaved(server)} title={`Connect to ${server.label}`}><span className={styles.serverMark}>{initials(server.label)}</span><span className={styles.serverDetails}><strong>{server.label}</strong><small>{server.host}:{server.port}</small><em>{server.username}</em></span><i /></button>)}</div>
          <button type="button" className={styles.addServer} title="Add server" onClick={() => setSurface("servers")}><PlusIcon /><span>Add server</span></button>
        </aside>
        <main className={styles.launcherIntro}>
          <section className={styles.launcherWelcome}>
            <div className={styles.introOrb}><span><VolumeIcon /></span><i /><i /><i /></div>
            <small>SERVER LAUNCHER</small>
            <h1>Your conversations<br /><em>are ready when you are.</em></h1>
            <p>Choose a server from the sidebar to connect. Expand it whenever you want to see addresses, identities, and connection details.</p>
            <div className={styles.introFeatures}>
              <span><b>{savedServers.length}</b> saved server{savedServers.length === 1 ? "" : "s"}</span>
              <span><b>Native</b> low-latency voice</span>
              <span><b>Private</b> server-first design</span>
              {error && <div className={styles.error}>{error}</div>}
              {connecting && <span className={styles.connectingHint}>Connecting…</span>}
            </div>
          </section>
        </main>
        {surface === "servers" && <ServerBrowser onClose={() => { setSurface(null); reloadSavedServers(); }} />}
      </div>
    );
  }

  return (
    <div className={`${styles.root} ${serverRailExpanded ? styles.serverRailExpanded : ""}`} data-testid="new-client-root">
      <header className={styles.titlebar} data-tauri-drag-region>
        <span className={styles.appMark}><SparklesIcon /></span><strong>Fancy Mumble</strong>
        <span className={styles.serverTitle}>{activeSession?.label ?? "Connecting"}</span>
        <div className={styles.titleActions}>
          <button type="button" onClick={onOpenDesignSheet}><SparklesIcon /> Design system</button>
          <button type="button" onClick={() => setSurface("servers")}><ServerIcon /> Servers</button>
          <button type="button" aria-label="Settings" onClick={() => setSurface("settings")}><SettingsIcon /></button>
          <button type="button" onClick={() => void useAppStore.getState().disconnect()}><ArrowLeftIcon /> Disconnect</button>
        </div>
      </header>

      <aside className={styles.servers} aria-label="Connected servers">
        <div className={styles.railHeader}><span>CONNECTED</span><button type="button" onClick={() => setServerRailExpanded((value) => !value)} aria-label={serverRailExpanded ? "Collapse server sidebar" : "Expand server sidebar"}>{serverRailExpanded ? <ChevronLeftIcon /> : <ChevronRightIcon />}</button></div>
        {sessions.map((session) => (
          <button key={session.id} type="button" className={session.id === activeServerId ? styles.serverActive : styles.server} onClick={() => void useAppStore.getState().switchServer(session.id)} title={session.label}>
            <span className={styles.serverMark}>{initials(session.label)}</span><span className={styles.serverDetails}><strong>{session.label}</strong><small>{session.host}:{session.port}</small><em>{session.username}</em></span>
          </button>
        ))}
        <button type="button" className={styles.addServer} title="Add server" onClick={() => setSurface("servers")}><PlusIcon /><span>Add server</span></button>
      </aside>

      <aside className={styles.channels}>
        <div className={styles.panelHeader}><div><small>SERVER</small><strong>{activeSession?.label ?? activeSession?.host ?? "Fancy server"}</strong></div><button type="button" aria-label="Server information" onClick={() => setSurface("server-info")}><InfoIcon /></button></div>
        <label className={styles.search}><SearchIcon /><input placeholder="Search channels" /></label>
        <div className={styles.sectionLabel}><span>CHANNELS</span><button type="button" aria-label="Create channel"><PlusIcon /></button></div>
        <nav>
          {visibleChannels.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} selected={channel.id === selectedChannel} current={channel.id === currentChannel} unread={unreadCounts[channel.id] ?? 0} onSelect={() => void useAppStore.getState().selectChannel(channel.id)} />
          ))}
          {visibleChannels.length === 0 && <div className={styles.noChannels}>No active channels</div>}
        </nav>
        <div className={styles.voiceDock}>
          <div><span className={styles.avatar}>{initials(users.find((user) => user.session === ownSession)?.name ?? activeSession?.username ?? "You")}</span><span><strong>{users.find((user) => user.session === ownSession)?.name ?? activeSession?.username ?? "You"}</strong><small>{inCall ? "Voice connected" : "Voice available"}</small></span></div>
          <button type="button" className={voiceState === "muted" ? styles.controlActive : undefined} onClick={() => void (voiceState === "inactive" ? useAppStore.getState().enableVoice() : useAppStore.getState().toggleMute())} aria-label={voiceState === "muted" ? "Unmute" : "Mute"}>{voiceState === "muted" ? <MicOffIcon /> : <MicIcon />}</button>
          <button type="button" onClick={() => void useAppStore.getState().toggleDeafen()} aria-label="Toggle deafen"><HeadphonesIcon /></button>
        </div>
      </aside>

      <main className={styles.conversation}>
        <header className={styles.conversationHeader}>
          <span className={styles.channelGlyph}><HashIcon /></span>
          <div><h1>{activeChannel?.name ?? "Choose a channel"}</h1><p>{activeChannel ? `${activeChannel.user_count} member${activeChannel.user_count === 1 ? "" : "s"}` : "Select a channel to start"}</p></div>
          {activeChannel && <button type="button" className={styles.headerIconButton} aria-label="Channel information" onClick={() => setSurface("channel-info")}><InfoIcon /></button>}
          <button type="button" className={styles.headerIconButton} aria-label="Share screen" onClick={() => setSurface("screen-share")}><WebcamIcon /></button>
          {activeChannel && currentChannel !== activeChannel.id && <button type="button" className={styles.joinButton} onClick={() => void useAppStore.getState().joinChannel(activeChannel.id)}><VolumeIcon /> Join voice</button>}
        </header>
        {bootstrapStage ? <div className={styles.emptyState}><span className={styles.spinner} /><strong>{bootstrapStage}</strong></div> : channelMessages.length === 0 ? (
          <div className={styles.emptyState}><span><HashIcon /></span><strong>This is the start of #{activeChannel?.name ?? "this channel"}</strong><p>Messages and shared moments will appear here.</p></div>
        ) : (
          <section className={styles.messageList}>{channelMessages.map((message, index) => <Message key={message.message_id ?? `${message.timestamp}-${index}`} message={message} />)}</section>
        )}
        <RichComposer channel={activeChannel} onSend={sendRich} />
      </main>

      <aside className={styles.members}>
        <div className={styles.panelHeader}><div><small>IN THIS CHANNEL</small><strong>{channelUsers.length} online</strong></div><UsersGroupIcon /></div>
        <div className={styles.memberList}>{channelUsers.map((user) => <MemberRow key={user.session} user={user} own={user.session === ownSession} talking={talkingSessions.has(user.session)} onHover={setHoveredUser} />)}</div>
      </aside>
      {hoveredUser !== null && selectedUser === null && users.find((user) => user.session === hoveredUser) && <UserHoverCard user={users.find((user) => user.session === hoveredUser)!} />}
      {selectedUser !== null && users.find((user) => user.session === selectedUser) && <UserCard user={users.find((user) => user.session === selectedUser)!} onClose={() => useAppStore.getState().selectUser(null)} />}
      {surface === "servers" && <ServerBrowser onClose={() => { setSurface(null); reloadSavedServers(); }} />}
      {surface === "settings" && <SettingsPanel onClose={() => setSurface(null)} />}
      {surface === "server-info" && <InfoPanel kind="server" channel={activeChannel} onClose={() => setSurface(null)} />}
      {surface === "channel-info" && <InfoPanel kind="channel" channel={activeChannel} onClose={() => setSurface(null)} />}
      {surface === "screen-share" && <ScreenSharePanel onClose={() => setSurface(null)} />}
    </div>
  );
}
