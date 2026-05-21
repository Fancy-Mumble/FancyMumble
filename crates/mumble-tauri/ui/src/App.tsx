import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, useNavigate, Navigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { initEventListeners, useAppStore } from "./store";
import { getPreferences, getSavedAudioSettings, isFirstRun, getNotificationSounds } from "./preferencesStorage";
import { setKlipyApiKey } from "./components/chat/GifPicker";
import { setKlipyApiKey as setKlipyApiKeyBanner } from "./pages/settings/KlipyGifBrowser";
import { loadShortcuts, applyAllGlobalShortcuts } from "./pages/settings/shortcutHelpers";
import {
  loadUserShortcuts,
  applyAllUserShortcuts,
  JUMP_TO_USER_EVENT,
  type JumpToUserDetail,
} from "./pages/settings/userShortcuts";
import { useVisualViewport } from "./hooks/useVisualViewport";
import { useNotificationSounds } from "./hooks/useNotificationSounds";
import { useSpoilerReveal } from "./hooks/useSpoilerReveal";
import { useCodeHighlight } from "./hooks/useCodeHighlight";
import { useWatchLifecycle } from "./components/chat/watch/useWatchLifecycle";
import { DEFAULT_NOTIFICATION_SOUNDS } from "./pages/settings/NotificationsPanel";
import type { NotificationSoundSettings, AudioSettings } from "./types";
import TitleBar from "./components/layout/TitleBar";
import ConnectPage from "./pages/ConnectPage";
import LoadingSplash from "./components/elements/LoadingSplash";
import { isUpdaterWindow } from "./updater";
import UpdaterWindow from "./updater/UpdaterWindow";
import PopoutPage from "./pages/PopoutPage";
import StreamPopoutPage from "./pages/StreamPopoutPage";
import DmPopoutPage from "./pages/DmPopoutPage";
import DrawOverlayPage from "./pages/DrawOverlayPage";
import OnboardingModal from "./components/onboarding/OnboardingModal";

const ChatPage = lazy(() => import("./pages/ChatPage"));
const SettingsPage = lazy(() => import("./pages/settings"));
const AdminPanel = lazy(() => import("./pages/admin"));
const RoleEditorPage = lazy(() => import("./pages/admin/RoleEditorPage"));
const WelcomePage = lazy(() => import("./pages/WelcomePage"));
const FriendsPage = lazy(() => import("./pages/FriendsPage"));

/**
 * Returns true when this webview window is an image popout window.
 * Popout windows are spawned by `open_image_popout` and use a window
 * label of the form `popout-<id>`.
 */
function isPopoutWindow(): boolean {
  // Tauri exposes the window label via the `__TAURI_METADATA__` global, but
  // checking the `?popout=` query string set by the popout URL is simpler
  // and works in browser dev as well.
  if (new URLSearchParams(globalThis.location.search).has("popout")) return true;
  // Fallback: detect via the Tauri window label using the IPC global.
  // We run this synchronously by reading the document title fallback.
  const tauriInternals = (globalThis as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
  const label = tauriInternals?.metadata?.currentWindow?.label;
  return !!label
    && label.startsWith("popout-")
    && !label.startsWith("popout-stream-")
    && !label.startsWith("popout-dm-");
}

/** True when this webview is a stream-share popout (`popout-stream-<id>`). */
function isStreamPopoutWindow(): boolean {
  if (new URLSearchParams(globalThis.location.search).has("stream-popout")) return true;
  const tauriInternals = (globalThis as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
  const label = tauriInternals?.metadata?.currentWindow?.label;
  return !!label && label.startsWith("popout-stream-");
}

/** True when this webview is a DM popout (`popout-dm-<id>`). */
function isDmPopoutWindow(): boolean {
  if (new URLSearchParams(globalThis.location.search).has("popout-dm")) return true;
  const tauriInternals = (globalThis as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
  const label = tauriInternals?.metadata?.currentWindow?.label;
  return !!label && label.startsWith("popout-dm-");
}

/**
 * Returns true when this webview window is the desktop drawing
 * overlay window. Spawned by the Rust `open_drawing_overlay` command
 * with the fixed label `draw-overlay`.
 */
function isDrawOverlayWindow(): boolean {
  if (new URLSearchParams(globalThis.location.search).has("draw-overlay")) return true;
  const tauriInternals = (globalThis as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
  }).__TAURI_INTERNALS__;
  const label = tauriInternals?.metadata?.currentWindow?.label;
  return label === "draw-overlay";
}

const enum WindowKind { Main, Popout, StreamPopout, DmPopout, Updater, DrawOverlay }

function getWindowKind(): WindowKind {
  if (isUpdaterWindow()) return WindowKind.Updater;
  if (isDrawOverlayWindow()) return WindowKind.DrawOverlay;
  if (isStreamPopoutWindow()) return WindowKind.StreamPopout;
  if (isDmPopoutWindow()) return WindowKind.DmPopout;
  if (isPopoutWindow()) return WindowKind.Popout;
  return WindowKind.Main;
}

export default function App() {
  switch (getWindowKind()) {
    case WindowKind.Updater:      return <UpdaterWindow />;
    case WindowKind.DrawOverlay:  return <DrawOverlayPage />;
    case WindowKind.StreamPopout: return <StreamPopoutPage />;
    case WindowKind.DmPopout:     return <DmPopoutPage />;
    case WindowKind.Popout:       return <PopoutPage />;
    default:                      return <MainApp />;
  }
}

function MainApp() {
  const navigate = useNavigate();
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  const [notifSounds, setNotifSounds] =
    useState<NotificationSoundSettings>(DEFAULT_NOTIFICATION_SOUNDS);

  // Track visual viewport height on mobile so the layout shrinks
  // when the on-screen keyboard is active.
  useVisualViewport();

  // Notification sounds - plays audio for events based on user config.
  useNotificationSounds(notifSounds);

  // Click-to-reveal for spoiler tags rendered anywhere in the app.
  useSpoilerReveal();

  // Syntax-highlight any <pre><code> block rendered anywhere in the app.
  useCodeHighlight();

  // Watch-together lifecycle: host re-election on disconnect and
  // automatic leave when the local user changes channel.
  useWatchLifecycle();

  // Check first-run status on mount and load persisted preferences.
  // Also apply saved audio settings and shortcuts to the backend so
  // they take effect without the user visiting the settings page.
  useEffect(() => {
    isFirstRun().then(setFirstRun);
    getPreferences().then((prefs) => {
      setKlipyApiKey(prefs.klipyApiKey);
      setKlipyApiKeyBanner(prefs.klipyApiKey);
      useAppStore.setState({ disableLinkPreviews: prefs.disableLinkPreviews ?? false });
      useAppStore.setState({ enableExternalEmbeds: prefs.enableExternalEmbeds ?? false });
      useAppStore.setState({ streamerMode: prefs.streamerMode ?? false });
      // Native notifications: streamer mode forces them off so they
      // cannot leak personal data into a screen recording; otherwise
      // honour the user's saved preference.
      const notificationsEnabled = prefs.streamerMode
        ? false
        : (prefs.enableNotifications ?? true);
      invoke("set_notifications_enabled", { enabled: notificationsEnabled })
        .catch(() => undefined);
      // Dual-path audio: backend stores the inverted "disabled" flag.
      invoke("set_disable_dual_path", { disabled: !(prefs.enableDualPath ?? false) })
        .catch(() => undefined);
      // Log level (also accepts "debug" via the legacy debugLogging flag).
      const logLevel = prefs.logLevel ?? (prefs.debugLogging ? "debug" : "info");
      invoke("set_log_level", { filter: logLevel }).catch(() => undefined);
      // Inform the Rust updater whether to auto-install on startup.
      invoke("updater_set_auto_install", { enabled: prefs.autoUpdateOnStartup ?? false })
        .catch(() => undefined);
      // Inform the Rust updater of the version (if any) the user chose to skip.
      invoke("updater_set_skipped_version", { version: prefs.skippedUpdateVersion ?? null })
        .catch(() => undefined);
    });
    getNotificationSounds().then((ns) => {
      if (ns) setNotifSounds(ns);
    });
    getSavedAudioSettings().then(async (saved) => {
      if (!saved) return;
      try {
        // Merge persisted values on top of the backend defaults so any
        // fields missing from older saves don't cause serde to reject
        // the invoke.  Without this merge the call silently fails and
        // the saved device (and other settings) only get applied once
        // the user opens the settings page, which performs its own
        // merge before re-invoking.
        const cfg = await invoke<AudioSettings>("get_audio_settings");
        const merged: AudioSettings = { ...cfg, ...saved };
        await invoke("set_audio_settings", { settings: merged });
      } catch (e) {
        console.error("Startup audio settings error:", e);
      }
    });
    loadShortcuts().then((sc) => {
      applyAllGlobalShortcuts(sc).catch(console.error);
    });
    loadUserShortcuts().then((us) => {
      applyAllUserShortcuts(us).catch(console.error);
    });
  }, []);

  // Sync notification sounds when settings page saves changes.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<NotificationSoundSettings>).detail;
      setNotifSounds(detail);
    };
    globalThis.addEventListener("notification-sounds-changed", handler);
    return () => globalThis.removeEventListener("notification-sounds-changed", handler);
  }, []);

  // Global "jump to user" shortcuts: identify the user by cert hash
  // when available (matches on whichever connected server they happen
  // to be visible on); fall back to a server-scoped name lookup for
  // anonymous users with no certificate hash.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<JumpToUserDetail>).detail;
      if (!detail) return;
      try {
        type Match = { serverId: string; userSession: number; userName: string };
        let match: Match | null = null;
        if (detail.userHash) {
          match = await invoke<Match | null>("find_user_by_hash", { userHash: detail.userHash });
        }
        if (!match && detail.serverId) {
          match = await invoke<Match | null>("find_user_in_server", {
            serverId: detail.serverId,
            userName: detail.userName,
          });
        }
        if (!match) {
          console.warn("jump-to-user: target user not online", detail);
          return;
        }
        const state = useAppStore.getState();
        if (state.activeServerId !== match.serverId) {
          await state.switchServer(match.serverId);
        }
        navigate("/chat");
        await useAppStore.getState().selectDmUser(match.userSession);
      } catch (err) {
        console.error("jump-to-user failed:", err);
      }
    };
    globalThis.addEventListener(JUMP_TO_USER_EVENT, handler);
    return () => globalThis.removeEventListener(JUMP_TO_USER_EVENT, handler);
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    let unlisteners: (() => void)[] = [];

    initEventListeners(navigate).then((fns) => {
      if (cancelled) {
        fns.forEach((fn) => fn());
        return;
      }
      unlisteners = fns;
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [navigate]);

  // Wait until we know the first-run status before rendering routes.
  if (firstRun === null) return <LoadingSplash />;

  return (
    <div className="app">
      <TitleBar />
      <Suspense fallback={<LoadingSplash />}>
        <Routes>
          {firstRun ? (
            <>
              <Route path="/welcome" element={<WelcomePage onComplete={() => setFirstRun(false)} />} />
              <Route path="*" element={<Navigate to="/welcome" replace />} />
            </>
          ) : (
            <>
              <Route path="/" element={<ConnectPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/admin/role/:groupName" element={<RoleEditorPage />} />
            </>
          )}
        </Routes>
      </Suspense>
      <OnboardingModal />
    </div>
  );
}
