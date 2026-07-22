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
  ServerIcon,
  SettingsIcon,
  SparklesIcon,
  UsersGroupIcon,
  VolumeIcon,
  InfoIcon,
  WebcamIcon,
} from "@ui/icons";
import { getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import type { SavedServer } from "@core/types";
import { getSavedServers } from "@core/serverStorage";
import { AppTitleBar, Button, ChannelRow, IconButton, MemberRow, MessageItem, OnboardingFlow, SearchField, ServerRail } from "./components";
import styles from "./NewClientApp.module.css";
import {
  InfoPanel,
  RichComposer,
  ScreenSharePanel,
  ServerBrowser,
  SettingsPanel,
  UserCard,
  UserHoverCard,
  type Surface,
} from "./NewClientSurfaces";

type NewClientAppProps = {
  onOpenDesignSheet: () => void;
};

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
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
          <AppTitleBar actions={[{ id: "design", label: "Design system", icon: <SparklesIcon />, onClick: onOpenDesignSheet }, { id: "legacy", label: "Old UI", icon: <ArrowLeftIcon />, onClick: () => void switchToLegacy(), disabled: switchingBack || override !== null }]} />
          <main className={styles.onboardingPage}>{savedServers === null ? <span className={styles.spinner} /> : <OnboardingFlow onComplete={(server, connectNow) => { setSavedServers([server]); if (connectNow) void connectSaved(server); }} />}</main>
        </div>
      );
    }
    return (
      <div className={`${styles.root} ${styles.launcherRoot} ${serverRailExpanded ? styles.serverRailExpanded : ""}`} data-testid="new-client-root">
        <AppTitleBar actions={[{ id: "servers", label: "Servers", icon: <ServerIcon />, onClick: () => setSurface("servers") }, { id: "design", label: "Design system", icon: <SparklesIcon />, onClick: onOpenDesignSheet }, { id: "legacy", label: "Old UI", icon: <ArrowLeftIcon />, onClick: () => void switchToLegacy(), disabled: switchingBack || override !== null }]} />
        <ServerRail items={savedServers} expanded={serverRailExpanded} connecting={connecting} label="Saved servers" onToggle={() => setServerRailExpanded((value) => !value)} onSelect={(server) => void connectSaved(server)} onAdd={() => setSurface("servers")} />
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
      <AppTitleBar serverTitle={activeSession?.label ?? "Connecting"} actions={[{ id: "design", label: "Design system", icon: <SparklesIcon />, onClick: onOpenDesignSheet }, { id: "servers", label: "Servers", icon: <ServerIcon />, onClick: () => setSurface("servers") }, { id: "settings", label: "Settings", icon: <SettingsIcon />, iconOnly: true, onClick: () => setSurface("settings") }, { id: "disconnect", label: "Disconnect", icon: <ArrowLeftIcon />, onClick: () => void useAppStore.getState().disconnect() }]} />

      <ServerRail items={sessions} expanded={serverRailExpanded} activeId={activeServerId} label="Connected servers" onToggle={() => setServerRailExpanded((value) => !value)} onSelect={(session) => void useAppStore.getState().switchServer(session.id)} onAdd={() => setSurface("servers")} />

      <aside className={styles.channels}>
        <div className={styles.panelHeader}><div><small>SERVER</small><strong>{activeSession?.label ?? activeSession?.host ?? "Fancy server"}</strong></div><IconButton icon={<InfoIcon />} label="Server information" onClick={() => setSurface("server-info")} /></div>
        <SearchField placeholder="Search channels" aria-label="Search channels" />
        <div className={styles.sectionLabel}><span>CHANNELS</span><IconButton icon={<PlusIcon />} label="Create channel" /></div>
        <nav>
          {visibleChannels.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} selected={channel.id === selectedChannel} current={channel.id === currentChannel} unread={unreadCounts[channel.id] ?? 0} onSelect={() => void useAppStore.getState().selectChannel(channel.id)} />
          ))}
          {visibleChannels.length === 0 && <div className={styles.noChannels}>No active channels</div>}
        </nav>
        <div className={styles.voiceDock}>
          <div><span className={styles.avatar}>{initials(users.find((user) => user.session === ownSession)?.name ?? activeSession?.username ?? "You")}</span><span><strong>{users.find((user) => user.session === ownSession)?.name ?? activeSession?.username ?? "You"}</strong><small>{inCall ? "Voice connected" : "Voice available"}</small></span></div>
          <IconButton icon={voiceState === "muted" ? <MicOffIcon /> : <MicIcon />} label={voiceState === "muted" ? "Unmute" : "Mute"} className={voiceState === "muted" ? styles.controlActive : undefined} onClick={() => void (voiceState === "inactive" ? useAppStore.getState().enableVoice() : useAppStore.getState().toggleMute())} />
          <IconButton icon={<HeadphonesIcon />} label="Toggle deafen" onClick={() => void useAppStore.getState().toggleDeafen()} />
        </div>
      </aside>

      <main className={styles.conversation}>
        <header className={styles.conversationHeader}>
          <span className={styles.channelGlyph}><HashIcon /></span>
          <div><h1>{activeChannel?.name ?? "Choose a channel"}</h1><p>{activeChannel ? `${activeChannel.user_count} member${activeChannel.user_count === 1 ? "" : "s"}` : "Select a channel to start"}</p></div>
          {activeChannel && <IconButton icon={<InfoIcon />} label="Channel information" className={styles.headerIconButton} onClick={() => setSurface("channel-info")} />}
          <IconButton icon={<WebcamIcon />} label="Share screen" className={styles.headerIconButton} onClick={() => setSurface("screen-share")} />
          {activeChannel && currentChannel !== activeChannel.id && <Button variant="bare" className={styles.joinButton} leadingIcon={<VolumeIcon />} onClick={() => void useAppStore.getState().joinChannel(activeChannel.id)}>Join voice</Button>}
        </header>
        {bootstrapStage ? <div className={styles.emptyState}><span className={styles.spinner} /><strong>{bootstrapStage}</strong></div> : channelMessages.length === 0 ? (
          <div className={styles.emptyState}><span><HashIcon /></span><strong>This is the start of #{activeChannel?.name ?? "this channel"}</strong><p>Messages and shared moments will appear here.</p></div>
        ) : (
          <section className={styles.messageList}>{channelMessages.map((message, index) => <MessageItem key={message.message_id ?? `${message.timestamp}-${index}`} message={message} />)}</section>
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
