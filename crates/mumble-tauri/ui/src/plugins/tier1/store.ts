// State slice and dispatch helpers for the Tier-1 plugin extension
// system.  The actual Zustand store lives in `src/store.ts`; this file
// defines the shape of the slice and pure helper functions that the
// store wires up.  Keeping the slice here means new plugin surfaces
// can be added without bloating the already-large root store file.

import type {
  ActionRow,
  ClientManifest,
  Interaction,
  InteractionKind,
  InteractionResponse,
  PanelRow,
  ResponseKind,
  ToastLevel,
} from "./types";
import {
  Capability,
  INTERACTION_PAYLOAD_TYPE,
  INTERACTION_RESPONSE_PAYLOAD_TYPE,
  normaliseActionRow,
} from "./types";
import { newCorrelationId, parseClientManifest } from "./manifest";
import {
  evaluateTrust,
  type PendingTrustPrompt,
  type TrustRecord,
} from "./trust";
import { base64ToBytes } from "../../utils/base64";

/** An active plugin-rendered message card.  Created when a plugin
 *  sends a `Message` InteractionResponse; dismissed when the user
 *  closes it or the plugin sends a follow-up clearing the components. */
export interface PluginMessageCard {
  readonly id: string;
  readonly pluginName: string;
  readonly messageId: string;
  readonly content: string;
  readonly components: readonly ActionRow[];
  readonly ephemeral: boolean;
  /** Channel id the originating interaction came from, if any. */
  readonly channelId: number | null;
}

/** An active plugin-rendered modal dialog.  Carries the merged
 *  `ShowModal` payload: optional title / body text, optional
 *  components, and an ephemeral flag. */
export interface PluginModalState {
  readonly id: string;
  readonly pluginName: string;
  readonly customId: string;
  readonly title: string;
  readonly content: string;
  readonly components: readonly ActionRow[];
  readonly ephemeral: boolean;
  readonly channelId: number | null;
}

/** A pending toast queued by a plugin. */
export interface PluginToastState {
  readonly id: string;
  readonly pluginName: string;
  readonly message: string;
  readonly level: ToastLevel;
}

/** Live state of a plugin's settings panel.  Initial rows come from
 *  the manifest; the plugin pushes refreshed rows via
 *  `ResponseKind.UpdatePanel`. */
export interface PluginPanelState {
  readonly pluginName: string;
  readonly panelId: string;
  readonly title: string;
  readonly rows: readonly PanelRow[];
}

/** Read-only slice the rest of the app consumes. */
export interface PluginTier1Slice {
  /** Manifest keyed by plugin name, filtered to trusted plugins only.
   *  Untrusted plugins remain in `pluginRegistry` but are excluded
   *  here so their slash commands and panels are hidden. */
  pluginManifests: ReadonlyMap<string, ClientManifest>;
  /** Trust decisions keyed by plugin name (active server only). */
  pluginTrust: ReadonlyMap<string, TrustRecord>;
  /** Queue of plugins still awaiting a trust decision.  Surfaced
   *  one-at-a-time by `PluginTrustPrompt`. */
  pluginTrustQueue: readonly PendingTrustPrompt[];
  /** Settings panels keyed by `${pluginName}:${panelId}`. */
  pluginPanels: ReadonlyMap<string, PluginPanelState>;
  /** Live plugin-message cards (buttons / select menus). */
  pluginCards: PluginMessageCard[];
  /** The single currently-open modal, or null. */
  pluginModal: PluginModalState | null;
  /** Pending toasts. */
  pluginToasts: PluginToastState[];
  /** Plugin names granted "Allow once" for this app session.
   *  Not persisted to disk.  Cleared when the connection is torn down
   *  so the prompt reappears on the next connect. */
  pluginSessionTrust: ReadonlySet<string>;
}

/** Reset value used on disconnect. */
export const emptyPluginTier1Slice: PluginTier1Slice = {
  pluginManifests: new Map(),
  pluginTrust: new Map(),
  pluginTrustQueue: [],
  pluginPanels: new Map(),
  pluginCards: [],
  pluginModal: null,
  pluginToasts: [],
  pluginSessionTrust: new Set(),
};

/** Build the `pluginManifests` map from a freshly-arrived
 *  `plugin-registry` event payload.  Trust gating is applied later
 *  by `applyRegistryWithTrust`; this helper is kept for callers that
 *  only want the raw decoded manifests (e.g. tests). */
export function manifestsFromRegistry(
  entries: ReadonlyArray<{ pluginName: string; infoJson: string | null }>,
): Map<string, ClientManifest> {
  const out = new Map<string, ClientManifest>();
  for (const entry of entries) {
    const manifest = parseClientManifest(entry.infoJson);
    if (manifest) out.set(entry.pluginName, manifest);
  }
  return out;
}

/** Shape of the trimmed registry entry passed to
 *  `applyRegistryWithTrust`.  Mirrors `PluginRegistryEntry` from the
 *  root store but keeps this module decoupled. */
export interface RegistryEntryLike {
  readonly pluginName: string;
  readonly version: string;
  readonly infoJson: string | null;
}

/** Resolve a freshly-arrived registry against stored trust state.
 *  Returns the manifests for trusted plugins, the seeded panel state
 *  for those manifests, and the queue of plugins still awaiting a
 *  decision.  Untrusted decided ("deny") plugins are excluded from
 *  `pluginManifests` so their slash commands and panels stay hidden. */
export function applyRegistryWithTrust(
  serverId: string | null,
  entries: readonly RegistryEntryLike[],
  storedTrust: ReadonlyMap<string, TrustRecord>,
): {
  pluginManifests: Map<string, ClientManifest>;
  pluginPanels: Map<string, PluginPanelState>;
  pluginTrustQueue: PendingTrustPrompt[];
} {
  const pluginManifests = new Map<string, ClientManifest>();
  const pluginPanels = new Map<string, PluginPanelState>();
  const pluginTrustQueue: PendingTrustPrompt[] = [];

  for (const entry of entries) {
    const manifest = parseClientManifest(entry.infoJson);
    if (!manifest) continue;
    const previous = storedTrust.get(entry.pluginName) ?? null;
    const status = evaluateTrust(manifest, previous, entry.version);
    switch (status.kind) {
      case "no-prompt":
        pluginManifests.set(entry.pluginName, manifest);
        seedPanels(pluginPanels, entry.pluginName, manifest);
        break;
      case "decided":
        if (status.record.decision === "allow") {
          pluginManifests.set(entry.pluginName, manifest);
          seedPanels(pluginPanels, entry.pluginName, manifest);
        }
        break;
      case "needs-prompt":
        pluginTrustQueue.push({
          serverId,
          pluginName: entry.pluginName,
          version: entry.version,
          manifest,
          registryEntry: entry,
          previous: status.previous,
        });
        break;
    }
  }
  return { pluginManifests, pluginPanels, pluginTrustQueue };
}

function seedPanels(
  out: Map<string, PluginPanelState>,
  pluginName: string,
  manifest: ClientManifest,
): void {
  for (const panel of manifest.settings_panels ?? []) {
    out.set(panelKey(pluginName, panel.id), {
      pluginName,
      panelId: panel.id,
      title: panel.title,
      rows: panel.rows ?? [],
    });
  }
}

/** Canonical map key for a plugin's settings panel. */
export function panelKey(pluginName: string, panelId: string): string {
  return `${pluginName}:${panelId}`;
}

// ---------------------------------------------------------------------------
// Inbound: handle an InteractionResponse and produce a state patch
// ---------------------------------------------------------------------------

/** Capabilities a plugin may declare in its manifest to be allowed to
 *  emit an `InteractionResponse` of the given kind.  The plugin needs to
 *  have declared *at least one* of the returned capabilities; an empty
 *  array means the kind is not capability-gated.  Capabilities are
 *  otherwise advisory: the trust prompt surfaces them, but only this
 *  mapping makes a plugin's *declared* surface match what it is actually
 *  allowed to drive at runtime.
 *
 *  `show-modal` backs two distinct surfaces that share one response
 *  kind: a true input modal (built with `show_modal!`, gated by
 *  `Modals`) and a plain floating display card (built with the
 *  `InteractionResponse::message` constructor, which only needs
 *  `Components`).  Accepting either capability lets component-only
 *  plugins surface display cards without over-declaring `Modals`. */
export function acceptedCapabilitiesFor(
  kind: ResponseKind["kind"],
): readonly Capability[] {
  switch (kind) {
    case "show-modal":
      return [Capability.Modals, Capability.Components];
    case "toast":
      return [Capability.Notifications];
    case "update-panel":
      return [Capability.SettingsPanel];
    case "chat-message":
    case "update-message":
      return [Capability.Components];
  }
}

/** True when a trusted plugin's manifest permits emitting a response of
 *  `kind`.  A plugin must have declared at least one of the capabilities
 *  backing the surface it is trying to drive; a manifest that omits them
 *  all (e.g. the empty `{}` manifest that auto-trusts with no prompt) is
 *  refused. */
export function manifestPermitsResponse(
  manifest: ClientManifest,
  kind: ResponseKind["kind"],
): boolean {
  const accepted = acceptedCapabilitiesFor(kind);
  if (accepted.length === 0) return true;
  const declared = manifest.capabilities ?? [];
  return accepted.some((cap) => declared.includes(cap));
}

/** Pure reducer: apply an inbound `InteractionResponse` to the slice
 *  and return the next slice.  The store calls this from its
 *  `plugin-message` listener. */
export function applyInteractionResponse(
  slice: PluginTier1Slice,
  pluginName: string,
  response: InteractionResponse,
  channelId: number | null,
): PluginTier1Slice {
  switch (response.kind) {
    case "show-modal":
      return applyShowModal(slice, pluginName, response, channelId);
    case "chat-message":
      // Injection is a side effect on the message-history slice,
      // handled by the store wrapper before this reducer runs, so
      // the tier1 slice itself does not change.
      return slice;
    case "update-message":
      return applyUpdateMessage(slice, response);
    case "update-panel":
      return applyUpdatePanel(slice, pluginName, response);
    case "toast":
      return applyToast(slice, pluginName, response);
  }
}

function applyShowModal(
  slice: PluginTier1Slice,
  pluginName: string,
  response: Extract<ResponseKind, { kind: "show-modal" }>,
  channelId: number | null,
): PluginTier1Slice {
  return {
    ...slice,
    pluginModal: {
      id: `${pluginName}:${response.custom_id}:${newCorrelationId()}`,
      pluginName,
      customId: response.custom_id,
      title: response.title ?? "",
      content: response.content ?? "",
      components: response.components ?? [],
      ephemeral: response.ephemeral ?? false,
      channelId,
    },
  };
}

function applyUpdateMessage(
  slice: PluginTier1Slice,
  response: Extract<ResponseKind, { kind: "update-message" }>,
): PluginTier1Slice {
  const cards = slice.pluginCards.map((c) => {
    if (c.messageId !== response.message_id) return c;
    return {
      ...c,
      content: response.content ?? c.content,
      components:
        response.components === null
          ? []
          : (response.components ?? c.components),
    };
  });
  return { ...slice, pluginCards: cards };
}

function applyUpdatePanel(
  slice: PluginTier1Slice,
  pluginName: string,
  response: Extract<ResponseKind, { kind: "update-panel" }>,
): PluginTier1Slice {
  const key = panelKey(pluginName, response.panel_id);
  const existing = slice.pluginPanels.get(key);
  if (!existing) return slice;
  const next = new Map(slice.pluginPanels);
  next.set(key, { ...existing, rows: response.rows });
  return { ...slice, pluginPanels: next };
}

/** Apply a user-resolved trust decision: drop the prompt from the
 *  queue, persist the record (caller's responsibility - this reducer
 *  is pure), and surface the new manifest if allowed. */
export function applyTrustDecision(
  slice: PluginTier1Slice,
  pluginName: string,
  record: TrustRecord,
  manifest: ClientManifest,
): PluginTier1Slice {
  const nextTrust = new Map(slice.pluginTrust);
  nextTrust.set(pluginName, record);
  const nextQueue = slice.pluginTrustQueue.filter(
    (p) => p.pluginName !== pluginName,
  );
  const nextManifests = new Map(slice.pluginManifests);
  const nextPanels = new Map(slice.pluginPanels);
  if (record.decision === "allow") {
    nextManifests.set(pluginName, manifest);
    seedPanels(nextPanels, pluginName, manifest);
  } else {
    nextManifests.delete(pluginName);
    for (const k of Array.from(nextPanels.keys())) {
      if (k.startsWith(`${pluginName}:`)) nextPanels.delete(k);
    }
  }
  return {
    ...slice,
    pluginTrust: nextTrust,
    pluginTrustQueue: nextQueue,
    pluginManifests: nextManifests,
    pluginPanels: nextPanels,
  };
}

/** Drop a stored trust record so the next registry refresh re-prompts.
 *  Used by the Plugins settings tab "Revoke trust" button.  Pure;
 *  caller updates persistent storage separately. */
export function applyTrustRevocation(
  slice: PluginTier1Slice,
  pluginName: string,
): PluginTier1Slice {
  const nextTrust = new Map(slice.pluginTrust);
  nextTrust.delete(pluginName);
  const nextManifests = new Map(slice.pluginManifests);
  nextManifests.delete(pluginName);
  const nextPanels = new Map(slice.pluginPanels);
  for (const k of Array.from(nextPanels.keys())) {
    if (k.startsWith(`${pluginName}:`)) nextPanels.delete(k);
  }
  return {
    ...slice,
    pluginTrust: nextTrust,
    pluginManifests: nextManifests,
    pluginPanels: nextPanels,
  };
}

function applyToast(
  slice: PluginTier1Slice,
  pluginName: string,
  response: Extract<ResponseKind, { kind: "toast" }>,
): PluginTier1Slice {
  return {
    ...slice,
    pluginToasts: [
      ...slice.pluginToasts,
      {
        id: `${pluginName}:${newCorrelationId()}`,
        pluginName,
        message: response.message,
        level: response.level ?? "info",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Outbound: serialise an Interaction and ship it via sendPluginMessage
// ---------------------------------------------------------------------------

/** Adapter signature matching `store.ts:sendPluginMessage`.  Passed in
 *  so this module stays free of Tauri imports and easy to unit-test. */
export type PluginMessageSender = (
  pluginName: string,
  payloadType: string,
  payload: unknown,
  targetSessions?: number[],
  channelId?: number | null,
) => Promise<void>;

/** Build and ship an `Interaction` envelope.  Returns the
 *  correlation id so callers can correlate the asynchronous response. */
export async function sendInteraction(
  send: PluginMessageSender,
  pluginName: string,
  kind: InteractionKind,
  channelId: number | null = null,
): Promise<string> {
  const correlationId = newCorrelationId();
  const interaction: Interaction = {
    ...kind,
    correlation_id: correlationId,
    channel_id: channelId,
  };
  await send(pluginName, INTERACTION_PAYLOAD_TYPE, interaction, [], channelId);
  return correlationId;
}

/** Decode an inbound `plugin-message` payload (base64-encoded bytes)
 *  as an `InteractionResponse`.  Returns null when the bytes do not
 *  look like a Tier-1 response envelope. */
export function decodeInteractionResponse(
  payloadType: string,
  payload: string,
): InteractionResponse | null {
  if (payloadType !== INTERACTION_RESPONSE_PAYLOAD_TYPE) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64ToBytes(payload)),
    ) as InteractionResponse;
    return normaliseInboundResponse(parsed);
  } catch (e) {
    console.warn("[plugin-tier1] malformed InteractionResponse:", e);
    return null;
  }
}

/** Run every embedded ActionRow through `normaliseActionRow` so the
 *  renderer only has to switch over schema-v2 component discriminants. */
function normaliseInboundResponse(response: InteractionResponse): InteractionResponse {
  switch (response.kind) {
    case "show-modal":
      return {
        ...response,
        components: (response.components ?? []).map(normaliseActionRow),
      };
    case "chat-message":
      return {
        ...response,
        components: (response.components ?? []).map(normaliseActionRow),
      };
    case "update-message":
      return {
        ...response,
        components:
          response.components == null
            ? response.components
            : response.components.map(normaliseActionRow),
      };
    case "update-panel":
    case "toast":
      return response;
  }
}
