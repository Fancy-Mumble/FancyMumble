/**
 * What follows a person from one of their devices to the next: a few
 * preferences, and the servers they use with this identity.
 *
 * Both live in the account's records on the server, written by whichever
 * device changed them and pushed by Starling to the account's other sessions
 * (`account-record-changed`). A device that connects later reads them then.
 *
 * - `prefs/v1`: the preferences in {@link SYNCED_PREFERENCES}, with the time
 *   they were last changed; the newer side wins. Only preferences about the
 *   person, not the machine - no audio devices, skin, logging or window
 *   layout, which rightly differ between a phone and a desktop.
 * - `servers/v1`: the saved servers that use this connection's identity, with
 *   their passwords, sealed under the identity seed (`account_seal`) so the
 *   server holding it cannot read which other servers its user visits. A
 *   device adds what it has not seen; one its owner removed on purpose is
 *   remembered (`syncedServerKeys`) and not brought back.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { useAppStore } from "../../store";
import type { UserPreferences } from "../../types";
import { getRecord, putRecord } from "../accountRecords";
import { getPreferences, updatePreferences } from "../../preferencesStorage";
import { addServer, getSavedServers, getServerPassword, setServerPassword } from "../../serverStorage";

/** The preferences a person's devices share. */
export const SYNCED_PREFERENCES = [
  "timeFormat",
  "convertToLocalTime",
  "dateFormat",
  "numberFormat",
  "disableReadReceipts",
  "disableTypingIndicators",
  "disableOsmMaps",
  "disableLinkPreviews",
  "enableExternalEmbeds",
  "showOfflineMembers",
  "hideEmptyChannels",
  "persistDms",
  "welcomeMessageDisplay",
  "trustedLinkHosts",
  "showDisconnectWarning",
] as const satisfies readonly (keyof UserPreferences)[];

const PREFS_KEY = "prefs/v1";
const SERVERS_KEY = "servers/v1";

/** How long local changes settle before they are written. */
const PUSH_DELAY_MS = 2000;

interface PrefsRecord {
  updatedAt: number;
  values: Partial<UserPreferences>;
}

export interface SyncedServer {
  host: string;
  port: number;
  username: string;
  label: string;
  password?: string | null;
}

type AppStore = typeof useAppStore;

/** The shared part of `prefs`, in a stable order so two copies compare equal. */
export function pickSynced(prefs: Partial<UserPreferences>): Partial<UserPreferences> {
  const picked: Record<string, unknown> = {};
  for (const key of SYNCED_PREFERENCES) {
    if (prefs[key] !== undefined) picked[key] = prefs[key];
  }
  return picked as Partial<UserPreferences>;
}

/**
 * The list to publish: the record's, with this device's entries added, or
 * `null` when this device has nothing the record lacks.
 *
 * Only an addition is ever a reason to write. Two devices whose copies differ
 * in a label or a password would otherwise take turns overwriting each other
 * for as long as both were online, each write pushed to the other and
 * answered with its own.
 */
export function serversToPublish(
  remote: readonly SyncedServer[],
  mine: readonly SyncedServer[],
): SyncedServer[] | null {
  const known = new Set(remote.map(serverKey));
  const missing = mine.filter((server) => !known.has(serverKey(server)));
  return missing.length === 0 ? null : [...remote, ...missing];
}

/** The key a saved server is known by across devices. */
export function serverKey(server: { host: string; port: number; username: string }): string {
  return `${server.host.trim().toLowerCase()}:${server.port}:${server.username.trim().toLowerCase()}`;
}

/**
 * The entries of `remote` this device should add: not saved here already, and
 * not ones its owner removed here before.
 */
export function serversToAdd(
  remote: readonly SyncedServer[],
  local: readonly { host: string; port: number; username: string }[],
  seen: readonly string[],
): SyncedServer[] {
  const have = new Set([...local.map(serverKey), ...seen]);
  const adding = new Map<string, SyncedServer>();
  for (const server of remote) {
    const key = serverKey(server);
    if (!have.has(key) && !adding.has(key)) adding.set(key, server);
  }
  return [...adding.values()];
}

function parse<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Start syncing for as long as the app runs. Returns the function that stops
 * it, in the shape `initEventListeners` collects.
 */
export function startAccountSync(store: AppStore): () => void {
  let lastShared: string | null = null;
  let applyingRemote = false;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;

  void getPreferences()
    .then((prefs) => {
      lastShared = JSON.stringify(pickSynced(prefs));
    })
    .catch(() => undefined);

  const connected = () => store.getState().status === "connected";

  const pushPrefs = async () => {
    if (!connected()) return;
    const updatedAt = Date.now();
    const prefs = await updatePreferences({ syncedPreferencesAt: updatedAt });
    const record: PrefsRecord = { updatedAt, values: pickSynced(prefs) };
    await putRecord(PREFS_KEY, JSON.stringify(record)).catch(() => undefined);
  };

  const applyPrefs = async (record: PrefsRecord | null) => {
    if (!record) return;
    const local = await getPreferences();
    if (record.updatedAt <= (local.syncedPreferencesAt ?? 0)) return;
    applyingRemote = true;
    try {
      const values = pickSynced(record.values);
      await updatePreferences({ ...values, syncedPreferencesAt: record.updatedAt });
      // The three the store mirrors at startup; everything else is read from
      // the preferences where it is used.
      store.setState({
        ...(values.disableLinkPreviews !== undefined && { disableLinkPreviews: values.disableLinkPreviews }),
        ...(values.disableOsmMaps !== undefined && { disableOsmMaps: values.disableOsmMaps }),
        ...(values.enableExternalEmbeds !== undefined && {
          enableExternalEmbeds: values.enableExternalEmbeds,
        }),
      });
    } finally {
      applyingRemote = false;
    }
  };

  /** Add what another device saved; publish what this one has. */
  const syncServers = async (sealedRemote: string | null) => {
    const identity = store.getState().pendingConnect?.certLabel ?? null;
    // Anonymous: there is no identity for the list to belong to, and no seed
    // to seal it with.
    if (!identity) return;

    const opened = sealedRemote
      ? await invoke<string>("account_open", { sealed: sealedRemote }).catch(() => null)
      : null;
    // A list this device cannot open was sealed under a seed it does not hold
    // - it signed in by password rather than being linked. It is left alone:
    // writing this device's own list over it would lose everyone else's.
    if (sealedRemote && opened === null) return;
    const remote = parse<SyncedServer[]>(opened) ?? [];

    const prefs = await getPreferences();
    const local = await getSavedServers();
    const adding = serversToAdd(remote, local, prefs.syncedServerKeys ?? []);
    for (const server of adding) {
      const saved = await addServer({
        label: server.label || server.host,
        host: server.host,
        port: server.port,
        username: server.username,
        cert_label: identity,
      });
      if (server.password) await setServerPassword(saved.id, server.password);
    }

    // Publish this device's list for the identity, with what it just added.
    const mine = (await getSavedServers()).filter((server) => server.cert_label === identity);
    const published: SyncedServer[] = [];
    for (const server of mine) {
      const password = await getServerPassword(server.id).catch(() => null);
      published.push({
        host: server.host,
        port: server.port,
        username: server.username,
        label: server.label,
        ...(password ? { password } : {}),
      });
    }
    // Everything on the list has now been seen here, so removing it later is
    // a decision this device will remember.
    const seen = [...new Set([...(prefs.syncedServerKeys ?? []), ...published.map(serverKey)])];
    await updatePreferences({ syncedServerKeys: seen });

    const next = serversToPublish(remote, published);
    if (!next) return;
    const sealed = await invoke<string>("account_seal", { plaintext: JSON.stringify(next) }).catch(
      () => null,
    );
    if (sealed) await putRecord(SERVERS_KEY, sealed).catch(() => undefined);
  };

  const onConnected = async () => {
    try {
      const prefsRecord = await getRecord(PREFS_KEY);
      const remote = prefsRecord.found ? parse<PrefsRecord>(prefsRecord.value) : null;
      const local = await getPreferences();
      const localAt = local.syncedPreferencesAt ?? 0;
      if (remote && remote.updatedAt > localAt) await applyPrefs(remote);
      else if (localAt > (remote?.updatedAt ?? 0)) await pushPrefs();

      const serversRecord = await getRecord(SERVERS_KEY);
      await syncServers(serversRecord.found ? serversRecord.value : null);
    } catch {
      // A guest, or a server without records: nothing to share with.
    }
  };

  const onPreferencesChanged = (event: Event) => {
    const prefs = (event as CustomEvent<UserPreferences>).detail;
    if (!prefs) return;
    const shared = JSON.stringify(pickSynced(prefs));
    if (shared === lastShared) return;
    lastShared = shared;
    if (applyingRemote) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void pushPrefs().catch(() => undefined);
    }, PUSH_DELAY_MS);
  };
  window.addEventListener("preferences-changed", onPreferencesChanged);

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.status === "connected" && previous.status !== "connected") void onConnected();
  });

  const unlisten = listen<{ key: string; value: string | null; found: boolean }>(
    "account-record-changed",
    (event) => {
      const { key, value, found } = event.payload;
      if (!found) return;
      if (key === PREFS_KEY) void applyPrefs(parse<PrefsRecord>(value));
      if (key === SERVERS_KEY) void syncServers(value);
    },
  );

  return () => {
    if (pushTimer) clearTimeout(pushTimer);
    window.removeEventListener("preferences-changed", onPreferencesChanged);
    unsubscribe();
    void unlisten.then((off) => off());
  };
}
