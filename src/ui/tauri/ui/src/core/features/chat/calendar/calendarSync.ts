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
import { RECORD_KEYS, classify, getRecord, putRecord } from "../../accountRecords";
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
 * Show a desktop notification through our own Rust command.
 *
 * Deliberately NOT `@tauri-apps/plugin-notification`'s `sendNotification`, which
 * merely constructs a Web `Notification` in the webview - that path is
 * unreliable on desktop (the embedded webview may not surface it) and bypasses
 * the platform's real notification API.
 *
 * Equally NOT the plugin's own `plugin:notification|notify` command: on Linux it
 * runs notify-rust's blocking D-Bus call on the async runtime, which panics
 * ("Cannot start a runtime from within a runtime") and, under `panic = "abort"`,
 * kills the app. Our command routes to the same shared helper the protocol
 * emitter uses, which drives that call from a blocking thread.
 * Fire-and-forget.
 */
export function showDesktopNotification(title: string, body: string): void {
  // Also surface every notification as a DOM event, decoupling delivery from
  // observation: an in-app notification UI can react to it, and e2e tests can
  // assert it (the native IPC below is not interceptable from the webview, whose
  // `__TAURI_INTERNALS__.invoke` is locked non-writable).
  try {
    globalThis.dispatchEvent(new CustomEvent("fancy:desktop-notification", { detail: { title, body } }));
  } catch {
    /* no DOM event target (non-browser context) */
  }
  void invoke("show_desktop_notification", { title, body }).catch((e) => {
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

/** Where this connection's calendar is kept.
 *
 *  Settled by the first load, so a save cannot land in a store the load did
 *  not come from. */
let backend: "records" | "plugin" | null = null;

/** Load the user's calendar blob from the server, or null.
 *
 *  The account record store first, and the file-server plugin only where the
 *  server has no record store: the plugin needs an operator to have loaded it,
 *  and the record store is simply part of the server. */
export async function loadCalendarBlob(): Promise<string | null> {
  try {
    const record = await getRecord(RECORD_KEYS.calendar);
    backend = "records";
    return record.found ? record.value : null;
  } catch (e) {
    if (classify(e).failure !== "unsupported") {
      // A guest, or a failed read. Neither is a reason to write into the
      // plugin instead - this server keeps records and this account's answer
      // is the one that counts.
      backend = "records";
      console.warn("[calendar] record load failed:", e);
      return null;
    }
  }

  backend = "plugin";
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
  // Nothing is written before a load has said where this calendar lives: a
  // save that guessed would write a fresh calendar over a stored one.
  if (backend === null) return;
  if (backend === "records") {
    try {
      await putRecord(RECORD_KEYS.calendar, json);
    } catch (e) {
      console.error("[calendar] save failed:", e);
    }
    return;
  }
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
