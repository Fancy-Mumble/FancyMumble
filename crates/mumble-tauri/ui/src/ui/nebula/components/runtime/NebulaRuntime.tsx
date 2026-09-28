import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18n, { registerLanguage, type LocaleBundle } from "@core/i18n";
import { getNotificationSounds, getPreferences, getSavedAudioSettings } from "@core/preferencesStorage";
import { useAppStore } from "@core/store";
import { useCalendarReminders } from "@core/features/chat/calendar/useCalendarReminders";
import { requestJoinMeeting } from "@core/features/chat/calendar/meetings";
import { parseInviteLink, type ParsedInvite } from "@core/features/invites/inviteLink";
import { followDeviceLink } from "@core/features/devices/deviceLink";
import { useWatchLifecycle } from "@core/features/chat/watch/useWatchLifecycle";
import { applyAllGlobalShortcuts, loadShortcuts } from "@core/features/settings/shortcutHelpers";
import {
  applyAllUserShortcuts,
  JUMP_TO_USER_EVENT,
  loadUserShortcuts,
  type JumpToUserDetail,
} from "@core/features/settings/userShortcuts";
import {
  applyAllWhisperTargets,
  loadWhisperTargets,
  startWhisperSync,
} from "@core/features/settings/whisperTargets";
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
interface NebulaRuntimeProps {
  onOpenMarketplace: (pluginId?: string) => void;
  /** A followed `fancy://invite/...` link. */
  onOpenInvite: (invite: ParsedInvite) => void;
}

function NebulaRuntimeInner({ onOpenMarketplace, onOpenInvite }: NebulaRuntimeProps) {
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
      void invoke("updater_set_beta_channel", { enabled: preferences.betaUpdates ?? false }).catch(
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
    void loadWhisperTargets()
      .then(applyAllWhisperTargets)
      .catch((reason) => console.error("Nebula whisper shortcut bootstrap failed:", reason));
  }, []);

  // Keeps every whisper target registered with the server ahead of its key,
  // so a press only switches slots and its first syllable is not lost.
  useEffect(() => startWhisperSync(), []);

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

  // Read through refs so the listener below is registered once: the shell
  // hands these in as fresh arrows every render, and re-subscribing on each
  // one would also re-ask the backend for a parked launch link every time.
  const openMarketplace = useRef(onOpenMarketplace);
  const openInvite = useRef(onOpenInvite);
  openMarketplace.current = onOpenMarketplace;
  openInvite.current = onOpenInvite;

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
    const route = (link: string) => {
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        return;
      }
      if (url.protocol !== "fancy:") return;
      const segments = [url.host, ...url.pathname.split("/")].filter(Boolean);
      if (segments[0] === "marketplace" && segments[1] === "plugin" && segments[2])
        openMarketplace.current(decodeURIComponent(segments[2]));
      if (segments[0] === "meeting" && segments[1])
        requestJoinMeeting(decodeURIComponent(segments[1]), url.searchParams.get("t") ?? undefined);
      if (segments[0] === "invite") {
        const invite = parseInviteLink(link);
        if (invite) openInvite.current(invite);
      }
      // A link from another of the owner's devices: sign this one in as the
      // same account. Errors land where every other connect error does.
      if (segments[0] === "link") {
        void followDeviceLink(link).catch((error: unknown) =>
          console.warn("deep-link: device link failed", error),
        );
      }
    };
    const deepLink = listen<string>("deep-link-open", (event) => route(event.payload));
    // A link that launched the app arrived before anything was listening, so
    // the backend parked it; collected once the listener above is up.
    void deepLink
      .then(() => invoke<string | null>("take_pending_deep_link"))
      .then((pending) => {
        if (pending) route(pending);
      })
      .catch(() => undefined);
    return () => {
      void translation.then((off) => off());
      void deepLink.then((off) => off());
    };
  }, []);

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

export function NebulaRuntime(props: NebulaRuntimeProps) {
  // Everything above talks to the Tauri backend; outside the webview (tests,
  // plain browser) there is nothing to bootstrap.
  if (!("__TAURI_INTERNALS__" in globalThis)) return null;
  return <NebulaRuntimeInner {...props} />;
}
