/** Editable server settings (schema + values) advertised to admins, and the
 *  broadcast event that delivers them. */

/** Input type for a server setting, mapped to a form control by the factory. */
export type ServerSettingType =
  | "string" | "text" | "bool" | "int" | "enum" | "country" | "password";

/** One editable server setting (schema + current value), advertised by the
 *  server. The `type` drives the client's form-control factory. */
export interface ServerSetting {
  /** Config key (core key, or `plugin.<name>.<key>` for plugin settings). */
  key: string;
  /** Input type driving the form control. */
  type: ServerSettingType | string;
  /** Group/section the setting belongs to. */
  group: string;
  /** Human-readable label. */
  label: string;
  /** Current value (string-encoded). Omitted for secret settings. */
  value?: string | null;
  /** Allowed values for `enum` types. */
  options: string[];
  /** Whether the value is a secret (masked, write-only). */
  secret: boolean;
  /** Optional one-line help text. */
  help?: string | null;
}

/** Editable server-settings snapshot advertised by the server to admins. */
export interface ServerSettingsSnapshot {
  settings: ServerSetting[];
  revision: number;
}

/** Event payload emitted when a `FancyServerSettings` broadcast arrives. */
export interface ServerSettingsEvent {
  settings: ServerSettingsSnapshot;
}
