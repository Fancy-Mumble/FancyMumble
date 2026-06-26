/**
 * Calendar sync transport + persistence (the Tauri-touching layer).
 *
 * - Outbound: ships shared meeting data to the `fancy-calendar` plugin over the
 *   generic PluginMessage channel (`sendPluginMessage`).
 * - Persistence: reads/writes the user's whole calendar to the file-server
 *   per-user private store (`/me/storage/calendar`) via the existing
 *   `fileserver_get_private` / `fileserver_put_private` commands.
 *
 * Inbound handling and store mutation live in `calendarStore.ts` so this module
 * has no dependency on the calendar store (avoids an import cycle).
 */

import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../../store";
import { sendPluginMessage } from "../../../store/plugins";

export const CALENDAR_PLUGIN = "fancy-calendar";
const STORAGE_KEY = "calendar";

/** Fire-and-forget a calendar message to the plugin. */
export function sendCalendar(payloadType: string, payload: unknown): void {
  void sendPluginMessage(CALENDAR_PLUGIN, payloadType, payload).catch((e) => {
    console.error("[calendar] sendPluginMessage failed:", e);
  });
}

/**
 * Show a desktop notification through the Tauri notification plugin's Rust IPC
 * command (`plugin:notification|notify`).
 *
 * Deliberately NOT `@tauri-apps/plugin-notification`'s `sendNotification`, which
 * merely constructs a Web `Notification` in the webview - that path is
 * unreliable on desktop (the embedded webview may not surface it) and bypasses
 * the plugin's native delivery and OS permission handling. Routing through the
 * Rust command uses the platform's real notification API. Fire-and-forget;
 * `notification:allow-notify` is granted in the app capabilities.
 */
export function showDesktopNotification(title: string, body: string): void {
  // Also surface every notification as a DOM event, decoupling delivery from
  // observation: an in-app notification UI can react to it, and e2e tests can
  // assert it (the native IPC below is not interceptable from the webview, whose
  // `__TAURI_INTERNALS__.invoke` is locked non-writable).
  try {
    globalThis.dispatchEvent(
      new CustomEvent("fancy:desktop-notification", { detail: { title, body } }),
    );
  } catch {
    /* no DOM event target (non-browser context) */
  }
  void invoke("plugin:notification|notify", { options: { title, body } }).catch((e) => {
    console.error("[calendar] notify failed:", e);
  });
}

/** File-server base URL + session JWT, or null when unavailable (no file-server
 *  configured, or the user is unregistered - the private store is reg-only). */
function fsConfig(): { baseUrl: string; sessionJwt: string } | null {
  const cfg = useAppStore.getState().fileServerConfig;
  if (!cfg?.sessionJwt) return null;
  return { baseUrl: cfg.baseUrl, sessionJwt: cfg.sessionJwt };
}

/** True once persistence is possible (file-server config with a session JWT). */
export function canPersistCalendar(): boolean {
  return fsConfig() !== null;
}

/** Load the user's calendar blob from the private store, or null. */
export async function loadCalendarBlob(): Promise<string | null> {
  const cfg = fsConfig();
  if (!cfg) return null;
  try {
    return await invoke<string | null>("fileserver_get_private", {
      request: { baseUrl: cfg.baseUrl, sessionJwt: cfg.sessionJwt, key: STORAGE_KEY },
    });
  } catch (e) {
    console.error("[calendar] load failed:", e);
    return null;
  }
}

/** Persist the user's calendar blob to the private store. */
export async function saveCalendarBlob(json: string): Promise<void> {
  const cfg = fsConfig();
  if (!cfg) return;
  try {
    await invoke("fileserver_put_private", {
      request: { baseUrl: cfg.baseUrl, sessionJwt: cfg.sessionJwt, key: STORAGE_KEY, value: json },
    });
  } catch (e) {
    console.error("[calendar] save failed:", e);
  }
}
