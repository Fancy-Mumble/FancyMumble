import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@core/store";
import { useInAppShortcuts } from "@ui/standard/hooks/useInAppShortcuts";
import {
  HashIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  VolumeIcon,
  InfoIcon,
  WebcamIcon,
} from "@ui/icons";
import type { AudioSettings, ChannelEntry, SavedServer } from "@core/types";
import { userRelationIdentity } from "@core/userRelationsStorage";
import { PERM_WRITE } from "@core/utils/permissions";
import { isStructuralChannel } from "@core/utils/channelAttributes";
import { applyMentionsToHtml, type MentionResolver } from "@core/utils/mentions";
import {
  ClientTitleBar,
  Button,
  ChannelContextMenu,
  ChannelEditorSurface,
  ChannelJoinPrompt,
  ChannelSidebar,
  MoveUsersDialog,
  PurgeChannelDialog,
  ConnectionOverlays,
  FriendsSurface,
  IconButton,
  MemberSidebar,
  MessageItem,
  AuroraClientRuntime,
  OnboardingFlow,
  PinnedMessagesPanel,
  PollCreatorSurface,
  QuickSwitcher,
  ScreenShareRuntime,
  SearchField,
  SidebarContextMenu,
  ServerAdminPanel,
  ServerRail,
  SessionStatusScreen,
  SettingsPanel,
  TypingStatus,
  WorkspaceSurface,
} from "./components";
import { Lightbox, type LightboxHandle } from "@standard/components/elements/Lightbox";
import type { MessageScope } from "@core/messageOffload";
import type { RailIdentity } from "./components";
import {
  filterChannelMessages,
  filterDmMessages,
  filterVisibleChannels,
  groupServersForRail,
  listChannelMembers,
} from "./clientSelectors";
import {
  useAuroraAppearance,
  useClientEventBridge,
  useClientPreferences,
  useMessageImageClicks,
  useRegisteredUsers,
  useSavedServers,
  useServerConfigSync,
  useShortcutBindings,
  useUserRelations,
} from "./clientHooks";
import {
  useChannelModeration,
  useChatSearch,
  useMemberDirectory,
  useRailExpansion,
  useSurfaceRouting,
} from "./clientState";
import styles from "./AuroraClientApp.module.css";
import extensionStyles from "./AuroraClientExtensions.module.css";
import { InfoPanel, RichComposer, ServerBrowser, UserCard, UserHoverCard } from "./components";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export default function AuroraClientApp() {
  const navigate = useNavigate();
  const [hoveredUser, setHoveredUser] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");
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

  const {
    surface,
    setSurface,
    marketplacePluginId,
    openMarketplace,
    quickSwitcherOpen,
    setQuickSwitcherOpen,
    showPollCreator,
    setShowPollCreator,
  } = useSurfaceRouting();
  const { launcherRailExpanded, setLauncherRailExpanded, connectedRailExpanded, setConnectedRailExpanded } =
    useRailExpansion();
  const {
    channelEditor,
    setChannelEditor,
    channelMenu,
    setChannelMenu,
    sidebarMenu,
    setSidebarMenu,
    moveUsersSource,
    setMoveUsersSource,
    purgeChannel,
    setPurgeChannel,
    restrictedChannel,
    setRestrictedChannel,
  } = useChannelModeration();
  const {
    chatSearchOpen,
    setChatSearchOpen,
    chatQuery,
    setChatQuery,
    showPinned,
    setShowPinned,
    selectedMessageIds,
    setSelectedMessageIds,
    toggleMessageSelection,
  } = useChatSearch(selectedChannel, selectedDmUser);
  const { memberQuery, setMemberQuery, memberScope, setMemberScope } = useMemberDirectory();
  const relations = useUserRelations();
  const { hideEmptyChannels } = useClientPreferences();
  const shortcuts = useShortcutBindings();
  const { savedServers, reload: reloadSavedServers } = useSavedServers();
  const registeredUsers = useRegisteredUsers(activeServerId, status);
  const attachMessageList = useMessageImageClicks(
    useCallback((src: string) => lightboxRef.current?.open(src), []),
  );
  useClientEventBridge(navigate);
  useAuroraAppearance();
  useServerConfigSync(activeServerId, status);

  const activeSession = sessions.find((session) => session.id === activeServerId);
  const canAdminister = ((channels.find((channel) => channel.id === 0)?.permissions ?? 0) & PERM_WRITE) !== 0;
  const activeChannel = channels.find((channel) => channel.id === selectedChannel) ?? null;
  const activeDmUser = users.find((user) => user.session === selectedDmUser) ?? null;
  const activeDmBlocked = activeDmUser
    ? (relations[userRelationIdentity(activeDmUser)]?.blocked ?? false)
    : false;
  // Every saved server plus any live session, grouped by host:port. Identities
  // (usernames) on the same address collapse into one stacked rail tile.
  const serverGroups = useMemo(() => groupServersForRail(savedServers, sessions), [savedServers, sessions]);

  const selectRailIdentity = useCallback(
    (identity: RailIdentity) => {
      if (identity.sessionId) {
        void useAppStore.getState().switchServer(identity.sessionId);
        return;
      }
      const saved = (savedServers ?? []).find((server) => server.id === identity.id);
      if (saved) void connectSaved(saved);
    },
    [savedServers],
  );
  const visibleChannels = useMemo(
    () =>
      filterVisibleChannels({
        channels,
        query: channelQuery,
        hideEmpty: hideEmptyChannels,
        currentChannel,
        selectedChannel,
      }),
    [channelQuery, channels, hideEmptyChannels, currentChannel, selectedChannel],
  );
  const channelUsers = useMemo(
    () =>
      listChannelMembers({
        users,
        registeredUsers,
        scope: memberScope,
        query: memberQuery,
        selectedChannel,
        talkingSessions,
      }),
    [memberQuery, memberScope, registeredUsers, selectedChannel, talkingSessions, users],
  );
  const channelMessages = useMemo(
    () => filterChannelMessages({ messages, pollMessages, selectedChannel, relations, query: chatQuery }),
    [chatQuery, messages, pollMessages, relations, selectedChannel],
  );
  const visibleDmMessages = useMemo(
    () => filterDmMessages({ dmMessages, blocked: activeDmBlocked, relations, query: chatQuery }),
    [activeDmBlocked, chatQuery, dmMessages, relations],
  );

  // Structural channels are headings, not destinations, so Alt+Up/Down skips them.
  const orderedChannelIds = useMemo(
    () =>
      [...channels]
        .filter((channel) => !isStructuralChannel(channel))
        .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))
        .map((channel) => channel.id),
    [channels],
  );
  const moveChannel = useCallback(
    (direction: -1 | 1) => {
      if (selectedChannel == null) return;
      const index = orderedChannelIds.indexOf(selectedChannel);
      const next = orderedChannelIds[index + direction];
      if (next != null) void useAppStore.getState().selectChannel(next);
    },
    [orderedChannelIds, selectedChannel],
  );
  useInAppShortcuts(shortcuts, {
    onToggleActivationMode: () => {
      void invoke<AudioSettings>("get_audio_settings").then((settings) =>
        invoke("set_audio_settings", { settings: { ...settings, push_to_talk: !settings.push_to_talk } }),
      );
    },
    onMoveChannelUp: () => moveChannel(-1),
    onMoveChannelDown: () => moveChannel(1),
    onJumpToRootChannel: () => {
      void useAppStore.getState().joinChannel(0);
    },
    onToggleChannelSidebar: () => setConnectedRailExpanded((value) => !value),
    onToggleMemberPanel: () => setMemberScope((value) => (value === "channel" ? "server" : "channel")),
    onOpenQuickSearch: () => setChatSearchOpen(true),
    onOpenQuickSwitcher: () => setQuickSwitcherOpen(true),
    onOpenSettings: () => setSurface("settings"),
    onToggleFullscreen: () => {
      void getCurrentWindow()
        .isFullscreen()
        .then((fullscreen) => getCurrentWindow().setFullscreen(!fullscreen));
    },
    onToggleDevOverlay: () => {
      (getCurrentWebviewWindow() as unknown as { openDevtools?: () => void }).openDevtools?.();
    },
  });

  // Message bodies are rendered as HTML, so delegate image clicks at the list
  // level rather than rewriting every <img> into a button. Bound through a
  // callback ref: an effect would run while the launcher is still mounted (list
  // ref still null) and never re-bind once the chat appears.

  const lightboxScope = useCallback((): MessageScope | null => {
    if (selectedDmUser !== null) return { scope: "dm", scopeId: String(selectedDmUser) };
    if (selectedChannel !== null) return { scope: "channel", scopeId: String(selectedChannel) };
    return null;
  }, [selectedDmUser, selectedChannel]);

  // The backend's ServerConfig event can land before this UI mounts (switching
  // design packs while already connected), which would leave us on the built-in
  // defaults - notably a 128 KiB image cap. Pull the real limits on connect.

  const connectSaved = async (server: SavedServer) => {
    if (connecting) return;
    setConnecting(true);
    try {
      await useAppStore.getState().connect(server.host, server.port, server.username, server.cert_label);
    } finally {
      setConnecting(false);
    }
  };

  const mentionResolver: MentionResolver = {
    resolveSession: (session) => {
      const user = users.find((candidate) => candidate.session === session);
      return user ? { name: user.name } : null;
    },
  };
  const sendRich = async (html: string) => {
    // Mention markers are typed as plain `<@session>` text, so TipTap hands
    // them over escaped; rewrite them into chip markup exactly like the
    // Standard send path does, otherwise receivers see the raw marker and
    // self-mention notifications never fire.
    const body = applyMentionsToHtml(html.trim(), mentionResolver);
    if (!body.trim()) return;
    if (selectedDmUser !== null) await useAppStore.getState().sendDm(selectedDmUser, body);
    else if (selectedChannel !== null) await useAppStore.getState().sendMessage(selectedChannel, body);
  };
  const deleteSelectedMessages = async () => {
    if (selectedChannel == null || selectedMessageIds.size === 0) return;
    await useAppStore
      .getState()
      .deletePchatMessages(selectedChannel, { messageIds: [...selectedMessageIds] });
    setSelectedMessageIds(new Set());
  };
  const reorderChannel = async (channel: ChannelEntry, direction: -1 | 1) => {
    const siblings = channels
      .filter((candidate) => candidate.parent_id === channel.parent_id && !candidate.detached)
      .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
    const index = siblings.findIndex((candidate) => candidate.id === channel.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await Promise.all(
      reordered.map((candidate, position) =>
        candidate.position === position * 100
          ? Promise.resolve()
          : useAppStore.getState().updateChannel(candidate.id, { position: position * 100 }),
      ),
    );
    setChannelMenu(null);
  };

  if (status === "disconnected" && sessions.length === 0) {
    if (savedServers === null || savedServers.length === 0) {
      return (
        <div className={`${styles.root} ${styles.onboardingRoot}`} data-testid="aurora-client-root">
          <ClientTitleBar onOpenSettings={() => setSurface("settings")} />
          <main className={styles.onboardingPage}>
            {savedServers === null ? (
              <span className={styles.spinner} />
            ) : (
              <OnboardingFlow
                onComplete={(server, connectNow) => {
                  reloadSavedServers();
                  if (connectNow) void connectSaved(server);
                }}
              />
            )}
          </main>
          {surface === "settings" && <SettingsPanel onClose={() => setSurface(null)} />}
          <AuroraClientRuntime onOpenMarketplace={openMarketplace} />
          <ConnectionOverlays />
        </div>
      );
    }
    return (
      <div
        className={`${styles.root} ${styles.launcherRoot} ${launcherRailExpanded ? styles.serverRailExpanded : ""}`}
        data-testid="aurora-client-root"
      >
        <ClientTitleBar onOpenSettings={() => setSurface("settings")} />
        <ServerRail
          className={styles.railSlot}
          groups={serverGroups}
          expanded={launcherRailExpanded}
          connecting={connecting}
          label="Saved servers"
          onToggle={() => setLauncherRailExpanded((value) => !value)}
          onSelect={selectRailIdentity}
          onAdd={() => setSurface("servers")}
        />
        <main className={styles.launcherIntro}>
          <section className={styles.launcherWelcome}>
            <div className={styles.introOrb}>
              <span>
                <VolumeIcon />
              </span>
              <i />
              <i />
              <i />
            </div>
            <small>SERVER LAUNCHER</small>
            <h1>
              Your conversations
              <br />
              <em>are ready when you are.</em>
            </h1>
            <p>
              Choose a server from the sidebar to connect. Expand it whenever you want to see addresses,
              identities, and connection details.
            </p>
            <div className={styles.introFeatures}>
              <span>
                <b>{savedServers.length}</b> saved server{savedServers.length === 1 ? "" : "s"}
              </span>
              <span>
                <b>Native</b> low-latency voice
              </span>
              <span>
                <b>Private</b> server-first design
              </span>
              {error && <div className={styles.error}>{error}</div>}
              {connecting && <span className={styles.connectingHint}>Connecting…</span>}
            </div>
          </section>
        </main>
        {surface === "servers" && (
          <ServerBrowser
            onClose={() => {
              setSurface(null);
              reloadSavedServers();
            }}
          />
        )}
        {surface === "settings" && <SettingsPanel onClose={() => setSurface(null)} />}
        <AuroraClientRuntime onOpenMarketplace={openMarketplace} />
        <ConnectionOverlays />
      </div>
    );
  }

  // A session row exists for connections the server rejected (bad password,
  // kick, ban).  Rendering the connected chrome around one would look like a
  // successful sign-in, so surface the reason instead.
  if (status === "disconnected") {
    return (
      <div
        className={`${styles.root} ${styles.launcherRoot} ${connectedRailExpanded ? styles.serverRailExpanded : ""}`}
        data-testid="aurora-client-root"
      >
        <ClientTitleBar
          serverTitle={activeSession?.label ?? "Disconnected"}
          onOpenSettings={() => setSurface("settings")}
        />
        <ServerRail
          className={styles.railSlot}
          groups={serverGroups}
          expanded={connectedRailExpanded}
          activeSessionId={activeServerId}
          connecting={connecting}
          label="Servers"
          onToggle={() => setConnectedRailExpanded((value) => !value)}
          onSelect={selectRailIdentity}
          onAdd={() => setSurface("servers")}
        />
        <SessionStatusScreen onOpenServers={() => setSurface("servers")} />
        {surface === "servers" && (
          <ServerBrowser
            onClose={() => {
              setSurface(null);
              reloadSavedServers();
            }}
          />
        )}
        {surface === "settings" && <SettingsPanel onClose={() => setSurface(null)} />}
        <AuroraClientRuntime onOpenMarketplace={openMarketplace} />
        <ConnectionOverlays />
      </div>
    );
  }

  return (
    <div
      className={`${styles.root} ${connectedRailExpanded ? styles.serverRailExpanded : ""}`}
      data-testid="aurora-client-root"
    >
      <ClientTitleBar
        serverTitle={activeSession?.label ?? "Connecting"}
        onOpenFriends={() => setSurface("friends")}
        onOpenWorkspace={() => setSurface("workspace")}
        onOpenAdmin={canAdminister ? () => setSurface("admin") : undefined}
        onOpenSettings={() => setSurface("settings")}
        onDisconnect={() => void useAppStore.getState().disconnect()}
      />

      <ServerRail
        className={styles.railSlot}
        groups={serverGroups}
        expanded={connectedRailExpanded}
        activeSessionId={activeServerId}
        label="Connected servers"
        onToggle={() => setConnectedRailExpanded((value) => !value)}
        onSelect={selectRailIdentity}
        onAdd={() => setSurface("servers")}
      />

      <ChannelSidebar
        serverLabel={activeSession?.label ?? activeSession?.host ?? "Fancy server"}
        channels={visibleChannels}
        users={users}
        selectedChannel={selectedChannel}
        currentChannel={currentChannel}
        listenedChannels={listenedChannels}
        unreadCounts={unreadCounts}
        talkingSessions={talkingSessions}
        query={channelQuery}
        onQueryChange={setChannelQuery}
        ownName={users.find((user) => user.session === ownSession)?.name ?? activeSession?.username ?? "You"}
        inCall={inCall}
        onOpenServerInfo={() => setSurface("server-info")}
        onCreateChannel={() => setChannelEditor({ channel: null, parentId: selectedChannel ?? 0 })}
        onSelectChannel={(channel) => void useAppStore.getState().selectChannel(channel.id)}
        onJoinChannel={(channel) =>
          channel.is_enter_restricted
            ? setRestrictedChannel(channel)
            : void useAppStore.getState().joinChannel(channel.id)
        }
        onChannelContextMenu={(channel, event) => {
          setSidebarMenu(null);
          setChannelMenu({ channel, x: event.clientX, y: event.clientY });
        }}
        onSidebarContextMenu={(position) => {
          setChannelMenu(null);
          setSidebarMenu(position);
        }}
      />

      <main className={styles.conversation}>
        <header className={styles.conversationHeader}>
          <span className={styles.channelGlyph}>
            {activeDmUser ? initials(activeDmUser.name) : <HashIcon />}
          </span>
          <div>
            <h1>{activeDmUser?.name ?? activeChannel?.name ?? "Choose a channel"}</h1>
            <p>
              {activeDmUser
                ? "Direct message"
                : activeChannel
                  ? `${activeChannel.user_count} member${activeChannel.user_count === 1 ? "" : "s"}`
                  : "Select a channel to start"}
            </p>
          </div>
          {activeChannel && (
            <IconButton
              icon={<InfoIcon />}
              label="Channel information"
              className={styles.headerIconButton}
              onClick={() => setSurface("channel-info")}
            />
          )}
          {activeChannel && (
            <IconButton
              icon={<SettingsIcon />}
              label="Edit channel"
              className={styles.headerIconButton}
              onClick={() =>
                setChannelEditor({ channel: activeChannel, parentId: activeChannel.parent_id ?? 0 })
              }
            />
          )}
          {activeChannel && (
            <IconButton
              icon={<SearchIcon />}
              label="Search messages"
              className={styles.headerIconButton}
              onClick={() => setChatSearchOpen((value) => !value)}
            />
          )}
          {activeChannel && (
            <IconButton
              icon={<PinIcon />}
              label="Pinned messages"
              className={styles.headerIconButton}
              onClick={() => setShowPinned(true)}
            />
          )}
          <IconButton
            icon={<WebcamIcon />}
            label="Share screen"
            className={styles.headerIconButton}
            onClick={() => setSurface("screen-share")}
          />
          {activeChannel && currentChannel !== activeChannel.id && (
            <Button
              variant="bare"
              className={styles.joinButton}
              leadingIcon={<VolumeIcon />}
              onClick={() =>
                activeChannel.is_enter_restricted
                  ? setRestrictedChannel(activeChannel)
                  : void useAppStore.getState().joinChannel(activeChannel.id)
              }
            >
              Join voice
            </Button>
          )}
        </header>
        {chatSearchOpen && (
          <div className={extensionStyles.chatSearch}>
            <SearchField
              autoFocus
              value={chatQuery}
              onChange={(event) => setChatQuery(event.target.value)}
              placeholder="Search this channel"
              aria-label="Search messages"
            />
            <Button
              variant="bare"
              onClick={() => {
                setChatQuery("");
                setChatSearchOpen(false);
              }}
            >
              Close
            </Button>
          </div>
        )}
        <ScreenShareRuntime
          pickerRequested={surface === "screen-share"}
          onClosePicker={() => setSurface(null)}
        />
        {activeChannel?.pchat_protocol && activeChannel.pchat_protocol !== "none" && (
          <Button
            variant="bare"
            className={extensionStyles.loadHistory}
            disabled={pchatHistoryLoading.has(activeChannel.id)}
            onClick={() =>
              void useAppStore
                .getState()
                .fetchHistory(activeChannel.id, channelMessages[0]?.message_id ?? undefined)
            }
          >
            {pchatHistoryLoading.has(activeChannel.id) ? "Loading history…" : "Load earlier messages"}
          </Button>
        )}
        {bootstrapStage ? (
          <div className={styles.emptyState}>
            <span className={styles.spinner} />
            <strong>{bootstrapStage}</strong>
          </div>
        ) : (activeDmUser ? visibleDmMessages : channelMessages).length === 0 ? (
          <div className={styles.emptyState}>
            <span>
              <HashIcon />
            </span>
            <strong>
              {activeDmUser
                ? `Start a conversation with ${activeDmUser.name}`
                : `This is the start of #${activeChannel?.name ?? "this channel"}`}
            </strong>
            <p>Messages and shared moments will appear here.</p>
          </div>
        ) : (
          <section className={styles.messageList} ref={attachMessageList}>
            {(activeDmUser ? visibleDmMessages : channelMessages).map((message, index) => (
              <MessageItem
                key={message.message_id ?? `${message.timestamp}-${index}`}
                message={message}
                selected={!!message.message_id && selectedMessageIds.has(message.message_id)}
                selectionMode={selectedMessageIds.size > 0}
                onToggleSelection={toggleMessageSelection}
              />
            ))}
          </section>
        )}
        {selectedMessageIds.size > 0 && (
          <div className={extensionStyles.messageSelectionBar}>
            <strong>{selectedMessageIds.size} selected</strong>
            <span>Select more messages or remove the selected persistent-chat entries.</span>
            <Button onClick={() => setSelectedMessageIds(new Set())}>Cancel</Button>
            <Button
              variant="danger"
              leadingIcon={<TrashIcon />}
              onClick={() => void deleteSelectedMessages()}
            >
              Delete selected
            </Button>
          </div>
        )}
        <TypingStatus channelId={selectedChannel} />
        {activeDmBlocked && (
          <div className={extensionStyles.blockedDm}>
            Direct messages from this user are blocked. Unblock them from the profile card to continue.
          </div>
        )}
        <RichComposer
          channel={activeChannel}
          targetLabel={!activeDmBlocked ? activeDmUser?.name : undefined}
          onSend={sendRich}
        />
      </main>

      <MemberSidebar
        members={channelUsers}
        scope={memberScope}
        onScopeChange={setMemberScope}
        query={memberQuery}
        onQueryChange={setMemberQuery}
        ownSession={ownSession}
        talkingSessions={talkingSessions}
        onHoverMember={setHoveredUser}
      />
      {hoveredUser !== null &&
        selectedUser === null &&
        users.find((user) => user.session === hoveredUser) && (
          <UserHoverCard user={users.find((user) => user.session === hoveredUser)!} />
        )}
      {selectedUser !== null && users.find((user) => user.session === selectedUser) && (
        <UserCard
          user={users.find((user) => user.session === selectedUser)!}
          onClose={() => useAppStore.getState().selectUser(null)}
        />
      )}
      {surface === "servers" && (
        <ServerBrowser
          onClose={() => {
            setSurface(null);
            reloadSavedServers();
          }}
        />
      )}
      {surface === "settings" && <SettingsPanel onClose={() => setSurface(null)} />}
      {surface === "admin" && <ServerAdminPanel onClose={() => setSurface(null)} />}
      {surface === "marketplace" && (
        <ServerAdminPanel
          initialTab="marketplace"
          initialPluginId={marketplacePluginId}
          onClose={() => setSurface(null)}
        />
      )}
      {surface === "workspace" && <WorkspaceSurface onClose={() => setSurface(null)} />}
      {surface === "friends" && <FriendsSurface onClose={() => setSurface(null)} />}
      {surface === "server-info" && (
        <InfoPanel kind="server" channel={activeChannel} onClose={() => setSurface(null)} />
      )}
      {surface === "channel-info" && (
        <InfoPanel kind="channel" channel={activeChannel} onClose={() => setSurface(null)} />
      )}
      {channelEditor && (
        <ChannelEditorSurface
          channel={channelEditor.channel}
          parentId={channelEditor.parentId}
          initialStructural={channelEditor.structural}
          onClose={() => setChannelEditor(null)}
        />
      )}
      {restrictedChannel && (
        <ChannelJoinPrompt channel={restrictedChannel} onClose={() => setRestrictedChannel(null)} />
      )}
      {sidebarMenu && (
        <SidebarContextMenu
          x={sidebarMenu.x}
          y={sidebarMenu.y}
          onCreateChannel={() => {
            setChannelEditor({ channel: null, parentId: 0 });
            setSidebarMenu(null);
          }}
          onCreateCategory={() => {
            setChannelEditor({ channel: null, parentId: 0, structural: true });
            setSidebarMenu(null);
          }}
        />
      )}
      {channelMenu && (
        <ChannelContextMenu
          channel={channelMenu.channel}
          x={channelMenu.x}
          y={channelMenu.y}
          listening={listenedChannels.has(channelMenu.channel.id)}
          notificationsMuted={mutedPushChannels.has(channelMenu.channel.id)}
          onOpenText={() => {
            void useAppStore.getState().selectChannel(channelMenu.channel.id);
            setChannelMenu(null);
          }}
          onJoinVoice={() => {
            if (channelMenu.channel.is_enter_restricted) setRestrictedChannel(channelMenu.channel);
            else void useAppStore.getState().joinChannel(channelMenu.channel.id);
            setChannelMenu(null);
          }}
          onToggleListen={() => {
            void useAppStore.getState().toggleListen(channelMenu.channel.id);
            setChannelMenu(null);
          }}
          onToggleNotifications={() => {
            void useAppStore.getState().toggleMutePushChannel(channelMenu.channel.id);
            setChannelMenu(null);
          }}
          onCreateSubchannel={() => {
            setChannelEditor({ channel: null, parentId: channelMenu.channel.id });
            setChannelMenu(null);
          }}
          onEdit={() => {
            setChannelEditor({ channel: channelMenu.channel, parentId: channelMenu.channel.parent_id ?? 0 });
            setChannelMenu(null);
          }}
          onEditPermissions={() => {
            void useAppStore.getState().selectChannel(channelMenu.channel.id);
            setSurface("admin");
            setChannelMenu(null);
          }}
          onMove={(direction) => void reorderChannel(channelMenu.channel, direction)}
          onMoveAllUsers={() => {
            setMoveUsersSource(channelMenu.channel);
            setChannelMenu(null);
          }}
          onPurgeHistory={() => {
            setPurgeChannel(channelMenu.channel);
            setChannelMenu(null);
          }}
        />
      )}
      {moveUsersSource && (
        <MoveUsersDialog
          source={moveUsersSource}
          channels={channels}
          onClose={() => setMoveUsersSource(null)}
        />
      )}
      {purgeChannel && <PurgeChannelDialog channel={purgeChannel} onClose={() => setPurgeChannel(null)} />}
      {showPinned && <PinnedMessagesPanel messages={channelMessages} onClose={() => setShowPinned(false)} />}
      {showPollCreator && activeChannel && (
        <PollCreatorSurface channelId={activeChannel.id} onClose={() => setShowPollCreator(false)} />
      )}
      {quickSwitcherOpen && (
        <QuickSwitcher
          sessions={sessions}
          channels={channels}
          users={users}
          onSwitchServer={(id) => void useAppStore.getState().switchServer(id)}
          onSelectChannel={(id) => void useAppStore.getState().selectChannel(id)}
          onSelectUser={(session) => void useAppStore.getState().selectDmUser(session)}
          onOpenSettings={() => setSurface("settings")}
          onOpenWorkspace={() => setSurface("workspace")}
          onClose={() => setQuickSwitcherOpen(false)}
        />
      )}
      <Lightbox
        ref={lightboxRef}
        allMessages={activeDmUser ? visibleDmMessages : channelMessages}
        selectedChannel={selectedChannel}
        selectedDmUser={selectedDmUser}
        currentScope={lightboxScope}
      />
      <AuroraClientRuntime onOpenMarketplace={openMarketplace} />
      <ConnectionOverlays />
    </div>
  );
}
