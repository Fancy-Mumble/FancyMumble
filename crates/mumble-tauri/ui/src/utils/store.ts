/**
 * Drop-in wrapper around `@tauri-apps/plugin-store`'s `load`.
 *
 * Production behaviour is unchanged. Under the e2e harness (see the separate
 * `fancy-mumble-e2e` repo) it redirects every store file into a harness-provided
 * directory so the suite runs against fresh / mock settings instead of the
 * user's real config (saved servers, preferences, etc.).
 *
 * The plugin resolves a relative store path against the app data dir; passing an
 * **absolute** path overrides that (Rust's `PathBuf::join` discards the base when
 * the joined component is absolute), so we can relocate every store with no Rust
 * changes. The harness writes the absolute dir into
 * `localStorage["fancy-e2e-data-dir"]` before the app bootstraps.
 */
import { load as tauriLoad } from "@tauri-apps/plugin-store";
import { isE2E } from "./e2e";

/** localStorage key the e2e harness uses to relocate the store directory. */
export const E2E_DATA_DIR_KEY = "fancy-e2e-data-dir";

export function load(
  path: string,
  options?: Parameters<typeof tauriLoad>[1],
): ReturnType<typeof tauriLoad> {
  return tauriLoad(resolveStorePath(path), options);
}

function resolveStorePath(path: string): string {
  if (!isE2E()) return path;
  let dir: string | null = null;
  try {
    dir = globalThis.localStorage?.getItem(E2E_DATA_DIR_KEY) ?? null;
  } catch {
    /* localStorage unavailable */
  }
  if (!dir) return path;
  // Forward slashes are accepted by Rust path handling on every platform.
  return `${dir.replace(/[\\/]+$/, "")}/${path}`;
}
