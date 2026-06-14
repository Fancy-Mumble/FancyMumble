import { MenuIcon } from "../icons";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { lazy, Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import { isMobile } from "../utils/platform";
import { useSwipeDrawer } from "../hooks/useSwipeDrawer";
import { usePasswordPrompt } from "../hooks/usePasswordPrompt";
import { useInAppShortcuts } from "../hooks/useInAppShortcuts";
import {
  type ShortcutBindings,
  DEFAULT_SHORTCUTS,
  loadShortcuts,
} from "./settings/shortcutHelpers";
import ChannelSidebar from "../components/sidebar/channel/ChannelSidebar";
import ChatView from "../components/chat/ChatView";
// MobileBottomSheet must be imported statically: MobileProfileSheet and
// ServerEditSheet already import it statically, and a module that is BOTH
// statically and dynamically imported makes rolldown emit it as a separate
// chunk that the entry chunk imports cyclically - the chunk then evaluates
// before the entry's CommonJS interop is initialised and the whole bundle
// dies with "TypeError: <minified> is not a function" (blank window in
// release builds; dev mode is unaffected because it doesn't chunk).
// The component is ~2 kB minified, so there is nothing to win by splitting.
import MobileBottomSheet from "../components/elements/MobileBottomSheet";
import PasswordDialog from "../components/server/PasswordDialog";
import { SuperSearch } from "../components/layout/SuperSearch";
import styles from "./ChatPage.module.css";

/** Format a millisecond duration as a compact "1h 02m 05s" / "2m 05s" / "12s". */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

const ServerInfoPanel = lazy(() => import("../components/server/ServerInfoPanel"));
const ChannelInfoPanel = lazy(() => import("../components/sidebar/channel/ChannelInfoPanel"));
const UserProfileView = lazy(() => import("../components/user/UserProfileView"));
const MobileProfileSheet = lazy(() => import("../components/user/MobileProfileSheet"));

export default function ChatPage() {
  const { t } = useTranslation("chat");
  const status = useAppStore((s) => s.status);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const channels = useAppStore((s) => s.channels);
  const joinChannel = useAppStore((s) => s.joinChannel);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const selectedUser = useAppStore((s) => s.selectedUser);
  const selectedDmUser = useAppStore((s) => s.selectedDmUser);
  const sessions = useAppStore((s) => s.sessions);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const error = useAppStore((s) => s.error);
  const bootstrapStage = useAppStore((s) => s.bootstrapStage);
  const reconnectAttempts = useAppStore((s) => s.reconnectAttempts);
  const connectionLostAt = useAppStore((s) => s.connectionLostAt);
  const reconnectScheduled = useAppStore((s) => s.reconnectScheduled);
  const nextReconnectAt = useAppStore((s) => s.nextReconnectAt);
  const passwordRequired = useAppStore((s) => s.passwordRequired);
  const pendingConnect = useAppStore((s) => s.pendingConnect);
  const dismissPasswordPrompt = useAppStore((s) => s.dismissPasswordPrompt);
  const connect = useAppStore((s) => s.connect);
  const navigate = useNavigate();

  const [isReconnecting, setIsReconnecting] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  const [superSearchOpen, setSuperSearchOpen] = useState(false);

  // Whether a connection attempt is actively running right now.
  const activelyConnecting =
    status === "connecting" || bootstrapStage !== null || isReconnecting;
  // Whether the active session is mid-(re)connect - actively connecting OR
  // waiting out the backoff before the next auto-reconnect attempt. Drives
  // the reconnect overlay so it stays visible between attempts instead of
  // flashing the "Disconnected" card.
  const reconnecting = activelyConnecting || reconnectScheduled;

  // Tick once a second while reconnecting so the "time since last
  // connection" counter stays live without re-rendering the chat.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!reconnecting || connectionLostAt === null) return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [reconnecting, connectionLostAt]);

  const { handleSubmit: handlePasswordSubmit, handleChangeUsername, showSaveOption } =
    usePasswordPrompt();


  // On desktop, track whether the viewport is narrow (<= 768px).
  // When narrow, the sidebar uses the same slide-out drawer as mobile.
  const [isNarrow, setIsNarrow] = useState(
    () => !isMobile && window.matchMedia("(max-width: 768px)").matches,
  );

  useEffect(() => {
    if (isMobile) return;
    const mql = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [isMobile]);

  const useDrawer = isMobile || isNarrow;
  const [sidebarOpen, setSidebarOpen] = useState(!useDrawer);
  const pageRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Auto-open sidebar when leaving narrow mode, auto-close when entering it.
  useEffect(() => {
    setSidebarOpen(!useDrawer);
  }, [useDrawer]);

  const [showServerInfo, setShowServerInfo] = useState(false);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [searchChannelId, setSearchChannelId] = useState<number | null>(null);
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const toggleServerInfo = useCallback(() => {
    setShowServerInfo((v) => !v);
    setShowChannelInfo(false);
  }, []);
  const toggleChannelInfo = useCallback(() => {
    setShowChannelInfo((v) => !v);
    setShowServerInfo(false);
  }, []);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => {
    if (useDrawer) setSidebarOpen(false);
  }, [useDrawer]);
  const openChannelSearch = useCallback(() => {
    setSearchChannelId(selectedChannel);
    setSidebarOpen(true);
  }, [selectedChannel]);

  // Swipe right from left edge => open, swipe left => close.
  useSwipeDrawer(sidebarOpen, openSidebar, closeSidebar, {
    containerRef: pageRef,
    drawerRef,
  });

  // Load shortcuts from storage on mount and re-sync when settings change.
  useEffect(() => {
    loadShortcuts().then(setShortcuts).catch(() => undefined);
    const handler = (e: Event) => {
      const sc = (e as CustomEvent<ShortcutBindings>).detail;
      if (sc) setShortcuts(sc);
    };
    globalThis.addEventListener("shortcuts-changed", handler);
    return () => globalThis.removeEventListener("shortcuts-changed", handler);
  }, []);

  // Redirect to connect page when disconnected with no open sessions.
  // With open sessions we stay on /chat and show the reconnect overlay.
  useEffect(() => {
    if (status === "disconnected" && sessions.length === 0) {
      navigate("/");
    }
  }, [status, sessions.length, navigate]);

  // On mobile, block the Android swipe-back gesture / hardware back button
  // from navigating away from the chat page (which would break the connection).
  // We push a sentinel history entry and suppress any popstate that tries to
  // leave while we are still connected.
  useEffect(() => {
    if (!isMobile || status !== "connected") return;

    // Push a guard entry so there is always something to "go back" to.
    window.history.pushState({ chatGuard: true }, "");

    const onPopState = () => {
      // Re-push the guard entry to stay on the chat page.
      window.history.pushState({ chatGuard: true }, "");
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isMobile, status]);

  // In-app shortcut handlers ---------------------------------------------------

  const handleToggleActivationMode = useCallback(async () => {
    try {
      const settings = await invoke<{ push_to_talk: boolean }>("get_audio_settings");
      await invoke("set_audio_settings", {
        settings: { ...settings, push_to_talk: !settings.push_to_talk },
      });
    } catch {
      // Silently ignore if not connected
    }
  }, []);

  // Depth-first traversal of the channel tree, respecting each level's
  // `position` order, so Alt+Up/Down follows the visual sidebar order.
  const depthFirstChannelIds = useMemo(() => {
    const childrenOf = new Map<number | null, typeof channels>();
    for (const ch of channels) {
      const parent = ch.parent_id === ch.id ? null : ch.parent_id;
      const list = childrenOf.get(parent) ?? [];
      list.push(ch);
      childrenOf.set(parent, list);
    }
    const sorted = (list: typeof channels) =>
      [...list].sort((a, b) =>
        a.position !== b.position ? a.position - b.position : a.name.localeCompare(b.name),
      );
    const result: number[] = [];
    const visit = (parentId: number | null) => {
      for (const ch of sorted(childrenOf.get(parentId) ?? [])) {
        result.push(ch.id);
        visit(ch.id);
      }
    };
    visit(null);
    return result;
  }, [channels]);

  const handleMoveChannelUp = useCallback(() => {
    if (selectedChannel === null) return;
    const idx = depthFirstChannelIds.indexOf(selectedChannel);
    if (idx > 0) void selectChannel(depthFirstChannelIds[idx - 1]);
  }, [selectedChannel, depthFirstChannelIds, selectChannel]);

  const handleMoveChannelDown = useCallback(() => {
    if (selectedChannel === null) return;
    const idx = depthFirstChannelIds.indexOf(selectedChannel);
    if (idx >= 0 && idx < depthFirstChannelIds.length - 1) {
      void selectChannel(depthFirstChannelIds[idx + 1]);
    }
  }, [selectedChannel, depthFirstChannelIds, selectChannel]);

  const handleJumpToRootChannel = useCallback(() => {
    void joinChannel(0);
  }, [joinChannel]);

  const handleOpenSettings = useCallback(() => {
    navigate("/settings");
  }, [navigate]);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const isFs = await win.isFullscreen();
      await win.setFullscreen(!isFs);
    } catch {
      // Not available in browser dev mode
    }
  }, []);

  const handleToggleDevOverlay = useCallback(() => {
    try {
      const webview = getCurrentWebviewWindow();
      (webview as unknown as { openDevtools?: () => void }).openDevtools?.();
    } catch {
      // Not available in browser dev mode
    }
  }, []);

  useInAppShortcuts(shortcuts, {
    onToggleActivationMode: handleToggleActivationMode,
    onMoveChannelUp: handleMoveChannelUp,
    onMoveChannelDown: handleMoveChannelDown,
    onJumpToRootChannel: handleJumpToRootChannel,
    onToggleChannelSidebar: toggleSidebar,
    onToggleMemberPanel: toggleChannelInfo,
    onOpenQuickSearch: openChannelSearch,
    onOpenQuickSwitcher: () => setSuperSearchOpen(true),
    onOpenSettings: handleOpenSettings,
    onToggleFullscreen: handleToggleFullscreen,
    onToggleDevOverlay: handleToggleDevOverlay,
  });

  // ---------------------------------------------------------------------------

  const handleReconnect = useCallback(async () => {
    const meta = sessions.find((s) => s.id === activeServerId);
    if (!meta) return;
    setIsReconnecting(true);
    try {
      // Count this manual attempt alongside the auto-reconnect attempts.
      useAppStore.setState((p) => ({
        reconnectAttempts: p.reconnectAttempts + 1,
        connectionLostAt: p.connectionLostAt ?? Date.now(),
      }));
      // Reconnect through the existing Disconnected session so the backend
      // re-binds the *same* tab (take_reusable_for) and keeps it in the
      // foreground. Removing the session first (disconnect_server) would
      // leave no reusable slot, forcing a brand-new ServerId and a
      // background tab.
      await connect(meta.host, meta.port, meta.username, meta.certLabel);
    } finally {
      setIsReconnecting(false);
    }
  }, [sessions, activeServerId, connect]);

  // Show the reconnect / connecting overlay whenever the active session is
  // not fully bootstrapped (still connecting, or `connected` but its channel
  // list has not arrived yet - the backend flips to `connected` before the
  // ServerSync completes). Rendering the chat in that window shows an empty
  // channel viewer and a "select a channel" placeholder, which looks broken.
  // `bootstrapStage` mirrors the ConnectPage gate so we stay on the overlay
  // until the very same point ConnectPage would hand off to the chat.
  const notReady = status !== "connected" || bootstrapStage !== null;
  if (notReady && sessions.length > 0) {
    const meta = sessions.find((s) => s.id === activeServerId);
    const serverLabel = meta?.label || meta?.host || "Server";
    const title = reconnecting
      ? t("page.reconnect.titleReconnecting")
      : error
        ? t("page.reconnect.titleDisconnected")
        : t("page.reconnect.titleLost");
    const elapsed =
      connectionLostAt !== null ? formatElapsed(nowTick - connectionLostAt) : null;
    // Seconds until the next queued auto-reconnect attempt (backoff window).
    const nextRetrySec =
      !activelyConnecting && reconnectScheduled && nextReconnectAt !== null
        ? Math.max(0, Math.ceil((nextReconnectAt - nowTick) / 1000))
        : null;
    return (
      <div className={styles.reconnectPage}>
        <div className={styles.reconnectCard}>
          {reconnecting ? (
            <div className={styles.reconnectSpinner} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <div className={styles.reconnectIcon}>!</div>
          )}
          <h2 className={styles.reconnectTitle}>{title}</h2>
          <p className={styles.reconnectServer}>{serverLabel}</p>
          {reconnecting ? (
            <>
              <p className={styles.reconnectStatus}>
                {activelyConnecting
                  ? (bootstrapStage ?? t("page.reconnect.reconnectingBtn"))
                  : nextRetrySec !== null
                    ? t("page.reconnect.nextRetry", {
                        time: formatElapsed(nextRetrySec * 1000),
                      })
                    : t("page.reconnect.reconnectingBtn")}
              </p>
              <div className={styles.reconnectStats}>
                {reconnectAttempts > 0 && (
                  <span className={styles.reconnectStat}>
                    {t("page.reconnect.attemptCount", { n: reconnectAttempts })}
                  </span>
                )}
                {elapsed !== null && (
                  <span className={styles.reconnectStat}>
                    {t("page.reconnect.sinceLastConnection", { time: elapsed })}
                  </span>
                )}
              </div>
              {/* During the backoff wait, let the user skip ahead. */}
              {!activelyConnecting && (
                <button
                  type="button"
                  className={styles.reconnectBtn}
                  onClick={() => void handleReconnect()}
                  disabled={isReconnecting}
                >
                  {t("page.reconnect.reconnectNowBtn")}
                </button>
              )}
            </>
          ) : (
            <>
              {error && (
                <div className={styles.reconnectReasonBox}>
                  <span className={styles.reconnectReasonLabel}>{t("page.reconnect.reasonLabel")}</span>
                  <p className={styles.reconnectError}>{error}</p>
                </div>
              )}
              <button
                type="button"
                className={styles.reconnectBtn}
                onClick={() => void handleReconnect()}
                disabled={isReconnecting}
              >
                {t("page.reconnect.reconnectBtn")}
              </button>
            </>
          )}
        </div>
        <PasswordDialog
          open={passwordRequired}
          onSubmit={handlePasswordSubmit}
          onCancel={dismissPasswordPrompt}
          serverHost={pendingConnect?.host}
          username={pendingConnect?.username}
          error={error}
          showSaveOption={showSaveOption}
          onChangeUsername={handleChangeUsername}
        />
      </div>
    );
  }

  return (
    <div ref={pageRef} className={styles.page}>
      {/* Burger toggle - shown when sidebar is closed (both drawer and desktop modes) */}
      {!sidebarOpen && (
        <button
          className={styles.menuToggle}
          onClick={toggleSidebar}
          aria-label={t("page.openChannelsAriaLabel")}
        >
          <MenuIcon width={24} height={24} />
        </button>
      )}

      {/* Backdrop overlay when drawer is open */}
      {useDrawer && sidebarOpen && (
        <button
          className={styles.backdrop}
          onClick={closeSidebar}
          onKeyDown={(e) => e.key === "Escape" && closeSidebar()}
          aria-label={t("page.closeChannelsAriaLabel")}
          type="button"
        />
      )}

      {/* Sidebar: inline on wide desktop, slide-out drawer when narrow or mobile */}
      <div
        ref={drawerRef}
        className={[
          styles.sidebarContainer,
          sidebarOpen ? styles.sidebarOpen : "",
          !sidebarOpen && !useDrawer ? styles.sidebarCollapsed : "",
        ].filter(Boolean).join(" ")}
      >
        <ChannelSidebar
          onChannelSelect={closeSidebar}
          onServerInfoToggle={toggleServerInfo}
          onCollapse={useDrawer ? closeSidebar : undefined}
          searchChannelId={searchChannelId}
          onSearchChannelClear={() => setSearchChannelId(null)}
          onSelectMessage={(_, messageId) => setPendingScrollMessageId(messageId)}
        />
      </div>

      <ChatView
        onChannelInfoToggle={toggleChannelInfo}
        onChannelSearch={openChannelSearch}
        scrollToMessageId={pendingScrollMessageId}
        onScrollConsumed={() => setPendingScrollMessageId(null)}
      />
      <SuperSearch
        open={superSearchOpen}
        onClose={() => setSuperSearchOpen(false)}
        onSelectChannel={(id) => {
          void selectChannel(id);
          setSuperSearchOpen(false);
        }}
        onSelectUser={(session) => {
          useAppStore.setState({ selectedUser: session });
          setSuperSearchOpen(false);
        }}
      />
      <Suspense fallback={null}>
        {showServerInfo && !isMobile && <ServerInfoPanel onClose={() => setShowServerInfo(false)} />}
        {showChannelInfo && !isMobile && <ChannelInfoPanel onClose={() => setShowChannelInfo(false)} />}
        {(selectedUser !== null || selectedDmUser !== null) && !showServerInfo && !showChannelInfo && !isMobile && <UserProfileView />}
        {isMobile && (
          <>
            <MobileProfileSheet />
            <MobileBottomSheet
              open={showServerInfo}
              onClose={() => setShowServerInfo(false)}
              ariaLabel="Close server info"
            >
              <ServerInfoPanel onClose={() => setShowServerInfo(false)} />
            </MobileBottomSheet>
            <MobileBottomSheet
              open={showChannelInfo}
              onClose={() => setShowChannelInfo(false)}
              ariaLabel="Close channel info"
            >
              <ChannelInfoPanel onClose={() => setShowChannelInfo(false)} />
            </MobileBottomSheet>
          </>
        )}
      </Suspense>
    </div>
  );
}
