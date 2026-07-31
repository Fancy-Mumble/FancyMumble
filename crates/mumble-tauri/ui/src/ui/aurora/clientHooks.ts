/**
 * Self-contained subscriptions the client screens depend on.
 *
 * Each of these was a `useEffect` in AuroraClientApp owning an independent
 * lifecycle - a store listener, a preferences feed, a backend query. Living in
 * one component body meant they shared scope with everything else and could
 * only be reasoned about together. As hooks each one owns its own state,
 * cleans up after itself, and can be mounted (or not) per screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { initEventListeners, useAppStore } from "@core/store";
import { getPreferences } from "@core/preferencesStorage";
import { setKlipyApiKey } from "@core/features/chat/gif/klipyConfig";
import {
  DEFAULT_SHORTCUTS,
  loadShortcuts,
  type ShortcutBindings,
} from "@core/features/settings/shortcutHelpers";
import { getSavedServers } from "@core/serverStorage";
import { loadPersonalization } from "@ui/standard/personalizationStorage";
import {
  getUserRelations,
  USER_RELATIONS_CHANGED_EVENT,
  type UserRelation,
} from "@core/userRelationsStorage";
import type { MumbleServerConfig, RegisteredUser, SavedServer } from "@core/types";
import { applyAuroraAppearance } from "./components";

/** Ignore/block list, kept in sync with the storage-change event. */
export function useUserRelations(): Record<string, UserRelation> {
  const [relations, setRelations] = useState<Record<string, UserRelation>>({});
  useEffect(() => {
    let active = true;
    const load = () =>
      void getUserRelations()
        .then((value) => {
          if (active) setRelations(value);
        })
        .catch(() => {
          if (active) setRelations({});
        });
    load();
    globalThis.addEventListener(USER_RELATIONS_CHANGED_EVENT, load);
    return () => {
      active = false;
      globalThis.removeEventListener(USER_RELATIONS_CHANGED_EVENT, load);
    };
  }, []);
  return relations;
}

/** The subset of preferences the client chrome reacts to live. */
export function useClientPreferences(): { hideEmptyChannels: boolean } {
  const [hideEmptyChannels, setHideEmptyChannels] = useState(false);
  useEffect(() => {
    let active = true;
    const apply = (preferences: { hideEmptyChannels?: boolean; klipyApiKey?: string }) => {
      if (!active) return;
      setHideEmptyChannels(preferences.hideEmptyChannels ?? false);
      setKlipyApiKey(preferences.klipyApiKey);
    };
    void getPreferences()
      .then(apply)
      .catch(() => undefined);
    const onChanged = (event: Event) =>
      apply((event as CustomEvent<{ hideEmptyChannels?: boolean; klipyApiKey?: string }>).detail);
    globalThis.addEventListener("preferences-changed", onChanged);
    return () => {
      active = false;
      globalThis.removeEventListener("preferences-changed", onChanged);
    };
  }, []);
  return { hideEmptyChannels };
}

export function useShortcutBindings(): ShortcutBindings {
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  useEffect(() => {
    const reload = () =>
      void loadShortcuts()
        .then(setShortcuts)
        .catch(() => undefined);
    reload();
    globalThis.addEventListener("shortcuts-changed", reload);
    return () => globalThis.removeEventListener("shortcuts-changed", reload);
  }, []);
  return shortcuts;
}

/** Saved servers plus an explicit reload, for screens that mutate the list. */
export function useSavedServers(): { savedServers: SavedServer[] | null; reload: () => void } {
  const [savedServers, setSavedServers] = useState<SavedServer[] | null>(null);
  const reload = useCallback(() => {
    void getSavedServers()
      .then(setSavedServers)
      .catch(() => setSavedServers([]));
  }, []);
  useEffect(reload, [reload]);
  return { savedServers, reload };
}

/** Server-side account list, refetched whenever the session changes. */
export function useRegisteredUsers(activeServerId: string | null, status: string): RegisteredUser[] {
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  useEffect(() => {
    setRegisteredUsers([]);
    if (status === "disconnected") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<RegisteredUser[]>("user-list", (event) => {
      if (!disposed) setRegisteredUsers(event.payload);
    })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
        return invoke("request_user_list");
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [activeServerId, status]);
  return registeredUsers;
}

/** Backend event listeners for the whole client, torn down on unmount. */
export function useClientEventBridge(navigate: Parameters<typeof initEventListeners>[0]): void {
  useEffect(() => {
    let cancelled = false;
    let unlisteners: (() => void)[] = [];
    void initEventListeners(navigate)
      .then((listeners) => {
        if (cancelled) listeners.forEach((unlisten) => unlisten());
        else unlisteners = listeners;
      })
      .catch((reason) => console.error("Aurora event bootstrap failed:", reason));
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [navigate]);
}

export function useAuroraAppearance(): void {
  useEffect(() => {
    void loadPersonalization()
      .then(applyAuroraAppearance)
      .catch(() => undefined);
  }, []);
}

/**
 * The backend's ServerConfig event can land before this UI mounts (switching
 * design packs while already connected), which would leave us on the built-in
 * defaults - notably a 128 KiB image cap. Pull the real limits on connect.
 */
export function useServerConfigSync(activeServerId: string | null, status: string): void {
  useEffect(() => {
    if (status === "disconnected") return;
    void invoke<MumbleServerConfig>("get_server_config")
      .then((serverConfig) => {
        console.info("aurora: server limits", {
          image: serverConfig.max_image_message_length,
          message: serverConfig.max_message_length,
        });
        useAppStore.setState({ serverConfig });
      })
      .catch((reason) => console.error("get_server_config failed:", reason));
  }, [activeServerId, status]);
}

/** Dismisses a floating menu on the next click, context-menu, or blur. */
export function useDismissOnInteraction(open: boolean, dismiss: () => void): void {
  useEffect(() => {
    if (!open) return;
    globalThis.addEventListener("click", dismiss);
    globalThis.addEventListener("blur", dismiss);
    globalThis.addEventListener("contextmenu", dismiss);
    return () => {
      globalThis.removeEventListener("click", dismiss);
      globalThis.removeEventListener("blur", dismiss);
      globalThis.removeEventListener("contextmenu", dismiss);
    };
  }, [open, dismiss]);
}

/**
 * Message bodies are rendered as HTML, so delegate image clicks at the list
 * level rather than rewriting every <img> into a button. Bound through a
 * callback ref: an effect would run while the launcher is still mounted (list
 * ref still null) and never re-bind once the chat appears.
 */
export function useMessageImageClicks(onOpen: (src: string) => void): (node: HTMLElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback(
    (node: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!node) return;
      const onClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target || target.tagName !== "IMG") return;
        // The lightbox indexes media by the raw attribute (see extractMedia), not
        // the resolved absolute URL, so look it up with the same value.
        const src = target.getAttribute("src");
        if (src) onOpen(src);
      };
      node.addEventListener("click", onClick);
      cleanup.current = () => node.removeEventListener("click", onClick);
    },
    [onOpen],
  );
}
