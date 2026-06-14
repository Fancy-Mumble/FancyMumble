/**
 * Ref-counted lease on the backend's registered-user avatar cache.
 *
 * Every `request_user_list` response makes the Rust backend cache the
 * avatar bytes of ALL registered users (so `get_registered_user_texture`
 * can serve them lazily).  On servers with many registered users that
 * cache is large, and without cleanup it lives until disconnect.
 *
 * Views that consume the user list (members sidebar, admin tabs, role
 * editor) acquire a lease on mount and release it on unmount.  When the
 * last lease is released the backend cache is dropped; re-opening such a
 * view re-requests the list, which re-populates it.  The ref-count is
 * needed because several of these views can be open at the same time.
 */

import { invoke } from "@tauri-apps/api/core";

let leases = 0;

/** Acquire a lease. Call on mount of a view that requests the user list. */
export function acquireRegisteredTextures(): void {
  leases += 1;
}

/** Release a lease; drops the backend avatar cache when none remain. */
export function releaseRegisteredTextures(): void {
  leases = Math.max(0, leases - 1);
  if (leases === 0) {
    void invoke("release_registered_user_textures").catch(() => {});
  }
}
