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
