/**
 * Linking a device, as the frontend drives it.
 *
 * The old device (already signed in) calls `beginDeviceLink` and shows the link
 * it gets back as a QR code and as text. The new device follows the link:
 * `followDeviceLink` logs in once as the device the link names, collects the
 * identity the old device left for it, saves the server with that identity,
 * and reconnects as the account. The crypto and the server round trips are
 * the backend's (`state::link`); this is the order of steps around them.
 */

import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import {
  addServer,
  getSavedServers,
  markServerJoined,
  setServerPassword,
  updateServer,
} from "../../serverStorage";

/** What the old device shows. */
export interface DeviceLinkOffer {
  /** `fancy://link/<code>?server=...&user=...`. */
  link: string;
  /** The code alone, grouped in fours. */
  code: string;
  /** The device row the link becomes, to withdraw it. */
  deviceId: string;
}

/** Where a link points. */
interface LinkTarget {
  host: string;
  port: number;
  username: string;
}

/** What the new device ends up holding. */
interface LinkedIdentity extends LinkTarget {
  label: string;
  password: string | null;
}

/** How long the one-off login may take before the link is given up on. */
const CONNECT_TIMEOUT_MS = 20_000;

/** Whether `text` is a device link rather than any other `fancy://` link. */
export function isDeviceLink(text: string): boolean {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== "fancy:") return false;
    const segments = [url.host, ...url.pathname.split("/")].filter(Boolean);
    return segments[0] === "link" && Boolean(segments[1]);
  } catch {
    return false;
  }
}

/**
 * Offer this account to a new device. `password` is the one saved for this
 * login, if any; it travels sealed, so the new device can sign in as this one
 * does.
 */
export function beginDeviceLink(password: string | null): Promise<DeviceLinkOffer> {
  return invoke<DeviceLinkOffer>("begin_device_link", { password });
}

/** Withdraw a link nobody completed. */
export function cancelDeviceLink(deviceId: string): Promise<void> {
  return invoke("cancel_device_link", { deviceId });
}

/** Resolve once the active session is connected, or reject on a timeout or refusal. */
function whenConnected(): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (state: ReturnType<typeof useAppStore.getState>) => {
      if (state.status === "connected") {
        cleanup();
        resolve();
      } else if (state.status === "disconnected" && state.error) {
        cleanup();
        reject(new Error(state.error));
      }
    };
    const unsubscribe = useAppStore.subscribe(settle);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, CONNECT_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      unsubscribe();
    }
    settle(useAppStore.getState());
  });
}

/**
 * Follow a device link on the new device, start to finish.
 *
 * Throws with the backend's sentence when the link cannot be read, the server
 * refuses the one-off login (the link expired, or was withdrawn), or the
 * parcel will not open.
 */
export async function followDeviceLink(link: string): Promise<LinkedIdentity> {
  const target = await invoke<LinkTarget>("start_device_link", { link });
  const store = useAppStore.getState();

  // The one-off login: no certificate and no password, only the device the
  // link names, which the backend now presents for this server.
  await store.connect(target.host, target.port, target.username, null, null);
  await whenConnected();
  const linked = await invoke<LinkedIdentity>("finish_device_link");

  // Saved under the identity it came with, so every later connect - and the
  // reconnect just below - signs in as the account rather than as a guest.
  const saved = (await getSavedServers()).find(
    (server) =>
      server.host === linked.host &&
      server.port === linked.port &&
      server.username.toLowerCase() === linked.username.toLowerCase(),
  );
  const server = saved
    ? (await updateServer(saved.id, { cert_label: linked.label }), { ...saved, cert_label: linked.label })
    : await addServer({
        label: linked.host,
        host: linked.host,
        port: linked.port,
        username: linked.username,
        cert_label: linked.label,
      });
  if (linked.password) await setServerPassword(server.id, linked.password);

  await useAppStore.getState().disconnect();
  await useAppStore
    .getState()
    .connect(linked.host, linked.port, linked.username, linked.label, linked.password);
  await markServerJoined(server.id).catch(() => undefined);
  return linked;
}
