/** Admin panel: registered users, bans and channel ACLs. */

/** A registered user entry from the server's UserList message. */
export interface RegisteredUser {
  user_id: number;
  name: string;
  last_seen?: string | null;
  last_channel?: number | null;
  /** Avatar byte length, present when the user has an avatar. The bytes are
   * fetched on demand via `get_registered_user_texture` (the bulk `user-list`
   * event ships only this marker, not the avatar bytes). */
  texture_size?: number | null;
  /** Short comment (len < 128) included inline by the server. */
  comment?: string | null;
  /** SHA-1 hash bytes present when the comment is >= 128 chars.
   * Indicates a comment exists that must be fetched via `request_user_comment`. */
  comment_hash?: number[] | null;
}

/** Payload of the `user-comment` Tauri event, emitted when the server
 * responds to a `request_user_comment` blob request. */
export interface UserCommentPayload {
  user_id: number;
  comment: string;
}

/** Payload for renaming (name set) or deleting (name null) a registered user. */
export interface RegisteredUserUpdate {
  user_id: number;
  name: string | null;
}

/**
 * A ban list entry as the UI shows and edits it. `mask` counts bits of the
 * address itself: 0 to 32 for IPv4, 0 to 128 for IPv6. The engine carries
 * the wire's count instead ({@link WireBanEntry}); the two only meet in
 * `core/features/admin/banMask.ts`.
 */
export interface BanEntry {
  address: string;
  mask: number;
  name: string;
  hash: string;
  reason: string;
  start: string;
  duration: number;
}

/**
 * A ban list entry as the `ban-list` event and the `update_ban_list` command
 * carry it: `mask` counts bits over the sixteen bytes every address travels
 * in, so one IPv4 address is 128 and an IPv4 /24 is 120.
 */
export interface WireBanEntry {
  address: string;
  mask: number;
  name: string;
  hash: string;
  reason: string;
  start: string;
  duration: number;
}

/** Full ACL data for a channel. */
export interface AclData {
  channel_id: number;
  inherit_acls: boolean;
  groups: AclGroup[];
  acls: AclEntry[];
}

/** A channel group entry within an ACL. */
export interface AclGroup {
  name: string;
  inherited: boolean;
  inherit: boolean;
  inheritable: boolean;
  add: number[];
  remove: number[];
  inherited_members: number[];
  /** FancyMumble role customization: arbitrary CSS color string. */
  color?: string | null;
  /** Raw icon bytes (PNG/JPEG). */
  icon?: number[] | null;
  /** Named visual preset id. */
  style_preset?: string | null;
  /** Free-form key/value metadata. */
  metadata?: Record<string, string>;
}

/** A single ACL rule within a channel's ACL list. */
export interface AclEntry {
  apply_here: boolean;
  apply_subs: boolean;
  inherited: boolean;
  user_id?: number | null;
  group?: string | null;
  grant: number;
  deny: number;
}
