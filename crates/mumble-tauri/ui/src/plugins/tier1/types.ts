// TypeScript mirror of mumble-plugin-api/src/client_manifest.rs (Tier-1
// client extension schema).  Plugins ship a ClientManifest inside the
// PluginRegistry's info_json blob and exchange Interaction /
// InteractionResponse envelopes through the generic PluginMessage
// transport (wire ID 200).

/** Reserved payload_type for inbound client-originated interactions. */
export const INTERACTION_PAYLOAD_TYPE = "Interaction";

/** Reserved payload_type for outbound plugin-originated responses. */
export const INTERACTION_RESPONSE_PAYLOAD_TYPE = "InteractionResponse";

/** Schema version this client understands.  Manifests declaring a
 *  higher version are ignored. */
export const CLIENT_MANIFEST_SCHEMA_VERSION = 1;

export type Capability =
  | "slash-commands"
  | "modals"
  | "components"
  | "notifications"
  | "settings-panel";

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
// Components
// ---------------------------------------------------------------------------

export type ButtonStyle = "primary" | "secondary" | "success" | "danger";

export interface Button {
  readonly type: "button";
  readonly custom_id: string;
  readonly label: string;
  readonly style?: ButtonStyle;
  readonly disabled?: boolean;
}

export interface SelectOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}

export interface SelectMenu {
  readonly type: "select-menu";
  readonly custom_id: string;
  readonly placeholder?: string;
  readonly options: readonly SelectOption[];
  readonly min_values?: number;
  readonly max_values?: number;
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
}

export type Component = Button | SelectMenu | TextInput;

export interface ActionRow {
  readonly components: readonly Component[];
}

// ---------------------------------------------------------------------------
// Interactions (client -> plugin) and responses (plugin -> client)
// ---------------------------------------------------------------------------

export type OptionValue = string | number | boolean;

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
      readonly values?: Readonly<Record<string, string>>;
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
