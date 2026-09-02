/**
 * Nebula's own translations.
 *
 * The pack keeps its strings in `locales/nebula/` rather than in the shared
 * `locales/common/` namespaces, because they describe Nebula's layout and mean
 * nothing to another design.  Anything a second pack would also say belongs in
 * `common/` instead - that split is the whole point of the two folders.
 *
 * Imported for its side effect by `@nebula/index`, so the English bundle rides
 * in Nebula's own lazy chunk and never reaches the startup heap of a client
 * showing Standard or Aurora.  The other built-in languages arrive through the
 * i18n backend, with English standing in for the moment they are in flight.
 */
import i18n, { NEBULA_NAMESPACES } from ".";

import enCommon from "../locales/nebula/en/common.json";
import enChrome from "../locales/nebula/en/chrome.json";
import enSidebar from "../locales/nebula/en/sidebar.json";
import enChat from "../locales/nebula/en/chat.json";
import enConnect from "../locales/nebula/en/connect.json";
import enUser from "../locales/nebula/en/user.json";
import enServer from "../locales/nebula/en/server.json";
import enSettings from "../locales/nebula/en/settings.json";

const EN_BUNDLES = {
  nebulaCommon: enCommon,
  nebulaChrome: enChrome,
  nebulaSidebar: enSidebar,
  nebulaChat: enChat,
  nebulaConnect: enConnect,
  nebulaUser: enUser,
  nebulaServer: enServer,
  nebulaSettings: enSettings,
} as const;

for (const [ns, bundle] of Object.entries(EN_BUNDLES)) {
  // `deep`, not `overwrite`: a custom language registered before the pack
  // loaded keeps whatever it already said about these keys.
  i18n.addResourceBundle("en", ns, bundle, true, false);
}

/**
 * Resolves once the active language's Nebula namespaces are in memory.
 *
 * Nothing awaits it - `t()` answers in English until the fetch lands and
 * i18next re-renders - but it is exported so a test can settle the pack
 * before asserting on translated text.
 */
export const nebulaTranslationsReady: Promise<unknown> = i18n.loadNamespaces([...NEBULA_NAMESPACES]);
