import type { ClientManifest, SlashCommand } from "./types";
import { CLIENT_MANIFEST_SCHEMA_VERSION } from "./types";

/** A slash command together with the plugin that exposes it.  Produced
 *  by `collectSlashCommands` and consumed by the composer's command
 *  picker. */
export interface SlashCommandEntry {
  readonly pluginName: string;
  readonly command: SlashCommand;
}

/** Decode the `info_json` blob attached to a `PluginRegistryEntry` into
 *  a typed `ClientManifest`.  Returns null when the blob is missing,
 *  malformed, or declares a schema version this client cannot render. */
export function parseClientManifest(infoJson: string | null): ClientManifest | null {
  if (!infoJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(infoJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const manifest = (parsed as { client_manifest?: ClientManifest }).client_manifest;
  if (!manifest || typeof manifest !== "object") return null;
  const version = manifest.schema_version ?? CLIENT_MANIFEST_SCHEMA_VERSION;
  if (version > CLIENT_MANIFEST_SCHEMA_VERSION) {
    console.warn(
      "[plugin-tier1] ignoring manifest with unsupported schema_version",
      version,
    );
    return null;
  }
  return manifest;
}

/** Flatten every plugin's slash commands into a single lookup list.
 *  Used by the composer's `/` picker. */
export function collectSlashCommands(
  manifests: ReadonlyMap<string, ClientManifest>,
): SlashCommandEntry[] {
  const out: SlashCommandEntry[] = [];
  for (const [pluginName, manifest] of manifests) {
    for (const command of manifest.slash_commands ?? []) {
      out.push({ pluginName, command });
    }
  }
  out.sort((a, b) => a.command.name.localeCompare(b.command.name));
  return out;
}

/** Match a typed `/prefix` against the known slash commands.  Returns
 *  the entries whose `name` starts with `query` (case-insensitive). */
export function filterSlashCommands(
  entries: readonly SlashCommandEntry[],
  query: string,
): SlashCommandEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries.slice();
  return entries.filter((e) => e.command.name.toLowerCase().startsWith(needle));
}

/** Generate a non-cryptographic correlation id for an outbound
 *  Interaction.  The plugin echoes it back in the matching response. */
export function newCorrelationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
