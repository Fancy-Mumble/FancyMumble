import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Box, Button, CssBaseline, Dialog, DialogContent, Snackbar, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppStore } from "@core/store";
import { getPreferences, isFirstRun, updatePreferences } from "@core/preferencesStorage";
import {
  getSavedServers,
  getServerPassword,
  markServerJoined,
  removeServer,
  updateServer,
} from "@core/serverStorage";
import { getUserRelations, userRelationIdentity, type UserRelation } from "@core/userRelationsStorage";
import { openDmPopout } from "@core/features/chat/dmPopout";
import { meetingRooms } from "@core/utils/channelVisibility";
import { isE2E } from "@core/utils/e2e";
import { TID } from "@core/testids";
import { PERM_WRITE } from "@core/utils/permissions";
import { applyMentionsToHtml, type MentionResolver } from "@core/utils/mentions";
import { isSpentWatchMarker } from "@core/features/chat/watch/watchMarker";
import type { AudioSettings, ChannelEntry, ChatMessage, SavedServer, ServerSwitcher } from "@core/types";
import ChannelEditorDialog from "@standard/components/sidebar/channel/ChannelEditorDialog";
import DownloadsPanel from "@standard/components/chat/download/DownloadsPanel";
import MySharedFilesTable from "./components/chat/MySharedFilesTable";
import { myFilesAvailable } from "@standard/components/fileserver/fileServerMe";
import TypingIndicator from "./components/chat/TypingIndicator";
import PublicServersSurface from "./components/connect/PublicServersSurface";
import { PinnedPanel } from "./components/chat/pinned/PinnedPanel";
import { useWelcomePin } from "./components/chat/pinned/useWelcomePin";
import { LiveDocDock } from "./components/chat/livedoc/LiveDocDock";
import { useNebulaLiveDoc } from "./components/chat/livedoc/useNebulaLiveDoc";
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
  ChannelPasswordDialog,
  ChatBackdrop,
  ChatHeader,
  Composer,
  ConnectScreen,
  ConnectionOverlays,
  SessionStatus,
  FriendsPanel,
  MemberPanel,
  RichPresencePanel,
  MessageList,
  MessageRow,
  MiniMode,
  MoveUsersDialog,
  NebulaRuntime,
  GlobalSearch,
  ForgetServerDialog,
  LeaveServerDialog,
  PurgeHistoryDialog,
  ProfileCard,
  QuickConnect,
  SearchBox,
  ServerInfoPanel,
  ServerList,
  ServerRail,
  SettingsNav,
  SettingsSearch,
  useSettingsNavContext,
  visibleSettingsPages,
  SidebarShell,
  TitleBar,
  UserInfoDialog,
  UserMenu,
  VoiceDock,
  Stack,
} from "./components";
import type { SettingsPageId, SettingsSearchTarget } from "./components";
import type { SettingsHighlight } from "./components/settings/SettingsScreen";
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
// The live-doc surfaces are Standard's, and heavy: an editor, a ribbon and a
// citation stack that a session which never opens a document should not pay
// for. Only the banner and the launch dialog are reachable without the dock,
// which loads its own panels the same way.
const LiveDocBanner = lazy(() => import("@standard/components/chat/livedoc/LiveDocBanner"));
const LiveDocLaunchDialog = lazy(() => import("@standard/components/chat/livedoc/LiveDocLaunchDialog"));
// The channel's own details, which are a deliberate click rather than
// something the window shows at rest: the description editor and the key
// takeover it carries are of no use to a session that never opens it.
const FirstRunSetup = lazy(() =>
  import("./components/setup/FirstRunSetup").then((m) => ({ default: m.FirstRunSetup })),
);
const ChannelInfoPanel = lazy(() =>
  import("./components/chat/ChannelInfoPanel").then((m) => ({ default: m.ChannelInfoPanel })),
);

import { AddServerDialog } from "./components/connect/AddServerDialog";
import { ScreenShareStrip } from "./components/chat/ScreenShareStrip";
import { MessageMenu, type MessageMenuTarget } from "./components/chat/MessageMenu";
import { WatchDock } from "./components/chat/watch/WatchDock";
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
  orderChannels,
  plainText,
  presenceLabel,
  quickConnectTargets,
  rosterGroups,
  serverRailEntries,
  type ServerRailEntry,
  type GlobalSearchRow,
  type ServerGroup,
} from "./selectors";
import { useRegisteredMembers } from "@core/features/roster/registeredMembers";
import { useAclGroups } from "@ui/standard/hooks/useAclGroups";
import { rolesForUser } from "@core/features/roster/roles";
import { usePublishOwnRoles } from "@core/features/chat/selfMention";
import { dmChannelLabel } from "./friends";
import { useSavedFriends } from "./useFriends";
import { shortcutLabel, useNebulaShortcuts } from "./shortcuts";
import { useChatDisplay } from "./useChatDisplay";
import { useTimeDisplay } from "./useTimeDisplay";
import { useLeaveServer } from "./useLeaveServer";
import { useNebulaEventBridge } from "./useNebulaEventBridge";
import { applyStoredGameOverlaySettings } from "@core/features/overlay/gameOverlay";
import { GameOverlayPrompt } from "./components/overlay/GameOverlayPrompt";
import { useNebulaTheme } from "./useNebulaAppearance";
import { useThemedWindowIcon } from "./useBrandMark";
import { useServerLiveries } from "./useServerLivery";
import { radius } from "./tokens";

/** Nothing unseen: a channel with no new pins, and what "Mark read" leaves. */
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

/**
 * Standard's tab order, restated as rail keys.
 *
 * The tab bar names sessions and the rail names addresses, so translating one
 * into the other needs the live session list to look the ids up in. Sessions
 * that have since gone drop out, which is right: the rail has no tile for
 * them either.
 */
function tabOrderAsAddresses(tabOrder: readonly string[]): string[] {
  const sessions = useAppStore.getState().sessions;
  const keys = tabOrder
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session) => session !== undefined)
    .map((session) => `${session.host}:${session.port}`.toLocaleLowerCase());
  return [...new Set(keys)];
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
  const { t } = useTranslation([
    "nebulaCommon",
    "nebulaChat",
    "nebulaSidebar",
    "nebulaUser",
    "nebulaSettings",
    "settings",
    "sidebar",
    "chat",
    "common",
  ]);
  // A second handle on the catalogue for the pure selectors: they say what
  // they find in `nebulaCommon`, and their `t` is typed to that namespace.
  const { t: tSelectors } = useTranslation("nebulaCommon");
  const status = useAppStore((state) => state.status);
  const sessions = useAppStore((state) => state.sessions);
  const sessionsLoaded = useAppStore((state) => state.sessionsLoaded);
  const sessionUnreadTotals = useAppStore((state) => state.sessionUnreadTotals);
  const activeServerId = useAppStore((state) => state.activeServerId);

  // What each open server says it looks like, keyed by session. Read here once
  // and routed twice, because the two consumers ask about different servers:
  // the window wears the colours of the tab in front of the user, while the
  // connect screen draws whichever server the sidebar has selected - often one
  // that is not open, and so has said nothing at all.
  const liveries = useServerLiveries();
  const theme = useNebulaTheme(liveries[activeServerId ?? ""] ?? null);
  // The taskbar icon is chrome too, and it is the only piece that was a
  // shipped picture rather than a drawing of the theme. Called here rather
  // than in a provider branch below: there are three of them - loading,
  // connect, client - and the window has one icon whichever is showing.
  useThemedWindowIcon(theme);
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
  // What the settings search last sent us to, for the page to light up. The
  // nonce is what makes picking the same result twice flash twice.
  const [settingsHighlight, setSettingsHighlight] = useState<SettingsHighlight | null>(null);
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

  // null until answered: showing the client first and the setup a frame later
  // would flash the connect screen at exactly the user who has never seen it.
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  useEffect(() => {
    // Under e2e automation the suite wants the connect screen, not a wizard.
    if (isE2E()) setFirstRun(false);
    // Fails open: if the preference cannot be read there is no evidence this
    // is a first run, and withholding the whole client over a failed read
    // would be a far worse answer than skipping a wizard.
    else void isFirstRun().then(setFirstRun, () => setFirstRun(false));
  }, []);
  // Text size, density and whether the message actions stay up: three fields
  // of the personalization record the conversation obeys, read once here
  // rather than by every row.
  const chatDisplay = useChatDisplay();
  const timeDisplay = useTimeDisplay();
  const miniCardRef = useMiniWindow(mini);
  const leave = useLeaveServer();

  const [savedServers, setSavedServers] = useState<SavedServer[] | null>(null);
  const [selectedServerKey, setSelectedServerKey] = useState<string | null>(null);
  const [addServerFor, setAddServerFor] = useState<{ host: string; port: number; label: string } | null>(
    null,
  );
  const [addServerOpen, setAddServerOpen] = useState(false);
  /** The saved identity the dialog is open on, when it is editing one. */
  const [editingServer, setEditingServer] = useState<SavedServer | null>(null);
  /** The server whose removal is awaiting confirmation. */
  const [forgetting, setForgetting] = useState<ServerGroup | null>(null);
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
  /** The channel asking for a password, held while the prompt is up. */
  const [passwordChannel, setPasswordChannel] = useState<ChannelEntry | null>(null);
  /** The room being emptied of its occupants, and the one being emptied of its history. */
  const [movingUsersFrom, setMovingUsersFrom] = useState<ChannelEntry | null>(null);
  const [purgingChannel, setPurgingChannel] = useState<ChannelEntry | null>(null);

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

  // Hand the game overlay's detector the stored settings. It stays inert while
  // the mode is "off", which is the default, so a client that never turns the
  // overlay on never starts a detector or creates a window.
  useEffect(() => {
    void applyStoredGameOverlaySettings();
  }, []);

  // With nothing open there is no conversation to show, so the connect screen
  // is the client rather than a detour from it.
  //
  // Only when nothing is open. A session that exists but is not connected is
  // the status surface's case, and sending that one here instead threw away
  // the thing the user most needs - which server ended, and why - by replacing
  // it with a list of servers to pick from.
  useEffect(() => {
    if (status !== "connected" && savedServers !== null && sessions.length === 0) openScreen("connect");
  }, [openScreen, savedServers, sessions.length, status]);

  // And its counterpart, which the event stream cannot supply on its own.
  //
  // The backend outlives the page: a reload - Vite's, or the one a store hot
  // update now forces - boots onto a session that is already connected, so the
  // `server-connected` event that routes to the conversation has long since
  // fired. Without this the client spends the moment before the session list
  // arrives being sent to the connect screen by the effect above, and then
  // stays there, connected, with no way back but a click.
  useEffect(() => {
    if (status === "connected") openScreen("chat");
  }, [openScreen, status]);

  // Auto-connect, once, at launch. Guarded by a ref rather than by `status` so
  // that disconnecting on purpose does not immediately reconnect the user.
  const autoConnected = useRef(false);
  useEffect(() => {
    if (autoConnected.current || savedServers === null || !sessionsLoaded || status === "connected") return;
    autoConnected.current = true;
    // A session the backend already holds is this launch's answer: dialling
    // the auto-connect server on top of it opens a second one under the same
    // identity, which the server resolves by evicting the first.
    if (sessions.length > 0) return;
    void getPreferences()
      .then((preferences) => {
        const target = savedServers.find((server) => server.id === preferences.autoConnectServerId);
        if (target) void connectTo(target);
      })
      .catch(() => undefined);
    // The ref, not the dependency list, is what makes this run once: `status`
    // and `savedServers` both change while the connection is being made.
    // `sessionsLoaded` has to be in it all the same - a backend with nothing
    // open flips it on its own, moving neither of the other two, and the run
    // that finally has an answer would never happen.
  }, [savedServers, sessions.length, sessionsLoaded, status]);

  const activeSession = sessions.find((session) => session.id === activeServerId);
  /**
   * Whether the open session is in no state to show a conversation.
   *
   * Standard gates its whole chat page on exactly this and Aurora returns a
   * status screen; Nebula had only the effect above nudging `screen` towards
   * "connect", which anything that later opened the chat screen undid. The
   * result was the connected chrome drawn around a session that had ended -
   * an empty channel list, a voice dock for a finished call, a composer that
   * could not send - and no word of what had happened. `bootstrapStage` is in
   * here for the same reason it is in Standard's: the backend reports
   * `connected` before `ServerSync` lands, and the window in between looks
   * exactly like the broken state it is not.
   */
  const sessionNotReady = (status !== "connected" || bootstrapStage !== null) && sessions.length > 0;
  const canAdminister = ((channels.find((channel) => channel.id === 0)?.permissions ?? 0) & PERM_WRITE) !== 0;
  const activeChannel = channels.find((channel) => channel.id === selectedChannel) ?? null;
  const joinedChannel = channels.find((channel) => channel.id === currentChannel) ?? null;
  const activeDmUser = users.find((user) => user.session === selectedDmUser) ?? null;
  const ownUser = users.find((user) => user.session === ownSession) ?? null;

  /**
   * Entering a channel, asking for its password first where it wants one.
   *
   * Every way into a room goes through here rather than calling the store
   * directly, because a restricted channel refuses the plain join silently:
   * the request is simply not honoured and the tree does not move, which reads
   * as the client having ignored the click.
   *
   * A hidden room is the exception. Private rooms and meeting rooms deny entry
   * to everyone and grant it to their invitees by id, so an invited user has
   * no password to give - and older servers mark those `is_enter_restricted`
   * all the same. Prompting them would demand a secret that does not exist.
   */
  const enterChannel = useCallback(
    (id: number) => {
      const channel = channels.find((entry) => entry.id === id);
      if (channel?.is_enter_restricted && !channel.hidden) {
        setPasswordChannel(channel);
        return;
      }
      void useAppStore.getState().joinChannel(id);
    },
    [channels],
  );

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

  /**
   * The rooms the tree above leaves out.
   *
   * Detached channels have no parent to hang from, so `orderChannels` drops
   * them - which used to mean a meeting link put you in a room the sidebar had
   * no line for. They get a flat section of their own instead. Friend chats
   * are detached too and are not rooms, which is what `meetingRooms` excludes.
   */
  const privateRooms = useMemo(() => {
    const rooms = meetingRooms([...channels]);
    const needle = search.channelQuery.trim().toLocaleLowerCase();
    return needle ? rooms.filter((room) => room.name.toLocaleLowerCase().includes(needle)) : rooms;
  }, [channels, search.channelQuery]);

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
    onJumpToRootChannel: () => enterChannel(0),
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

  /**
   * Which watch sessions exist, as a set that only changes when one starts
   * or ends.
   *
   * Selected as a joined key rather than the map itself: the map is replaced
   * on every sync heartbeat, and subscribing this component to that would
   * re-render the whole client every couple of seconds through a film.
   */
  const liveWatchKey = useAppStore((state) => [...state.watchSessions.keys()].sort().join(","));
  const liveWatchIds = useMemo(() => new Set(liveWatchKey ? liveWatchKey.split(",") : []), [liveWatchKey]);

  const visibleMessages = useMemo(() => {
    // A marker for a session that has ended is not a message - its whole
    // content was the session - so it goes, rather than sitting in the
    // history as an empty bubble with a timestamp on it.
    const isLive = (sessionId: string) => liveWatchIds.has(sessionId);
    const carrying = conversationMessages.filter((message) => !isSpentWatchMarker(message.body, isLive));
    const needle = search.chatQuery.trim().toLocaleLowerCase();
    if (!needle) return carrying;
    return carrying.filter((message) => plainText(message.body).toLocaleLowerCase().includes(needle));
  }, [conversationMessages, search.chatQuery, liveWatchIds]);

  // The sidebar chooses a server; the connect screen chooses which of that
  // server's identities to arrive as.
  // How the connect screen's "join as" rows are arranged, by saved-server id,
  // loaded with the rail's order below and written back on every drop.
  const [identityOrder, setIdentityOrder] = useState<readonly string[]>([]);
  const serverGroups = useMemo(
    () => groupSavedServers(savedServers, sessions, identityOrder),
    [savedServers, sessions, identityOrder],
  );
  // The rail order is the user arrangement, loaded once and written back on
  // every drop so a restart finds the tiles where they were left.
  const [railOrder, setRailOrder] = useState<readonly string[]>([]);
  const [serverSwitcher, setServerSwitcher] = useState<ServerSwitcher>("rail");
  useEffect(() => {
    let live = true;
    const load = () => {
      void getPreferences()
        .then((preferences) => {
          if (!live) return;
          // A user who has only ever arranged Standard's tabs has no rail
          // record, but their arrangement is on file keyed by session, so the
          // rail can open in it rather than alphabetically. Only as far as the
          // sessions loaded so far reach - this runs again as the preferences
          // change, and the first drag writes both records for good.
          const stored = preferences.serverRailOrder ?? [];
          setRailOrder(stored.length > 0 ? stored : tabOrderAsAddresses(preferences.serverTabOrder ?? []));
          setIdentityOrder(preferences.serverIdentityOrder ?? []);
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

  /**
   * Arranging the rail arranges the tabs too.
   *
   * The two designs ask the same question and have to keep two answers: the
   * rail is keyed on the address, because a saved server nobody is connected
   * to still has a tile, and the tab bar is keyed on the session id, because a
   * tab only exists while there is one. Writing only the rail's record left
   * Standard's tabs in whatever order they were last dragged into, so the
   * order is projected onto the live sessions and written to both.
   */
  const reorderRail = useCallback(
    (keys: readonly string[]) => {
      setRailOrder(keys);
      const rank = new Map(keys.map((key, index) => [key, index]));
      const rankOf = (session: (typeof sessions)[number]) =>
        rank.get(`${session.host}:${session.port}`.toLocaleLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const tabOrder = [...sessions].sort((left, right) => rankOf(left) - rankOf(right)).map((s) => s.id);
      void updatePreferences({ serverRailOrder: [...keys], serverTabOrder: tabOrder });
    },
    [sessions],
  );

  /**
   * Remember the order one server's identities were dragged into.
   *
   * The record is one flat list for every server, so the ids just moved are
   * lifted out of it and appended in their new order: ranks are only ever
   * compared inside a group, and what other servers put between two of these
   * ids cannot change how they sit against each other.
   */
  const reorderIdentitiesFor = useCallback(
    (ids: readonly string[]) => {
      const moved = new Set(ids);
      const next = [...identityOrder.filter((id) => !moved.has(id)), ...ids];
      setIdentityOrder(next);
      void updatePreferences({ serverIdentityOrder: next });
    },
    [identityOrder],
  );

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
   * switcher in the title bar alone there is no rail to open, and the sidebar
   * below stays; with both surfaces on, the rail is there and pins as usual.
   */
  const serverListPinned = screen === "connect" && serverSwitcher !== "titlebar";
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

  /**
   * What to call the server you are on, for the title bar.
   *
   * The same precedence the connect card and the rail tile use - the operator's
   * chosen name first, then the name saved for the address, then the address
   * itself - so the window agrees with every other place the server is named.
   * `session.label` is deliberately absent from it: it reads "you@host:port",
   * which names the *login*, and the title bar is naming the place.
   */
  /**
   * Every waiting direct message, summed.
   *
   * One number, because Friends is one destination wherever it is drawn - the
   * title bar or the rail. Which conversation it came from is the Friends
   * screen's own business.
   */
  const friendsUnread = useMemo(
    () => Object.values(dmUnreadCounts).reduce((total, count) => total + count, 0),
    [dmUnreadCounts],
  );

  const activeServerName = useMemo(() => {
    if (status !== "connected" || !activeServerId) return undefined;
    const group = railEntries.find((entry) => entry.session?.id === activeServerId)?.group;
    return liveries[activeServerId]?.displayName || group?.label || activeSession?.host;
  }, [activeServerId, activeSession?.host, liveries, railEntries, status]);

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

  const forgetServer = useCallback(
    (group: ServerGroup) => {
      setForgetting(null);
      // The screen it was selected on has nothing to show once the record is
      // gone, unless a session is still holding it open.
      setSelectedServerKey((current) => (current === group.key && !group.sessionId ? null : current));
      void Promise.all(group.identities.map((identity) => removeServer(identity.id)))
        .catch((reason) => console.error("Nebula forget server failed:", reason))
        .then(reloadServers);
    },
    [reloadServers],
  );

  // The registration table is only asked for while the panel is open with
  // offline people switched on: on a server with thousands registered it is
  // not a small answer.
  const wantsOffline = memberPanel.open && memberPanel.showOffline;
  const registeredMembers = useRegisteredMembers(wantsOffline);
  // The roster files people under the server's roles, which live on the root
  // channel's ACL. Reading it needs Write there, so on an ordinary account it
  // comes back empty and the list falls back to one "Members" group.
  const roles = useAclGroups();

  // The same ACL answers "am I in the group this message mentioned?". Kept off
  // `users` so the set holds its identity through talking-state churn: it is a
  // memo dependency in every row.
  const ownUserId = useMemo(
    () => users.find((user) => user.session === ownSession)?.user_id ?? null,
    [users, ownSession],
  );
  const ownRoles = useMemo(() => rolesForUser(roles, ownUserId), [roles, ownUserId]);
  usePublishOwnRoles(ownRoles);

  // Alphabetical within each group. Sorting talkers to the top made the panel
  // jump on every push-to-talk tap; the talking bars mark the speaker in place.
  const roster = useMemo(
    () =>
      rosterGroups({
        users,
        registered: registeredMembers.offlineEntries,
        roles,
        channels,
        query: memberPanel.query,
        selectedChannel,
        showOffline: memberPanel.showOffline,
      }),
    [
      channels,
      memberPanel.query,
      memberPanel.showOffline,
      registeredMembers.offlineEntries,
      roles,
      selectedChannel,
      users,
    ],
  );

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
   * What has arrived in the two panels behind the kebab since they were last
   * opened.
   *
   * Both are a click further in than anything on the header, so without a mark
   * on the menu the only way to find out a pin arrived - or that the download
   * you started has landed - is to go and look. The store already keeps both
   * tallies for Standard; nothing here reset them, so the pinned panel was
   * also being handed an empty set and drawing every pin as already seen.
   */
  const unseenPinIds = useAppStore((state) => state.unseenPinIds);
  const clearUnseenPins = useAppStore((state) => state.clearUnseenPins);
  const unseenDownloadCount = useAppStore((state) => state.unseenDownloadCount);
  const markDownloadsSeen = useAppStore((state) => state.markDownloadsSeen);
  const unseenPins = (selectedChannel === null ? undefined : unseenPinIds.get(selectedChannel)) ?? EMPTY_IDS;

  /**
   * Which pins were new at the moment the panel was opened.
   *
   * Opening it is what marks them read, so the live set is empty by the time
   * the panel renders - reading it there would mark nothing. The snapshot is
   * what the panel highlights, so the badge clears and the rows it was about
   * still say which ones they were.
   */
  const [pinsNewOnOpen, setPinsNewOnOpen] = useState<ReadonlySet<string>>(EMPTY_IDS);
  // The server's greeting, shown at the top of the pinned list: it is the one
  // message written to be read again, and it used to vanish with its modal.
  const welcomePin = useWelcomePin();
  const openPinned = useCallback(() => {
    setPinsNewOnOpen(unseenPins);
    if (selectedChannel !== null) clearUnseenPins(selectedChannel);
    setSurface("pinned");
  }, [unseenPins, selectedChannel, clearUnseenPins, setSurface]);
  const openDownloads = useCallback(() => {
    markDownloadsSeen();
    setSurface("downloads");
  }, [markDownloadsSeen, setSurface]);

  /**
   * The friend a `__dm:` channel is with, when the open conversation is one.
   *
   * A friend chat starts as a direct message and becomes a channel: the plugin
   * provisions the pair's persisted, encrypted room and the store selects it,
   * clearing `selectedDmUser`. From then on the conversation is a channel whose
   * *name* is the two user ids in it, so the header has to be told who that is
   * or it would announce `__dm:3-7`. Non-null is also what marks the pane as a
   * one-to-one chat: a friend room has no roster to open and no voice to join.
   */
  const savedFriends = useSavedFriends();
  const friendChatName = useMemo(
    () =>
      activeChannel === null
        ? null
        : dmChannelLabel(activeChannel, {
            users,
            friends: savedFriends,
            ownUserId: ownUser?.user_id ?? null,
          }),
    [activeChannel, ownUser?.user_id, savedFriends, users],
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
  // The listener's own report, not the preference: the switch can be on while
  // Discord holds the socket, and the entry should follow what is actually
  // running rather than what was asked for.
  const richPresenceOn = useAppStore((state) => state.richPresenceStatus.enabled);
  const fileServerKind = useAppStore((state) => state.fileServerKind);
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
            kind === "media"
              ? [{ name: t("nebulaChat:composer.photoOrVideo"), extensions: [...MEDIA_EXTENSIONS] }]
              : undefined,
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
   * Live Docs for the open conversation.
   *
   * The notice channel is the drop notice's: both are a sentence about
   * something the pane just refused to do, and one snackbar saying it is
   * enough.
   */
  const liveDoc = useNebulaLiveDoc({
    channelId: selectedChannel,
    isDm: activeDmUser !== null,
    onNotice: setDropNotice,
  });
  // A document is published to a channel, so a direct message has nowhere to
  // put one - and a server without the plugin has nothing to put it in.
  const canOpenLiveDoc = liveDoc.available && selectedChannel !== null && activeDmUser === null;

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
              setDropNotice(t("nebulaCommon:app.localFilesOnly"));
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

    // Files that were staged go up now, and the batch becomes one message
    // carrying a marker each - what was staged together arrives together, and
    // the row draws it as one gallery rather than as a column of separate
    // pictures. What was typed is that message's words. Every file in the
    // batch shares the one visibility chosen on the tray; quality is per file,
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
      await uploads.upload(
        staged.map((file) => {
          const compressed = options.quality === "compressed" ? file.compressed : null;
          const wantsCompressed = compressed && compressed !== "pending" ? compressed : null;
          return {
            filePath: wantsCompressed?.filePath ?? file.filePath,
            filename: file.filename,
            sizeBytes: wantsCompressed?.sizeBytes ?? file.sizeBytes,
            previewUrl: file.previewUrl,
          };
        }),
        { ...choice, message: body },
      );
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

  // Setup comes before the client, not beside it: every screen behind this one
  // assumes a chosen name and a decided mode.
  if (firstRun !== false)
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ height: "100vh", width: "100vw", overflow: "hidden", background: "transparent" }}>
          <Suspense fallback={null}>
            {firstRun === true && <FirstRunSetup onComplete={() => setFirstRun(false)} />}
          </Suspense>
        </Box>
      </ThemeProvider>
    );

  if (mini && joinedChannel)
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <MiniMode
          serverLabel={activeSession?.label ?? t("nebulaUser:card.presenceConnected")}
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
        <UserMenu
          target={userMenu.target}
          onClose={userMenu.close}
          onInfo={userInfo.open}
          onJoinChannel={enterChannel}
        />
        <UserInfoDialog session={userInfo.session} onClose={userInfo.close} />
        {/* Following someone into a restricted room has to be answerable from
            here too, or the entry on their menu would do nothing at all in
            this window. */}
        <ChannelPasswordDialog
          channel={passwordChannel}
          onConfirm={(password) => {
            const channel = passwordChannel;
            setPasswordChannel(null);
            if (channel)
              void useAppStore
                .getState()
                .joinChannelWithPassword(channel.id, password)
                .catch(() => {});
          }}
          onCancel={() => setPasswordChannel(null)}
        />
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
            // Themes that cut their corners into a HUD outline say so here; the
            // rest leave it `none` and the radius above is the whole shape.
            clipPath: "var(--nebula-clip-window, none)",
            border: `1px solid ${muiTheme.palette.nebula.line2}`,
            // The window's own mesh, over the window colour. Most skins paint a
            // gradient here; the flat ones resolve to a gradient of one colour
            // so this layer stack stays valid either way.
            background: `${muiTheme.palette.nebula.window},${muiTheme.palette.nebula.bg0}`,
            color: muiTheme.palette.nebula.text,
            fontSize: 13,
          })}
        >
          <TitleBar
            serverLabel={activeServerName}
            friendsActive={screen === "messages"}
            onOpenFriends={() => openScreen("messages")}
            friendsUnread={friendsUnread}
            /* The rail's own add-server button is the one that stays; up here
               it would be a second plus in the same window. */
            onQuickConnect={serverSwitcher === "titlebar" ? setQuickConnectAnchor : undefined}
            quickConnectOpen={quickConnectAnchor !== null}
            onDisconnect={status === "connected" ? () => leave.request(activeSession) : undefined}
            entries={railEntries}
            icons={railIcons}
            activeKey={selectedGroup?.key ?? null}
            onSelectServer={openServer}
            tabs={serverSwitcher !== "rail"}
          />

          <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
            {serverSwitcher !== "titlebar" && (
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
                      placeholder={t("nebulaCommon:app.searchServers")}
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
                onLeaveServer={(entry) =>
                  leave.request(sessions.find((session) => session.id === entry.session?.id))
                }
                onEditServer={(identity) => {
                  setEditingServer(identity);
                  setAddServerOpen(true);
                }}
                onForgetServer={setForgetting}
                /* Only when the strip is off: with tabs up top, Friends is up
                   there beside them. */
                friends={
                  serverSwitcher === "rail"
                    ? {
                        active: screen === "messages",
                        unread: friendsUnread,
                        onOpen: () => openScreen("messages"),
                      }
                    : undefined
                }
                onReorder={reorderRail}
              />
            )}
            {screen === "chat" && channelSidebarOpen && !sessionNotReady && (
              <SidebarShell
                search={
                  <SearchBox
                    value={search.channelQuery}
                    onChange={search.setChannelQuery}
                    placeholder={t("nebulaCommon:app.searchChannels")}
                    hint={shortcutLabel(shortcuts.openQuickSearch)}
                    inputRef={channelSearchRef}
                  />
                }
                footer={
                  <VoiceDock
                    name={ownUser?.name ?? activeSession?.username ?? t("nebulaChat:share.you")}
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
                    serverName={activeServerName}
                    onLeaveServer={status === "connected" ? () => leave.request(activeSession) : undefined}
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
                  privateRooms={privateRooms}
                  users={users}
                  selectedChannel={selectedChannel}
                  currentChannel={currentChannel}
                  talkingSessions={talkingSessions}
                  unreadCounts={unreadCounts}
                  ownSession={ownSession}
                  onSelect={(channel) => void useAppStore.getState().selectChannel(channel.id)}
                  onJoin={(channel) => enterChannel(channel.id)}
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
              <FriendsPanel
                query={search.channelQuery}
                onQueryChange={search.setChannelQuery}
                searchRef={channelSearchRef}
                onContextMenuUser={openUserMenuFor}
                onHoverUser={hovered.hover}
                onLeaveUser={hovered.clear}
              />
            )}

            {/* Only where the rail is not drawing this list itself. With the
                rail on, the connect screen's column *is* the open rail. */}
            {screen === "connect" && !serverListPinned && (
              <SidebarShell
                title={t("nebulaSidebar:servers.title")}
                action={{
                  label: t("nebulaCommon:app.addServer"),
                  testId: TID.addServer,
                  onClick: () => {
                    setAddServerFor(null);
                    setAddServerOpen(true);
                  },
                }}
                search={
                  <SearchBox
                    value={search.channelQuery}
                    onChange={search.setChannelQuery}
                    placeholder={t("nebulaCommon:app.searchServers")}
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
              <SidebarShell
                back={{
                  label: t("nebulaCommon:app.back"),
                  testId: TID.adminBack,
                  onClick: () => openScreen("chat"),
                }}
                search={
                  <SettingsSearch
                    pages={visibleSettingsPages(settingsNavContext).map((entry) => ({
                      id: entry.id,
                      label: t(entry.labelKey),
                    }))}
                    onSelect={(target: SettingsSearchTarget) => {
                      setAdminPage(null);
                      setSettingsPage(target.page);
                      setSettingsHighlight((current) => ({
                        term: target.term,
                        titles: target.titles,
                        nonce: (current?.nonce ?? 0) + 1,
                      }));
                    }}
                  />
                }
              >
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
                    setSettingsHighlight(null);
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
                      highlight={settingsHighlight}
                      onEditIdentityProfile={() => setSettingsPage("profile")}
                      onNavigate={setSettingsPage}
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
                  onEditIdentity={(identity) => {
                    setEditingServer(identity);
                    setAddServerOpen(true);
                  }}
                  onReorderIdentities={reorderIdentitiesFor}
                />
              ) : sessionNotReady ? (
                <SessionStatus onOpenServers={() => openScreen("connect")} />
              ) : (
                <>
                  <ChatHeader
                    title={
                      activeDmUser?.name ??
                      friendChatName ??
                      activeChannel?.name ??
                      t("nebulaCommon:app.chooseConversation")
                    }
                    subtitle={
                      activeDmUser || friendChatName
                        ? t("nebulaCommon:app.directMessage")
                        : presence
                          ? presenceLabel(tSelectors, presence)
                          : t("nebulaCommon:app.pickChannel")
                    }
                    memberCount={activeDmUser || friendChatName ? undefined : presence?.members}
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
                    /* A friend room is peeked rather than joined - moving into
                       it would take the user out of the channel they are
                       actually in - so it is never offered as voice. */
                    canJoinVoice={
                      !!activeChannel && friendChatName === null && activeChannel.id !== currentChannel
                    }
                    onJoinVoice={() => activeChannel && enterChannel(activeChannel.id)}
                    onToggleSearch={() => search.setChatOpen(!search.chatOpen)}
                    onShowMembers={() => memberPanel.setOpen(true)}
                    onShareScreen={() => setSurface("screen-share")}
                    onShowPinned={openPinned}
                    pinnedOpen={surface === "pinned"}
                    onShowInfo={() => setSurface("server-info")}
                    /* A direct message can be sent to its own always-on-top
                       window. Offered only for a real DM: a friend room is a
                       channel, and the popout page reconstructs a conversation
                       from one person, not from a room. */
                    /* Only where there is a file server to have uploaded
                       to. Gated on the server's config rather than on the
                       upload permission: files shared before the permission
                       was taken away are still yours to delete. */
                    onShowMyFiles={
                      myFilesAvailable(fileServerKind, fileServerConfig)
                        ? () => setSurface("my-files")
                        : undefined
                    }
                    /* Hidden while the listener is off: the entry would open a
                       panel whose only content is "presence is off", and the
                       switch that fixes it is in Settings, not here. */
                    onShowPresence={richPresenceOn ? () => setSurface("presence") : undefined}
                    onPopOutDm={
                      activeDmUser
                        ? () =>
                            void openDmPopout(
                              {
                                session: activeDmUser.session,
                                name: activeDmUser.name,
                                hash: activeDmUser.hash ?? null,
                              },
                              sessions.find((session) => session.id === activeSession?.id) ?? null,
                            )
                        : undefined
                    }
                    onShowDownloads={openDownloads}
                    /* A direct message is not a channel, so it has nothing to
                       describe - and `activeChannel` would be whatever room
                       the reader is standing in rather than the conversation
                       on screen. */
                    onShowChannelInfo={
                      activeDmUser || !activeChannel ? undefined : () => setSurface("channel-info")
                    }
                    hasNewPins={unseenPins.size > 0}
                    hasNewDownloads={unseenDownloadCount > 0}
                    onShowDocs={liveDoc.available ? liveDoc.openLibrary : undefined}
                  />

                  {/* Hung from the header's pin rather than filed beside the
                      roster: the pins are read at a glance and put away, and a
                      column would narrow the conversation they point into. */}
                  {surface === "pinned" && (
                    <PinnedPanel
                      messages={visibleMessages}
                      welcome={welcomePin}
                      unseenIds={pinsNewOnOpen}
                      time={timeDisplay}
                      onClose={() => setSurface(null)}
                      onJump={(messageId) => {
                        jumpToMessage(messageId);
                        setSurface(null);
                      }}
                      onMarkRead={() => setPinsNewOnOpen(EMPTY_IDS)}
                      onUnpin={(message) =>
                        message.message_id &&
                        void useAppStore.getState().pinMessage(message.channel_id, message.message_id, true)
                      }
                    />
                  )}

                  <ScreenShareStrip
                    pickerRequested={surface === "screen-share"}
                    cameraRequested={surface === "camera-share"}
                    onPickerClosed={() => setSurface(null)}
                  />

                  {/* Someone else's document, offered before it is joined. It
                      sits where the document would open rather than with the
                      channel's banners, because that is what it is about. */}
                  {liveDoc.announce && !liveDoc.session && (
                    <Suspense fallback={null}>
                      <LiveDocBanner
                        announce={liveDoc.announce}
                        onJoin={() => void liveDoc.joinAnnounced()}
                      />
                    </Suspense>
                  )}

                  <LiveDocDock doc={liveDoc} onCreateDoc={canOpenLiveDoc ? liveDoc.openLaunch : undefined} />

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
                        placeholder={t("nebulaCommon:app.searchConversation")}
                      />
                    </Box>
                  )}

                  {/* The conversation, put away while a document has the pane.
                      Kept mounted rather than dropped: the scroll position, the
                      draft in the composer and the staged attachments are each
                      worth more than the render, and unmounting loses all three. */}
                  <Stack
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      display: liveDoc.hidesChat ? "none" : "flex",
                    }}
                  >
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
                              ? t("nebulaCommon:app.startWith", { name: activeDmUser.name })
                              : activeChannel
                                ? t("nebulaCommon:app.startOfChannel", { channel: activeChannel.name })
                                : t("nebulaCommon:app.nothingSelected")}
                          </Typography>
                          <Typography
                            sx={(muiTheme) => ({ fontSize: 12, color: muiTheme.palette.nebula.muted })}
                          >
                            {t("nebulaCommon:app.emptyHint")}
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
                        display={chatDisplay}
                        currentScope={currentScope}
                        renderMessage={(message, avatar, grouped, restoring, endsGroup) => (
                          <MessageRow
                            message={message}
                            avatar={avatar}
                            grouped={grouped}
                            endsGroup={endsGroup}
                            restoring={restoring}
                            compact={chatDisplay.compact}
                            bubbleStyle={chatDisplay.bubbleStyle}
                            alwaysShowActions={chatDisplay.alwaysShowActions}
                            onOpenProfile={openProfile}
                            onHoverProfile={hovered.hover}
                            onLeaveProfile={hovered.clear}
                            onContextMenuProfile={openUserMenuFor}
                            onVote={handlePollVote}
                            onOpenImage={(src) => lightboxRef.current?.open(src)}
                            time={timeDisplay}
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
                        <Typography sx={{ fontSize: 12 }}>
                          {t("chat:selection.count", { count: selection.selected.size })}
                        </Typography>
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
                          {t("sidebar:userMenu.deleteConfirm")}
                        </Button>
                        <Button size="small" onClick={selection.clear}>
                          {t("common:actions.cancel")}
                        </Button>
                      </Stack>
                    )}

                    {selectedChannel !== null && !activeDmUser && (
                      <Box sx={{ px: "34px" }}>
                        <TypingIndicator channelId={selectedChannel} />
                      </Box>
                    )}

                    {/* The river above reserves a scrollbar's width; the
                        composer has no scrollbar of its own, so it borrows the
                        same reservation and the two columns line up. */}
                    <Box sx={{ paddingRight: "var(--nebula-chat-gutter, 0px)" }}>
                      <Composer
                        target={
                          activeDmUser ? `@${activeDmUser.name}` : `#${activeChannel?.name ?? "channel"}`
                        }
                        disabled={(!activeChannel && !activeDmUser) || persistent.sendBlocked}
                        onSend={send}
                        onAttach={canAttach ? (kind) => void pickAttachment(kind) : undefined}
                        onAttachFiles={canAttach ? stagePastedFiles : undefined}
                        attachBlocked={
                          activeChannel || activeDmUser
                            ? fileServerConfig
                              ? fileServerConfig.canShareFiles
                                ? null
                                : t("nebulaCommon:app.noFileSharingAllowed")
                              : t("nebulaCommon:app.noFileSharing")
                            : t("nebulaCommon:app.pickConversationFirst")
                        }
                        onCreatePoll={
                          selectedChannel !== null && !activeDmUser
                            ? (question, options, multiple) =>
                                void handlePollCreate(question, options, multiple)
                            : undefined
                        }
                        onOpenLiveDoc={canOpenLiveDoc ? liveDoc.openLaunch : undefined}
                        canSharePublic={fileServerConfig?.canShareFilesPublic ?? false}
                        canExpire={fileServerConfig?.deleteOnTtl ?? false}
                        shareOptions={shareOptions}
                        onShareOptionsChange={setShareOptions}
                        quotes={pendingQuotes}
                        onRemoveQuote={(id) =>
                          setPendingQuotes((prev) => prev.filter((quote) => quote.message_id !== id))
                        }
                        attachments={staged}
                        onRemoveAttachment={(id) =>
                          setStaged((prev) => prev.filter((file) => file.id !== id))
                        }
                        uploads={uploads.placeholders}
                        onCancelUpload={uploads.cancel}
                        dropActive={canAttach && dragOverWindow}
                      />
                    </Box>
                  </Stack>
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
                groups={roster}
                query={memberPanel.query}
                onQueryChange={memberPanel.setQuery}
                showOffline={memberPanel.showOffline}
                onShowOfflineChange={memberPanel.setShowOffline}
                offlineLoading={registeredMembers.loading}
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

            {surface === "channel-info" && selectedChannel !== null && (
              /* No fallback: the sheet opens over the shell rather than beside
                 it, so a chunk still resolving costs a frame of nothing rather
                 than a slot the conversation would widen into and back out of. */
              <Suspense fallback={null}>
                <ChannelInfoPanel channelId={selectedChannel} onClose={() => setSurface(null)} />
              </Suspense>
            )}
          </Stack>

          {surface === "public-servers" && (
            <FullSurface onClose={() => setSurface(null)}>
              <PublicServersSurface
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
          {surface === "presence" && (
            <Dialog open onClose={() => setSurface(null)} maxWidth="sm" fullWidth>
              <DialogContent>
                <RichPresencePanel />
              </DialogContent>
            </Dialog>
          )}
          {surface === "downloads" && (
            <Dialog open onClose={() => setSurface(null)} maxWidth="sm" fullWidth>
              <DialogContent>
                <DownloadsPanel />
              </DialogContent>
            </Dialog>
          )}

          {/* The table is the dialog: no content padding and no card of its
              own, so it runs to the paper's edge and the paper's radius does
              the cornering. `lg`, not `md` - nine columns of file facts in a
              900px paper left the name column too narrow to read. */}
          {surface === "my-files" && (
            <Dialog open onClose={() => setSurface(null)} maxWidth="lg" fullWidth>
              <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <MySharedFilesTable />
              </DialogContent>
            </Dialog>
          )}

          {/* Naming a new document, or picking one to reopen. Standard's
              dialog: the choice it collects - title, visibility, a seed - is
              the same question whichever pack asks it. */}
          {liveDoc.launchOpen && (
            <Suspense fallback={null}>
              <LiveDocLaunchDialog
                open={liveDoc.launchOpen}
                onSubmit={(choice) => void liveDoc.submitLaunch(choice)}
                onCancel={liveDoc.closeLaunch}
              />
            </Suspense>
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
            time={timeDisplay}
            onClose={() => setSwitcherOpen(false)}
            onSelect={openSearchRow}
          />

          <AddServerDialog
            open={addServerOpen}
            preset={editingServer ? null : addServerFor}
            editing={editingServer}
            onClose={() => {
              setAddServerOpen(false);
              setEditingServer(null);
            }}
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
            onJoinChannel={enterChannel}
          />
          <UserInfoDialog session={userInfo.session} onClose={userInfo.close} />

          <ChannelMenu
            target={channelMenu}
            listening={!!channelMenu && listenedChannels.has(channelMenu.channel.id)}
            notificationsMuted={!!channelMenu && mutedPushChannels.has(channelMenu.channel.id)}
            occupantCount={channelMenu ? channelOccupants(users, channelMenu.channel.id).length : 0}
            hideEmpty={hideEmpty}
            onToggleHideEmpty={toggleHideEmpty}
            onJoin={(channel) => enterChannel(channel.id)}
            /* The panel describes whatever is selected, so a channel asked
               about from the tree is selected first - otherwise the menu would
               open a panel about a different room. */
            onShowInfo={(channel) => {
              void useAppStore.getState().selectChannel(channel.id);
              setSurface("channel-info");
            }}
            onEdit={(channel) => setChannelDialog({ mode: "edit", channel })}
            onCreate={(parent, tempOnly) =>
              setChannelDialog({ mode: "create", parentId: parent.id, tempOnly })
            }
            onMoveAllUsers={setMovingUsersFrom}
            onPurgeHistory={setPurgingChannel}
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
                {t("nebulaCommon:app.deleteChannelTitle", { channel: deletingChannel?.name })}
              </Typography>
              <Typography sx={(muiTheme) => ({ fontSize: 12, color: muiTheme.palette.nebula.muted })}>
                {t("nebulaCommon:app.deleteChannelBody")}
              </Typography>
              <Stack direction="row" gap={1} sx={{ justifyContent: "flex-end", mt: 2 }}>
                <Button onClick={() => setDeletingChannel(null)}>{t("common:actions.cancel")}</Button>
                <Button
                  variant="contained"
                  color="error"
                  onClick={() => {
                    const id = deletingChannel?.id;
                    setDeletingChannel(null);
                    if (id != null) void useAppStore.getState().deleteChannel(id);
                  }}
                >
                  {t("sidebar:userMenu.deleteConfirm")}
                </Button>
              </Stack>
            </DialogContent>
          </Dialog>

          {/* The three things done to a channel from outside it. Each holds
              its own copy of the subject, because the menu that raised it has
              closed by the time it is on screen. */}
          <ChannelPasswordDialog
            channel={passwordChannel}
            onConfirm={(password) => {
              const channel = passwordChannel;
              setPasswordChannel(null);
              if (!channel) return;
              void useAppStore
                .getState()
                .joinChannelWithPassword(channel.id, password)
                // The join is what may be refused; selecting the channel is
                // reading it, which a wrong password does not stop.
                .catch(() => {})
                .finally(() => void useAppStore.getState().selectChannel(channel.id));
            }}
            onCancel={() => setPasswordChannel(null)}
          />

          <MoveUsersDialog
            source={movingUsersFrom}
            channels={channels}
            onConfirm={(targetId) => {
              const from = movingUsersFrom?.id;
              setMovingUsersFrom(null);
              if (from != null) void useAppStore.getState().moveChannelUsers(from, targetId);
            }}
            onCancel={() => setMovingUsersFrom(null)}
          />

          <PurgeHistoryDialog
            channel={purgingChannel}
            onConfirm={() => {
              const id = purgingChannel?.id;
              setPurgingChannel(null);
              // Everything up to now, which is what "purge" means here: the
              // server deletes by time range, and an open range would race
              // whatever arrives while the request is in flight.
              if (id != null) void useAppStore.getState().deletePchatMessages(id, { timeTo: Date.now() });
            }}
            onCancel={() => setPurgingChannel(null)}
          />

          <LeaveServerDialog
            session={leave.pending}
            leaving={leave.leaving}
            neverAsk={leave.neverAsk}
            onNeverAskChange={leave.setNeverAsk}
            onConfirm={() => void leave.confirm()}
            onCancel={leave.cancel}
          />

          <ForgetServerDialog
            group={forgetting}
            onConfirm={() => forgetting && forgetServer(forgetting)}
            onCancel={() => setForgetting(null)}
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

          {/* Both players hang off the window frame rather than the message
              pane: the theater covers the window in the design, and the
              mini's offset is measured from the same edges. */}
          <WatchDock />

          <MessageMenu
            target={messageMenu}
            onClose={() => setMessageMenu(null)}
            onQuickReact={react}
            onReact={(target, at) => setReactionTarget({ message: target, ...at })}
            onQuote={quoteMessage}
            onEdit={(target) => setEditingMessageId(target.message_id ?? null)}
            onSelect={selection.begin}
            allMessageIds={conversationMessageIds}
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
        {/* Asked at most once per program, and only for something that looks
            like a game without being certain. */}
        <GameOverlayPrompt />
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
