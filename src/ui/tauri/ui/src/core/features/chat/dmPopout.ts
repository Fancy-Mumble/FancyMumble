/**
 * What the direct-message popout window needs to know.
 *
 * `open_dm_popout` opens a borderless always-on-top window labelled
 * `popout-dm-…`, and the page inside it reconstructs the conversation from
 * this payload alone: which server the DM belongs to, and who the other person
 * is. Two packs offer the action, so the payload is built here rather than
 * twice - the same reason `imagePopout` exists next door.
 *
 * The certificate hash matters more than it looks. A session id is only
 * meaningful while that session is live, so a popout that outlived a reconnect
 * would be pointing at nobody; the hash is what lets the window find the same
 * person again.
 */
import { invoke } from "@tauri-apps/api/core";

/** The other end of the conversation, as far as the popout is concerned. */
export interface DmPopoutPartner {
  session: number;
  name: string;
  hash?: string | null;
}

/** A connection, narrowed to what names it in the popout's title bar. */
export interface DmPopoutServer {
  id: string;
  label?: string | null;
  host?: string | null;
}

/**
 * Open the conversation in its own window.
 *
 * Resolves once the window has been asked for, not once it is on screen, and
 * swallows nothing: a refusal is logged, because the only feedback otherwise
 * is a window that never appears.
 */
export async function openDmPopout(partner: DmPopoutPartner, server: DmPopoutServer | null): Promise<void> {
  const payload = {
    server_id: server?.id ?? "",
    server_label: server?.label ?? server?.host ?? null,
    user_session: partner.session,
    user_name: partner.name,
    user_hash: partner.hash ?? null,
  };
  try {
    await invoke("open_dm_popout", { payload });
  } catch (reason) {
    console.error("Failed to open DM popout:", reason);
  }
}
