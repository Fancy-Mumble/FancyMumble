/**
 * Client helpers for the livery admin tab.
 *
 * Thin wrappers over the Tauri proxy commands, plus the shape of the document
 * and the rules the editor has to respect. Every call goes through the backend
 * for the reason the file-server dashboard does: the operator API is a
 * different origin, so a direct `fetch` is CORS-blocked, and the admin bearer
 * must not live in the page.
 */
import { invoke } from "@tauri-apps/api/core";

/** Where the operator API is, and the credential for it. */
export interface OperatorCreds {
  readonly baseUrl: string;
  readonly token: string;
}

/** How a chip is toned. Not a colour - the client owns what each looks like. */
export const TONES = ["NEUTRAL", "OK", "WARN", "BAD", "ACCENT"] as const;
export type LiveryTone = (typeof TONES)[number];

export interface LiveryTag {
  label: string;
  tone: LiveryTone;
  href?: string;
}

/** One mode's colours. Every entry is `#rrggbb` or absent. */
export interface LiveryPalette {
  accent?: string;
  surface?: string;
  aura_from?: string;
  aura_to?: string;
}

/**
 * The document as the operator API serves it.
 *
 * `version` and `digest` are the server's and are refused as input, so the
 * editor strips them before writing.
 */
export interface LiveryDocument {
  version: number;
  digest: string;
  display_name?: string;
  tagline?: string;
  motd?: string;
  tags?: LiveryTag[];
  rules_url?: string;
  banner_key?: string;
  icon_key?: string;
  banner_focus_x?: number;
  banner_focus_y?: number;
  dark?: LiveryPalette;
  light?: LiveryPalette;
}

/** What a client will actually paint, and which colours had to move. */
export interface LiveryPreview {
  mode: "dark" | "light";
  palette: LiveryPalette | null;
  clamped: string[];
  contrast_floor: { accent: number; text: number };
}

/**
 * The server's own limits, mirrored so the editor can count down to them rather
 * than only report a refusal after the fact.
 *
 * The server remains the authority: everything here is also enforced there, and
 * a mismatch shows up as a refusal naming the real number.
 */
export const LIMITS = {
  displayName: 64,
  tagline: 120,
  motd: 400,
  tagLabel: 24,
  tags: 4,
  bannerBytes: 512 * 1024,
  iconBytes: 64 * 1024,
} as const;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Fields the editor may write, which is every one the API accepts. */
export type LiveryField =
  | "display_name"
  | "tagline"
  | "motd"
  | "tags"
  | "rules_url"
  | "banner_focus_x"
  | "banner_focus_y"
  | "dark"
  | "light";

export type LiveryPatch = Partial<Record<LiveryField, unknown>>;

export function readLivery(creds: OperatorCreds): Promise<LiveryDocument> {
  return invoke<LiveryDocument>("livery_get", { ...creds });
}

/**
 * Write only what changed.
 *
 * The API merges field-wise, so sending the whole document would make two
 * operators editing different halves overwrite each other. An empty patch is
 * refused by the server, so callers check before sending.
 */
export function writeLivery(creds: OperatorCreds, patch: LiveryPatch): Promise<void> {
  return invoke<void>("livery_set", { ...creds, patch });
}

export function previewLivery(
  creds: OperatorCreds,
  mode: "dark" | "light",
): Promise<LiveryPreview> {
  return invoke<LiveryPreview>("livery_preview", { ...creds, mode });
}

export function uploadLiveryImage(
  creds: OperatorCreds,
  which: "banner" | "icon",
  bytes: Uint8Array,
): Promise<void> {
  // Handed over as a plain array: Tauri's IPC carries JSON, and a typed array
  // arrives at a `Vec<u8>` parameter as an object rather than a sequence.
  return invoke<void>("livery_upload_image", { ...creds, which, bytes: Array.from(bytes) });
}

export function clearLiveryImage(
  creds: OperatorCreds,
  which: "banner" | "icon",
): Promise<void> {
  return invoke<void>("livery_clear_image", { ...creds, which });
}

export function liveryImage(
  creds: OperatorCreds,
  which: "banner" | "icon",
): Promise<string | null> {
  return invoke<string | null>("livery_image_data_uri", { ...creds, which });
}

export function checkOperatorApi(creds: OperatorCreds): Promise<string> {
  return invoke<string>("livery_check", { ...creds });
}

/** `#rrggbb`, the only colour form the server accepts. */
export function isHexColour(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

/**
 * What changed between the document on the server and the one being edited.
 *
 * Compared by value rather than tracked by a dirty flag per control, because
 * the palettes and the tag list are nested: a flag would have to be set by
 * every control that can reach them, and one that forgets produces an edit that
 * silently does not save.
 */
export function diffLivery(before: LiveryDocument, after: LiveryDocument): LiveryPatch {
  const patch: LiveryPatch = {};
  const text = (field: "display_name" | "tagline" | "motd" | "rules_url") => {
    if ((before[field] ?? "") !== (after[field] ?? "")) patch[field] = after[field] ?? "";
  };
  text("display_name");
  text("tagline");
  text("motd");
  text("rules_url");

  const focus = (field: "banner_focus_x" | "banner_focus_y") => {
    if ((before[field] ?? 0) !== (after[field] ?? 0)) patch[field] = after[field] ?? 0;
  };
  focus("banner_focus_x");
  focus("banner_focus_y");

  if (JSON.stringify(before.tags ?? []) !== JSON.stringify(after.tags ?? [])) {
    patch.tags = after.tags ?? [];
  }
  for (const mode of ["dark", "light"] as const) {
    if (JSON.stringify(before[mode] ?? {}) !== JSON.stringify(after[mode] ?? {})) {
      patch[mode] = after[mode] ?? {};
    }
  }
  return patch;
}
