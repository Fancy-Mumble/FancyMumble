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

/**
 * Write the same patch over the connection this client already has.
 *
 * No credential: the server authorises against the session the frame arrived
 * on - `Write` on the root channel, murmur's rule for every administrative
 * write - so an admin who is connected is already carrying an identity the
 * server established at the handshake.
 *
 * Resolves once the frame is away. A refusal comes back asynchronously as a
 * `PermissionDenied`, not as a rejection here, so a caller shows "sent" and
 * lets the reload that follows report what actually landed.
 */
export function writeLiveryOverChannel(patch: LiveryPatch): Promise<void> {
  return invoke<void>("livery_update_over_channel", { patch });
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

/**
 * The livery as the connection reports it: what the client is rendering, with
 * artwork already fetched.
 *
 * Camel-cased because it is built by the Rust handler for the UI, where the
 * operator API's document is snake-cased because it is the operator's own.
 */
export interface LiverySnapshot {
  version: number;
  digest: string;
  displayName?: string;
  tagline?: string;
  motd?: string;
  tags: LiveryTag[];
  rulesUrl?: string;
  bannerKey?: string;
  iconKey?: string;
  bannerSrc?: string;
  iconSrc?: string;
  bannerFocus?: { x: number; y: number };
  palette: { dark?: LiveryPalette; light?: LiveryPalette };
}

/** What the open server is currently showing, or null if it shows nothing. */
export function currentLivery(): Promise<LiverySnapshot | null> {
  return invoke<LiverySnapshot | null>("get_livery");
}

/**
 * The editable document behind a snapshot.
 *
 * The two shapes exist because they answer different questions - one is what a
 * client paints, the other is what an operator typed - and this is the single
 * place that knows both.
 */
export function fromSnapshot(snapshot: LiverySnapshot | null): LiveryDocument {
  if (!snapshot) return { version: 0, digest: "" };
  return {
    version: snapshot.version,
    digest: snapshot.digest,
    display_name: snapshot.displayName,
    tagline: snapshot.tagline,
    motd: snapshot.motd,
    tags: snapshot.tags,
    rules_url: snapshot.rulesUrl,
    banner_key: snapshot.bannerKey,
    icon_key: snapshot.iconKey,
    banner_focus_x: snapshot.bannerFocus?.x,
    banner_focus_y: snapshot.bannerFocus?.y,
    dark: snapshot.palette.dark,
    light: snapshot.palette.light,
  };
}

/**
 * The contrast floor a client holds an accent to, mirroring
 * `starling_runtime::livery::clamp`.
 *
 * Computed here rather than read from `GET /v1/livery/preview` for two
 * reasons. The route reports the *saved* palette, so while an operator is
 * typing it answers about the colour they had before; and it needs the operator
 * credential, which the rest of this page no longer does.
 *
 * The server stays the authority - it runs the same clamp for its preview, and
 * every client runs it before painting. This is the editor showing what that
 * will produce, live.
 */
export const CONTRAST_ACCENT = 3;

function channels(hex: string): [number, number, number] {
  const digits = hex.slice(1);
  return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function luminance(colour: readonly [number, number, number]): number {
  const [red, green, blue] = colour.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
export function contrast(one: string, other: string): number {
  const [lighter, darker] = [luminance(channels(one)), luminance(channels(other))].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function toHsl(colour: readonly [number, number, number]): [number, number, number] {
  const [red, green, blue] = colour.map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    max === red
      ? ((((green - blue) / delta) % 6) + 6) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function fromHsl(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((((hue % 360) + 360) % 360) / 60) % 6;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const table: [number, number, number][] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const base = lightness - chroma / 2;
  return `#${table[Math.floor(sector)]
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, (value + base) * 255)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * Move `colour` until it reads against `behind`, keeping its hue, or return it
 * unchanged when it already does.
 *
 * Both directions are tried nearest-first rather than deciding which way to go
 * from the ground's luminance: every such rule is wrong somewhere, and "away
 * from the ground" sends a near-white accent on a near-white surface further
 * towards white.
 */
export function clampHex(colour: string, behind: string, target = CONTRAST_ACCENT): string {
  if (!isHexColour(colour) || !isHexColour(behind)) return colour;
  if (contrast(colour, behind) >= target) return colour;

  const [hue, saturation, lightness] = toHsl(channels(colour));
  let best = colour;
  let bestContrast = contrast(colour, behind);
  for (let step = 1; step <= 100; step += 1) {
    for (const candidate of [lightness + step / 100, lightness - step / 100]) {
      if (candidate < 0 || candidate > 1) continue;
      const moved = fromHsl(hue, saturation, candidate);
      const reached = contrast(moved, behind);
      if (reached >= target) return moved;
      if (reached > bestContrast) {
        best = moved;
        bestContrast = reached;
      }
    }
  }
  return best;
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
