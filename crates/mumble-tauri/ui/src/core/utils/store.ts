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
 * changes.
 *
 * Two things relocate it. The client itself, when it was started with
 * `FANCY_E2E_DATA_DIR`: the backend names the directory (`isolated_store_dir`)
 * and every store goes there from the very first read, so a test instance
 * never sees the user's saved servers. And the harness, which writes the
 * absolute dir into `localStorage["fancy-e2e-data-dir"]`; that only takes
 * effect after the page it was written from, so it is the second choice.
 */
import { invoke } from "@tauri-apps/api/core";
import { load as tauriLoad } from "@tauri-apps/plugin-store";
import { isE2E } from "./e2e";

/** localStorage key the e2e harness uses to relocate the store directory. */
export const E2E_DATA_DIR_KEY = "fancy-e2e-data-dir";

export async function load(
  path: string,
  options?: Parameters<typeof tauriLoad>[1],
): ReturnType<typeof tauriLoad> {
  return tauriLoad(storePath(await isolatedStoreDir(), path), options);
}

/** The backend's answer, asked once: the isolation directory, or `null`. */
let isolated: Promise<string | null> | null = null;

function isolatedStoreDir(): Promise<string | null> {
  isolated ??= (async () => {
    try {
      return (await invoke<string | null>("isolated_store_dir")) ?? null;
    } catch {
      // No backend (a browser preview or a test): nothing is isolated.
      return null;
    }
  })();
  return isolated;
}

/** Forget the backend's answer; for tests. */
export function _resetIsolatedStoreDirForTests(): void {
  isolated = null;
}

/** Where the store file `path` lives, given the backend's isolation directory. */
export function storePath(isolatedDir: string | null, path: string): string {
  const dir = isolatedDir ?? harnessDir();
  if (!dir) return path;
  // Forward slashes are accepted by Rust path handling on every platform.
  return `${dir.replace(/[\\/]+$/, "")}/${path}`;
}

function harnessDir(): string | null {
  if (!isE2E()) return null;
  try {
    return globalThis.localStorage?.getItem(E2E_DATA_DIR_KEY) ?? null;
  } catch {
    /* localStorage unavailable */
    return null;
  }
}
