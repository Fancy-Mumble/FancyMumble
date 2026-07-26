/**
 * Which plugins ship as first-party.
 *
 * Lives in core because "is this ours?" is a fact about the app, not a
 * rendering choice - every UI pack that badges official plugins must agree,
 * and a pack-local copy would drift the moment one is added.
 */

const OFFICIAL_PLUGIN_NAMES = new Set(["fancy-live-doc", "fancy-file-server"]);

export function isOfficialPlugin(pluginName: string): boolean {
  return OFFICIAL_PLUGIN_NAMES.has(pluginName);
}
