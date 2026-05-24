// Tauri-backed persistence for Tier-1 plugin trust decisions.  Keyed
// by serverId (the active SavedServer's UUID); decisions taken while
// no server is selected fall back to a sentinel "<no-server>" key so
// they at least survive the session.

import { load } from "@tauri-apps/plugin-store";
import type { TrustRecord } from "./trust";

const STORE_FILE = "pluginTrust.json";
const STORE_KEY = "trust";

/** Sentinel server id used when the connection has no SavedServer
 *  attached (e.g. quick-connect flow). */
const NO_SERVER_KEY = "<no-server>";

/** Key under which globally-trusted ("always allow") records are stored. */
const GLOBAL_KEY = "*";

type ServerTrustMap = Record<string, TrustRecord>;
type GlobalTrustMap = Record<string, ServerTrustMap>;

async function getStore() {
  return load(STORE_FILE, { autoSave: true, defaults: {} });
}

function keyFor(serverId: string | null): string {
  return serverId ?? NO_SERVER_KEY;
}

/** Load every trust record effective for a given server.
 *  Global records ("always allow") provide a baseline; server-specific
 *  records override them, so a per-server deny wins over a global allow. */
export async function loadServerTrust(
  serverId: string | null,
): Promise<Record<string, TrustRecord>> {
  const store = await getStore();
  const all = (await store.get<GlobalTrustMap>(STORE_KEY)) ?? {};
  return { ...(all[GLOBAL_KEY] ?? {}), ...(all[keyFor(serverId)] ?? {}) };
}

/** Persist a trust record that applies to every server ("always allow"). */
export async function saveGlobalTrustRecord(
  pluginName: string,
  record: TrustRecord,
): Promise<void> {
  const store = await getStore();
  const all = (await store.get<GlobalTrustMap>(STORE_KEY)) ?? {};
  all[GLOBAL_KEY] = { ...(all[GLOBAL_KEY] ?? {}), [pluginName]: record };
  await store.set(STORE_KEY, all);
}

/** Persist a single trust record. */
export async function saveTrustRecord(
  serverId: string | null,
  pluginName: string,
  record: TrustRecord,
): Promise<void> {
  const store = await getStore();
  const all = (await store.get<GlobalTrustMap>(STORE_KEY)) ?? {};
  const k = keyFor(serverId);
  all[k] = { ...(all[k] ?? {}), [pluginName]: record };
  await store.set(STORE_KEY, all);
}

/** Drop a trust record so the next registry refresh re-prompts.
 *  Removes from both the server-specific bucket and the global bucket
 *  so that "Allowed - All Servers" records are fully cleared too. */
export async function revokeTrustRecord(
  serverId: string | null,
  pluginName: string,
): Promise<void> {
  const store = await getStore();
  const all = (await store.get<GlobalTrustMap>(STORE_KEY)) ?? {};

  const k = keyFor(serverId);
  if (all[k]) {
    const { [pluginName]: _a, ...rest } = all[k];
    void _a;
    all[k] = rest;
  }

  if (all[GLOBAL_KEY]) {
    const { [pluginName]: _b, ...globalRest } = all[GLOBAL_KEY];
    void _b;
    all[GLOBAL_KEY] = globalRest;
  }

  await store.set(STORE_KEY, all);
}
