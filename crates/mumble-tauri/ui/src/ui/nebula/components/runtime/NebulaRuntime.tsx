import { lazy, Suspense, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18n, { registerLanguage, type LocaleBundle } from "@core/i18n";
import { getNotificationSounds, getPreferences, getSavedAudioSettings } from "@core/preferencesStorage";
import { useAppStore } from "@core/store";
import { useCalendarReminders } from "@core/features/chat/calendar/useCalendarReminders";
import { requestJoinMeeting } from "@core/features/chat/calendar/meetings";
import { useWatchLifecycle } from "@core/features/chat/watch/useWatchLifecycle";
import { applyAllGlobalShortcuts, loadShortcuts } from "@core/features/settings/shortcutHelpers";
import {
  applyAllUserShortcuts,
  JUMP_TO_USER_EVENT,
  loadUserShortcuts,
  type JumpToUserDetail,
} from "@core/features/settings/userShortcuts";
import { setKlipyApiKey } from "@core/features/chat/gif/klipyConfig";
import { DEFAULT_NOTIFICATION_SOUNDS } from "@core/features/notifications/sounds";
import { useNotificationSounds } from "@core/features/notifications/useNotificationSounds";
import type { AudioSettings, NotificationSoundSettings } from "@core/types";
import { useCodeHighlight } from "@standard/hooks/useCodeHighlight";
import { useSpoilerReveal } from "@standard/hooks/useSpoilerReveal";
import { useVisualViewport } from "@standard/hooks/useVisualViewport";

const PluginInteractionLayer = lazy(() => import("@standard/components/plugin/PluginInteractionLayer"));
const TranslationPickerOverlay = lazy(
  () => import("@standard/components/translation/TranslationPickerOverlay"),
);
const PluginDisabledDialog = lazy(() => import("@standard/components/elements/PluginDisabledDialog"));
const WelcomeMessageModal = lazy(() => import("@standard/components/server/WelcomeMessageModal"));
const OnboardingModal = lazy(() => import("../onboarding/OnboardingModal"));

/**
 * Everything the client has to do that is not a screen: preference bootstrap,
 * audio and shortcut setup, notification sounds, deep links, and the handful of
 * always-mounted overlays.
 *
 * A UI pack owns its own runtime because the pack decides which overlays exist
 * and when they mount; the work itself is all shared `@core` behaviour, so
 * nothing here is Nebula-specific beyond the mounting.
 */
function NebulaRuntimeInner({ onOpenMarketplace }: { onOpenMarketplace: (pluginId?: string) => void }) {
  const [notificationSounds, setNotificationSounds] =
    useState<NotificationSoundSettings>(DEFAULT_NOTIFICATION_SOUNDS);
  useVisualViewport();
  useNotificationSounds(notificationSounds);
  useCalendarReminders();
  useSpoilerReveal();
  useCodeHighlight();
  useWatchLifecycle();

  useEffect(() => {
    void getPreferences().then((preferences) => {
      setKlipyApiKey(preferences.klipyApiKey);
      useAppStore.setState({
        disableLinkPreviews: preferences.disableLinkPreviews ?? false,
        disableOsmMaps: preferences.disableOsmMaps ?? false,
        enableExternalEmbeds: preferences.enableExternalEmbeds ?? false,
        streamerMode: preferences.streamerMode ?? false,
      });
      void invoke("set_notifications_enabled", {
        enabled: preferences.streamerMode ? false : (preferences.enableNotifications ?? true),
      }).catch(() => undefined);
      void invoke("set_disable_dual_path", { disabled: !(preferences.enableDualPath ?? false) }).catch(
        () => undefined,
      );
      void invoke("set_log_level", {
        filter: preferences.logLevel ?? (preferences.debugLogging ? "debug" : "info"),
      }).catch(() => undefined);
      void invoke("updater_set_auto_install", { enabled: preferences.autoUpdateOnStartup ?? false }).catch(
        () => undefined,
      );
      void invoke("updater_set_skipped_version", { version: preferences.skippedUpdateVersion ?? null }).catch(
        () => undefined,
      );
    });
    void getNotificationSounds().then((settings) => {
      if (settings) setNotificationSounds(settings);
    });
    void getSavedAudioSettings()
      .then(async (saved) => {
        if (!saved) return;
        const defaults = await invoke<AudioSettings>("get_audio_settings");
        await invoke("set_audio_settings", { settings: { ...defaults, ...saved } });
        await invoke("probe_microphone");
      })
      .catch((reason) => console.error("Nebula audio bootstrap failed:", reason));
    void loadShortcuts()
      .then(applyAllGlobalShortcuts)
      .catch((reason) => console.error("Nebula shortcut bootstrap failed:", reason));
    void loadUserShortcuts()
      .then(applyAllUserShortcuts)
      .catch((reason) => console.error("Nebula user shortcut bootstrap failed:", reason));
  }, []);

  useEffect(() => {
    const update = (event: Event) =>
      setNotificationSounds((event as CustomEvent<NotificationSoundSettings>).detail);
    globalThis.addEventListener("notification-sounds-changed", update);
    return () => globalThis.removeEventListener("notification-sounds-changed", update);
  }, []);

  useEffect(() => {
    const jump = async (event: Event) => {
      const detail = (event as CustomEvent<JumpToUserDetail>).detail;
      if (!detail) return;
      type Match = { serverId: string; userSession: number; userName: string };
      let match = detail.userHash
        ? await invoke<Match | null>("find_user_by_hash", { userHash: detail.userHash })
        : null;
      if (!match && detail.serverId)
        match = await invoke<Match | null>("find_user_in_server", {
          serverId: detail.serverId,
          userName: detail.userName,
        });
      if (!match) return;
      if (useAppStore.getState().activeServerId !== match.serverId)
        await useAppStore.getState().switchServer(match.serverId);
      await useAppStore.getState().selectDmUser(match.userSession);
    };
    globalThis.addEventListener(JUMP_TO_USER_EVENT, jump);
    return () => globalThis.removeEventListener(JUMP_TO_USER_EVENT, jump);
  }, []);

  useEffect(() => {
    const translation = listen<{ code: string; bundle: Partial<LocaleBundle> | null }>(
      "translation:apply",
      (event) => {
        const { code, bundle } = event.payload;
        if (!code) return;
        if (bundle) registerLanguage(code, bundle);
        if (i18n.language !== code) void i18n.changeLanguage(code);
        else i18n.emit("languageChanged", code);
      },
    );
    const deepLink = listen<string>("deep-link-open", (event) => {
      let url: URL;
      try {
        url = new URL(event.payload);
      } catch {
        return;
      }
      if (url.protocol !== "fancy:") return;
      const segments = [url.host, ...url.pathname.split("/")].filter(Boolean);
      if (segments[0] === "marketplace" && segments[1] === "plugin" && segments[2])
        onOpenMarketplace(decodeURIComponent(segments[2]));
      if (segments[0] === "meeting" && segments[1])
        requestJoinMeeting(decodeURIComponent(segments[1]), url.searchParams.get("t") ?? undefined);
    });
    return () => {
      void translation.then((off) => off());
      void deepLink.then((off) => off());
    };
  }, [onOpenMarketplace]);

  return (
    <Suspense fallback={null}>
      <PluginInteractionLayer />
      <TranslationPickerOverlay />
      <PluginDisabledDialog />
      <WelcomeMessageModal />
      <OnboardingModal />
    </Suspense>
  );
}

export function NebulaRuntime(props: { onOpenMarketplace: (pluginId?: string) => void }) {
  // Everything above talks to the Tauri backend; outside the webview (tests,
  // plain browser) there is nothing to bootstrap.
  if (!("__TAURI_INTERNALS__" in globalThis)) return null;
  return <NebulaRuntimeInner {...props} />;
}
