import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, CssBaseline, Dialog, DialogContent, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppStore } from "@core/store";
import { getPreferences } from "@core/preferencesStorage";
import { getSavedServers, getServerPassword, markServerJoined, updateServer } from "@core/serverStorage";
import { getUserRelations, userRelationIdentity, type UserRelation } from "@core/userRelationsStorage";
import { PERM_WRITE } from "@core/utils/permissions";
import { applyMentionsToHtml, type MentionResolver } from "@core/utils/mentions";
import type { AudioSettings, ChannelEntry, SavedServer, UserEntry } from "@core/types";
import ChannelEditorDialog from "@standard/components/sidebar/channel/ChannelEditorDialog";
import DownloadsPanel from "@standard/components/chat/download/DownloadsPanel";
import TypingIndicator from "@standard/components/chat/typing/TypingIndicator";
import PinnedMessagesPanel from "@standard/components/chat/pinned/PinnedMessagesPanel";
import PublicServerList from "@standard/components/server/PublicServerList";
import {
  ChannelList,
  ChannelMenu,
  ChatBackdrop,
  ChatHeader,
  Composer,
  ConnectScreen,
  ConnectionOverlays,
  DirectMessageList,
  MemberPanel,
  MessageList,
  MessageRow,
  MiniMode,
  NebulaRuntime,
  GlobalSearch,
  LeaveServerDialog,
  ProfileCard,
  QuickConnect,
  SearchBox,
  ServerInfoPanel,
  ServerList,
  SettingsNav,
  useSettingsNavContext,
  SettingsScreen,
  SidebarShell,
  TitleBar,
  UserMenu,
  VoiceDock,
  Stack,
} from "./components";
import type { SettingsPageId } from "./components";
import {
  AdminScreen,
  useAdminCapabilities,
  useAdminNavEntries,
  type AdminPageId,
} from "./components/admin";
import { AddServerDialog } from "./components/connect/AddServerDialog";
import { ScreenShareStrip } from "./components/chat/ScreenShareStrip";
import {
  useHideEmptyChannels,
  useHoverTarget,
  useMemberPanel,
  useMiniMode,
  useProfileAnchor,
  useScreenRouting,
  useUserMenu,
  useSearchState,
  useServerPings,
  type HoverEvent,
} from "./clientState";
import {
  channelOccupants,
  groupSavedServers,
  listDirectConversations,
  orderChannels,
  plainText,
  quickConnectTargets,
  type GlobalSearchRow,
  type ServerGroup,
} from "./selectors";
import { shortcutLabel, useNebulaShortcuts } from "./shortcuts";
import { useLeaveServer } from "./useLeaveServer";
import { useNebulaEventBridge } from "./useNebulaEventBridge";
import { useNebulaTheme } from "./useNebulaAppearance";
import { useServerLivery } from "./useServerLivery";
import { radius } from "./tokens";

/** Pinned messages have no "unseen" concept in Nebula's chrome. */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * The Nebula client.
 *
 * One window, one left column, one conversation. The column swaps between
 * channels, direct messages, servers and the settings sections; the pane beside
 * it follows. Nebula draws the three settings pages the design specifies -
 * profile, voice, personalize - and hands everything else to Standard's
 * settings surface, which owns the flows there is no second version of.
 */
export default function NebulaClientApp() {
  // What the open server says it looks like, or null for the great majority
  // that say nothing. Feeds the theme and the connect screen from one place, so
  // the two can never disagree about which server's colours are showing.
  const livery = useServerLivery();
  const theme = useNebulaTheme(livery);

  const status = useAppStore((state) => state.status);
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const selectedChannel = useAppStore((state) => state.selectedChannel);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const selectedDmUser = useAppStore((state) => state.selectedDmUser);
  const selectedUser = useAppStore((state) => state.selectedUser);
  const ownSession = useAppStore((state) => state.ownSession);
  const messages = useAppStore((state) => state.messages);
  const pollMessages = useAppStore((state) => state.pollMessages);
  const dmMessages = useAppStore((state) => state.dmMessages);
  const unreadCounts = useAppStore((state) => state.unreadCounts);
  const dmUnreadCounts = useAppStore((state) => state.dmUnreadCounts);
  const talkingSessions = useAppStore((state) => state.talkingSessions);
  const bootstrapStage = useAppStore((state) => state.bootstrapStage);
  const listenedChannels = useAppStore((state) => state.listenedChannels);
  const mutedPushChannels = useAppStore((state) => state.mutedPushChannels);
  const voiceState = useAppStore((state) => state.voiceState);
  const error = useAppStore((state) => state.error);

  const { screen, openScreen, surface, setSurface, marketplacePluginId, openMarketplace } =
    useScreenRouting();
  // Backend events drive `status`, `bootstrapStage` and every list below, so
  // this has to run for the client as a whole - including mini mode, which
  // renders its own tree and would otherwise drop the subscription.
  useNebulaEventBridge(openScreen);
  const search = useSearchState(`${selectedChannel}:${selectedDmUser}`);
  const memberPanel = useMemberPanel();
  const hovered = useHoverTarget();
  const profileAnchor = useProfileAnchor();
  const userMenu = useUserMenu();
  const channelSearchRef = useRef<HTMLInputElement>(null);
  // Bumped rather than set: the request is "focus the field now", which has to
  // survive the field being remounted by the same keystroke that expanded the
  // column it lives in.
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [channelSidebarOpen, setChannelSidebarOpen] = useState(true);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPageId>("profile");
  const settingsNavContext = useSettingsNavContext();
  // Administration is a *section of settings*, not a separate surface, so the
  // two share one nav and one content area. Null means a settings page is
  // showing; a page id means an admin page has taken the pane.
  const [adminPage, setAdminPage] = useState<AdminPageId | null>(null);
  const [aclChannelId, setAclChannelId] = useState<number | null>(null);
  const adminCapabilities = useAdminCapabilities();
  const adminNavEntries = useAdminNavEntries(adminCapabilities);
  const { hideEmpty, toggle: toggleHideEmpty } = useHideEmptyChannels();
  // Mini mode exists for "I am in a call and doing something else", so it is
  // gated on voice being live rather than on being in a channel - connected
  // users are always in one.
  const { mini, setMini } = useMiniMode(voiceState !== "inactive");
  const leave = useLeaveServer();

  const [savedServers, setSavedServers] = useState<SavedServer[] | null>(null);
  const [selectedServerKey, setSelectedServerKey] = useState<string | null>(null);
  const [addServerFor, setAddServerFor] = useState<{ host: string; port: number; label: string } | null>(
    null,
  );
  const [addServerOpen, setAddServerOpen] = useState(false);
  const [quickConnectAnchor, setQuickConnectAnchor] = useState<HTMLElement | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [relations, setRelations] = useState<Record<string, UserRelation>>({});
  const [channelMenu, setChannelMenu] = useState<{ channel: ChannelEntry; x: number; y: number } | null>(
    null,
  );
  const [editingChannel, setEditingChannel] = useState<ChannelEntry | null>(null);

  const reloadServers = useCallback(() => {
    void getSavedServers()
      .then(setSavedServers)
      .catch(() => setSavedServers([]));
  }, []);
  useEffect(reloadServers, [reloadServers]);
  useEffect(() => {
    void getUserRelations()
      .then(setRelations)
      .catch(() => setRelations({}));
  }, []);

  // With nothing saved there is no conversation to show, so the connect screen
  // is the client rather than a detour from it.
  useEffect(() => {
    if (status !== "connected" && savedServers !== null) openScreen("connect");
  }, [openScreen, savedServers, status]);

  // Auto-connect, once, at launch. Guarded by a ref rather than by `status` so
  // that disconnecting on purpose does not immediately reconnect the user.
  const autoConnected = useRef(false);
  useEffect(() => {
    if (autoConnected.current || savedServers === null || status === "connected") return;
    autoConnected.current = true;
    void getPreferences()
      .then((preferences) => {
        const target = savedServers.find((server) => server.id === preferences.autoConnectServerId);
        if (target) void connectTo(target);
      })
      .catch(() => undefined);
    // The ref, not the dependency list, is what makes this run once: `status`
    // and `savedServers` both change while the connection is being made.
  }, [savedServers, status]);

  const activeSession = sessions.find((session) => session.id === activeServerId);
  const canAdminister = ((channels.find((channel) => channel.id === 0)?.permissions ?? 0) & PERM_WRITE) !== 0;
  const activeChannel = channels.find((channel) => channel.id === selectedChannel) ?? null;
  const joinedChannel = channels.find((channel) => channel.id === currentChannel) ?? null;
  const activeDmUser = users.find((user) => user.session === selectedDmUser) ?? null;
  const ownUser = users.find((user) => user.session === ownSession) ?? null;

  const orderedChannels = useMemo(
    () =>
      orderChannels({
        channels,
        query: search.channelQuery,
        hideEmpty,
        currentChannel,
        selectedChannel,
      }),
    [channels, currentChannel, hideEmpty, search.channelQuery, selectedChannel],
  );

  // Focusing after the commit, not inside the handler: expanding the column
  // and focusing its field are one keystroke, and the field does not exist yet
  // while that keystroke is still being handled.
  useEffect(() => {
    if (searchFocusRequest === 0) return;
    channelSearchRef.current?.focus();
    channelSearchRef.current?.select();
  }, [searchFocusRequest]);

  // The displayed order, not the stored one: the sidebar hides channels the
  // filter or "hide empty" has dropped, and stepping through rows that are not
  // on screen looks like the key doing nothing.
  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      const index = orderedChannels.findIndex((entry) => entry.channel.id === selectedChannel);
      const next = orderedChannels[index + direction];
      if (index !== -1 && next) void useAppStore.getState().selectChannel(next.channel.id);
    },
    [orderedChannels, selectedChannel],
  );

  const shortcuts = useNebulaShortcuts({
    onToggleActivationMode: toggleActivationMode,
    onMoveChannelUp: () => moveSelection(-1),
    onMoveChannelDown: () => moveSelection(1),
    onJumpToRootChannel: () => void useAppStore.getState().joinChannel(0),
    onToggleChannelSidebar: () => setChannelSidebarOpen((open) => !open),
    onToggleMemberPanel: () => memberPanel.setOpen((open) => !open),
    onOpenQuickSearch: () => {
      setChannelSidebarOpen(true);
      setSearchFocusRequest((request) => request + 1);
    },
    onOpenQuickSwitcher: () => setSwitcherOpen(true),
    onOpenSettings: () => openScreen("settings"),
    onToggleFullscreen: toggleFullscreen,
    onToggleDevOverlay: openDevtools,
  });

  const visibleMessages = useMemo(() => {
    const needle = search.chatQuery.trim().toLocaleLowerCase();
    const pool = activeDmUser
      ? dmMessages
      : [...messages, ...pollMessages].filter(
          (message) => message.channel_id === selectedChannel && !message.dm_session,
        );
    return pool.filter((message) => {
      const key = message.sender_hash
        ? `hash:${message.sender_hash}`
        : `name:${message.sender_name.toLocaleLowerCase()}`;
      if (relations[key]?.ignored) return false;
      if (activeDmUser && relations[userRelationIdentity(activeDmUser)]?.blocked) return false;
      return !needle || plainText(message.body).toLocaleLowerCase().includes(needle);
    });
  }, [activeDmUser, dmMessages, messages, pollMessages, relations, search.chatQuery, selectedChannel]);

  const conversations = useMemo(
    () =>
      listDirectConversations({
        users,
        ownSession,
        history: new Map(
          selectedDmUser === null ? [] : [[selectedDmUser, dmMessages] as [number, typeof dmMessages]],
        ),
        unreadCounts: dmUnreadCounts,
        query: search.channelQuery,
      }),
    [dmMessages, dmUnreadCounts, ownSession, search.channelQuery, selectedDmUser, users],
  );

  // The sidebar chooses a server; the connect screen chooses which of that
  // server's identities to arrive as.
  const serverGroups = useMemo(() => groupSavedServers(savedServers, sessions), [savedServers, sessions]);
  const visibleGroups = useMemo(() => {
    const needle = search.channelQuery.trim().toLocaleLowerCase();
    if (!needle) return serverGroups;
    return serverGroups.filter(
      (group) =>
        group.label.toLocaleLowerCase().includes(needle) || group.host.toLocaleLowerCase().includes(needle),
    );
  }, [search.channelQuery, serverGroups]);
  const pings = useServerPings(serverGroups);
  // Quick connect offers the logins the tab strip does not already hold - per
  // identity, not per address, because that is what a tab is keyed on.
  const quickTargets = useMemo(() => quickConnectTargets(serverGroups, sessions), [serverGroups, sessions]);

  const selectedGroup =
    serverGroups.find((group) => group.key === selectedServerKey) ?? serverGroups[0] ?? null;
  const identities = selectedGroup?.identities ?? [];

  const toggleFavorite = useCallback(
    (group: ServerGroup) => {
      // Favouriting is a property of the server, so it applies to every saved
      // identity on that address - otherwise the star would flicker depending
      // on which login happened to sort first.
      const next = !group.favorite;
      void Promise.all(
        group.identities.map((identity) => updateServer(identity.id, { favorite: next })),
      ).then(reloadServers);
    },
    [reloadServers],
  );

  const roster = useMemo<UserEntry[]>(() => {
    const needle = memberPanel.query.trim().toLocaleLowerCase();
    return users
      .filter((user) => memberPanel.scope === "server" || user.channel_id === selectedChannel)
      .filter((user) => !needle || user.name.toLocaleLowerCase().includes(needle))
      .sort(
        (left, right) =>
          Number(talkingSessions.has(right.session)) - Number(talkingSessions.has(left.session)) ||
          left.name.localeCompare(right.name),
      );
  }, [memberPanel.query, memberPanel.scope, selectedChannel, talkingSessions, users]);

  const mentionResolver: MentionResolver = {
    resolveSession: (session) => {
      const user = users.find((candidate) => candidate.session === session);
      return user ? { name: user.name } : null;
    },
  };

  const send = async (html: string) => {
    const body = applyMentionsToHtml(html.trim(), mentionResolver);
    if (!body.trim()) return;
    if (selectedDmUser !== null) await useAppStore.getState().sendDm(selectedDmUser, body);
    else if (selectedChannel !== null) await useAppStore.getState().sendMessage(selectedChannel, body);
  };

  const connectTo = async (server: SavedServer) => {
    if (connecting) return;
    setConnecting(true);
    try {
      // A saved password is part of the saved login; without it quick connect
      // would stop on the password overlay for exactly the servers the user
      // already told the client how to enter.
      const password = await getServerPassword(server.id).catch(() => null);
      await useAppStore
        .getState()
        .connect(server.host, server.port, server.username, server.cert_label, password);
      // Restamp before reloading so the list this connect came from reorders
      // around it: the server just used is the one most likely wanted next.
      await markServerJoined(server.id).catch(() => undefined);
      reloadServers();
      openScreen("chat");
    } finally {
      setConnecting(false);
    }
  };

  // The card opens beside whatever was clicked, so the click carries the row.
  const openProfile = (session: number, event?: HoverEvent) => {
    profileAnchor.openFrom(event);
    void useAppStore.getState().selectUser(session);
  };

  // Surfaces that know only a session - message authors, the dock - still open
  // the menu the lists do; the roster is what turns one into the other.
  const openUserMenuFor = (session: number | null, event: React.MouseEvent) => {
    const user = users.find((entry) => entry.session === session);
    if (user) userMenu.open(user, event);
  };

  // The menu's "Message" lands the conversation the same way the card's does.
  const openConversation = (session: number) => {
    void useAppStore.getState().selectDmUser(session);
    useAppStore.getState().selectUser(null);
    openScreen("messages");
  };

  // Search names a destination; landing on it means putting the screen that
  // shows it up as well, since the row was chosen from somewhere else. The row
  // says what it opens rather than what it is - a message lands on the channel,
  // or the conversation, it was said in.
  const openSearchRow = (row: GlobalSearchRow) => {
    if (row.opens === "person") {
      openConversation(Number(row.id));
      return;
    }
    if (row.opens === "channel") void useAppStore.getState().selectChannel(Number(row.id));
    else void useAppStore.getState().switchServer(String(row.id));
    openScreen("chat");
  };

  // One card, one place in the tree: the person whose card was clicked open and
  // stays, or - while nothing is pinned - the one the pointer is resting on.
  const profileCardUser = users.find(
    (user) => user.session === (selectedUser ?? hovered.target?.session),
  );

  if (mini && joinedChannel)
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <MiniMode
          serverLabel={activeSession?.label ?? "Connected"}
          channelName={joinedChannel.name}
          occupants={channelOccupants(users, joinedChannel.id, talkingSessions)}
          ownSession={ownSession}
          talkingSessions={talkingSessions}
          latencyMs={null}
          onExpand={() => setMini(false)}
          // Restore the full window first: the confirmation belongs on a
          // surface with room for it, and leaving ends the call this window
          // exists for anyway.
          onLeave={() => {
            setMini(false);
            leave.request(activeSession);
          }}
          onContextMenuUser={userMenu.open}
        />
        <UserMenu target={userMenu.target} onClose={userMenu.close} />
      </ThemeProvider>
    );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          height: "100vh",
          width: "100vw",
          overflow: "hidden",
          // Nothing is painted here: the window is transparent and undecorated,
          // so everything outside the shell's rounded corners must stay clear
          // for the desktop to show through.
          background: "transparent",
        }}
      >
        <Stack
          data-testid="nebula-client-root"
          sx={(muiTheme) => ({
            position: "relative",
            height: "100%",
            overflow: "hidden",
            // This radius is the window's radius. `overflow: hidden` is what
            // actually clips the corners; the hairline traces the resulting
            // edge so the window reads as an object rather than a cut-out.
            borderRadius: radius("xl"),
            border: `1px solid ${muiTheme.palette.nebula.line2}`,
            background: `${muiTheme.palette.nebula.tint},${muiTheme.palette.nebula.bg0}`,
            color: muiTheme.palette.nebula.text,
            fontSize: 13,
          })}
        >
          <TitleBar
            serverLabel={status === "connected" ? (activeSession?.label ?? activeSession?.host) : undefined}
            friendsActive={screen === "messages"}
            onOpenFriends={() => openScreen("messages")}
            onOpenChat={() => openScreen("chat")}
            onQuickConnect={setQuickConnectAnchor}
            quickConnectOpen={quickConnectAnchor !== null}
            onDisconnect={status === "connected" ? () => leave.request(activeSession) : undefined}
          />

          <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
            {screen === "chat" && channelSidebarOpen && (
              <SidebarShell
                search={
                  <SearchBox
                    value={search.channelQuery}
                    onChange={search.setChannelQuery}
                    placeholder="Search channels"
                    hint={shortcutLabel(shortcuts.openQuickSearch)}
                    inputRef={channelSearchRef}
                  />
                }
                footer={
                  <VoiceDock
                    name={ownUser?.name ?? activeSession?.username ?? "You"}
                    session={ownSession}
                    textureSize={ownUser?.texture_size ?? null}
                    channelName={joinedChannel?.name ?? null}
                    latencyMs={null}
                    onOpenSettings={() => openScreen("settings")}
                    onOpenProfile={(event) => ownSession !== null && openProfile(ownSession, event)}
                    onContextMenuProfile={(event) => openUserMenuFor(ownSession, event)}
                    onOpenAdmin={
                      canAdminister
                        ? () => {
                            setAdminPage("users");
                            openScreen("settings");
                          }
                        : undefined
                    }
                    onLeave={activeSession ? () => leave.request(activeSession) : undefined}
                  />
                }
              >
                <ChannelList
                  channels={orderedChannels}
                  users={users}
                  selectedChannel={selectedChannel}
                  currentChannel={currentChannel}
                  talkingSessions={talkingSessions}
                  unreadCounts={unreadCounts}
                  ownSession={ownSession}
                  onSelect={(channel) => void useAppStore.getState().selectChannel(channel.id)}
                  onJoin={(channel) => void useAppStore.getState().joinChannel(channel.id)}
                  onContextMenu={(channel, event) => {
                    event.preventDefault();
                    setChannelMenu({ channel, x: event.clientX, y: event.clientY });
                  }}
                  onSelectUser={openProfile}
                  onHoverUser={hovered.hover}
                  onLeaveUser={hovered.clear}
                  onContextMenuUser={userMenu.open}
                />
              </SidebarShell>
            )}

            {screen === "messages" && (
              <SidebarShell
                title="Messages"
                search={
                  <SearchBox
                    value={search.channelQuery}
                    onChange={search.setChannelQuery}
                    placeholder="Search people"
                    inputRef={channelSearchRef}
                  />
                }
              >
                <DirectMessageList
                  conversations={conversations}
                  selectedSession={selectedDmUser}
                  onSelect={(session) => void useAppStore.getState().selectDmUser(session)}
                  onHover={hovered.hover}
                  onLeave={hovered.clear}
                  onContextMenu={userMenu.open}
                />
              </SidebarShell>
            )}

            {screen === "connect" && (
              <SidebarShell
                title="Servers"
                action={{
                  label: "+ Add",
                  onClick: () => {
                    setAddServerFor(null);
                    setAddServerOpen(true);
                  },
                }}
                search={
                  <SearchBox
                    value={search.channelQuery}
                    onChange={search.setChannelQuery}
                    placeholder="Search servers"
                    inputRef={channelSearchRef}
                  />
                }
              >
                <ServerList
                  groups={visibleGroups}
                  pings={pings}
                  selectedKey={selectedGroup?.key ?? null}
                  onSelect={(group) => {
                    setSelectedServerKey(group.key);
                    if (group.sessionId) {
                      void useAppStore.getState().switchServer(group.sessionId);
                      openScreen("chat");
                    }
                  }}
                  onToggleFavorite={toggleFavorite}
                />
              </SidebarShell>
            )}

            {screen === "settings" && (
              <SidebarShell back={{ label: "Back", onClick: () => openScreen("chat") }}>
                <SettingsNav
                  active={settingsPage}
                  context={settingsNavContext}
                  admin={
                    adminCapabilities.canAdminister
                      ? { entries: adminNavEntries, active: adminPage }
                      : undefined
                  }
                  onSelect={(id) => {
                    setAdminPage(null);
                    setSettingsPage(id);
                  }}
                  onOpenAdmin={(id) => setAdminPage(id as AdminPageId)}
                />
              </SidebarShell>
            )}

            <Stack
              component="main"
              // `zIndex: 0` establishes the stacking context the backdrop's
              // `zIndex: -1` sits inside; without it the layer falls behind the
              // shell's own background and disappears.
              sx={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", zIndex: 0 }}
            >
              {screen !== "connect" && screen !== "settings" && <ChatBackdrop />}
              {screen === "settings" ? (
                adminPage !== null ? (
                  <AdminScreen
                    page={adminPage}
                    capabilities={adminCapabilities}
                    onNavigate={setAdminPage}
                    marketplacePluginId={marketplacePluginId}
                    aclChannelId={aclChannelId}
                  />
                ) : (
                  <SettingsScreen
                    page={settingsPage}
                    onEditIdentityProfile={() => setSettingsPage("profile")}
                  />
                )
              ) : screen === "connect" ? (
                <ConnectScreen
                  server={selectedGroup?.identities[0] ?? null}
                  livery={livery}
                  identities={identities}
                  connecting={connecting}
                  error={error}
                  onConnect={(identity) => void connectTo(identity)}
                  onAddIdentity={() => {
                    if (!selectedGroup) return;
                    setAddServerFor({
                      host: selectedGroup.host,
                      port: selectedGroup.port,
                      label: selectedGroup.label,
                    });
                    setAddServerOpen(true);
                  }}
                />
              ) : (
                <>
                  <ChatHeader
                    title={activeDmUser?.name ?? activeChannel?.name ?? "Choose a conversation"}
                    subtitle={
                      activeDmUser
                        ? "Direct message"
                        : activeChannel
                          ? `${activeChannel.user_count} in voice`
                          : "Pick a channel on the left"
                    }
                    partner={
                      activeDmUser
                        ? {
                            name: activeDmUser.name,
                            session: activeDmUser.session,
                            textureSize: activeDmUser.texture_size,
                          }
                        : undefined
                    }
                    canJoinVoice={!!activeChannel && activeChannel.id !== currentChannel}
                    onJoinVoice={() =>
                      activeChannel && void useAppStore.getState().joinChannel(activeChannel.id)
                    }
                    onToggleSearch={() => search.setChatOpen(!search.chatOpen)}
                    onShowMembers={() => memberPanel.setOpen(true)}
                    onShareScreen={() => setSurface("screen-share")}
                    onShowPinned={() => setSurface("pinned")}
                    onShowInfo={() => setSurface("server-info")}
                    onShowDownloads={() => setSurface("downloads")}
                  />

                  <ScreenShareStrip
                    pickerRequested={surface === "screen-share"}
                    onPickerClosed={() => setSurface(null)}
                  />

                  {search.chatOpen && (
                    <Box sx={{ px: "26px", pt: "12px" }}>
                      <SearchBox
                        autoFocus
                        value={search.chatQuery}
                        onChange={search.setChatQuery}
                        placeholder="Search this conversation"
                      />
                    </Box>
                  )}

                  {bootstrapStage ? (
                    <Stack sx={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <Typography sx={{ fontSize: 12.5 }}>{bootstrapStage}</Typography>
                    </Stack>
                  ) : visibleMessages.length === 0 ? (
                    <Stack sx={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 0.5 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
                        {activeDmUser
                          ? `Start a conversation with ${activeDmUser.name}`
                          : activeChannel
                            ? `This is the start of #${activeChannel.name}`
                            : "Nothing selected"}
                      </Typography>
                      <Typography sx={(muiTheme) => ({ fontSize: 12, color: muiTheme.palette.nebula.muted })}>
                        Messages and shared moments will appear here.
                      </Typography>
                    </Stack>
                  ) : (
                    <MessageList
                      messages={visibleMessages}
                      users={users}
                      renderMessage={(message, avatar, grouped) => (
                        <MessageRow
                          message={message}
                          avatar={avatar}
                          grouped={grouped}
                          onOpenProfile={openProfile}
                          onHoverProfile={hovered.hover}
                          onLeaveProfile={hovered.clear}
                          onContextMenuProfile={openUserMenuFor}
                        />
                      )}
                    />
                  )}

                  {selectedChannel !== null && !activeDmUser && (
                    <Box sx={{ px: "34px" }}>
                      <TypingIndicator channelId={selectedChannel} />
                    </Box>
                  )}

                  <Composer
                    target={activeDmUser ? `@${activeDmUser.name}` : `#${activeChannel?.name ?? "channel"}`}
                    disabled={!activeChannel && !activeDmUser}
                    onSend={send}
                  />
                </>
              )}
            </Stack>

            {memberPanel.open && screen === "chat" && (
              <MemberPanel
                members={roster}
                scope={memberPanel.scope}
                onScopeChange={memberPanel.setScope}
                query={memberPanel.query}
                onQueryChange={memberPanel.setQuery}
                talkingSessions={talkingSessions}
                ownSession={ownSession}
                onSelect={openProfile}
                onHover={hovered.hover}
                onLeave={hovered.clear}
                onContextMenu={userMenu.open}
                onClose={() => memberPanel.setOpen(false)}
              />
            )}

            {surface === "server-info" && <ServerInfoPanel onClose={() => setSurface(null)} />}
          </Stack>

          {surface === "pinned" && (
            <PinnedMessagesPanel
              messages={visibleMessages}
              unseenIds={EMPTY_IDS}
              onClose={() => setSurface(null)}
              onNavigate={() => setSurface(null)}
              onUnpin={(message) =>
                message.message_id &&
                void useAppStore.getState().pinMessage(message.channel_id, message.message_id, true)
              }
            />
          )}
          {surface === "public-servers" && (
            <FullSurface onClose={() => setSurface(null)}>
              <PublicServerList
                disabled={connecting}
                onBack={() => setSurface(null)}
                // A public server is an address, not a login, so picking one
                // lands in the same form as "add by address" with the address
                // already filled in - there is still a username to choose.
                onConnect={(host, port) => {
                  setSurface(null);
                  setAddServerFor({ host, port, label: host });
                  setAddServerOpen(true);
                }}
              />
            </FullSurface>
          )}
          {surface === "downloads" && (
            <Dialog open onClose={() => setSurface(null)} maxWidth="sm" fullWidth>
              <DialogContent>
                <DownloadsPanel />
              </DialogContent>
            </Dialog>
          )}

          <QuickConnect
            anchorEl={quickConnectAnchor}
            targets={quickTargets}
            savedCount={savedServers?.length ?? 0}
            pings={pings}
            onClose={() => setQuickConnectAnchor(null)}
            onConnect={(target) => {
              setQuickConnectAnchor(null);
              void connectTo(target.identity);
            }}
            onAddByAddress={() => {
              setQuickConnectAnchor(null);
              setAddServerFor(null);
              setAddServerOpen(true);
            }}
            onBrowsePublic={() => {
              setQuickConnectAnchor(null);
              setSurface("public-servers");
            }}
          />

          <GlobalSearch
            open={switcherOpen}
            channels={channels}
            users={users}
            sessions={sessions}
            ownSession={ownSession}
            serverLabel={activeSession?.host ?? activeSession?.label ?? ""}
            onClose={() => setSwitcherOpen(false)}
            onSelect={openSearchRow}
          />

          <AddServerDialog
            open={addServerOpen}
            preset={addServerFor}
            onClose={() => setAddServerOpen(false)}
            onAdded={(server) => {
              reloadServers();
              setSelectedServerKey(`${server.host}:${server.port}`.toLocaleLowerCase());
              openScreen("connect");
            }}
          />

          {profileCardUser && (
            <ProfileCard
              user={profileCardUser}
              anchor={selectedUser === null ? (hovered.target?.anchor ?? null) : profileAnchor.anchor}
              pinned={selectedUser !== null}
              onClose={() => useAppStore.getState().selectUser(null)}
              onMessage={openConversation}
            />
          )}

          {/* One menu for every surface that shows a person. */}
          <UserMenu target={userMenu.target} onClose={userMenu.close} onMessage={openConversation} />

          <ChannelMenu
            target={channelMenu}
            listening={!!channelMenu && listenedChannels.has(channelMenu.channel.id)}
            notificationsMuted={!!channelMenu && mutedPushChannels.has(channelMenu.channel.id)}
            hideEmpty={hideEmpty}
            onToggleHideEmpty={toggleHideEmpty}
            onEdit={setEditingChannel}
            onEditPermissions={(channel) => {
              // The permission editor is channel-scoped, so it is handed the
              // channel to open on rather than left on whatever was selected.
              setAclChannelId(channel.id);
              setAdminPage("acl");
              openScreen("settings");
            }}
            onClose={() => setChannelMenu(null)}
          />

          {editingChannel && (
            <ChannelEditorDialog
              channel={editingChannel}
              parentId={editingChannel.parent_id ?? 0}
              onClose={() => setEditingChannel(null)}
            />
          )}

          <LeaveServerDialog
            session={leave.pending}
            leaving={leave.leaving}
            neverAsk={leave.neverAsk}
            onNeverAskChange={leave.setNeverAsk}
            onConfirm={() => void leave.confirm()}
            onCancel={leave.cancel}
          />

          <ConnectionOverlays />
          <NebulaRuntime
            onOpenMarketplace={(pluginId) => {
              openMarketplace(pluginId);
              setAdminPage("marketplace");
              openScreen("settings");
            }}
          />
        </Stack>
      </Box>
    </ThemeProvider>
  );
}

/** Flip between push to talk and voice activation without opening settings. */
function toggleActivationMode(): void {
  void invoke<AudioSettings>("get_audio_settings")
    .then((settings) =>
      invoke("set_audio_settings", { settings: { ...settings, push_to_talk: !settings.push_to_talk } }),
    )
    .catch(() => undefined);
}

/**
 * Fullscreen and the devtools overlay are the window manager's, not the
 * client's: outside the Tauri shell - a browser dev session, a test - the call
 * simply is not there, so both are attempted and forgotten rather than guarded
 * by a platform check that would have to be kept true.
 */
function toggleFullscreen(): void {
  try {
    const shell = getCurrentWindow();
    void shell
      .isFullscreen()
      .then((fullscreen) => shell.setFullscreen(!fullscreen))
      .catch(() => undefined);
  } catch {
    /* no shell to ask */
  }
}

function openDevtools(): void {
  try {
    (getCurrentWebviewWindow() as unknown as { openDevtools?: () => void }).openDevtools?.();
  } catch {
    /* no shell to ask */
  }
}

/**
 * A Standard page hosted inside Nebula's window.
 *
 * Those pages own their own chrome, including a back control, so this is a
 * plain full-bleed container plus an escape hatch on Escape rather than a
 * modal with its own header.
 */
function FullSurface({ children, onClose }: Readonly<{ children: React.ReactNode; onClose: () => void }>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <Box
      sx={(theme) => ({
        position: "absolute",
        inset: "44px 0 0 0",
        zIndex: 30,
        overflow: "auto",
        background: `${theme.palette.nebula.tint},${theme.palette.nebula.bg0}`,
      })}
    >
      {children}
    </Box>
  );
}
