/**
 * Plugin trust + plugin envelope API.
 *
 * Lifted out of `store.ts` so the giant root store file is smaller and
 * the plugin surface is reviewable on its own.  Everything in here is a
 * free function that reads/writes through `useAppStore.getState()` /
 * `setState()` rather than living inside the Zustand `create()` call,
 * which keeps the import graph one-directional (this module imports
 * `useAppStore` from `../store`; `../store` re-exports back out so
 * existing `import { resolvePluginTrust } from "./store"` callers keep
 * working unchanged).
 *
 * The cyclic `import` works because nothing here touches `useAppStore`
 * at module-eval time - every reference is inside a function body, so
 * by the time these functions are actually called both modules are
 * fully loaded.
 */

import { invoke } from "@tauri-apps/api/core";

import { useAppStore } from "../store";
import type { AppState } from "../store";
import type { PluginTier1Slice } from "../plugins/tier1/store";
import type { SessionMeta } from "../types";
import {
  applyRegistryWithTrust,
  applyTrustDecision,
  applyTrustRevocation,
  sendInteraction as sendInteractionInternal,
  type PluginMessageSender,
} from "../plugins/tier1/store";
import {
  recordFromDecision,
  TrustDecision,
  TrustScope,
  type PendingTrustPrompt,
} from "../plugins/tier1/trust";
import { parseClientManifest } from "../plugins/tier1/manifest";
import type { InteractionKind } from "../plugins/tier1/types";
import {
  loadServerTrust,
  revokeTrustRecord,
  saveGlobalTrustRecord,
  saveGlobalTrustRecords,
  saveTrustRecord,
  saveTrustRecords,
  type NamedTrustRecord,
} from "../plugins/tier1/trustStorage";

// --- Event payload types -------------------------------------------

/** Convert a `host:port:username` triple from a `SessionMeta` into a
 *  stable identity string usable as a trust-storage bucket key. */
function stableKeyFromMeta(meta: SessionMeta): string {
  return `${meta.host.toLowerCase()}:${meta.port}:${meta.username}`;
}

/** Resolve a stable, restart-survivable storage key for the currently
 *  active server.  `ServerId` itself is a fresh `Uuid::new_v4()` per
 *  session, so persisting trust under it means every restart re-fires
 *  the trust prompt.  Mapping the ephemeral ServerId to its host /
 *  port / username (which the user controls via the saved-server
 *  entry) gives us a key that stays the same across reconnects. */
async function stableServerKey(): Promise<string | null> {
  const state = useAppStore.getState();
  const serverId =
    state.activeServerId ?? (await invoke<string | null>("get_active_server"));
  if (!serverId) return null;

  let meta = state.sessions.find((s) => s.id === serverId);
  if (!meta) {
    try {
      const sessions = await invoke<SessionMeta[]>("list_servers");
      meta = sessions.find((s) => s.id === serverId);
    } catch {
      // Backend unreachable; fall through to the raw serverId so the
      // record at least round-trips within this session.
    }
  }
  return meta ? stableKeyFromMeta(meta) : serverId;
}

/** Same as {@link stableServerKey} but also returns the legacy
 *  ephemeral-UUID key so callers can read records persisted by older
 *  builds and migrate them forward on the next write. */
async function storedServerKeys(): Promise<{
  primary: string | null;
  legacy: string | null;
}> {
  const state = useAppStore.getState();
  const serverId =
    state.activeServerId ?? (await invoke<string | null>("get_active_server"));
  if (!serverId) return { primary: null, legacy: null };

  let meta = state.sessions.find((s) => s.id === serverId);
  if (!meta) {
    try {
      const sessions = await invoke<SessionMeta[]>("list_servers");
      meta = sessions.find((s) => s.id === serverId);
    } catch {
      // ignored - falls through to using just the raw id
    }
  }
  return meta
    ? { primary: stableKeyFromMeta(meta), legacy: serverId }
    : { primary: serverId, legacy: null };
}

/** Raw `plugin-registry` event payload (server -> client after ServerSync). */
export interface PluginRegistryEntry {
  pluginName: string;
  version: string;
  pluginSlot: number | null;
  infoJson: string | null;
}

export interface PluginRegistryEvent {
  plugins: PluginRegistryEntry[];
}

// --- Slice helpers (exported so the inbound dispatcher in store.ts
//     can reuse them when applying InteractionResponse envelopes) ----

export function sliceFromState(s: AppState): PluginTier1Slice {
  return {
    pluginManifests: s.pluginManifests,
    pluginTrust: s.pluginTrust,
    pluginTrustQueue: s.pluginTrustQueue,
    pluginPanels: s.pluginPanels,
    pluginCards: s.pluginCards,
    pluginModal: s.pluginModal,
    pluginToasts: s.pluginToasts,
    pluginSessionTrust: s.pluginSessionTrust,
  };
}

export function slicePatch(slice: PluginTier1Slice): Partial<AppState> {
  return {
    pluginManifests: slice.pluginManifests,
    pluginTrust: slice.pluginTrust,
    pluginTrustQueue: slice.pluginTrustQueue,
    pluginPanels: slice.pluginPanels,
    pluginCards: slice.pluginCards,
    pluginModal: slice.pluginModal,
    pluginToasts: slice.pluginToasts,
    pluginSessionTrust: slice.pluginSessionTrust,
  };
}

// --- Outbound: plugin envelope -------------------------------------

/** Convenience wrapper around the `send_plugin_message` Tauri command.
 *  Payloads are serialized as UTF-8 JSON. */
export async function sendPluginMessage(
  pluginName: string,
  payloadType: string,
  payload: unknown,
  targetSessions: number[] = [],
  channelId: number | null = null,
): Promise<void> {
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify(payload)));
  await invoke("send_plugin_message", {
    pluginName,
    payloadType,
    payload: bytes,
    targetSessions,
    channelId,
  });
}

/** Send a Tier-1 `Interaction` to a plugin and return the correlation id
 *  so callers can await the matching response in `pluginCards`. */
export function sendPluginInteraction(
  pluginName: string,
  kind: InteractionKind,
  channelId: number | null = null,
): Promise<string> {
  const sender: PluginMessageSender = (name, type, payload, targets, ch) =>
    sendPluginMessage(name, type, payload, targets ?? [], ch ?? null);
  return sendInteractionInternal(sender, pluginName, kind, channelId);
}

// --- Trust prompt resolution ---------------------------------------

/** Reconcile a fresh `plugin-registry` event against stored trust
 *  records and update the slice in one shot.  Fetches the active
 *  server id directly from the backend to avoid a race where the
 *  Zustand store's `activeServerId` is still null when this fires
 *  right after `server-connected` (before `refreshSessions` settles). */
export async function reconcilePluginRegistry(
  entries: readonly PluginRegistryEntry[],
): Promise<void> {
  const state = useAppStore.getState();
  const { primary, legacy } = await storedServerKeys();
  const serverId =
    state.activeServerId ?? (await invoke<string | null>("get_active_server"));
  // Read both the stable (host:port:user) bucket and the legacy
  // (ServerId UUID) bucket so trust granted before this change still
  // applies. Stable wins on conflict; the next save migrates the
  // record into the stable bucket.
  const legacyRecords =
    legacy && legacy !== primary ? await loadServerTrust(legacy) : {};
  const primaryRecords = primary ? await loadServerTrust(primary) : {};
  const storedTrust = new Map<string, import("../plugins/tier1/trust").TrustRecord>(
    Object.entries({ ...legacyRecords, ...primaryRecords }),
  );
  // Overlay in-memory session grants so session-allowed plugins do not
  // re-prompt when the server re-broadcasts the registry.
  const effectiveTrust = new Map(storedTrust);
  for (const name of state.pluginSessionTrust) {
    const sessionRecord = state.pluginTrust.get(name);
    if (sessionRecord) effectiveTrust.set(name, sessionRecord);
  }
  const { pluginManifests, pluginPanels, pluginTrustQueue } =
    applyRegistryWithTrust(serverId, entries, effectiveTrust);
  useAppStore.setState((s) => {
    // Preserve any panel rows the plugin patched in via UpdatePanel
    // between manifest broadcasts.  The freshly-seeded rows are only
    // honoured for panels that did not previously exist.
    const mergedPanels = new Map(pluginPanels);
    for (const [k, existing] of s.pluginPanels) {
      if (mergedPanels.has(k)) mergedPanels.set(k, existing);
    }
    return {
      pluginRegistry: entries.slice(),
      pluginManifests,
      pluginPanels: mergedPanels,
      pluginTrust: effectiveTrust,
      pluginTrustQueue,
    };
  });
}

/** Resolve the front-of-queue trust prompt.  Persists the decision
 *  to `pluginTrust.json` (unless scope is "once") and rolls the
 *  in-memory slice forward. */
export async function resolvePluginTrust(
  pluginName: string,
  decision: TrustDecision,
  scope: TrustScope = TrustScope.Server,
): Promise<void> {
  const state = useAppStore.getState();
  const pending = state.pluginTrustQueue.find(
    (p) => p.pluginName === pluginName,
  );
  if (!pending) return;
  const record = recordFromDecision(decision, pending.version, pending.manifest, scope);
  if (decision === TrustDecision.Allow && scope === TrustScope.Global) {
    await saveGlobalTrustRecord(pluginName, record);
  } else if (scope !== TrustScope.Once) {
    await saveTrustRecord(await stableServerKey(), pluginName, record);
  }
  useAppStore.setState((s) => {
    const next = applyTrustDecision(
      sliceFromState(s),
      pluginName,
      record,
      pending.manifest,
    );
    const nextSessionTrust =
      decision === TrustDecision.Allow && scope === TrustScope.Once
        ? new Set([...s.pluginSessionTrust, pluginName])
        : s.pluginSessionTrust;
    return { ...slicePatch(next), pluginSessionTrust: nextSessionTrust };
  });
}

/** Bulk variant of {@link resolvePluginTrust}: applies the same
 *  decision/scope to every named plugin in one atomic persist and one
 *  `setState` pass.  Wiring the "Allow all" / "Block all" buttons
 *  through here instead of looping {@link resolvePluginTrust} avoids
 *  the read-modify-write race on `pluginTrust.json` that caused most
 *  of the parallel writes to be silently lost. */
export async function resolvePluginTrustBulk(
  pluginNames: readonly string[],
  decision: TrustDecision,
  scope: TrustScope = TrustScope.Server,
): Promise<void> {
  const state = useAppStore.getState();
  const pendings = pluginNames
    .map((n) => state.pluginTrustQueue.find((p) => p.pluginName === n))
    .filter((p): p is PendingTrustPrompt => p !== undefined);
  if (pendings.length === 0) return;

  const named: NamedTrustRecord[] = pendings.map((p) => ({
    pluginName: p.pluginName,
    record: recordFromDecision(decision, p.version, p.manifest, scope),
  }));

  if (decision === TrustDecision.Allow && scope === TrustScope.Global) {
    await saveGlobalTrustRecords(named);
  } else if (scope !== TrustScope.Once) {
    await saveTrustRecords(await stableServerKey(), named);
  }

  useAppStore.setState((s) => {
    let slice = sliceFromState(s);
    let sessionTrust = s.pluginSessionTrust;
    for (let i = 0; i < pendings.length; i++) {
      const pending = pendings[i]!;
      const record = named[i]!.record;
      slice = applyTrustDecision(slice, pending.pluginName, record, pending.manifest);
      if (decision === TrustDecision.Allow && scope === TrustScope.Once) {
        sessionTrust = new Set([...sessionTrust, pending.pluginName]);
      }
    }
    return { ...slicePatch(slice), pluginSessionTrust: sessionTrust };
  });
}

/** Revoke trust for a plugin: persist a `deny` decision so the plugin
 *  stops running AND will not re-prompt on the next registry refresh.
 *  Used by the "Revoke trust" button on currently-allowed plugins in
 *  the Plugins settings tab.  Clearing the disk record outright (as
 *  the original implementation did) caused the trust prompt to come
 *  back the next time anything triggered a registry reconcile (HMR
 *  reload, reconnect, etc.) because the lack of a record reads as
 *  "needs prompt". */
export async function revokePluginTrust(pluginName: string): Promise<void> {
  const state = useAppStore.getState();
  // Build the deny record from whatever manifest we have on hand: the
  // in-memory trusted manifest first, falling back to re-parsing the
  // registry entry so even a manifest we never accepted can be denied.
  const entry = state.pluginRegistry.find((e) => e.pluginName === pluginName);
  const manifest =
    state.pluginManifests.get(pluginName) ??
    (entry ? parseClientManifest(entry.infoJson) : null);
  if (!manifest || !entry) {
    // Without a manifest we cannot persist a structured deny record;
    // fall back to clearing whatever is on disk so at least the
    // in-memory trust state matches the user's intent.
    const key = await stableServerKey();
    await revokeTrustRecord(key, pluginName);
    useAppStore.setState((s) => {
      const next = applyTrustRevocation(sliceFromState(s), pluginName);
      return slicePatch(next);
    });
    return;
  }
  const record = recordFromDecision(
    TrustDecision.Deny,
    entry.version,
    manifest,
    TrustScope.Server,
  );
  // Drop any "always allow" / per-server allow record first so the
  // new per-server deny is the effective decision (per-server records
  // overlay the global ones in `loadServerTrust`).
  const key = await stableServerKey();
  await revokeTrustRecord(key, pluginName);
  await saveTrustRecord(key, pluginName, record);
  useAppStore.setState((s) => {
    const next = applyTrustDecision(
      sliceFromState(s),
      pluginName,
      record,
      manifest,
    );
    // Also drop any in-session "Allow once" grant so the deny is not
    // overlaid by an older session record on the next reconcile.
    const nextSessionTrust = new Set(s.pluginSessionTrust);
    nextSessionTrust.delete(pluginName);
    return { ...slicePatch(next), pluginSessionTrust: nextSessionTrust };
  });
}

/** Forget every stored decision for a plugin and immediately re-queue
 *  it for a fresh trust prompt.  Used by the "Re-prompt" button next
 *  to a denied plugin in the Plugins settings tab: the user is
 *  explicitly asking to be asked again. */
export async function resetPluginTrust(pluginName: string): Promise<void> {
  const state = useAppStore.getState();
  await revokeTrustRecord(await stableServerKey(), pluginName);
  const entry = state.pluginRegistry.find((e) => e.pluginName === pluginName);
  const manifest = entry ? parseClientManifest(entry.infoJson) : null;
  useAppStore.setState((s) => {
    const next = applyTrustRevocation(sliceFromState(s), pluginName);
    // Push the plugin back onto the prompt queue so the user sees the
    // dialog immediately instead of having to wait for the next
    // reconcile.  Skip when we cannot reconstruct a manifest (e.g.
    // legacy registry entry without `info_json`) - in that case the
    // disk record is simply cleared.
    const nextQueue = manifest && entry
      ? [
          ...next.pluginTrustQueue,
          {
            serverId: s.activeServerId,
            pluginName,
            version: entry.version,
            manifest,
            registryEntry: entry,
            previous: s.pluginTrust.get(pluginName) ?? null,
          },
        ]
      : next.pluginTrustQueue;
    const nextSessionTrust = new Set(s.pluginSessionTrust);
    nextSessionTrust.delete(pluginName);
    return {
      ...slicePatch({ ...next, pluginTrustQueue: nextQueue }),
      pluginSessionTrust: nextSessionTrust,
    };
  });
}

/** Allow a plugin that was previously denied or whose trust was revoked,
 *  without requiring it to be in the trust-prompt queue.  Looks up the
 *  plugin from the registry, parses its manifest, and persists the
 *  decision according to the given scope. */
export async function allowPlugin(
  pluginName: string,
  scope: TrustScope = TrustScope.Server,
): Promise<void> {
  const state = useAppStore.getState();
  const entry = state.pluginRegistry.find((e) => e.pluginName === pluginName);
  if (!entry) return;
  const manifest = parseClientManifest(entry.infoJson);
  if (!manifest) return;
  const record = recordFromDecision(TrustDecision.Allow, entry.version, manifest, scope);
  if (scope === TrustScope.Global) {
    await saveGlobalTrustRecord(pluginName, record);
  } else if (scope !== TrustScope.Once) {
    await saveTrustRecord(await stableServerKey(), pluginName, record);
  }
  useAppStore.setState((s) => {
    const next = applyTrustDecision(sliceFromState(s), pluginName, record, manifest);
    const nextSessionTrust =
      scope === TrustScope.Once
        ? new Set([...s.pluginSessionTrust, pluginName])
        : s.pluginSessionTrust;
    return { ...slicePatch(next), pluginSessionTrust: nextSessionTrust };
  });
}

// --- Plugin-rendered surface dismissal -----------------------------

/** Dismiss a plugin-rendered card by `messageId`. */
export function dismissPluginCard(messageId: string): void {
  useAppStore.setState((s) => ({
    pluginCards: s.pluginCards.filter((c) => c.messageId !== messageId),
  }));
}

/** Dismiss the active plugin modal without submitting. */
export function dismissPluginModal(): void {
  useAppStore.setState({ pluginModal: null });
}

/** Remove a finished toast from the queue. */
export function dismissPluginToast(id: string): void {
  useAppStore.setState((s) => ({
    pluginToasts: s.pluginToasts.filter((t) => t.id !== id),
  }));
}
