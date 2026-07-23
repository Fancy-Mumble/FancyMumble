import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useNavigate } from "react-router-dom";
import { initEventListeners, useAppStore } from "@core/store";
import { getPreferences } from "@core/preferencesStorage";
import { setKlipyApiKey } from "@core/features/chat/gif/klipyConfig";
import { DEFAULT_SHORTCUTS, loadShortcuts, type ShortcutBindings } from "@core/features/settings/shortcutHelpers";
import { useInAppShortcuts } from "@ui/standard/hooks/useInAppShortcuts";
import {
  ArrowLeftIcon,
  HashIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  PinIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  TrashIcon,
  UsersGroupIcon,
  VolumeIcon,
  InfoIcon,
  WebcamIcon,
} from "@ui/icons";
import { getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import type { AudioSettings, ChannelEntry, MumbleServerConfig, RegisteredUser, SavedServer, UserEntry } from "@core/types";
import { getSavedServers } from "@core/serverStorage";
import { loadPersonalization } from "@ui/standard/personalizationStorage";
import { getUserRelations, USER_RELATIONS_CHANGED_EVENT, userRelationIdentity, type UserRelation } from "@core/userRelationsStorage";
import { PERM_WRITE } from "@core/utils/permissions";
import { WindowTitleBar, applyAuroraAppearance, Button, ChannelEditorSurface, ChannelJoinPrompt, ChannelTree, ConnectionOverlays, FriendsSurface, IconButton, MemberRow, MessageItem, ModalSurface, AuroraClientRuntime, OnboardingFlow, PinnedMessagesPanel, PollCreatorSurface, QuickSwitcher, ScreenShareRuntime, SearchField, ServerAdminPanel, ServerRail, TypingStatus, WorkspaceSurface } from "./components";
import { Lightbox, type LightboxHandle } from "@standard/components/elements/Lightbox";
import type { MessageScope } from "@core/messageOffload";
import type { RailGroup, RailIdentity } from "./components";
import styles from "./AuroraClientApp.module.css";
import extensionStyles from "./AuroraClientExtensions.module.css";
import {
  InfoPanel,
  RichComposer,
  ServerBrowser,
  SettingsPanel,
  UserCard,
  UserHoverCard,
  type Surface,
} from "./AuroraClientSurfaces";

type AuroraClientAppProps = {
  onOpenDesignSheet: () => void;
};

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

export default function AuroraClientApp({ onOpenDesignSheet }: AuroraClientAppProps) {
  const navigate = useNavigate();
  const [surface, setSurface] = useState<Surface>(null);
  const [savedServers, setSavedServers] = useState<SavedServer[] | null>(null);
  const [launcherRailExpanded, setLauncherRailExpanded] = useState(true);
  const [connectedRailExpanded, setConnectedRailExpanded] = useState(false);
  const [hideEmptyChannels, setHideEmptyChannels] = useState(false);
  const [hoveredUser, setHoveredUser] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switchingBack, setSwitchingBack] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");
  const [collapsedChannels, setCollapsedChannels] = useState<Set<number>>(() => new Set());
  const [channelEditor, setChannelEditor] = useState<{ channel: ChannelEntry | null; parentId: number } | null>(null);
  const [channelMenu, setChannelMenu] = useState<{ channel: ChannelEntry; x: number; y: number } | null>(null);
  const [moveUsersSource, setMoveUsersSource] = useState<ChannelEntry | null>(null);
  const [purgeChannel, setPurgeChannel] = useState<ChannelEntry | null>(null);
  const [restrictedChannel, setRestrictedChannel] = useState<ChannelEntry | null>(null);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [showPinned, setShowPinned] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const [memberQuery, setMemberQuery] = useState("");
  const [memberScope, setMemberScope] = useState<"channel" | "server">("channel");
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [relations, setRelations] = useState<Record<string, UserRelation>>({});
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [marketplacePluginId, setMarketplacePluginId] = useState<string | undefined>();
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  const override = getUiDesignOverride();
  const messageListCleanup = useRef<(() => void) | null>(null);
  const lightboxRef = useRef<LightboxHandle>(null);

  const status = useAppStore((state) => state.status);
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const selectedChannel = useAppStore((state) => state.selectedChannel);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const ownSession = useAppStore((state) => state.ownSession);
  const messages = useAppStore((state) => state.messages);
  const pollMessages = useAppStore((state) => state.pollMessages);
  const unreadCounts = useAppStore((state) => state.unreadCounts);
  const voiceState = useAppStore((state) => state.voiceState);
  const inCall = useAppStore((state) => state.inCall);
  const talkingSessions = useAppStore((state) => state.talkingSessions);
  const selectedUser = useAppStore((state) => state.selectedUser);
  const selectedDmUser = useAppStore((state) => state.selectedDmUser);
  const dmMessages = useAppStore((state) => state.dmMessages);
  const error = useAppStore((state) => state.error);
  const bootstrapStage = useAppStore((state) => state.bootstrapStage);
  const pchatHistoryLoading = useAppStore((state) => state.pchatHistoryLoading);
  const listenedChannels = useAppStore((state) => state.listenedChannels);
  const mutedPushChannels = useAppStore((state) => state.mutedPushChannels);

  const activeSession = sessions.find((session) => session.id === activeServerId);
  const canAdminister = ((channels.find((channel) => channel.id === 0)?.permissions ?? 0) & PERM_WRITE) !== 0;
  const activeChannel = channels.find((channel) => channel.id === selectedChannel) ?? null;
  const activeDmUser = users.find((user) => user.session === selectedDmUser) ?? null;
  const activeDmBlocked = activeDmUser ? relations[userRelationIdentity(activeDmUser)]?.blocked ?? false : false;
  // Every saved server plus any live session, grouped by host:port. Identities
  // (usernames) on the same address collapse into one stacked rail tile.
  const serverGroups = useMemo<RailGroup[]>(() => {
    const identityKey = (host: string, port: number, username: string) => `${host}:${port}:${username}`.toLowerCase();
    const groupKey = (host: string, port: number) => `${host}:${port}`.toLowerCase();
    const sessionByIdentity = new Map(sessions.map((session) => [identityKey(session.host, session.port, session.username), session]));
    const groups = new Map<string, RailGroup & { identities: RailIdentity[] }>();

    const ensure = (key: string, seed: Omit<RailGroup, "identities"> & { identities: RailIdentity[] }) => {
      const existing = groups.get(key);
      if (existing) return existing;
      groups.set(key, seed);
      return seed;
    };

    for (const server of savedServers ?? []) {
      const key = groupKey(server.host, server.port);
      const group = ensure(key, { key, label: server.label, host: server.host, port: server.port, favorite: false, identities: [] });
      if (server.favorite) { group.favorite = true; group.label = server.label; }
      group.identities.push({
        id: server.id, label: server.label, host: server.host, port: server.port, username: server.username,
        favorite: server.favorite, sessionId: sessionByIdentity.get(identityKey(server.host, server.port, server.username))?.id ?? null,
      });
    }
    // Sessions without a saved entry (direct connects) still deserve a tile.
    for (const session of sessions) {
      const key = groupKey(session.host, session.port);
      const group = ensure(key, { key, label: session.label, host: session.host, port: session.port, favorite: false, identities: [] });
      if (!group.identities.some((identity) => identity.sessionId === session.id)) {
        group.identities.push({ id: session.id, label: session.label, host: session.host, port: session.port, username: session.username, sessionId: session.id });
      }
    }
    return [...groups.values()].sort((left, right) =>
      Number(right.favorite) - Number(left.favorite)
      || Number(right.identities.some((identity) => identity.sessionId)) - Number(left.identities.some((identity) => identity.sessionId))
      || left.label.localeCompare(right.label));
  }, [savedServers, sessions]);

  const selectRailIdentity = useCallback((identity: RailIdentity) => {
    if (identity.sessionId) { void useAppStore.getState().switchServer(identity.sessionId); return; }
    const saved = (savedServers ?? []).find((server) => server.id === identity.id);
    if (saved) void connectSaved(saved);
  }, [savedServers]);
  const visibleChannels = useMemo(() => {
    const candidates = channels.filter((channel) => !channel.detached);
    const byId = new Map(candidates.map((channel) => [channel.id, channel]));
    const keep = new Set<number>();
    const includeWithAncestors = (channelId: number) => {
      let current = byId.get(channelId);
      while (current && !keep.has(current.id)) { keep.add(current.id); current = current.parent_id === null ? undefined : byId.get(current.parent_id); }
    };
    const needle = channelQuery.trim().toLocaleLowerCase();
    for (const channel of candidates) {
      const matchesSearch = !needle || channel.name.toLocaleLowerCase().includes(needle);
      const matchesVisibility = !hideEmptyChannels || channel.user_count > 0 || channel.id === currentChannel || channel.id === selectedChannel;
      if (matchesSearch && matchesVisibility) includeWithAncestors(channel.id);
    }
    return candidates.filter((channel) => keep.has(channel.id));
  }, [channelQuery, channels, hideEmptyChannels, currentChannel, selectedChannel]);
  const channelUsers = useMemo(() => {
    const onlineIds = new Set(users.flatMap((user) => user.user_id == null ? [] : [user.user_id]));
    const offline: UserEntry[] = memberScope === "server" ? registeredUsers.filter((user) => !onlineIds.has(user.user_id)).map((user) => ({ session: -(user.user_id + 1), name: user.name, channel_id: user.last_channel ?? 0, user_id: user.user_id, texture_size: user.texture_size ?? null, comment: user.comment, mute: false, deaf: false, suppress: false, self_mute: false, self_deaf: false, priority_speaker: false })) : [];
    const query = memberQuery.trim().toLocaleLowerCase();
    return [...users.filter((user) => memberScope === "server" || user.channel_id === selectedChannel), ...offline].filter((user) => !query || user.name.toLocaleLowerCase().includes(query)).sort((left, right) => Number(left.session < 0) - Number(right.session < 0) || Number(talkingSessions.has(right.session)) - Number(talkingSessions.has(left.session)) || left.name.localeCompare(right.name));
  }, [memberQuery, memberScope, registeredUsers, selectedChannel, talkingSessions, users]);
  const channelMessages = useMemo(
    () => [...messages, ...pollMessages].filter((message) => message.channel_id === selectedChannel && !message.dm_session && !relations[message.sender_hash ? `hash:${message.sender_hash}` : `name:${message.sender_name.toLocaleLowerCase()}`]?.ignored && (!chatQuery.trim() || new DOMParser().parseFromString(message.body, "text/html").body.textContent?.toLocaleLowerCase().includes(chatQuery.trim().toLocaleLowerCase()))),
    [chatQuery, messages, pollMessages, relations, selectedChannel],
  );
  const visibleDmMessages = useMemo(() => activeDmBlocked ? [] : dmMessages.filter((message) => !relations[message.sender_hash ? `hash:${message.sender_hash}` : `name:${message.sender_name.toLocaleLowerCase()}`]?.ignored && (!chatQuery.trim() || new DOMParser().parseFromString(message.body, "text/html").body.textContent?.toLocaleLowerCase().includes(chatQuery.trim().toLocaleLowerCase()))), [activeDmBlocked, chatQuery, dmMessages, relations]);

  useEffect(() => {
    let active = true;
    const loadRelations = () => void getUserRelations().then((value) => { if (active) setRelations(value); }).catch(() => { if (active) setRelations({}); });
    loadRelations(); globalThis.addEventListener(USER_RELATIONS_CHANGED_EVENT, loadRelations);
    return () => { active = false; globalThis.removeEventListener(USER_RELATIONS_CHANGED_EVENT, loadRelations); };
  }, []);
  useEffect(() => { const open = () => setShowPollCreator(true); globalThis.addEventListener("new-ui:create-poll", open); return () => globalThis.removeEventListener("new-ui:create-poll", open); }, []);
  useEffect(() => {
    if (!channelMenu) return;
    const close = () => setChannelMenu(null);
    globalThis.addEventListener("click", close);
    globalThis.addEventListener("blur", close);
    return () => { globalThis.removeEventListener("click", close); globalThis.removeEventListener("blur", close); };
  }, [channelMenu]);
  useEffect(() => setSelectedMessageIds(new Set()), [selectedChannel, selectedDmUser]);
  useEffect(() => { const reload = () => void loadShortcuts().then(setShortcuts).catch(() => undefined); reload(); globalThis.addEventListener("shortcuts-changed", reload); return () => globalThis.removeEventListener("shortcuts-changed", reload); }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisteners: (() => void)[] = [];
    void initEventListeners(navigate).then((listeners) => {
      if (cancelled) listeners.forEach((unlisten) => unlisten());
      else unlisteners = listeners;
    }).catch((reason) => console.error("Aurora event bootstrap failed:", reason));
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [navigate]);

  useEffect(() => {
    let active = true;
    const apply = (preferences: { hideEmptyChannels?: boolean; klipyApiKey?: string }) => {
      if (active) { setHideEmptyChannels(preferences.hideEmptyChannels ?? false); setKlipyApiKey(preferences.klipyApiKey); }
    };
    void getPreferences().then(apply).catch(() => undefined);
    const onPreferencesChanged = (event: Event) => apply((event as CustomEvent<{ hideEmptyChannels?: boolean; klipyApiKey?: string }>).detail);
    globalThis.addEventListener("preferences-changed", onPreferencesChanged);
    return () => { active = false; globalThis.removeEventListener("preferences-changed", onPreferencesChanged); };
  }, []);

  const reloadSavedServers = () => {
    void getSavedServers().then(setSavedServers).catch(() => setSavedServers([]));
  };
  const openMarketplace = useCallback((pluginId?: string) => { setMarketplacePluginId(pluginId); setSurface("marketplace"); }, []);
  const orderedChannelIds = useMemo(() => [...channels].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name)).map((channel) => channel.id), [channels]);
  const moveChannel = useCallback((direction: -1 | 1) => { if (selectedChannel == null) return; const index = orderedChannelIds.indexOf(selectedChannel); const next = orderedChannelIds[index + direction]; if (next != null) void useAppStore.getState().selectChannel(next); }, [orderedChannelIds, selectedChannel]);
  useInAppShortcuts(shortcuts, {
    onToggleActivationMode: () => { void invoke<AudioSettings>("get_audio_settings").then((settings) => invoke("set_audio_settings", { settings: { ...settings, push_to_talk: !settings.push_to_talk } })); },
    onMoveChannelUp: () => moveChannel(-1), onMoveChannelDown: () => moveChannel(1), onJumpToRootChannel: () => { void useAppStore.getState().joinChannel(0); },
    onToggleChannelSidebar: () => setConnectedRailExpanded((value) => !value), onToggleMemberPanel: () => setMemberScope((value) => value === "channel" ? "server" : "channel"),
    onOpenQuickSearch: () => setChatSearchOpen(true), onOpenQuickSwitcher: () => setQuickSwitcherOpen(true), onOpenSettings: () => setSurface("settings"),
    onToggleFullscreen: () => { void getCurrentWindow().isFullscreen().then((fullscreen) => getCurrentWindow().setFullscreen(!fullscreen)); },
    onToggleDevOverlay: () => { (getCurrentWebviewWindow() as unknown as { openDevtools?: () => void }).openDevtools?.(); },
  });

  useEffect(() => { reloadSavedServers(); }, []);
  useEffect(() => { void loadPersonalization().then(applyAuroraAppearance).catch(() => undefined); }, []);

  useEffect(() => {
    setRegisteredUsers([]);
    if (status === "disconnected") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<RegisteredUser[]>("user-list", (event) => { if (!disposed) setRegisteredUsers(event.payload); }).then((off) => {
      if (disposed) off(); else unlisten = off;
      return invoke("request_user_list");
    }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, [activeServerId, status]);

  // Message bodies are rendered as HTML, so delegate image clicks at the list
  // level rather than rewriting every <img> into a button. Bound through a
  // callback ref: an effect would run while the launcher is still mounted (list
  // ref still null) and never re-bind once the chat appears.
  const attachMessageList = useCallback((node: HTMLElement | null) => {
    messageListCleanup.current?.();
    messageListCleanup.current = null;
    if (!node) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.tagName !== "IMG") return;
      // The lightbox indexes media by the raw attribute (see extractMedia), not
      // the resolved absolute URL, so look it up with the same value.
      const src = target.getAttribute("src");
      if (src) lightboxRef.current?.open(src);
    };
    node.addEventListener("click", onClick);
    messageListCleanup.current = () => node.removeEventListener("click", onClick);
  }, []);

  const lightboxScope = useCallback((): MessageScope | null => {
    if (selectedDmUser !== null) return { scope: "dm", scopeId: String(selectedDmUser) };
    if (selectedChannel !== null) return { scope: "channel", scopeId: String(selectedChannel) };
    return null;
  }, [selectedDmUser, selectedChannel]);

  // The backend's ServerConfig event can land before this UI mounts (switching
  // design packs while already connected), which would leave us on the built-in
  // defaults - notably a 128 KiB image cap. Pull the real limits on connect.
  useEffect(() => {
    if (status === "disconnected") return;
    void invoke<MumbleServerConfig>("get_server_config")
      .then((serverConfig) => {
        console.info("aurora: server limits", { image: serverConfig.max_image_message_length, message: serverConfig.max_message_length });
        useAppStore.setState({ serverConfig });
      })
      .catch((reason) => console.error("get_server_config failed:", reason));
  }, [activeServerId, status]);

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
    if (!body) return;
    if (selectedDmUser !== null) await useAppStore.getState().sendDm(selectedDmUser, body);
    else if (selectedChannel !== null) await useAppStore.getState().sendMessage(selectedChannel, body);
  };
  const toggleMessageSelection = (messageId: string) => setSelectedMessageIds((current) => {
    const next = new Set(current);
    if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
    return next;
  });
  const deleteSelectedMessages = async () => {
    if (selectedChannel == null || selectedMessageIds.size === 0) return;
    await useAppStore.getState().deletePchatMessages(selectedChannel, { messageIds: [...selectedMessageIds] });
    setSelectedMessageIds(new Set());
  };
  const reorderChannel = async (channel: ChannelEntry, direction: -1 | 1) => {
    const siblings = channels.filter((candidate) => candidate.parent_id === channel.parent_id && !candidate.detached).sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
    const index = siblings.findIndex((candidate) => candidate.id === channel.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await Promise.all(reordered.map((candidate, position) => candidate.position === position * 100 ? Promise.resolve() : useAppStore.getState().updateChannel(candidate.id, { position: position * 100 })));
    setChannelMenu(null);
  };

  const switchToStandard = async () => {
    if (switchingBack || override) return;
    setSwitchingBack(true);
    try {
      await setSelectedUiDesign("standard");
    } catch (reason) {
      setSwitchingBack(false);
      console.error("Failed to switch to the legacy UI:", reason);
    }
  };

  if (status === "disconnected" && sessions.length === 0) {
    if (savedServers === null || savedServers.length === 0) {
      return (
        <div className={`${styles.root} ${styles.onboardingRoot}`} data-testid="aurora-client-root">
          <WindowTitleBar actions={[{ id: "design", label: "Design system", icon: <SparklesIcon />, onClick: onOpenDesignSheet }, { id: "standard", label: "Standard UI", icon: <ArrowLeftIcon />, onClick: () => void switchToStandard(), disabled: switchingBack || override !== null }]} />
          <main className={styles.onboardingPage}>{savedServers === null ? <span className={styles.spinner} /> : <OnboardingFlow onComplete={(server, connectNow) => { setSavedServers([server]); if (connectNow) void connectSaved(server); }} />}</main>
          <AuroraClientRuntime onOpenMarketplace={openMarketplace} />
          <ConnectionOverlays />
        </div>
      );
    }
    return (
      <div className={`${styles.root} ${styles.launcherRoot} ${launcherRailExpanded ? styles.serverRailExpanded : ""}`} data-testid="aurora-client-root">
        <WindowTitleBar actions={[{ id: "servers", label: "Servers", icon: <ServerIcon />, onClick: () => setSurface("servers") }, { id: "design", label: "Design system", icon: <SparklesIcon />, onClick: onOpenDesignSheet }, { id: "standard", label: "Standard UI", icon: <ArrowLeftIcon />, onClick: () => void switchToStandard(), disabled: switchingBack || override !== null }]} />
        <ServerRail groups={serverGroups} expanded={launcherRailExpanded} connecting={connecting} label="Saved servers" onToggle={() => setLauncherRailExpanded((value) => !value)} onSelect={selectRailIdentity} onAdd={() => setSurface("servers")} />
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
        <AuroraClientRuntime onOpenMarketplace={openMarketplace} />
        <ConnectionOverlays />
      </div>
    );
  }

  return (
    <div className={`${styles.root} ${connectedRailExpanded ? styles.serverRailExpanded : ""}`} data-testid="aurora-client-root">
      <WindowTitleBar serverTitle={activeSession?.label ?? "Connecting"} actions={[{ id: "design", label: "Design system", icon: <SparklesIcon />, onClick: onOpenDesignSheet }, { id: "friends", label: "Friends", icon: <UsersGroupIcon />, onClick: () => setSurface("friends") }, { id: "workspace", label: "Workspace", icon: <StarIcon />, onClick: () => setSurface("workspace") }, { id: "servers", label: "Servers", icon: <ServerIcon />, onClick: () => setSurface("servers") }, ...(canAdminister ? [{ id: "admin", label: "Administration", icon: <ShieldCheckIcon />, iconOnly: true, onClick: () => setSurface("admin" as const) }] : []), { id: "settings", label: "Settings", icon: <SettingsIcon />, iconOnly: true, onClick: () => setSurface("settings") }, { id: "disconnect", label: "Disconnect", icon: <ArrowLeftIcon />, onClick: () => void useAppStore.getState().disconnect() }]} />

      <ServerRail groups={serverGroups} expanded={connectedRailExpanded} activeSessionId={activeServerId} label="Connected servers" onToggle={() => setConnectedRailExpanded((value) => !value)} onSelect={selectRailIdentity} onAdd={() => setSurface("servers")} />

      <aside className={styles.channels}>
        <div className={styles.panelHeader}><div><small>SERVER</small><strong>{activeSession?.label ?? activeSession?.host ?? "Fancy server"}</strong></div><IconButton icon={<InfoIcon />} label="Server information" onClick={() => setSurface("server-info")} /></div>
        <SearchField placeholder="Search channels" aria-label="Search channels" value={channelQuery} onChange={(event) => setChannelQuery(event.target.value)} />
        <div className={styles.sectionLabel}><span>CHANNELS</span><IconButton icon={<PlusIcon />} label="Create channel" onClick={() => setChannelEditor({ channel: null, parentId: selectedChannel ?? 0 })} /></div>
        <nav>
          <ChannelTree channels={visibleChannels} collapsed={collapsedChannels} selectedChannel={selectedChannel} currentChannel={currentChannel} unreadCounts={unreadCounts} onSelect={(channel) => void useAppStore.getState().selectChannel(channel.id)} onToggle={(channelId) => setCollapsedChannels((current) => { const next = new Set(current); if (next.has(channelId)) next.delete(channelId); else next.add(channelId); return next; })} onContextMenu={(channel, event) => setChannelMenu({ channel, x: event.clientX, y: event.clientY })} />
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
          <span className={styles.channelGlyph}>{activeDmUser ? initials(activeDmUser.name) : <HashIcon />}</span>
          <div><h1>{activeDmUser?.name ?? activeChannel?.name ?? "Choose a channel"}</h1><p>{activeDmUser ? "Direct message" : activeChannel ? `${activeChannel.user_count} member${activeChannel.user_count === 1 ? "" : "s"}` : "Select a channel to start"}</p></div>
          {activeChannel && <IconButton icon={<InfoIcon />} label="Channel information" className={styles.headerIconButton} onClick={() => setSurface("channel-info")} />}
          {activeChannel && <IconButton icon={<SettingsIcon />} label="Edit channel" className={styles.headerIconButton} onClick={() => setChannelEditor({ channel: activeChannel, parentId: activeChannel.parent_id ?? 0 })} />}
          {activeChannel && <IconButton icon={<SearchIcon />} label="Search messages" className={styles.headerIconButton} onClick={() => setChatSearchOpen((value) => !value)} />}
          {activeChannel && <IconButton icon={<PinIcon />} label="Pinned messages" className={styles.headerIconButton} onClick={() => setShowPinned(true)} />}
          <IconButton icon={<WebcamIcon />} label="Share screen" className={styles.headerIconButton} onClick={() => setSurface("screen-share")} />
          {activeChannel && currentChannel !== activeChannel.id && <Button variant="bare" className={styles.joinButton} leadingIcon={<VolumeIcon />} onClick={() => activeChannel.is_enter_restricted ? setRestrictedChannel(activeChannel) : void useAppStore.getState().joinChannel(activeChannel.id)}>Join voice</Button>}
        </header>
        {chatSearchOpen && <div className={extensionStyles.chatSearch}><SearchField autoFocus value={chatQuery} onChange={(event) => setChatQuery(event.target.value)} placeholder="Search this channel" aria-label="Search messages" /><Button variant="bare" onClick={() => { setChatQuery(""); setChatSearchOpen(false); }}>Close</Button></div>}
        <ScreenShareRuntime pickerRequested={surface === "screen-share"} onClosePicker={() => setSurface(null)} />
        {activeChannel?.pchat_protocol && activeChannel.pchat_protocol !== "none" && <Button variant="bare" className={extensionStyles.loadHistory} disabled={pchatHistoryLoading.has(activeChannel.id)} onClick={() => void useAppStore.getState().fetchHistory(activeChannel.id, channelMessages[0]?.message_id ?? undefined)}>{pchatHistoryLoading.has(activeChannel.id) ? "Loading history…" : "Load earlier messages"}</Button>}
        {bootstrapStage ? <div className={styles.emptyState}><span className={styles.spinner} /><strong>{bootstrapStage}</strong></div> : (activeDmUser ? visibleDmMessages : channelMessages).length === 0 ? (
          <div className={styles.emptyState}><span><HashIcon /></span><strong>{activeDmUser ? `Start a conversation with ${activeDmUser.name}` : `This is the start of #${activeChannel?.name ?? "this channel"}`}</strong><p>Messages and shared moments will appear here.</p></div>
        ) : (
          <section className={styles.messageList} ref={attachMessageList}>{(activeDmUser ? visibleDmMessages : channelMessages).map((message, index) => <MessageItem key={message.message_id ?? `${message.timestamp}-${index}`} message={message} selected={!!message.message_id && selectedMessageIds.has(message.message_id)} selectionMode={selectedMessageIds.size > 0} onToggleSelection={toggleMessageSelection} />)}</section>
        )}
        {selectedMessageIds.size > 0 && <div className={extensionStyles.messageSelectionBar}><strong>{selectedMessageIds.size} selected</strong><span>Select more messages or remove the selected persistent-chat entries.</span><Button onClick={() => setSelectedMessageIds(new Set())}>Cancel</Button><Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => void deleteSelectedMessages()}>Delete selected</Button></div>}
        <TypingStatus channelId={selectedChannel} />
        {activeDmBlocked && <div className={extensionStyles.blockedDm}>Direct messages from this user are blocked. Unblock them from the profile card to continue.</div>}
        <RichComposer channel={activeChannel} targetLabel={!activeDmBlocked ? activeDmUser?.name : undefined} onSend={sendRich} />
      </main>

      <aside className={styles.members}>
        <div className={styles.panelHeader}><div><small>{memberScope === "channel" ? "IN THIS CHANNEL" : "SERVER MEMBERS"}</small><strong>{channelUsers.length} {memberScope === "channel" ? "online" : "members"}</strong></div><UsersGroupIcon /></div>
        <div className={extensionStyles.memberTools}><SearchField value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Find members" aria-label="Search members" /><div><Button variant={memberScope === "channel" ? "secondary" : "bare"} onClick={() => setMemberScope("channel")}>Channel</Button><Button variant={memberScope === "server" ? "secondary" : "bare"} onClick={() => setMemberScope("server")}>Server</Button></div></div>
        <div className={styles.memberList}>{channelUsers.map((user) => <MemberRow key={user.session} user={user} own={user.session === ownSession} talking={talkingSessions.has(user.session)} onHover={setHoveredUser} />)}</div>
      </aside>
      {hoveredUser !== null && selectedUser === null && users.find((user) => user.session === hoveredUser) && <UserHoverCard user={users.find((user) => user.session === hoveredUser)!} />}
      {selectedUser !== null && users.find((user) => user.session === selectedUser) && <UserCard user={users.find((user) => user.session === selectedUser)!} onClose={() => useAppStore.getState().selectUser(null)} />}
      {surface === "servers" && <ServerBrowser onClose={() => { setSurface(null); reloadSavedServers(); }} />}
      {surface === "settings" && <SettingsPanel onClose={() => setSurface(null)} />}
      {surface === "admin" && <ServerAdminPanel onClose={() => setSurface(null)} />}
      {surface === "marketplace" && <ServerAdminPanel initialTab="marketplace" initialPluginId={marketplacePluginId} onClose={() => setSurface(null)} />}
      {surface === "workspace" && <WorkspaceSurface onClose={() => setSurface(null)} />}
      {surface === "friends" && <FriendsSurface onClose={() => setSurface(null)} />}
      {surface === "server-info" && <InfoPanel kind="server" channel={activeChannel} onClose={() => setSurface(null)} />}
      {surface === "channel-info" && <InfoPanel kind="channel" channel={activeChannel} onClose={() => setSurface(null)} />}
      {channelEditor && <ChannelEditorSurface channel={channelEditor.channel} parentId={channelEditor.parentId} onClose={() => setChannelEditor(null)} />}
      {restrictedChannel && <ChannelJoinPrompt channel={restrictedChannel} onClose={() => setRestrictedChannel(null)} />}
      {channelMenu && <div className={extensionStyles.channelContextMenu} style={{ left: channelMenu.x, top: channelMenu.y }} onClick={(event) => event.stopPropagation()} role="menu"><strong>#{channelMenu.channel.name}</strong><Button variant="bare" onClick={() => { void useAppStore.getState().selectChannel(channelMenu.channel.id); setChannelMenu(null); }}>Open text channel</Button><Button variant="bare" onClick={() => { if (channelMenu.channel.is_enter_restricted) setRestrictedChannel(channelMenu.channel); else void useAppStore.getState().joinChannel(channelMenu.channel.id); setChannelMenu(null); }}>Join voice</Button><Button variant="bare" onClick={() => { void useAppStore.getState().toggleListen(channelMenu.channel.id); setChannelMenu(null); }}>{listenedChannels.has(channelMenu.channel.id) ? "Stop listening" : "Listen without joining"}</Button><Button variant="bare" onClick={() => { void useAppStore.getState().toggleMutePushChannel(channelMenu.channel.id); setChannelMenu(null); }}>{mutedPushChannels.has(channelMenu.channel.id) ? "Enable notifications" : "Mute notifications"}</Button><Button variant="bare" onClick={() => { setChannelEditor({ channel: null, parentId: channelMenu.channel.id }); setChannelMenu(null); }}>Create subchannel</Button><Button variant="bare" onClick={() => { setChannelEditor({ channel: channelMenu.channel, parentId: channelMenu.channel.parent_id ?? 0 }); setChannelMenu(null); }}>Edit or move channel</Button><Button variant="bare" onClick={() => { void useAppStore.getState().selectChannel(channelMenu.channel.id); setSurface("admin"); setChannelMenu(null); }}>Edit permissions</Button><Button variant="bare" onClick={() => void reorderChannel(channelMenu.channel, -1)}>Move up</Button><Button variant="bare" onClick={() => void reorderChannel(channelMenu.channel, 1)}>Move down</Button>{channelMenu.channel.user_count > 0 && <Button variant="bare" onClick={() => { setMoveUsersSource(channelMenu.channel); setChannelMenu(null); }}>Move all users…</Button>}{channelMenu.channel.pchat_protocol && channelMenu.channel.pchat_protocol !== "none" && <Button variant="danger" onClick={() => { setPurgeChannel(channelMenu.channel); setChannelMenu(null); }}>Purge message history…</Button>}</div>}
      {moveUsersSource && <ModalSurface title={`Move everyone from #${moveUsersSource.name}`} eyebrow="CHANNEL MODERATION" onClose={() => setMoveUsersSource(null)}><div className={extensionStyles.channelTargetList}>{channels.filter((channel) => !channel.detached && channel.id !== moveUsersSource.id).map((channel) => <Button variant="bare" key={channel.id} onClick={() => void useAppStore.getState().moveChannelUsers(moveUsersSource.id, channel.id).then(() => setMoveUsersSource(null))}><span>#{channel.name}</span><small>{channel.user_count} members</small></Button>)}</div></ModalSurface>}
      {purgeChannel && <ModalSurface title={`Purge #${purgeChannel.name}`} eyebrow="DESTRUCTIVE ACTION" onClose={() => setPurgeChannel(null)}><div className={extensionStyles.purgeConfirm}><p>This removes all persistent messages in the channel up to the current time. This cannot be undone.</p><footer><Button onClick={() => setPurgeChannel(null)}>Cancel</Button><Button variant="danger" onClick={() => void useAppStore.getState().deletePchatMessages(purgeChannel.id, { timeTo: Date.now() }).then(() => setPurgeChannel(null))}>Purge history</Button></footer></div></ModalSurface>}
      {showPinned && <PinnedMessagesPanel messages={channelMessages} onClose={() => setShowPinned(false)} />}
      {showPollCreator && activeChannel && <PollCreatorSurface channelId={activeChannel.id} onClose={() => setShowPollCreator(false)} />}
      {quickSwitcherOpen && <QuickSwitcher sessions={sessions} channels={channels} users={users} onSwitchServer={(id) => void useAppStore.getState().switchServer(id)} onSelectChannel={(id) => void useAppStore.getState().selectChannel(id)} onSelectUser={(session) => void useAppStore.getState().selectDmUser(session)} onOpenSettings={() => setSurface("settings")} onOpenWorkspace={() => setSurface("workspace")} onClose={() => setQuickSwitcherOpen(false)} />}
      <Lightbox ref={lightboxRef} allMessages={activeDmUser ? visibleDmMessages : channelMessages} selectedChannel={selectedChannel} selectedDmUser={selectedDmUser} currentScope={lightboxScope} />
      <AuroraClientRuntime onOpenMarketplace={openMarketplace} />
      <ConnectionOverlays />
    </div>
  );
}
