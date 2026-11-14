/**
 * End-to-end test-mode detection.
 *
 * The e2e harness (Selenium + tauri-driver) cannot pass process env into the
 * webview, so it drives test mode entirely through `localStorage`:
 *
 *   1. launch the app (one throwaway load),
 *   2. `localStorage.setItem("fancy-e2e", "1")` and set the i18next language
 *      key (`mumble-language` -> "en") for deterministic, language-stable
 *      selectors,
 *   3. reload, after which `isE2E()` reports true for the rest of the session.
 *
 * Test mode only relaxes non-functional UX that would otherwise make the DOM
 * non-deterministic (e.g. the first-run welcome flow).  It never changes
 * protocol or connection behaviour, so production builds are unaffected when
 * the flag is absent.
 */
export const E2E_FLAG_KEY = "fancy-e2e";

/** True when the app is being driven by the automated e2e suite. */
export function isE2E(): boolean {
  try {
    return globalThis.localStorage?.getItem(E2E_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}
