// Per-server, per-plugin trust state used by the Tier-1 client
// extension trust prompt.  A plugin's manifest is only honoured (slash
// commands surfaced, components rendered, modals popped) when the user
// has explicitly granted trust on the current server.

import { Capability } from "./types";
import type { ClientManifest } from "./types";

/** Persisted decision.  "deny" plugins stay registered but their UI is
 *  suppressed; the user can re-prompt by revoking from the Plugins
 *  settings tab. */
export enum TrustDecision {
  Allow = "allow",
  Deny = "deny",
}

/** Scope of an "allow" decision.
 *  - `Once`   - allowed for this app session only; never written to disk.
 *  - `Server` - persisted per connected server (the default).
 *  - `Global` - persisted across all servers; plugin is trusted everywhere.
 */
export enum TrustScope {
  Once = "once",
  Server = "server",
  Global = "global",
}

/** Persisted trust entry.  Keyed by `(serverId, pluginName)`. */
export interface TrustRecord {
  readonly decision: TrustDecision;
  /** Plugin version that the user reviewed when granting trust.
   *  A bumped version triggers a fresh prompt. */
  readonly version: string;
  /** Capability set the user reviewed.  An expanded set triggers a
   *  fresh prompt; a narrowed set passes silently. */
  readonly capabilities: readonly Capability[];
  /** Wall-clock ms at decision time. */
  readonly decidedAt: number;
  /** Scope under which the decision was made.  Optional for backwards
   *  compatibility with records written before this field existed;
   *  absent records default to "server" in the UI. */
  readonly scope?: TrustScope;
}

/** Result of evaluating a registry entry against the stored trust map. */
export type TrustStatus =
  /** Plugin has no manifest, or declared none of the gated
   *  capabilities.  No prompt needed. */
  | { readonly kind: "no-prompt" }
  /** Stored decision is current; honour it. */
  | { readonly kind: "decided"; readonly record: TrustRecord }
  /** Either no stored decision or the manifest changed enough that the
   *  user must re-confirm. */
  | { readonly kind: "needs-prompt"; readonly previous: TrustRecord | null };

const GATED_CAPABILITIES = new Set<Capability>(
  Object.values(Capability).filter((c) => c !== Capability.RichLayout),
);

/** Decide whether a plugin's declared manifest needs a trust prompt. */
export function evaluateTrust(
  manifest: ClientManifest,
  previous: TrustRecord | null,
  currentVersion: string,
): TrustStatus {
  const declared = manifest.capabilities ?? [];
  const gated = declared.filter((c) => GATED_CAPABILITIES.has(c));
  if (gated.length === 0 && (manifest.slash_commands ?? []).length === 0) {
    return { kind: "no-prompt" };
  }
  if (!previous) {
    return { kind: "needs-prompt", previous: null };
  }
  if (previous.version !== currentVersion) {
    return { kind: "needs-prompt", previous };
  }
  if (capabilitiesExpanded(previous.capabilities, gated)) {
    return { kind: "needs-prompt", previous };
  }
  return { kind: "decided", record: previous };
}

/** Returns true when `next` contains a capability not present in
 *  `previous`.  A *narrowed* set never re-prompts. */
function capabilitiesExpanded(
  previous: readonly Capability[],
  next: readonly Capability[],
): boolean {
  const prev = new Set(previous);
  return next.some((c) => !prev.has(c));
}

/** Build a fresh `TrustRecord` from a manifest + decision. */
export function recordFromDecision(
  decision: TrustDecision,
  version: string,
  manifest: ClientManifest,
  scope: TrustScope = TrustScope.Server,
): TrustRecord {
  return {
    decision,
    version,
    capabilities: (manifest.capabilities ?? []).filter((c) =>
      GATED_CAPABILITIES.has(c),
    ),
    decidedAt: Date.now(),
    scope,
  };
}

/** A registry entry that still needs the user's verdict, surfaced to
 *  the prompt component verbatim. */
export interface PendingTrustPrompt {
  readonly serverId: string | null;
  readonly pluginName: string;
  readonly version: string;
  readonly manifest: ClientManifest;
  readonly registryEntry: PendingTrustRegistryEntry;
  readonly previous: TrustRecord | null;
}

/** Trimmed view of a `PluginRegistryEntry` that the prompt needs.
 *  Decoupled from the store type so this module stays test-friendly. */
export interface PendingTrustRegistryEntry {
  readonly pluginName: string;
  readonly version: string;
  readonly infoJson: string | null;
}

/** Decode the human-readable plugin description (author, homepage,
 *  ...) from an `info_json` blob.  Returns null for malformed or
 *  manifest-only payloads. */
export function decodePluginInfo(infoJson: string | null): PluginInfoDigest {
  if (!infoJson) return EMPTY_DIGEST;
  let parsed: unknown;
  try {
    parsed = JSON.parse(infoJson);
  } catch {
    return EMPTY_DIGEST;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_DIGEST;
  const o = parsed as Record<string, unknown>;
  return {
    description: typeof o.description === "string" ? o.description : null,
    author: typeof o.author === "string" ? o.author : null,
    homepage: typeof o.homepage === "string" ? o.homepage : null,
    capabilityTags: Array.isArray(o.capabilities)
      ? (o.capabilities.filter((c): c is string => typeof c === "string"))
      : [],
  };
}

/** Free-form plugin metadata.  Distinct from `Capability` enum: this
 *  is the plugin's own self-description, surfaced in the advanced
 *  section of the trust prompt. */
export interface PluginInfoDigest {
  readonly description: string | null;
  readonly author: string | null;
  readonly homepage: string | null;
  readonly capabilityTags: readonly string[];
}

const EMPTY_DIGEST: PluginInfoDigest = {
  description: null,
  author: null,
  homepage: null,
  capabilityTags: [],
};

/** Pretty-print a capability tag for the prompt UI. */
export function capabilityLabel(capability: Capability): string {
  switch (capability) {
    case Capability.SlashCommands:
      return "Register slash commands";
    case Capability.Modals:
      return "Open modal dialogs";
    case Capability.Components:
      return "Send interactive components (buttons, menus)";
    case Capability.Notifications:
      return "Show toast notifications";
    case Capability.SettingsPanel:
      return "Add a settings panel";
    case Capability.RichLayout:
      return "Use rich layout (containers, sections, media)";
  }
}
