/**
 * The own account's devices, as both skins' Account pages list them.
 *
 * Starling lets one account be online from several devices at once and keeps
 * a list of them. The owner can rename any device and sign out any but the
 * one they are on. Signing out disconnects that device and refuses it from
 * then on. The list, the ordering and the editing state are shared here; each
 * skin only draws them.
 */

import { useCallback, useState } from "react";
import type { AccountDevice, AccountSettings } from "../../types";
import { formatRelativeDate } from "../../utils/format";

/** The longest device name the server keeps; it cuts longer ones. */
export const MAX_DEVICE_NAME = 64;

/**
 * The devices to list: this one first, then the ones online, then the rest
 * by when they were last seen.
 */
export function orderedDevices(snapshot: AccountSettings): AccountDevice[] {
  const own = snapshot.this_device ?? null;
  const rank = (device: AccountDevice) => (device.id === own ? 0 : device.online ? 1 : 2);
  return [...(snapshot.devices ?? [])].sort(
    (a, b) => rank(a) - rank(b) || b.last_seen_ms - a.last_seen_ms || a.id.localeCompare(b.id),
  );
}

/** How a device is doing, as a translation key under `account.devices` and its arguments. */
export interface DeviceStatus {
  key: "thisDevice" | "online" | "lastSeen" | "neverSeen";
  when?: string;
}

export function deviceStatus(device: AccountDevice, thisDevice: string | null | undefined): DeviceStatus {
  if (device.id === thisDevice) return { key: "thisDevice" };
  if (device.online) return { key: "online" };
  // Registered ahead by a linking device and not signed in yet.
  if (device.last_seen_ms === 0) return { key: "neverSeen" };
  return { key: "lastSeen", when: formatRelativeDate(new Date(device.last_seen_ms).toISOString()) };
}

/**
 * Which device is being renamed or confirmed for sign-out, and the draft name.
 *
 * One at a time: a second rename field open beside the first would leave the
 * user guessing which one Save applies to.
 */
export function useDeviceEditor() {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [signingOut, setSigningOut] = useState<string | null>(null);
  const startRename = useCallback((device: AccountDevice) => {
    setSigningOut(null);
    setRenaming(device.id);
    setDraft(device.name);
  }, []);
  const startSignOut = useCallback((device: AccountDevice) => {
    setRenaming(null);
    setSigningOut(device.id);
  }, []);
  // Stable, because the pages close the editor from an effect keyed on the
  // last successful action, and a new function each render would re-run it.
  const cancel = useCallback(() => {
    setRenaming(null);
    setSigningOut(null);
  }, []);
  return { renaming, draft, signingOut, setDraft, startRename, startSignOut, cancel };
}
