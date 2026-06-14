import { BellIcon, BellOffIcon, ChevronRightIcon, CloseIcon, DatabaseIcon, EditIcon, HeadphonesIcon, HeadphonesOffIcon, InfoIcon, ListenBadgeIcon, LogoutIcon, MenuIcon, MicIcon, MicOffIcon, MicOffSmallIcon, PhoneIcon, PhoneOffIcon, PlusIcon, RecordIcon, SearchIcon, SettingsIcon, ShieldIcon, TrashIcon, UsersGroupIcon } from "../../../icons";
import { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { listen } from "@tauri-apps/api/event";
import type { ChannelEntry, UserEntry, SidebarSections } from "../../../types";
import { getPreferences, updatePreferences } from "../../../preferencesStorage";
const SidebarSearchView = lazy(() => import("../SidebarSearchView").then((m) => ({ default: m.SidebarSearchView })));
import { UserListItem, RoleColorsContext, RoleGroupsContext, buildRoleColorMap, buildRoleGroupsMap } from "../user/UserListItem";
import { useAclGroups } from "../../../hooks/useAclGroups";
import { UserContextMenu } from "../user/UserContextMenu";
import type { UserContextMenuState } from "../user/UserContextMenu";
import ChannelEditorDialog, { canEditChannel, canCreateChannel, canOnlyCreateTemp, canDeleteChannel, canDeleteMessages } from "./ChannelEditorDialog";
import ConfirmDialog from "../../elements/ConfirmDialog";
import { MoveUsersDialog } from "../move/MoveUsersDialog";
import { ChannelPasswordDialog } from "./ChannelPasswordDialog";
import styles from "./ChannelSidebar.module.css";
import { loadPersonalization } from "../../../personalizationStorage";
import type { ChannelViewerStyle } from "../../../personalizationStorage";
const ModernChannelList = lazy(() => import("../flat/ModernChannelList"));
const ChannelIconList = lazy(() => import("../modern/ChannelIconList"));
const ClassicChannelList = lazy(() => import("../classic/ClassicChannelList"));
const MembersTab = lazy(() => import("../MembersTab").then((m) => ({ default: m.MembersTab })));
const RecordingModal = lazy(() => import("../RecordingModal"));
import { SidebarTabs } from "../SidebarTabs";
import { PERM_LISTEN, PERM_WRITE } from "../../../utils/permissions";
import { filterVisibleChannels } from "../../../utils/channelVisibility";
import { TID } from "../../../testids";

/** Check whether a channel's cached permissions include the Listen bit. */
function canListen(channel: ChannelEntry | undefined): boolean {
  if (!channel) return true; // channel not found - allow optimistically
  if (channel.permissions == null) return true; // not yet queried - allow optimistically
  return (channel.permissions & PERM_LISTEN) !== 0;
}

// --- Voice panel helpers -------------------------------------------

// --- Self voice controls (extracted for cognitive complexity) ------

interface SelfVoiceControlsProps {
  readonly voiceState: string;
  readonly inCall: boolean;
  readonly toggleMute: () => void;
  readonly toggleDeafen: () => void;
  readonly enableVoice: () => void;
  readonly disableVoice: () => void;
  readonly onCollapse?: () => void;
}

function SelfVoiceControls({ voiceState, inCall, toggleMute, toggleDeafen, enableVoice, disableVoice, onCollapse }: Readonly<SelfVoiceControlsProps>) {
  const { t } = useTranslation(["sidebar", "common"]);
  const isActive = voiceState === "active";
  const isInactive = voiceState === "inactive";
  const muteTitle = isActive ? t("channelSidebar.mute") : t("channelSidebar.unmute");

  return (<>
    {/* Desktop: mute + deaf toggles (hidden on mobile via CSS) */}
    <div className={`${styles.selfVoiceActions} ${styles.desktopOnly}`}>
      <button
        className={`${styles.voiceToggle} ${isActive ? styles.voiceActive : styles.voiceMuted}`}
        data-testid={TID.toggleMute}
        onClick={toggleMute}
        title={muteTitle}
      >
        {isActive ? (
          <MicIcon width={18} height={18} />
        ) : (
          <MicOffIcon width={18} height={18} />
        )}
      </button>
      <button
        className={`${styles.voiceToggle} ${isInactive ? styles.voiceMuted : styles.voiceActive}`}
        data-testid={TID.toggleDeafen}
        onClick={toggleDeafen}
        title={isInactive ? t("channelSidebar.enableVoice") : t("channelSidebar.disableVoice")}
      >
        {isInactive ? (
          <HeadphonesOffIcon width={18} height={18} />
        ) : (
          <HeadphonesIcon width={18} height={18} />
        )}
      </button>
    </div>
    {/* Mobile: single call / hang-up button (hidden on desktop via CSS) */}
    <div className={`${styles.selfVoiceActions} ${styles.mobileOnly}`}>
      {inCall ? (
        <button
          className={`${styles.voiceToggle} ${styles.callBtnEnd}`}
          onClick={() => { disableVoice(); onCollapse?.(); }}
          title={t("channelSidebar.endCall")}
        >
          <PhoneOffIcon width={18} height={18} />
        </button>
      ) : (
        <button
          className={`${styles.voiceToggle} ${styles.callBtnStart}`}
          onClick={() => { enableVoice(); onCollapse?.(); }}
          title={t("channelSidebar.startCall")}
        >
          <PhoneIcon width={18} height={18} />
        </button>
      )}
    </div>
  </>);
}

// --- Main component -----------------------------------------------

interface ChannelSidebarProps {
  /** Called after the user taps a channel (used by mobile drawer to close). */
  onChannelSelect?: () => void;
  /** Toggle the server info panel. */
  onServerInfoToggle?: () => void;
  /** Called when the user clicks the collapse button (desktop narrow mode). */
  onCollapse?: () => void;
  /** When set, opens search scoped to this channel. */
  searchChannelId?: number | null;
  /** Called to clear the channel search scope. */
  onSearchChannelClear?: () => void;
  /** Called when a message search result is selected; receives channel+message IDs. */
  onSelectMessage?: (channelId: number, messageId: string) => void;
}

export default function ChannelSidebar({ onChannelSelect, onServerInfoToggle, onCollapse, searchChannelId, onSearchChannelClear, onSelectMessage }: Readonly<ChannelSidebarProps>) {
  const { t } = useTranslation(["sidebar", "common"]);
  const channels = useAppStore((s) => s.channels);
  const users = useAppStore((s) => s.users);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const currentChannel = useAppStore((s) => s.currentChannel);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const joinChannel = useAppStore((s) => s.joinChannel);
  const joinChannelWithPassword = useAppStore((s) => s.joinChannelWithPassword);
  const deleteChannel = useAppStore((s) => s.deleteChannel);
  const moveChannelUsers = useAppStore((s) => s.moveChannelUsers);
  const deletePchatMessages = useAppStore((s) => s.deletePchatMessages);
  const disconnect = useAppStore((s) => s.disconnect);
  const toggleListen = useAppStore((s) => s.toggleListen);
  const listenedChannels = useAppStore((s) => s.listenedChannels);
  const unreadCounts = useAppStore((s) => s.unreadCounts);
  const voiceState = useAppStore((s) => s.voiceState);
  const toggleMute = useAppStore((s) => s.toggleMute);
  const toggleDeafen = useAppStore((s) => s.toggleDeafen);
  const enableVoice = useAppStore((s) => s.enableVoice);
  const disableVoice = useAppStore((s) => s.disableVoice);
  const inCall = useAppStore((s) => s.inCall);
  const toggleMutePushChannel = useAppStore((s) => s.toggleMutePushChannel);
  const mutedPushChannels = useAppStore((s) => s.mutedPushChannels);
  const navigate = useNavigate();

  const ownSession = useAppStore((s) => s.ownSession);
  const talkingSessions = useAppStore((s) => s.talkingSessions);
  const broadcastingSessions = useAppStore((s) => s.broadcastingSessions);

  const aclGroups = useAclGroups();
  const roleColors = useMemo(() => buildRoleColorMap(aclGroups), [aclGroups]);
  const roleGroups = useMemo(() => buildRoleGroupsMap(aclGroups), [aclGroups]);

  const selectDmUser = useAppStore((s) => s.selectDmUser);
  const selectUser = useAppStore((s) => s.selectUser);
  const selectedDmUser = useAppStore((s) => s.selectedDmUser);

  const [channelViewerStyle, setChannelViewerStyle] = useState<ChannelViewerStyle>("flat");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const [shakingChannelId, setShakingChannelId] = useState<number | undefined>();
  const [highlightChannelId, setHighlightChannelId] = useState<number | undefined>();
  const [highlightUserSession, setHighlightUserSession] = useState<number | undefined>();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unlistenPromise = listen<{ channel_id: number }>("channel-denied", (event) => {
      setShakingChannelId(event.payload.channel_id);
      clearTimeout(timer);
      timer = setTimeout(() => setShakingChannelId(undefined), 600);
    });
    return () => {
      clearTimeout(timer);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
  const [devMode, setDevMode] = useState(false);
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  useEffect(() => {
    getPreferences().then((prefs) => setDevMode(prefs.userMode === "developer"));
  }, []);

  // Load channel viewer style preference.
  useEffect(() => {
    loadPersonalization().then((p) => setChannelViewerStyle(p.channelViewerStyle ?? "flat"));
  }, []);

  // -- Channel editor dialog state --------------------------------
  const [channelEditor, setChannelEditor] = useState<{
    channel: ChannelEntry | null;
    parentId: number;
    tempOnly: boolean;
  } | null>(null);

  // -- Delete channel confirm state --------------------------------
  const [deleteConfirm, setDeleteConfirm] = useState<{
    channelId: number;
    channelName: string;
  } | null>(null);

  // -- Purge persistent chat confirm state -------------------------
  const [purgeConfirm, setPurgeConfirm] = useState<{
    channelId: number;
    channelName: string;
  } | null>(null);

  // -- Move all users dialog state ---------------------------------
  const [moveUsersSource, setMoveUsersSource] = useState<ChannelEntry | null>(null);

  // -- Channel password dialog state -------------------------------
  const [passwordChannel, setPasswordChannel] = useState<ChannelEntry | null>(null);

  // True when the user has Write permission on the root channel (id 0).
  // This is the traditional Mumble indicator for server admin rights.
  const isAdmin = useMemo(() => {
    const root = channels.find((ch) => ch.id === 0);
    return root?.permissions != null && (root.permissions & PERM_WRITE) !== 0;
  }, [channels]);

  // Global Ctrl+K / Cmd+K shortcut to toggle sidebar search.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (showSearch) {
          setShowSearch(false);
          setSearchQuery("");
        } else {
          setShowSearch(true);
          requestAnimationFrame(() => searchInputRef.current?.focus());
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showSearch]);

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery("");
    onSearchChannelClear?.();
  }, [onSearchChannelClear]);

  useEffect(() => {
    if (!showSearch) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        closeSearch();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showSearch, closeSearch]);

  // Open search when a channel search is requested from the chat header.
  useEffect(() => {
    if (searchChannelId != null) {
      setShowSearch(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [searchChannelId]);

  // Resolve channel name for the search scope indicator.
  const searchChannelName = useMemo(() => {
    if (searchChannelId == null) return undefined;
    return channels.find((ch) => ch.id === searchChannelId)?.name;
  }, [searchChannelId, channels]);

  // Section collapse state (all expanded by default, restored from prefs).
  const [channelsOpen, setChannelsOpen] = useState(true);

  // When true, channels with no members are hidden from the viewer (restored
  // from prefs).  Ancestors of populated channels and the current/selected
  // channel are always kept so the tree stays consistent.
  const [hideEmptyChannels, setHideEmptyChannels] = useState(false);

  // Members pane is mounted lazily on first activation by SidebarTabs.
  // Once shown it stays mounted (hidden via CSS) so subsequent tab
  // switches are pure CSS toggles.
  const [membersMounted, setMembersMounted] = useState(false);
  const handleMembersFirstShown = useCallback(() => setMembersMounted(true), []);

  // Load persisted section states on mount.  (Active tab is handled
  // inside SidebarTabs to keep its state local.)
  useEffect(() => {
    getPreferences().then((prefs) => {
      const s = prefs.sidebarSections;
      if (s) {
        setChannelsOpen(s.channels);
      }
      setHideEmptyChannels(prefs.hideEmptyChannels ?? false);
    });
  }, []);

  const toggleHideEmptyChannels = useCallback(() => {
    setHideEmptyChannels((prev) => {
      const next = !prev;
      updatePreferences({ hideEmptyChannels: next });
      return next;
    });
  }, []);

  // Persist section states when they change.
  const toggleSection = useCallback(
    (section: keyof SidebarSections, current: boolean, setter: (v: boolean) => void) => {
      const next = !current;
      setter(next);
      getPreferences().then((prefs) => {
        const sections = prefs.sidebarSections ?? { channels: true };
        updatePreferences({ sidebarSections: { ...sections, [section]: next } });
      });
    },
    [],
  );

  // -- Context menu state ------------------------------------------
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    channelId: number;
  } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const openCtxMenu = useCallback(
    (e: React.MouseEvent, channelId: number) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY, channelId });
    },
    [],
  );

  // Close context menu on outside click or Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ctxMenu]);

  // -- User context menu state ------------------------------------
  const [userCtxMenu, setUserCtxMenu] = useState<UserContextMenuState | null>(null);

  const openUserCtxMenu = useCallback(
    (e: React.MouseEvent, user: UserEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setUserCtxMenu({ x: e.clientX, y: e.clientY, user });
    },
    [],
  );

  // Stable callbacks for the list components below: avoid passing fresh
  // arrow functions on every render so React.memo on MemberItem/MemberRow
  // can short-circuit when nothing about a row actually changed.
  const handleSelectChannel = useCallback((id: number) => {
    selectChannel(id);
    onChannelSelect?.();
  }, [selectChannel, onChannelSelect]);
  const handleJoinChannel = useCallback((id: number) => {
    const ch = channels.find((c) => c.id === id);
    if (ch?.is_enter_restricted) {
      setPasswordChannel(ch);
      return;
    }
    joinChannel(id);
    selectChannel(id);
    onChannelSelect?.();
  }, [channels, joinChannel, selectChannel, onChannelSelect]);
  const handleUserClick = useCallback((session: number) => {
    selectDmUser(session);
    onChannelSelect?.();
  }, [selectDmUser, onChannelSelect]);

  /** Get the channel name for a user's current channel. */
  const channelName = (channelId: number) => {
    const ch = channels.find((c) => c.id === channelId);
    return ch?.name || "Root";
  };

  // Channels passed to the list renderers.  When "hide empty" is on, only
  // channels with members (plus the current/selected/listened ones) are shown -
  // empty parents are hidden too, with populated subchannels re-parented so the
  // tree stays consistent.  See filterVisibleChannels for the details.
  const visibleChannels = useMemo(() => {
    if (!hideEmptyChannels) return channels;
    return filterVisibleChannels(channels, users, {
      currentChannel,
      selectedChannel,
      listenedChannels,
    });
  }, [channels, users, hideEmptyChannels, currentChannel, selectedChannel, listenedChannels]);

  return (
    <RoleColorsContext.Provider value={roleColors}>
    <RoleGroupsContext.Provider value={roleGroups}>
    <aside ref={sidebarRef} className={styles.sidebar}>
      {/* Header */}
      <div className={styles.header}>
        {onCollapse && (
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={onCollapse}
            aria-label={t("channelSidebar.collapse")}
            title={t("channelSidebar.collapse")}
          >
            <MenuIcon width={18} height={18} />
          </button>
        )}
        <div className={styles.searchBar}>
          <SearchIcon className={styles.searchBarIcon} width={14} height={14} />
          <input
            ref={searchInputRef}
            className={styles.searchBarInput}
            type="text"
            placeholder={t("channelSidebar.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!showSearch) setShowSearch(true);
            }}
            onFocus={() => { if (!showSearch) setShowSearch(true); }}
            onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
          />
          {showSearch ? (
            <button
              type="button"
              className={styles.searchBarClose}
              onClick={closeSearch}
              aria-label={t("channelSidebar.closeSearch")}
              title={t("channelSidebar.closeSearchTooltip")}
            >
              <CloseIcon width={14} height={14} />
            </button>
          ) : (
            <span className={styles.searchShortcut}>Ctrl+K</span>
          )}
        </div>
      </div>

      {/* -- Search mode replaces channel/group/online content -- */}
      {showSearch ? (
        <Suspense fallback={null}>
          <SidebarSearchView
            query={searchQuery}
            channelId={searchChannelId}
            channelName={searchChannelName}
            onSelectChannel={(id) => {
              selectChannel(id);
              setHighlightChannelId(id);
              setTimeout(() => setHighlightChannelId(undefined), 1500);
              onChannelSelect?.();
            }}
            onSelectUser={(session) => {
              const user = users.find((u) => u.session === session);
              const channelId = user?.channel_id;
              if (channelId != null) {
                selectChannel(channelId);
                setHighlightChannelId(channelId);
                setTimeout(() => setHighlightChannelId(undefined), 1500);
              }
              setHighlightUserSession(session);
              setTimeout(() => setHighlightUserSession(undefined), 1500);
              onChannelSelect?.();
            }}
            onSelectMessage={(channelId, messageId) => {
              selectChannel(channelId);
              setHighlightChannelId(channelId);
              setTimeout(() => setHighlightChannelId(undefined), 1500);
              onSelectMessage?.(channelId, messageId);
              onChannelSelect?.();
            }}
          />
        </Suspense>
      ) : (<>

      <SidebarTabs
        onMembersFirstShown={handleMembersFirstShown}
        membersPane={membersMounted ? (
          <Suspense fallback={null}>
            <MembersTab
              users={users}
              channels={channels}
              ownSession={ownSession}
              selectedDmUser={selectedDmUser}
              talkingSessions={talkingSessions}
              onSelectDm={handleUserClick}
              onUserContextMenu={openUserCtxMenu}
            />
          </Suspense>
        ) : null}
        channelsPane={(<>
      {/* Channel list header (always visible) */}
      <div className={styles.sectionHeaderBar}>
        <button
          className={styles.collapsibleHeader}
          onClick={() => toggleSection("channels", channelsOpen, setChannelsOpen)}
          type="button"
        >
          <ChevronRightIcon
            className={`${styles.collapseChevron} ${channelsOpen ? styles.collapseChevronOpen : ""}`}
            width={12}
            height={12}
          />
          <span>{t("channelSidebar.channels")}</span>
        </button>
        <button
          type="button"
          className={`${styles.sectionHeaderAction} ${hideEmptyChannels ? styles.sectionHeaderActionActive : ""}`}
          onClick={toggleHideEmptyChannels}
          aria-pressed={hideEmptyChannels}
          title={hideEmptyChannels ? t("channelSidebar.showAllChannels") : t("channelSidebar.hideEmptyChannels")}
          aria-label={hideEmptyChannels ? t("channelSidebar.showAllChannels") : t("channelSidebar.hideEmptyChannels")}
        >
          <UsersGroupIcon width={14} height={14} />
        </button>
      </div>

      {/* Channel list */}
      <div className={`${styles.channelList} ${channelsOpen ? "" : styles.sectionCollapsed}`}>

        <Suspense fallback={null}>
        {channelsOpen && channelViewerStyle === "flat" && (
          <ModernChannelList
            channels={visibleChannels}
            users={users}
            selectedChannel={selectedChannel}
            currentChannel={currentChannel}
            listenedChannels={listenedChannels}
            unreadCounts={unreadCounts}
            talkingSessions={talkingSessions}
            broadcastingSessions={broadcastingSessions}
            shakingChannelId={shakingChannelId}
            highlightChannelId={highlightChannelId}
            highlightUserSession={highlightUserSession}
            onSelectChannel={handleSelectChannel}
            onJoinChannel={handleJoinChannel}
            onContextMenu={openCtxMenu}
            onUserContextMenu={openUserCtxMenu}
            onUserClick={handleUserClick}
          />
        )}

        {channelsOpen && channelViewerStyle === "modern" && (
          <ChannelIconList
            channels={visibleChannels}
            users={users}
            selectedChannel={selectedChannel}
            currentChannel={currentChannel}
            listenedChannels={listenedChannels}
            unreadCounts={unreadCounts}
            talkingSessions={talkingSessions}
            broadcastingSessions={broadcastingSessions}
            shakingChannelId={shakingChannelId}
            highlightChannelId={highlightChannelId}
            highlightUserSession={highlightUserSession}
            onSelectChannel={handleSelectChannel}
            onJoinChannel={handleJoinChannel}
            onContextMenu={openCtxMenu}
            onUserContextMenu={openUserCtxMenu}
            onUserClick={handleUserClick}
          />
        )}

        {channelsOpen && channelViewerStyle === "classic" && (
          <ClassicChannelList
            channels={visibleChannels}
            users={users}
            selectedChannel={selectedChannel}
            currentChannel={currentChannel}
            listenedChannels={listenedChannels}
            unreadCounts={unreadCounts}
            shakingChannelId={shakingChannelId}
            highlightChannelId={highlightChannelId}
            highlightUserSession={highlightUserSession}
            onSelectChannel={handleSelectChannel}
            onJoinChannel={handleJoinChannel}
            onContextMenu={openCtxMenu}
          />
        )}
        </Suspense>
      </div>
        </>)}
      />

      </>)}{/* end search-mode ternary */}

      {/* Self user section - always visible */}
      {(() => {
        const self = users.find((u) => u.session === ownSession);
        if (!self) return null;
        const selfTalking = talkingSessions.has(self.session);
        return (
          <div className={styles.selfUserSection}>
            <UserListItem
              user={self}
              channelName={channelName(self.channel_id)}
              isSelf
              isTalking={selfTalking}
              onClick={() => selectUser(self.session)}
              onContextMenu={(e) => openUserCtxMenu(e, self)}
            />
            {currentChannel != null && (
              <SelfVoiceControls
                voiceState={voiceState}
                inCall={inCall}
                toggleMute={toggleMute}
                toggleDeafen={toggleDeafen}
                enableVoice={enableVoice}
                disableVoice={disableVoice}
                onCollapse={onCollapse}
              />
            )}
          </div>
        );
      })()}

      {/* Voice panel */}
      <div className={styles.voicePanel}>
        <div className={styles.voiceActions}>
          {onServerInfoToggle && (
            <button
              className={styles.serverInfoBtn}
              onClick={onServerInfoToggle}
              title={t("channelSidebar.serverInfo")}
              aria-label={t("channelSidebar.serverInfo")}
            >
              <InfoIcon width={18} height={18} />
            </button>
          )}
          <button
            className={styles.settingsBtn}
            onClick={() => navigate("/settings")}
            title={t("channelSidebar.audioSettings")}
          >
            <SettingsIcon width={18} height={18} />
          </button>
          {isAdmin && (
            <button
              className={styles.adminBtn}
              onClick={() => navigate("/admin")}
              title={t("channelSidebar.adminPanel")}
              aria-label={t("channelSidebar.adminPanel")}
            >
              <ShieldIcon width={18} height={18} />
            </button>
          )}
          {devMode && voiceState !== "inactive" && (
            <button
              className={`${styles.settingsBtn} ${showRecordingModal ? styles.activeBtn : ""}`}
              onClick={() => setShowRecordingModal(true)}
              title={t("channelSidebar.recordAudio")}
              aria-label={t("channelSidebar.recordAudio")}
            >
              <RecordIcon width={18} height={18} />
            </button>
          )}
          <button
            className={styles.disconnectBtn}
            onClick={disconnect}
            title={t("channelSidebar.disconnect")}
          >
            <LogoutIcon width={16} height={16} />
            {t("channelSidebar.disconnect")}
          </button>
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (() => {
        const ctxChannel = channels.find((c) => c.id === ctxMenu.channelId);
        const hasListenPerm = canListen(ctxChannel);
        const isListened = listenedChannels.has(ctxMenu.channelId);
        const isPushMuted = mutedPushChannels.has(ctxMenu.channelId);
        const showEdit = canEditChannel(ctxChannel);
        const showCreate = canCreateChannel(ctxChannel);
        const showDelete = canDeleteChannel(ctxChannel);
        const showPurge = canDeleteMessages(ctxChannel) && !!ctxChannel?.pchat_protocol;
        const channelUserCount = users.filter((u) => u.channel_id === ctxMenu.channelId).length;

        return createPortal(
          <div
            ref={ctxRef}
            className={styles.contextMenu}
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
          >
            <button
              className={styles.contextMenuItem}
              disabled={!isListened && !hasListenPerm}
              title={!isListened && !hasListenPerm ? t("channelSidebar.noListenPerm") : undefined}
              onClick={() => {
                toggleListen(ctxMenu.channelId);
                setCtxMenu(null);
              }}
            >
              {isListened ? (
                <>
                  <MicOffSmallIcon width={14} height={14} />
                  {t("channelSidebar.stopListening")}
                </>
              ) : (
                <>
                  <ListenBadgeIcon width={14} height={14} opacity={hasListenPerm ? 1 : 0.4} />
                  {t("channelSidebar.listenChannel")}
                </>
              )}
            </button>

            <button
              className={styles.contextMenuItem}
              onClick={() => {
                toggleMutePushChannel(ctxMenu.channelId);
                setCtxMenu(null);
              }}
            >
              {isPushMuted ? (
                <>
                  <BellIcon width={14} height={14} />
                  {t("channelSidebar.enableNotifications")}
                </>
              ) : (
                <>
                  <BellOffIcon width={14} height={14} />
                  {t("channelSidebar.muteNotifications")}
                </>
              )}
            </button>

            {showEdit && (
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  if (ctxChannel) {
                    setChannelEditor({ channel: ctxChannel, parentId: ctxChannel.parent_id ?? 0, tempOnly: false });
                  }
                  setCtxMenu(null);
                }}
              >
                <EditIcon width={14} height={14} />
                {t("channelSidebar.editChannel")}
              </button>
            )}

            {showEdit && (
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  const channelId = ctxMenu.channelId;
                  setCtxMenu(null);
                  navigate(`/admin?tab=acl&channel=${channelId}`);
                }}
              >
                <ShieldIcon width={14} height={14} />
                {t("channelSidebar.editPermissions")}
              </button>
            )}

            {showCreate && (
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  setChannelEditor({
                    channel: null,
                    parentId: ctxMenu.channelId,
                    tempOnly: canOnlyCreateTemp(ctxChannel),
                  });
                  setCtxMenu(null);
                }}
              >
                <PlusIcon width={14} height={14} />
                {t("channelSidebar.createSubchannel")}
              </button>
            )}

            {showEdit && channelUserCount > 0 && (
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  if (ctxChannel) setMoveUsersSource(ctxChannel);
                  setCtxMenu(null);
                }}
              >
                <UsersGroupIcon width={14} height={14} />
                {t("channelSidebar.moveAllUsers")}
              </button>
            )}

            {showPurge && (
              <button
                className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
                onClick={() => {
                  setPurgeConfirm({
                    channelId: ctxMenu.channelId,
                    channelName: ctxChannel?.name ?? "this channel",
                  });
                  setCtxMenu(null);
                }}
              >
                <DatabaseIcon width={14} height={14} />
                {t("channelSidebar.purgeHistory")}
              </button>
            )}

            {showDelete && (
              <button
                className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
                onClick={() => {
                  setDeleteConfirm({
                    channelId: ctxMenu.channelId,
                    channelName: ctxChannel?.name ?? "this channel",
                  });
                  setCtxMenu(null);
                }}
              >
                <TrashIcon width={14} height={14} />
                {t("channelSidebar.deleteChannel")}
              </button>
            )}
          </div>,
          document.body,
        );
      })()}

      {/* User context menu */}
      {userCtxMenu && (
        <UserContextMenu
          menu={userCtxMenu}
          onClose={() => setUserCtxMenu(null)}
        />
      )}

      {/* Channel editor dialog */}
      {channelEditor && (
        <ChannelEditorDialog
          channel={channelEditor.channel}
          parentId={channelEditor.parentId}
          tempOnly={channelEditor.tempOnly}
          onClose={() => setChannelEditor(null)}
        />
      )}

      {/* Delete channel confirmation dialog */}
      {deleteConfirm && createPortal(
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => setDeleteConfirm(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setDeleteConfirm(null); }}
        >
          <div className={styles.deleteConfirmDialog} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.deleteConfirmTitle}>{t("channelSidebar.deleteChannelTitle")}</h3>
            <p className={styles.deleteConfirmBody}>
              {t("channelSidebar.deleteChannelBody", { channel: deleteConfirm.channelName })}
            </p>
            <div className={styles.deleteConfirmActions}>
              <button
                className={styles.deleteConfirmCancel}
                onClick={() => setDeleteConfirm(null)}
              >
                {t("common:actions.cancel")}
              </button>
              <button
                className={styles.deleteConfirmOk}
                onClick={async () => {
                  const id = deleteConfirm.channelId;
                  setDeleteConfirm(null);
                  await deleteChannel(id);
                }}
              >
                {t("channelSidebar.deleteChannelConfirm")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Recording modal (developer mode) */}
      {showRecordingModal && (
        <Suspense fallback={null}>
          <RecordingModal onClose={() => setShowRecordingModal(false)} />
        </Suspense>
      )}

      {/* Purge persistent chat confirmation */}
      {purgeConfirm && (
        <ConfirmDialog
          title={t("channelSidebar.purgeHistoryTitle")}
          body={t("channelSidebar.purgeHistoryBody", { channel: purgeConfirm.channelName })}
          confirmLabel={t("channelSidebar.purgeConfirm")}
          danger
          onConfirm={async () => {
            const id = purgeConfirm.channelId;
            setPurgeConfirm(null);
            await deletePchatMessages(id, { timeTo: Date.now() });
          }}
          onCancel={() => setPurgeConfirm(null)}
        />
      )}

      {/* Move all users to channel picker */}
      {moveUsersSource && (
        <MoveUsersDialog
          sourceChannel={moveUsersSource}
          channels={channels}
          onConfirm={async (targetId) => {
            const srcId = moveUsersSource.id;
            setMoveUsersSource(null);
            await moveChannelUsers(srcId, targetId);
          }}
          onCancel={() => setMoveUsersSource(null)}
        />
      )}

      {/* Channel password dialog */}
      {passwordChannel && (
        <ChannelPasswordDialog
          channel={passwordChannel}
          onConfirm={async (password) => {
            const ch = passwordChannel;
            setPasswordChannel(null);
            await joinChannelWithPassword(ch.id, password);
            selectChannel(ch.id);
            onChannelSelect?.();
          }}
          onCancel={() => setPasswordChannel(null)}
        />
      )}
    </aside>
    </RoleGroupsContext.Provider>
    </RoleColorsContext.Provider>
  );
}
