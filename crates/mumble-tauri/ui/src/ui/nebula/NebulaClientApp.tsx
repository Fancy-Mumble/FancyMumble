import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, CssBaseline, Dialog, DialogContent, Snackbar, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppStore } from "@core/store";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { getSavedServers, getServerPassword, markServerJoined, updateServer } from "@core/serverStorage";
import { getUserRelations, userRelationIdentity, type UserRelation } from "@core/userRelationsStorage";
import { PERM_WRITE } from "@core/utils/permissions";
import { applyMentionsToHtml, type MentionResolver } from "@core/utils/mentions";
import type { AudioSettings, ChannelEntry, ChatMessage, SavedServer, UserEntry } from "@core/types";
import ChannelEditorDialog from "@standard/components/sidebar/channel/ChannelEditorDialog";
import DownloadsPanel from "@standard/components/chat/download/DownloadsPanel";
import TypingIndicator from "@standard/components/chat/typing/TypingIndicator";
import PinnedMessagesPanel from "@standard/components/chat/pinned/PinnedMessagesPanel";
import PublicServerList from "@standard/components/server/PublicServerList";
import { Lightbox, type LightboxHandle } from "@standard/components/elements/Lightbox";
import { usePersistentChat } from "@standard/components/security/PersistentChatOverlays";
import { usePolls } from "@standard/components/chat/poll/usePolls";
import { useReadReceipts } from "@core/features/chat/readreceipt/useReadReceipts";
import { compressStagedImage, stashPastedImage, useFileUpload } from "@core/features/chat/useFileUpload";
import type { FileShareChoice, StagedAttachment } from "@core/features/chat/useFileUpload";
import { MEDIA_EXTENSIONS, previewKindForFilename } from "@core/features/chat/fileAttachments";
import { DEFAULT_SHARE_OPTIONS, type ShareOptions } from "./components/chat/AttachmentTray";
import type { AttachKind } from "./components/chat/Composer";
import EmojiPicker from "@standard/components/elements/EmojiPicker";
import { hasReacted } from "@core/features/chat/reaction/reactionStore";
import type { MessageScope } from "@core/messageOffload";
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
  ServerRail,
  SettingsNav,
  useSettingsNavContext,
  SidebarShell,
  TitleBar,
  UserInfoDialog,
  UserMenu,
  VoiceDock,
  Stack,
} from "./components";
import type { SettingsPageId } from "./components";
import { useAdminCapabilities, useAdminNavEntries, type AdminPageId } from "./components/admin";
/**
 * The two surfaces the client is not, loaded when they are asked for.
 *
 * Settings is twelve pages and administration is fourteen, and together they
 * were about 5.7s of the client's ~9.4s cold import - carried by every mount,
 * including one that only ever shows a connect screen. Neither is reachable
 * without a deliberate click, so neither belongs in the graph until it happens.
 */
const SettingsScreen = lazy(() =>
  import("./components/settings/SettingsScreen").then((m) => ({ default: m.SettingsScreen })),
);
const AdminScreen = lazy(() =>
  import("./components/admin/AdminScreen").then((m) => ({ default: m.AdminScreen })),
);

import { AddServerDialog } from "./components/connect/AddServerDialog";
import { ScreenShareStrip } from "./components/chat/ScreenShareStrip";
import { MessageMenu, type MessageMenuTarget } from "./components/chat/MessageMenu";
import {
  useFirstUnreadId,
  useHideEmptyChannels,
  useHoverTarget,
  useMemberPanel,
  useMiniMode,
  useMiniWindow,
  useProfileAnchor,
  useScreenRouting,
  useUserInfo,
  useUserMenu,
  useMessageSelection,
  useSearchState,
  useServerPings,
  type HoverEvent,
} from "./clientState";
import {
  channelOccupants,
  channelPresence,
  groupSavedServers,
  isEncryptedChannel,
  listDirectConversations,
  orderChannels,
  plainText,
  presenceLabel,
  quickConnectTargets,
  serverRailEntries,
  type ServerRailEntry,
  type GlobalSearchRow,
  type ServerGroup,
} from "./selectors";
import { shortcutLabel, useNebulaShortcuts } from "./shortcuts";
import { useLeaveServer } from "./useLeaveServer";
import { useNebulaEventBridge } from "./useNebulaEventBridge";
import { useNebulaTheme } from "./useNebulaAppearance";
import { useServerLiveries } from "./useServerLivery";
import { radius } from "./tokens";

/** Pinned messages have no "unseen" concept in Nebula's chrome. */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** A file chosen from the picker or a drop, before the share question. */
interface PickedFile {
  readonly filePath: string;
  readonly filename: string;
}

/**
 * Name a path.
 *
 * Both separators, because a Windows path arrives with backslashes and the
 * same build runs against a Linux drop.
 */
function pickedFile(filePath: string): PickedFile {
  return { filePath, filename: filePath.replaceAll("\\", "/").split("/").pop() ?? "file" };
}

/** `convertFileSrc`, tolerant of a shell that has not wired the asset protocol. */
function previewUrlFor(filePath: string): string | undefined {
  try {
    return convertFileSrc(filePath);
  } catch {
    return undefined;
  }
}

/**
 * Whether a dropped entry names a file on disk.
 *
 * The shell hands over the drag's URI list with only the `file://` prefix
 * removed, so an image dragged out of a browser - or out of this very chat -
 * arrives as `http://…`. The uploader streams from a path, and a URL is not
 * one.
 */
function isLocalPath(path: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(path);
}

function newStagedId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `staged-${Math.random().toString(36).slice(2)}`;
}

/** The server search matches what the row shows: its name and its address. */
function matchesServer(group: ServerGroup, needle: string): boolean {
  return group.label.toLocaleLowerCase().includes(needle) || group.host.toLocaleLowerCase().includes(needle);
}

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
  const status = useAppStore((state) => state.status);
  const sessions = useAppStore((state) => state.sessions);
  const sessionUnreadTotals = useAppStore((state) => state.sessionUnreadTotals);
  const activeServerId = useAppStore((state) => state.activeServerId);

  // What each open server says it looks like, keyed by session. Read here once
  // and routed twice, because the two consumers ask about different servers:
  // the window wears the colours of the tab in front of the user, while the
  // connect screen draws whichever server the sidebar has selected - often one
  // that is not open, and so has said nothing at all.
  const liveries = useServerLiveries();
  const theme = useNebulaTheme(liveries[activeServerId ?? ""] ?? null);
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
  const userInfo = useUserInfo();
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

  // Administration shares the settings surface, so `adminPage` outlives a visit
  // to it. Anything asking for *settings* has to clear it, or the pane reopens
  // on whichever admin page was looked at last.
  const openSettings = useCallback(() => {
    setAdminPage(null);
    openScreen("settings");
  }, [openScreen]);
  const { hideEmpty, toggle: toggleHideEmpty } = useHideEmptyChannels();
  // Mini mode exists for "I am in a call and doing something else", so it is
  // gated on voice being live rather than on being in a channel - connected
  // users are always in one.
  const { mini, setMini } = useMiniMode(voiceState !== "inactive");
  const miniCardRef = useMiniWindow(mini);
  const leave = useLeaveServer();

  const [savedServers, setSavedServers] = useState<SavedServer[] | null>(null);
  const [selectedServerKey, setSelectedServerKey] = useState<string | null>(null);
  const [addServerFor, setAddServerFor] = useState<{ host: string; port: number; label: string } | null>(
    null,
  );
  const [addServerOpen, setAddServerOpen] = useState(false);
  const [quickConnectAnchor, setQuickConnectAnchor] = useState<HTMLElement | null>(null);
  const [railExpanded, setRailExpanded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [relations, setRelations] = useState<Record<string, UserRelation>>({});
  const [channelMenu, setChannelMenu] = useState<{ channel: ChannelEntry; x: number; y: number } | null>(
    null,
  );
  /**
   * The channel editor, in whichever of its two jobs is open.
   *
   * Editing and creating are one dialog - Standard's, which switches on being
   * handed a channel or not - so they are one piece of state rather than two
   * that could both be set.
   */
  const [channelDialog, setChannelDialog] = useState<
    { mode: "edit"; channel: ChannelEntry } | { mode: "create"; parentId: number; tempOnly: boolean } | null
  >(null);
  const [deletingChannel, setDeletingChannel] = useState<ChannelEntry | null>(null);

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
    onOpenSettings: openSettings,
    onToggleFullscreen: toggleFullscreen,
    onToggleDevOverlay: openDevtools,
  });

  /**
   * The whole conversation, minus the people this user has muted out of it.
   *
   * Kept apart from the searched list below because several things are about
   * the conversation rather than about what is on screen: the read watermark,
   * where reading stopped, and the lightbox's gallery. Deriving those from the
   * filtered list would let typing in the search box move this client's read
   * receipt and drop images out of the gallery.
   */
  const conversationMessages = useMemo(() => {
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
      return !(activeDmUser && relations[userRelationIdentity(activeDmUser)]?.blocked);
    });
  }, [activeDmUser, dmMessages, messages, pollMessages, relations, selectedChannel]);

  const visibleMessages = useMemo(() => {
    const needle = search.chatQuery.trim().toLocaleLowerCase();
    if (!needle) return conversationMessages;
    return conversationMessages.filter((message) =>
      plainText(message.body).toLocaleLowerCase().includes(needle),
    );
  }, [conversationMessages, search.chatQuery]);

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
  // The rail order is the user arrangement, loaded once and written back on
  // every drop so a restart finds the tiles where they were left.
  const [railOrder, setRailOrder] = useState<readonly string[]>([]);
  const [serverSwitcher, setServerSwitcher] = useState<"rail" | "titlebar">("rail");
  useEffect(() => {
    let live = true;
    const load = () => {
      void getPreferences()
        .then((preferences) => {
          if (!live) return;
          setRailOrder(preferences.serverRailOrder ?? []);
          setServerSwitcher(preferences.serverSwitcher ?? "rail");
        })
        .catch(() => undefined);
    };
    load();
    // Moving the list between the rail and the title bar has to happen as the
    // setting is changed, not at the next launch.
    globalThis.addEventListener("preferences-changed", load);
    return () => {
      live = false;
      globalThis.removeEventListener("preferences-changed", load);
    };
  }, []);

  const openServer = useCallback(
    (entry: ServerRailEntry) => {
      setSelectedServerKey(entry.group.key);
      // A server you are already on switches to it; one you are not takes you
      // to its connect page, which is where the identity gets chosen.
      if (entry.session) {
        void useAppStore.getState().switchServer(entry.session.id);
        openScreen("chat");
      } else {
        openScreen("connect");
      }
    },
    [openScreen],
  );

  const reorderRail = useCallback((keys: readonly string[]) => {
    setRailOrder(keys);
    void updatePreferences({ serverRailOrder: [...keys] });
  }, []);

  const railEntries = useMemo(
    () => serverRailEntries(serverGroups, sessions, sessionUnreadTotals, railOrder),
    [serverGroups, sessions, sessionUnreadTotals, railOrder],
  );
  /**
   * The connect screen leaves the rail open, as its sidebar.
   *
   * The two used to list the same servers side by side - the same names, the
   * same occupancy, the same identity counts - so the rail's own list now takes
   * that column outright rather than being a second copy of it. With the
   * switcher in the title bar there is no rail to open, and the sidebar below
   * stays.
   */
  const serverListPinned = screen === "connect" && serverSwitcher === "rail";
  const visibleGroups = useMemo(() => {
    const needle = search.channelQuery.trim().toLocaleLowerCase();
    if (!needle) return serverGroups;
    return serverGroups.filter((group) => matchesServer(group, needle));
  }, [search.channelQuery, serverGroups]);
  // The same filter over the rail's rows, so the merged column searches the
  // way the sidebar it replaced did. Only the rows narrow: the tiles are a
  // fixed place to aim at, and a rail that emptied as you typed would not be.
  const visibleRailEntries = useMemo(() => {
    const needle = search.channelQuery.trim().toLocaleLowerCase();
    if (!needle) return railEntries;
    return railEntries.filter((entry) => matchesServer(entry.group, needle));
  }, [search.channelQuery, railEntries]);
  const pings = useServerPings(serverGroups);
  // Quick connect offers the logins the tab strip does not already hold - per
  // identity, not per address, because that is what a tab is keyed on.
  const quickTargets = useMemo(() => quickConnectTargets(serverGroups, sessions), [serverGroups, sessions]);

  const selectedGroup =
    serverGroups.find((group) => group.key === selectedServerKey) ?? serverGroups[0] ?? null;
  const identities = selectedGroup?.identities ?? [];
  // Only an open connection carries branding. A saved address the user is
  // merely looking at has sent nothing, and lending it the open server's livery
  // is what put one server's banner on every server's page.
  const selectedLivery = selectedGroup?.sessionId ? (liveries[selectedGroup.sessionId] ?? null) : null;
  // Artwork only reaches the rail for servers that are connected: a livery
  // arrives over the session, so a saved server nobody is on has none to show
  // and falls back to its initials.
  const railBanners = useMemo(() => {
    const art = new Map<string, string>();
    for (const entry of railEntries) {
      const banner = entry.session ? liveries[entry.session.id]?.bannerSrc : undefined;
      if (banner) art.set(entry.group.key, banner);
    }
    return art;
  }, [railEntries, liveries]);

  // Only the channel you are actually sitting in, and only on the server you
  // are on: the card cannot report a room on a server it is not connected to.
  const railOccupants = useMemo(
    () =>
      joinedChannel
        ? channelOccupants(users, joinedChannel.id).map((person) => ({
            session: person.session,
            name: person.name,
            talking: talkingSessions.has(person.session),
            muted: Boolean(person.mute || person.self_mute),
          }))
        : [],
    [joinedChannel, users, talkingSessions],
  );

  const railIcons = useMemo(() => {
    const icons = new Map<string, string>();
    for (const entry of railEntries) {
      const icon = entry.session ? liveries[entry.session.id]?.iconSrc : undefined;
      if (icon) icons.set(entry.group.key, icon);
    }
    return icons;
  }, [railEntries, liveries]);

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
    // Alphabetical only. Sorting talkers to the top made the panel jump on
    // every push-to-talk tap; the talking bars mark the speaker in place.
    return users
      .filter((user) => memberPanel.scope === "server" || user.channel_id === selectedChannel)
      .filter((user) => !needle || user.name.toLocaleLowerCase().includes(needle))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [memberPanel.query, memberPanel.scope, selectedChannel, users]);

  // Every id in the conversation, in order: the read-receipt watermark is a
  // position in this list rather than a per-message flag, so a row cannot work
  // out on its own whether anyone has read past it.
  const conversationMessageIds = useMemo(
    () => conversationMessages.map((message) => message.message_id).filter((id): id is string => !!id),
    [conversationMessages],
  );

  const { handlePollVote, handlePollCreate } = usePolls();

  // Sends this client's own watermark and asks for everyone else's. Without
  // it Nebula would show other people's receipts and never return one, which
  // reads to them as "nobody is here".
  useReadReceipts(activeDmUser ? null : selectedChannel, conversationMessageIds.at(-1));

  const firstUnreadId = useFirstUnreadId(
    conversationMessages,
    `${selectedChannel}:${selectedDmUser}`,
    activeDmUser
      ? (dmUnreadCounts[activeDmUser.session] ?? 0)
      : selectedChannel === null
        ? 0
        : (unreadCounts[selectedChannel] ?? 0),
  );

  // The encryption state of the open channel: whether it persists, whose keys
  // are trusted, who is waiting for one. Standard owns these flows; what
  // Nebula decides is where the banners sit and that a revoked key disables
  // the composer rather than letting a send fail silently.
  const persistent = usePersistentChat(activeDmUser ? null : selectedChannel, activeChannel?.name ?? "");

  // Who belongs to the open channel. The people in it are in the roster
  // already; the ones who belong and are elsewhere are only knowable for a
  // persisted channel, whose key holders the server names when asked - so ask,
  // once per such channel opened. A plain channel never asks, and its
  // membership is simply whoever is standing in it.
  const keyHolders = useAppStore((state) => state.keyHolders);
  const queryKeyHolders = useAppStore((state) => state.queryKeyHolders);
  useEffect(() => {
    if (selectedChannel === null || !persistent.isPersisted) return;
    void queryKeyHolders(selectedChannel);
  }, [selectedChannel, persistent.isPersisted, queryKeyHolders]);

  const presence = useMemo(
    () =>
      activeChannel === null ? null : channelPresence(users, activeChannel.id, keyHolders[activeChannel.id]),
    [activeChannel, keyHolders, users],
  );

  /**
   * The banners that belong to the conversation rather than to the window.
   *
   * They are drawn at the top of the scroller, above the oldest message,
   * because one of them - the persistence banner - carries the sentinel that
   * asks for the next page of history when it scrolls into view. Placed in
   * fixed chrome it would be permanently visible and would page the whole
   * archive in as fast as the server could answer.
   */
  const chatBanners = (
    <>
      {persistent.banner}
      {persistent.signalBridgeErrorBanner}
      {persistent.disputeBanner}
      {persistent.revokedBanner}
    </>
  );

  // --- attaching a file -------------------------------------------------
  const fileServerConfig = useAppStore((state) => state.fileServerConfig);
  const uploads = useFileUpload({
    channelId: selectedChannel,
    dmSession: activeDmUser?.session ?? null,
  });
  /**
   * The files staged on the message being written, before it is sent.
   *
   * There is no question asked before this: a file lands here the instant it
   * is picked, dropped, or pasted, and how it may be shared is a choice on
   * the tray rather than a dialog blocking its way in - see `shareOptions`.
   */
  const [staged, setStaged] = useState<readonly StagedAttachment[]>([]);
  /** How the staged batch goes up, folded away on the tray until opened. */
  const [shareOptions, setShareOptions] = useState<ShareOptions>(DEFAULT_SHARE_OPTIONS);

  /**
   * Take picked, dropped, or pasted files straight into the composer's tray.
   *
   * The size arrives a moment after the tile does: it is a stat on a path, and
   * the tile is worth drawing before the disk has answered. Images get a local
   * preview URL rather than being read into memory - the tray shows a 54px
   * square, and pulling a 40-megapixel photograph through IPC to fill it would
   * cost more than the upload it is standing in for. A photo's smaller copy
   * starts alongside the stat rather than after it, so the "compressed" option
   * is usually ready by the time anyone opens the tray to look at it.
   */
  const stageFiles = useCallback((files: readonly PickedFile[]) => {
    const entries: StagedAttachment[] = files.map((file) => {
      const isImage = previewKindForFilename(file.filename) === "image";
      return {
        id: newStagedId(),
        filePath: file.filePath,
        filename: file.filename,
        // A preview that cannot be built is not worth a message either: the
        // tile still stages and still sends, just without the square.
        previewUrl: isImage ? previewUrlFor(file.filePath) : undefined,
        compressed: isImage ? ("pending" as const) : undefined,
      };
    });
    setStaged((prev) => [...prev, ...entries]);
    for (const entry of entries) {
      void (async () => {
        let sizeBytes: number | undefined;
        try {
          sizeBytes = await invoke<number>("file_size", { path: entry.filePath });
          setStaged((prev) => prev.map((file) => (file.id === entry.id ? { ...file, sizeBytes } : file)));
        } catch {
          // A size that cannot be read is not worth a message: the file is
          // still stageable and still sendable, and the tile simply does not
          // say how big it is.
        }
        if (entry.compressed !== "pending") return;
        const compressed = await compressStagedImage(entry.filePath, entry.filename, sizeBytes);
        setStaged((prev) => prev.map((file) => (file.id === entry.id ? { ...file, compressed } : file)));
      })();
    }
  }, []);

  /**
   * Pick files to attach, if this server will take one.
   *
   * The button is only rendered when the file server has said both that it is
   * there and that this user may share - an attach button that opens a picker
   * and then fails on upload wastes the choice the user just made. "media"
   * narrows the dialog to what a photo or video actually is; "any" leaves it
   * open, the way the paperclip itself does.
   */
  const canAttach = !!fileServerConfig?.canShareFiles && (!!activeChannel || !!activeDmUser);
  const pickAttachment = useCallback(
    async (kind: AttachKind = "any") => {
      if (!canAttach) return;
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({
          multiple: true,
          directory: false,
          filters:
            kind === "media" ? [{ name: "Photo or video", extensions: [...MEDIA_EXTENSIONS] }] : undefined,
        });
        const paths = typeof picked === "string" ? [picked] : (picked ?? []);
        if (paths.length > 0) stageFiles(paths.map(pickedFile));
      } catch (e) {
        console.error("file picker failed:", e);
      }
    },
    [canAttach, stageFiles],
  );

  /**
   * Images pasted into the composer, or dropped onto the browser itself.
   *
   * Neither carries a path - a paste is bytes the webview is holding, and a
   * browser-level drop (as opposed to the shell's own, handled below) hands
   * over a `File` the same way. Both are written to a scratch file first, the
   * one step `stageFiles` cannot do for them, and staged like anything else
   * once they have one.
   */
  const stagePastedFiles = useCallback(
    (files: File[]) => {
      if (!canAttach) return;
      for (const file of files) {
        void stashPastedImage(file)
          .then((picked) => stageFiles([picked]))
          .catch((e) => console.error("stash pasted image failed:", e));
      }
    },
    [canAttach, stageFiles],
  );

  // --- replying ---------------------------------------------------------
  const [pendingQuotes, setPendingQuotes] = useState<ChatMessage[]>([]);
  const [jumpTo, setJumpTo] = useState<{ messageId: string; nonce: number } | null>(null);

  const quoteMessage = useCallback((message: ChatMessage) => {
    if (!message.message_id) return;
    // Quoting the same message twice would send the marker twice and draw two
    // identical blocks on top of the reply.
    setPendingQuotes((prev) =>
      prev.some((quote) => quote.message_id === message.message_id) ? prev : [...prev, message],
    );
  }, []);

  const selection = useMessageSelection(`${selectedChannel}:${selectedDmUser}`);
  const [messageMenu, setMessageMenu] = useState<MessageMenuTarget | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  /** The message a menu-opened reaction picker is about, and where it sits. */
  const [reactionTarget, setReactionTarget] = useState<{
    message: ChatMessage;
    x: number;
    y: number;
  } | null>(null);

  const ownHash = ownUser?.hash ?? "";
  const react = useCallback(
    (message: ChatMessage, emoji: string) => {
      if (!message.message_id) return;
      const already = ownHash && hasReacted(message.message_id, emoji, ownHash);
      void useAppStore
        .getState()
        .sendReaction(message.channel_id, message.message_id, emoji, already ? "remove" : "add");
    },
    [ownHash],
  );

  const jumpToMessage = useCallback((messageId: string) => {
    setJumpTo((prev) => ({ messageId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // Quotes belong to the conversation they were taken from; carrying them into
  // the next one would attach a reply to a message nobody there can see.
  useEffect(() => {
    setPendingQuotes([]);
    setJumpTo(null);
    setEditingMessageId(null);
    // Staged files belong to the message being written here. Carrying them to
    // the next conversation would share them with a room that was never asked.
    setStaged([]);
    setShareOptions(DEFAULT_SHARE_OPTIONS);
  }, [selectedChannel, selectedDmUser]);

  const [dragOverWindow, setDragOverWindow] = useState(false);
  /** Why the last drop was turned away, while the message is up. */
  const [dropNotice, setDropNotice] = useState<string | null>(null);

  /**
   * Files dragged onto the window.
   *
   * Tauri's own event rather than the DOM's: a dropped `File` carries no path,
   * and the uploader streams from one. A drop stages straight into the tray
   * the same way a pick does - no question in its way, nothing pressed first.
   *
   * Gated on `canAttach` alone, the same as the button: a direct message has
   * no selected channel, and the uploader takes the DM session instead.
   */
  useEffect(() => {
    if (!canAttach) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
          if (event.payload.type === "over") setDragOverWindow(true);
          else if (event.payload.type === "leave") setDragOverWindow(false);
          else if (event.payload.type === "drop") {
            setDragOverWindow(false);
            const paths = event.payload.paths ?? [];
            if (paths.length === 0) return;
            const files = paths.filter(isLocalPath);
            // The overlay said "drop files": a drop that held none is answered
            // rather than swallowed, or it looks like nothing happened.
            if (files.length === 0) {
              setDropNotice("Only files from this computer can be dropped here");
              return;
            }
            stageFiles(files.map(pickedFile));
          }
        });
        if (cancelled) unlisten();
        else stop = unlisten;
      } catch {
        /* no shell to listen to - a browser dev session or a test */
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
      setDragOverWindow(false);
    };
  }, [canAttach, stageFiles]);

  const lightboxRef = useRef<LightboxHandle>(null);
  const currentScope = useCallback((): MessageScope | null => {
    if (selectedDmUser !== null) return { scope: "dm", scopeId: String(selectedDmUser) };
    if (selectedChannel !== null) return { scope: "channel", scopeId: String(selectedChannel) };
    return null;
  }, [selectedChannel, selectedDmUser]);

  const mentionResolver: MentionResolver = {
    resolveSession: (session) => {
      const user = users.find((candidate) => candidate.session === session);
      return user ? { name: user.name } : null;
    },
  };

  const send = async (html: string) => {
    const markers = pendingQuotes
      .filter((quote) => quote.message_id)
      .map((quote) => `<!-- FANCY_QUOTE:${quote.message_id} -->`)
      .join("");
    const body = markers + applyMentionsToHtml(html.trim(), mentionResolver);
    if (!body.trim() && staged.length === 0) return;
    setPendingQuotes([]);

    // Files that were staged go up now, and each becomes its own message -
    // that is what an attachment is on this wire, a marker in a body. What was
    // typed rides on the first of them rather than being sent separately, so a
    // photo and the sentence about it stay one thing in the river; the rest go
    // up bare, because saying it once is saying it. Every file in the batch
    // shares the one visibility chosen on the tray; quality is per file,
    // because a compressed copy that never turned out smaller falls back to
    // the original rather than holding the whole batch to whichever finished.
    if (staged.length > 0) {
      const options = shareOptions;
      setStaged([]);
      setShareOptions(DEFAULT_SHARE_OPTIONS);
      const choice: FileShareChoice = {
        mode: options.mode,
        password: options.mode === "password" ? options.password : undefined,
        // Sent only on a server that honours it - the tray's own "Expires"
        // row is locked to "never" otherwise, but a stale default from
        // before the tray was ever opened must not still ask for one.
        ttlSeconds: fileServerConfig?.deleteOnTtl ? options.ttlSeconds : undefined,
      };
      for (const [index, file] of staged.entries()) {
        const compressed = options.quality === "compressed" ? file.compressed : null;
        const wantsCompressed = compressed && compressed !== "pending" ? compressed : null;
        await uploads.upload(
          wantsCompressed?.filePath ?? file.filePath,
          file.filename,
          { ...choice, message: index === 0 ? body : undefined },
          {
            sizeBytes: wantsCompressed?.sizeBytes ?? file.sizeBytes,
            previewUrl: file.previewUrl,
          },
        );
      }
      return;
    }

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
  const profileCardUser = users.find((user) => user.session === (selectedUser ?? hovered.target?.session));

  if (mini && joinedChannel)
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <MiniMode
          serverLabel={activeSession?.label ?? "Connected"}
          channelName={joinedChannel.name}
          occupants={channelOccupants(users, joinedChannel.id)}
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
          cardRef={miniCardRef}
        />
        <UserMenu target={userMenu.target} onClose={userMenu.close} onInfo={userInfo.open} />
        <UserInfoDialog session={userInfo.session} onClose={userInfo.close} />
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
            entries={railEntries}
            icons={railIcons}
            activeKey={selectedGroup?.key ?? null}
            onSelectServer={openServer}
            tabs={serverSwitcher === "titlebar"}
          />

          <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
            {serverSwitcher === "rail" && (
              <ServerRail
                entries={railEntries}
                panelEntries={visibleRailEntries}
                icons={railIcons}
                banners={railBanners}
                pings={pings}
                activeChannelName={joinedChannel?.name ?? null}
                ownName={activeSession?.username ?? null}
                occupants={railOccupants}
                activeKey={selectedGroup?.key ?? null}
                expanded={railExpanded}
                pinned={serverListPinned}
                search={
                  serverListPinned ? (
                    <SearchBox
                      value={search.channelQuery}
                      onChange={search.setChannelQuery}
                      placeholder="Search servers"
                      inputRef={channelSearchRef}
                    />
                  ) : undefined
                }
                onToggleExpanded={() => setRailExpanded((open) => !open)}
                onSelect={openServer}
                onAddServer={() => {
                  setAddServerFor(null);
                  setAddServerOpen(true);
                }}
                onToggleFavorite={toggleFavorite}
                onDisconnect={status === "connected" ? () => leave.request(activeSession) : undefined}
                onReorder={reorderRail}
              />
            )}
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
                    hideEmpty={hideEmpty}
                    onToggleHideEmpty={toggleHideEmpty}
                    onOpenSettings={openSettings}
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
                    /* Both need a channel to broadcast into; the strip that
                       answers them lives on the chat screen, which is the only
                       screen this dock is drawn on. */
                    onShareScreen={currentChannel !== null ? () => setSurface("screen-share") : undefined}
                    onShareCamera={currentChannel !== null ? () => setSurface("camera-share") : undefined}
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

            {/* Only where the rail is not drawing this list itself. With the
                rail on, the connect screen's column *is* the open rail. */}
            {screen === "connect" && !serverListPinned && (
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
                // One boundary for both: they occupy the same pane and never
                // show together, so a fallback that covered only one of them
                // would blank a pane the other was about to fill.
                <Suspense fallback={<ScreenLoading />}>
                  {adminPage !== null ? (
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
                  )}
                </Suspense>
              ) : screen === "connect" ? (
                <ConnectScreen
                  server={selectedGroup?.identities[0] ?? null}
                  livery={selectedLivery}
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
                        : presence
                          ? presenceLabel(presence)
                          : "Pick a channel on the left"
                    }
                    memberCount={activeDmUser ? undefined : presence?.members}
                    persisted={persistent.isPersisted}
                    encrypted={!activeDmUser && isEncryptedChannel(activeChannel)}
                    trustLevel={persistent.trustLevel}
                    onVerifyKey={persistent.onVerifyClick}
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
                    cameraRequested={surface === "camera-share"}
                    onPickerClosed={() => setSurface(null)}
                  />

                  {/* A key-share request is about a person who just walked in,
                      not about the history below, so it is pinned here rather
                      than filed at the top of the conversation. */}
                  {persistent.keyShareBanner && (
                    <Stack gap={0.75} sx={{ px: "26px", pt: "10px" }}>
                      {persistent.keyShareBanner}
                    </Stack>
                  )}

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
                    // The banners still belong here: a channel whose history has
                    // not been fetched yet is empty, and its sentinel is the
                    // thing that would fetch it.
                    <Stack sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                      <Box sx={{ px: "26px", pt: "12px" }}>{chatBanners}</Box>
                      <Stack sx={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 0.5 }}>
                        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
                          {activeDmUser
                            ? `Start a conversation with ${activeDmUser.name}`
                            : activeChannel
                              ? `This is the start of #${activeChannel.name}`
                              : "Nothing selected"}
                        </Typography>
                        <Typography
                          sx={(muiTheme) => ({ fontSize: 12, color: muiTheme.palette.nebula.muted })}
                        >
                          Messages and shared moments will appear here.
                        </Typography>
                      </Stack>
                    </Stack>
                  ) : (
                    <MessageList
                      messages={visibleMessages}
                      users={users}
                      firstUnreadId={firstUnreadId}
                      header={chatBanners}
                      jumpTo={jumpTo}
                      renderMessage={(message, avatar, grouped) => (
                        <MessageRow
                          message={message}
                          avatar={avatar}
                          grouped={grouped}
                          onOpenProfile={openProfile}
                          onHoverProfile={hovered.hover}
                          onLeaveProfile={hovered.clear}
                          onContextMenuProfile={openUserMenuFor}
                          onVote={handlePollVote}
                          onOpenImage={(src) => lightboxRef.current?.open(src)}
                          allMessageIds={conversationMessageIds}
                          onQuote={quoteMessage}
                          onJumpTo={jumpToMessage}
                          onContextMenu={(target, at, editable) =>
                            setMessageMenu({ message: target, x: at.x, y: at.y, editable })
                          }
                          selected={
                            selection.active && message.message_id
                              ? selection.selected.has(message.message_id)
                              : null
                          }
                          onToggleSelected={selection.toggle}
                          editing={!!message.message_id && editingMessageId === message.message_id}
                          onEditingChange={(next) =>
                            setEditingMessageId(next ? (message.message_id ?? null) : null)
                          }
                        />
                      )}
                    />
                  )}

                  {selection.active && (
                    <Stack
                      direction="row"
                      alignItems="center"
                      gap={1}
                      sx={(muiTheme) => ({
                        mx: "34px",
                        mt: "8px",
                        px: "14px",
                        py: "8px",
                        borderRadius: radius("md"),
                        background: muiTheme.palette.nebula.card,
                        border: `1px solid ${muiTheme.palette.nebula.line}`,
                      })}
                    >
                      <Typography sx={{ fontSize: 12 }}>{selection.selected.size} selected</Typography>
                      <Button
                        size="small"
                        color="error"
                        disabled={selection.selected.size === 0 || selectedChannel === null}
                        onClick={() => {
                          const ids = [...selection.selected];
                          selection.clear();
                          if (selectedChannel !== null && ids.length > 0) {
                            void useAppStore
                              .getState()
                              .deletePchatMessages(selectedChannel, { messageIds: ids });
                          }
                        }}
                        sx={{ ml: "auto" }}
                      >
                        Delete
                      </Button>
                      <Button size="small" onClick={selection.clear}>
                        Cancel
                      </Button>
                    </Stack>
                  )}

                  {selectedChannel !== null && !activeDmUser && (
                    <Box sx={{ px: "34px" }}>
                      <TypingIndicator channelId={selectedChannel} />
                    </Box>
                  )}

                  <Composer
                    target={activeDmUser ? `@${activeDmUser.name}` : `#${activeChannel?.name ?? "channel"}`}
                    disabled={(!activeChannel && !activeDmUser) || persistent.sendBlocked}
                    onSend={send}
                    onAttach={canAttach ? (kind) => void pickAttachment(kind) : undefined}
                    onAttachFiles={canAttach ? stagePastedFiles : undefined}
                    attachBlocked={
                      activeChannel || activeDmUser
                        ? fileServerConfig
                          ? fileServerConfig.canShareFiles
                            ? null
                            : "This server does not let you share files"
                          : "This server has no file sharing"
                        : "Pick a conversation first"
                    }
                    onCreatePoll={
                      selectedChannel !== null && !activeDmUser
                        ? (question, options, multiple) => void handlePollCreate(question, options, multiple)
                        : undefined
                    }
                    canSharePublic={fileServerConfig?.canShareFilesPublic ?? false}
                    canExpire={fileServerConfig?.deleteOnTtl ?? false}
                    shareOptions={shareOptions}
                    onShareOptionsChange={setShareOptions}
                    quotes={pendingQuotes}
                    onRemoveQuote={(id) =>
                      setPendingQuotes((prev) => prev.filter((quote) => quote.message_id !== id))
                    }
                    attachments={staged}
                    onRemoveAttachment={(id) => setStaged((prev) => prev.filter((file) => file.id !== id))}
                    uploads={uploads.placeholders}
                    onCancelUpload={uploads.cancel}
                    dropActive={canAttach && dragOverWindow}
                  />
                  <Snackbar
                    open={dropNotice !== null}
                    autoHideDuration={4000}
                    onClose={() => setDropNotice(null)}
                    anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
                  >
                    {dropNotice ? (
                      <Alert severity="info" variant="filled" onClose={() => setDropNotice(null)}>
                        {dropNotice}
                      </Alert>
                    ) : undefined}
                  </Snackbar>
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
                onInfo={userInfo.open}
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
          <UserMenu
            target={userMenu.target}
            onClose={userMenu.close}
            onMessage={openConversation}
            onInfo={userInfo.open}
          />
          <UserInfoDialog session={userInfo.session} onClose={userInfo.close} />

          <ChannelMenu
            target={channelMenu}
            listening={!!channelMenu && listenedChannels.has(channelMenu.channel.id)}
            notificationsMuted={!!channelMenu && mutedPushChannels.has(channelMenu.channel.id)}
            hideEmpty={hideEmpty}
            onToggleHideEmpty={toggleHideEmpty}
            onEdit={(channel) => setChannelDialog({ mode: "edit", channel })}
            onCreate={(parent, tempOnly) =>
              setChannelDialog({ mode: "create", parentId: parent.id, tempOnly })
            }
            onDelete={setDeletingChannel}
            onEditPermissions={(channel) => {
              // The permission editor is channel-scoped, so it is handed the
              // channel to open on rather than left on whatever was selected.
              setAclChannelId(channel.id);
              setAdminPage("acl");
              openScreen("settings");
            }}
            onClose={() => setChannelMenu(null)}
          />

          {channelDialog && (
            <ChannelEditorDialog
              channel={channelDialog.mode === "edit" ? channelDialog.channel : null}
              parentId={
                channelDialog.mode === "edit"
                  ? (channelDialog.channel.parent_id ?? 0)
                  : channelDialog.parentId
              }
              tempOnly={channelDialog.mode === "create" && channelDialog.tempOnly}
              onClose={() => setChannelDialog(null)}
            />
          )}

          {/* Deleting a channel takes its messages with it and cannot be undone,
              so it asks - and the dialog holds its own copy of the target,
              because dismissing the menu to show it must not take the subject
              with it. */}
          <Dialog open={!!deletingChannel} onClose={() => setDeletingChannel(null)} maxWidth="xs">
            <DialogContent>
              <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 0.5 }}>
                Delete #{deletingChannel?.name}?
              </Typography>
              <Typography sx={(muiTheme) => ({ fontSize: 12, color: muiTheme.palette.nebula.muted })}>
                Its sub-channels and stored messages go with it. This cannot be undone.
              </Typography>
              <Stack direction="row" gap={1} sx={{ justifyContent: "flex-end", mt: 2 }}>
                <Button onClick={() => setDeletingChannel(null)}>Cancel</Button>
                <Button
                  variant="contained"
                  color="error"
                  onClick={() => {
                    const id = deletingChannel?.id;
                    setDeletingChannel(null);
                    if (id != null) void useAppStore.getState().deleteChannel(id);
                  }}
                >
                  Delete
                </Button>
              </Stack>
            </DialogContent>
          </Dialog>

          <LeaveServerDialog
            session={leave.pending}
            leaving={leave.leaving}
            neverAsk={leave.neverAsk}
            onNeverAskChange={leave.setNeverAsk}
            onConfirm={() => void leave.confirm()}
            onCancel={leave.cancel}
          />

          {/* Key verification and the custodian prompt: modal decisions about
              the open channel's encryption, mounted once at the root so they
              outlive the row or banner that asked for them. */}
          {persistent.dialogs}

          <Lightbox
            ref={lightboxRef}
            allMessages={[...conversationMessages]}
            selectedChannel={selectedChannel}
            selectedDmUser={selectedDmUser}
            currentScope={currentScope}
          />

          <MessageMenu
            target={messageMenu}
            onClose={() => setMessageMenu(null)}
            onQuickReact={react}
            onReact={(target, at) => setReactionTarget({ message: target, ...at })}
            onQuote={quoteMessage}
            onEdit={(target) => setEditingMessageId(target.message_id ?? null)}
            onSelect={selection.begin}
          />

          {reactionTarget && (
            <EmojiPicker
              anchorX={reactionTarget.x}
              anchorY={reactionTarget.y}
              onSelect={(emoji) => {
                react(reactionTarget.message, emoji);
                setReactionTarget(null);
              }}
              onClose={() => setReactionTarget(null)}
            />
          )}

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

/**
 * What fills the pane while a lazily-loaded screen arrives.
 *
 * Deliberately quiet: the chunk is local and resolves in a frame or two, and a
 * spinner that appears and vanishes that fast reads as a flicker rather than as
 * progress. What it must do is hold the pane's shape, so the sidebar beside it
 * does not jump.
 */
function ScreenLoading() {
  return <Box sx={{ flex: 1, minHeight: 0 }} aria-busy="true" />;
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
