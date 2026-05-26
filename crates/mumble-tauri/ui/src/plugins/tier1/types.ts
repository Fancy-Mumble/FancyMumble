// TypeScript mirror of mumble-plugin-api/src/client_manifest.rs and
// mumble-plugin-api/src/components/*.rs (Tier-1 client extension
// schema v2).  Plugins ship a ClientManifest inside the
// PluginRegistry's info_json blob and exchange Interaction /
// InteractionResponse envelopes through the generic PluginMessage
// transport (wire ID 200).
//
// Schema v2 adds the full Discord-aligned component vocabulary:
//   - typed selects (UserSelect, RoleSelect, MentionableSelect,
//     ChannelSelect) on top of the renamed StringSelect (= SelectMenu)
//   - layout primitives (ActionRow, Container, Section, Separator,
//     Label, TextDisplay)
//   - rich media (Thumbnail, MediaGallery, File, UnfurledMediaItem)
//   - modal additions (FileUpload, RadioGroup, CheckboxGroup, Checkbox)
//   - typed modal-submit values (ModalFieldValue) alongside the
//     legacy string-only `values` map for backwards compatibility.

/** Reserved payload_type for inbound client-originated interactions. */
export const INTERACTION_PAYLOAD_TYPE = "Interaction";

/** Reserved payload_type for outbound plugin-originated responses. */
export const INTERACTION_RESPONSE_PAYLOAD_TYPE = "InteractionResponse";

/** Schema version this client understands.  Manifests declaring a
 *  higher version are ignored. */
export const CLIENT_MANIFEST_SCHEMA_VERSION = 2;

export enum Capability {
  SlashCommands = "slash-commands",
  Modals = "modals",
  Components = "components",
  Notifications = "notifications",
  SettingsPanel = "settings-panel",
  /** Plugin uses rich-layout primitives (containers, sections,
   *  thumbnails, media galleries, file references).  Always allowed
   *  at runtime; declared purely so the trust prompt can surface it. */
  RichLayout = "rich-layout",
}

export type OptionType = "string" | "integer" | "boolean" | "user" | "channel";

export interface OptionChoice {
  readonly label: string;
  readonly value: string;
}

export interface SlashCommandOption {
  readonly name: string;
  readonly description: string;
  readonly type: OptionType;
  readonly required?: boolean;
  readonly choices?: readonly OptionChoice[];
}

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly SlashCommandOption[];
}

export interface PanelRow {
  readonly label: string;
  readonly value: string;
}

export interface SettingsPanel {
  readonly id: string;
  readonly title: string;
  readonly rows?: readonly PanelRow[];
}

export interface ClientManifest {
  readonly schema_version?: number;
  readonly slash_commands?: readonly SlashCommand[];
  readonly capabilities?: readonly Capability[];
  readonly settings_panels?: readonly SettingsPanel[];
}

// ---------------------------------------------------------------------------
// Shared rich-media reference
// ---------------------------------------------------------------------------

/** Reference to a piece of media addressable by URL.
 *
 *  Plugins use one of the following URL schemes:
 *   - `https://...` / `http://...` — fetched directly by the browser
 *   - `fancy-file://<file_id>` — a file uploaded via Fancy Mumble's
 *     file-server plugin; the client resolves the id to a signed
 *     download URL at render time
 *   - `attachment://<name>` — a file attached to the originating
 *     message under the matching `name`
 */
export interface UnfurledMediaItem {
  readonly url: string;
}

// ---------------------------------------------------------------------------
// Interactive components
// ---------------------------------------------------------------------------

export type ButtonStyle = "primary" | "secondary" | "success" | "danger" | "link";

export interface Button {
  readonly type: "button";
  /** Required for `primary` / `secondary` / `success` / `danger`.
   *  Absent for `link` buttons (which use `url` instead). */
  readonly custom_id?: string;
  readonly label: string;
  readonly style?: ButtonStyle;
  readonly disabled?: boolean;
  /** Required iff `style === "link"`. */
  readonly url?: string;
}

export interface SelectOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly default?: boolean;
}

export interface StringSelect {
  readonly type: "string-select";
  readonly custom_id: string;
  readonly placeholder?: string;
  readonly options: readonly SelectOption[];
  readonly min_values?: number;
  readonly max_values?: number;
  readonly disabled?: boolean;
  readonly required?: boolean;
}

/** Legacy alias for plugins still emitting `select-menu`.  Decoded into
 *  a `StringSelect` at parse time by the wire format, but kept here as
 *  a type alias so older TS callers compile. */
export type SelectMenu = StringSelect;

export interface UserSelect {
  readonly type: "user-select";
  readonly custom_id: string;
  readonly placeholder?: string;
  readonly min_values?: number;
  readonly max_values?: number;
  readonly disabled?: boolean;
  readonly required?: boolean;
  /** Pre-selected user session ids. */
  readonly default_values?: readonly number[];
}

export interface RoleSelect {
  readonly type: "role-select";
  readonly custom_id: string;
  readonly placeholder?: string;
  readonly min_values?: number;
  readonly max_values?: number;
  readonly disabled?: boolean;
  readonly required?: boolean;
  /** Pre-selected ACL group names. */
  readonly default_values?: readonly string[];
}

export type Mentionable =
  | { readonly kind: "user"; readonly id: number }
  | { readonly kind: "role"; readonly name: string };

export interface MentionableSelect {
  readonly type: "mentionable-select";
  readonly custom_id: string;
  readonly placeholder?: string;
  readonly min_values?: number;
  readonly max_values?: number;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly default_values?: readonly Mentionable[];
}

export interface ChannelSelect {
  readonly type: "channel-select";
  readonly custom_id: string;
  readonly placeholder?: string;
  readonly min_values?: number;
  readonly max_values?: number;
  readonly disabled?: boolean;
  readonly required?: boolean;
  /** Pre-selected channel ids. */
  readonly default_values?: readonly number[];
}

export type TextInputStyle = "short" | "paragraph";

export interface TextInput {
  readonly type: "text-input";
  readonly custom_id: string;
  readonly label: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly style?: TextInputStyle;
  readonly required?: boolean;
  readonly max_length?: number;
  readonly min_length?: number;
}

// ---------------------------------------------------------------------------
// Modal-only components
// ---------------------------------------------------------------------------

export interface FileUpload {
  readonly type: "file-upload";
  readonly custom_id: string;
  readonly min_values?: number;
  readonly max_values?: number;
  readonly required?: boolean;
}

export interface RadioOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly default?: boolean;
}

export interface RadioGroup {
  readonly type: "radio-group";
  readonly custom_id: string;
  readonly options: readonly RadioOption[];
  readonly required?: boolean;
}

export interface CheckboxOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly default?: boolean;
}

export interface CheckboxGroup {
  readonly type: "checkbox-group";
  readonly custom_id: string;
  readonly options: readonly CheckboxOption[];
  readonly min_values?: number;
  readonly max_values?: number;
  readonly required?: boolean;
}

export interface Checkbox {
  readonly type: "checkbox";
  readonly custom_id: string;
  readonly label?: string;
  readonly default?: boolean;
}

// ---------------------------------------------------------------------------
// Display / layout primitives
// ---------------------------------------------------------------------------

export interface TextDisplay {
  readonly type: "text-display";
  readonly content: string;
}

export interface Thumbnail {
  readonly type: "thumbnail";
  readonly media: UnfurledMediaItem;
  readonly description?: string;
  readonly spoiler?: boolean;
}

export interface MediaGalleryItem {
  readonly media: UnfurledMediaItem;
  readonly description?: string;
  readonly spoiler?: boolean;
}

export interface MediaGallery {
  readonly type: "media-gallery";
  readonly items: readonly MediaGalleryItem[];
}

export interface FileComponent {
  readonly type: "file";
  readonly file: UnfurledMediaItem;
  readonly spoiler?: boolean;
  readonly name?: string;
  readonly size?: number;
}

export type SeparatorSpacing = "small" | "large";

export interface Separator {
  readonly type: "separator";
  readonly divider?: boolean;
  readonly spacing?: SeparatorSpacing;
}

/** Section's accessory slot.  Carries the same `type` discriminant as
 *  the corresponding top-level Component variant so renderers can
 *  reuse the same switch arms. */
export type SectionAccessory = Button | Thumbnail;

export interface Section {
  readonly type: "section";
  readonly components: readonly Component[];
  readonly accessory: SectionAccessory;
}

export interface Container {
  readonly type: "container";
  readonly components: readonly Component[];
  /** Packed 0xRRGGBB. */
  readonly accent_color?: number;
  readonly spoiler?: boolean;
}

export interface Label {
  readonly type: "label";
  readonly label: string;
  readonly description?: string;
  readonly component: Component;
}

// ---------------------------------------------------------------------------
// Component sum type
// ---------------------------------------------------------------------------

export type Component =
  | Button
  | StringSelect
  | UserSelect
  | RoleSelect
  | MentionableSelect
  | ChannelSelect
  | TextInput
  | TextDisplay
  | Thumbnail
  | MediaGallery
  | FileComponent
  | FileUpload
  | Separator
  | Section
  | Container
  | Label
  | RadioGroup
  | CheckboxGroup
  | Checkbox;

export interface ActionRow {
  readonly components: readonly Component[];
}

// ---------------------------------------------------------------------------
// Interactions (client -> plugin) and responses (plugin -> client)
// ---------------------------------------------------------------------------

export type OptionValue = string | number | boolean;

/** Typed modal field value, mirroring `ModalFieldValue` in the Rust
 *  crate.  Used for modal components that cannot be represented as a
 *  single string (checkboxes, multi-selects, file uploads). */
export type ModalFieldValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "strings"; readonly values: readonly string[] }
  | { readonly kind: "users"; readonly values: readonly number[] }
  | { readonly kind: "channels"; readonly values: readonly number[] }
  | { readonly kind: "roles"; readonly values: readonly string[] }
  | { readonly kind: "mentionables"; readonly values: readonly Mentionable[] }
  | { readonly kind: "files"; readonly values: readonly string[] };

export type InteractionKind =
  | {
      readonly kind: "slash-command";
      readonly name: string;
      readonly options?: Readonly<Record<string, OptionValue>>;
    }
  | {
      readonly kind: "component";
      readonly custom_id: string;
      readonly values?: readonly string[];
    }
  | {
      readonly kind: "modal-submit";
      readonly custom_id: string;
      /** Legacy string-only field values, kept for backwards
       *  compatibility with schema-1 plugins. */
      readonly values?: Readonly<Record<string, string>>;
      /** Typed field values keyed by component `custom_id`. */
      readonly fields?: Readonly<Record<string, ModalFieldValue>>;
    };

export type Interaction = InteractionKind & {
  readonly correlation_id: string;
  readonly channel_id?: number | null;
};

export type ToastLevel = "info" | "success" | "warning" | "error";

export type ResponseKind =
  | {
      readonly kind: "message";
      readonly message_id: string;
      readonly content?: string;
      readonly components?: readonly ActionRow[];
      readonly ephemeral?: boolean;
    }
  | {
      readonly kind: "show-modal";
      readonly custom_id: string;
      readonly title: string;
      readonly components: readonly ActionRow[];
    }
  | {
      readonly kind: "update-message";
      readonly message_id: string;
      readonly content?: string;
      readonly components?: readonly ActionRow[] | null;
    }
  | {
      readonly kind: "update-panel";
      readonly panel_id: string;
      readonly rows: readonly PanelRow[];
    }
  | {
      readonly kind: "toast";
      readonly message: string;
      readonly level?: ToastLevel;
    };

export type InteractionResponse = ResponseKind & {
  readonly correlation_id?: string | null;
};

/** Normalise a wire-form Component.  Rewrites the schema-1
 *  `select-menu` discriminant to its v2 name `string-select` so the
 *  rest of the client only has to switch over the v2 vocabulary. */
export function normaliseComponent(component: unknown): Component | null {
  if (!component || typeof component !== "object") return null;
  const raw = component as Record<string, unknown> & { type?: unknown };
  if (raw.type === "select-menu") {
    return { ...(raw as object), type: "string-select" } as Component;
  }
  return component as Component;
}

/** Recursively normalise every component inside an ActionRow,
 *  descending into nested layout primitives. */
export function normaliseActionRow(row: ActionRow): ActionRow {
  return { components: row.components.map(normaliseComponentDeep) };
}

function normaliseComponentDeep(component: Component): Component {
  const normalised = normaliseComponent(component) ?? component;
  switch (normalised.type) {
    case "container":
      return {
        ...normalised,
        components: normalised.components.map(normaliseComponentDeep),
      };
    case "section":
      return {
        ...normalised,
        components: normalised.components.map(normaliseComponentDeep),
        accessory: normaliseComponentDeep(
          normalised.accessory,
        ) as SectionAccessory,
      };
    case "label":
      return {
        ...normalised,
        component: normaliseComponentDeep(normalised.component),
      };
    default:
      return normalised;
  }
}
