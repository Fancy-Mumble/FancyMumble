/**
 * Server Settings admin tab.
 *
 * Renders a form from the server-advertised settings schema (core murmur
 * settings + currently-loaded plugin settings) using a component-map *factory*
 * that maps each setting's `type` to an input control.  The server is the
 * single source of truth: new settings render automatically, and unknown types
 * fall back to a text field.  Saving sends only the changed settings; the
 * server applies them at runtime and re-broadcasts the updated snapshot.
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import * as Flags from "country-flag-icons/react/3x2";
import type { ServerSetting, ServerSettingsEvent } from "@core/types";
import { COUNTRIES, countryName } from "@core/utils/countries";
import { SelectInput, TextArea, TextInput } from "../../components/elements/TextInput";
import { Toggle } from "../settings/SharedControls";
import { useServerSettingsStore } from "@core/features/admin/serverSettingsStore";
import { isRichTextSetting } from "@core/features/admin/serverSettingKinds";
import { BioEditor } from "../settings/BioEditor";
import styles from "./ServerSettingsTab.module.css";
import tabStyles from "../../components/elements/TabbedPage.module.css";

export interface ServerSettingsTabProps {
  /** Hands the tab's Save bar up to `AdminPanel`'s shared pinned footer. */
  readonly setFooter?: (footer: ReactNode) => void;
}

interface FieldProps {
  readonly setting: ServerSetting;
  readonly value: string;
  readonly onChange: (v: string) => void;
}

type FieldComponent = (props: FieldProps) => ReactElement;

const FLAG_REGISTRY = Flags as unknown as Record<
  string,
  ComponentType<{ style?: CSSProperties; title?: string }>
>;

function CountryFlag({ code }: { readonly code: string }) {
  const Svg = code ? FLAG_REGISTRY[code.toUpperCase()] : undefined;
  if (!Svg) return null;
  return (
    <Svg
      style={{ width: 22, height: 16, borderRadius: 2, objectFit: "cover", flex: "0 0 auto" }}
      title={countryName(code)}
    />
  );
}

/** The row already renders the setting's label, so controls are self-labelled. */
function label(setting: FieldProps["setting"]): string {
  return setting.label || setting.key;
}

function TextField({ setting, value, onChange }: FieldProps) {
  return (
    <TextInput
      type="text"
      value={value}
      aria-label={label(setting)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function PasswordField({ setting, value, onChange }: FieldProps) {
  return (
    <TextInput
      type="password"
      value={value}
      placeholder={setting.secret ? "•••••••• (unchanged)" : ""}
      autoComplete="new-password"
      aria-label={label(setting)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function CodeField({ setting, value, onChange }: FieldProps) {
  return (
    <TextArea
      mono
      value={value}
      rows={8}
      spellCheck={false}
      aria-label={label(setting)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function BoolField({ setting, value, onChange }: FieldProps) {
  const checked = value === "true" || value === "1";
  return (
    <Toggle
      checked={checked}
      ariaLabel={label(setting)}
      onChange={() => onChange(checked ? "false" : "true")}
    />
  );
}

function IntField({ setting, value, onChange }: FieldProps) {
  return (
    <TextInput
      type="number"
      value={value}
      aria-label={label(setting)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EnumField({ setting, value, onChange }: FieldProps) {
  return (
    <SelectInput value={value} aria-label={label(setting)} onChange={(e) => onChange(e.target.value)}>
      {!setting.options.includes(value) && value !== "" && <option value={value}>{value}</option>}
      {setting.options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </SelectInput>
  );
}

function CountryField({ setting, value, onChange }: FieldProps) {
  const lower = value.toLowerCase();
  const known = COUNTRIES.some((c) => c.code === lower);
  return (
    <div className={styles.countryRow}>
      <CountryFlag code={value} />
      <SelectInput value={lower} aria-label={label(setting)} onChange={(e) => onChange(e.target.value)}>
        <option value="">-</option>
        {!known && value !== "" && <option value={lower}>{value}</option>}
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}

/**
 * How long a welcome text may get.
 *
 * Every connecting client is sent this in its `ServerSync`, so it is paid for
 * on every join rather than once - generous enough for a page of house rules,
 * short enough that it is not where somebody pastes a picture.
 */
const HTML_MAX_LENGTH = 16_000;

/**
 * A setting whose value is markup, edited as what it renders as.
 *
 * The same editor this UI writes bios and channel descriptions with, so the
 * three surfaces that produce HTML produce the same HTML - and the allow-list
 * every client puts this through on the way to the screen is what decides what
 * survives, not this toolbar.
 */
function HtmlField({ setting, value, onChange }: FieldProps) {
  return (
    <BioEditor
      value={value}
      onChange={onChange}
      ariaLabel={label(setting)}
      maxLength={HTML_MAX_LENGTH}
    />
  );
}

/** The component-map factory: maps a setting `type` to a form control. */
const FIELD_FACTORY: Record<string, FieldComponent> = {
  string: TextField,
  text: CodeField,
  html: HtmlField,
  bool: BoolField,
  int: IntField,
  enum: EnumField,
  country: CountryField,
  password: PasswordField,
};

/**
 * The control for one setting.
 *
 * Keyed on the declared type, except that a server which says only "text" for
 * a value that has always been markup still gets the editor - see
 * `isRichTextSetting`.
 */
function fieldFor(setting: ServerSetting): FieldComponent {
  if (isRichTextSetting(setting)) return HtmlField;
  return FIELD_FACTORY[setting.type] ?? TextField;
}

function originalValue(s: ServerSetting): string {
  return s.value ?? "";
}

export function ServerSettingsTab({ setFooter }: Readonly<ServerSettingsTabProps>) {
  const { t } = useTranslation("settings");
  const snapshot = useServerSettingsStore((s) => s.snapshot);
  const busy = useServerSettingsStore((s) => s.busy);
  const save = useServerSettingsStore((s) => s.save);
  const load = useServerSettingsStore((s) => s.load);
  const setSnapshot = useServerSettingsStore((s) => s.setSnapshot);

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void load().finally(() => setLoaded(true));
    const un = listen<ServerSettingsEvent>("server-settings", (e) => setSnapshot(e.payload.settings));
    return () => {
      void un.then((f) => f());
    };
  }, [load, setSnapshot]);

  // A fresh snapshot (e.g. the server's re-broadcast after a save) supersedes
  // local edits.
  const revision = snapshot?.revision ?? -1;
  useEffect(() => {
    setEdits({});
  }, [revision]);

  const groups = useMemo(() => {
    const map = new Map<string, ServerSetting[]>();
    for (const s of snapshot?.settings ?? []) {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return [...map.entries()];
  }, [snapshot]);

  const valueOf = (s: ServerSetting): string => edits[s.key] ?? originalValue(s);

  const changed: ServerSetting[] = (snapshot?.settings ?? [])
    .filter((s) => {
      if (!(s.key in edits)) return false;
      const v = edits[s.key] ?? "";
      // Secret: only send when a new value was actually typed.
      if (s.secret) return v.length > 0;
      return v !== originalValue(s);
    })
    .map((s) => ({ ...s, value: edits[s.key] ?? "" }));

  const onSave = async () => {
    setError(null);
    try {
      await save(changed);
      setEdits({});
      setSavedAt(Date.now());
    } catch (e) {
      setError(String(e));
    }
  };

  const footerNode = useMemo(() => {
    if (!snapshot) return null;
    return (
      <>
        {error && <span className={styles.error}>{error}</span>}
        {!error && savedAt > 0 && changed.length === 0 && (
          <span className={styles.saved}>{t("serverSettings.saved", { defaultValue: "Saved" })}</span>
        )}
        <div className={tabStyles.actionBtnGroup}>
          <button
            type="button"
            className={`${tabStyles.actionBtn} ${tabStyles.actionBtnPrimary}`}
            disabled={busy || changed.length === 0}
            onClick={() => void onSave()}
          >
            {busy
              ? t("serverSettings.saving", { defaultValue: "Saving…" })
              : t("serverSettings.save", { defaultValue: "Save changes" })}
            {changed.length > 0 ? ` (${changed.length})` : ""}
          </button>
        </div>
      </>
    );
    // `changed` is derived fresh from `snapshot`+`edits` every render, so
    // depending on those two (not `changed`/`onSave` themselves) is what
    // keeps the memoized button's `onClick` from closing over a stale
    // `edits` snapshot - the same stale-closure trap as useChannelAcl's
    // `save`, just one level removed via a derived variable.
  }, [snapshot, edits, error, savedAt, busy, t]);

  useEffect(() => {
    setFooter?.(footerNode);
    return () => setFooter?.(null);
  }, [footerNode, setFooter]);

  if (!snapshot) {
    return (
      <div className={styles.empty}>
        {loaded
          ? t("serverSettings.unavailable", {
              defaultValue:
                "Server settings aren't available. This server may not support runtime settings, or you may not have permission to change them.",
            })
          : t("serverSettings.loading", { defaultValue: "Loading server settings…" })}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.intro}>
        {t("serverSettings.intro", {
          defaultValue:
            "Change server settings at runtime. Changes apply immediately and are saved on the server.",
        })}
      </div>

      {groups.map(([group, items]) => (
        <section key={group} className={styles.group}>
          <h3 className={styles.groupTitle}>{group}</h3>
          <div className={styles.grid}>
            {items.map((s) => {
              const Field = fieldFor(s);
              return (
                <div key={s.key} className={styles.row}>
                  <div className={styles.labelCol}>
                    <label className={styles.label} htmlFor={`set-${s.key}`}>
                      {s.label || s.key}
                    </label>
                    {s.help && <div className={styles.help}>{s.help}</div>}
                  </div>
                  <div className={styles.controlCol}>
                    <Field
                      setting={s}
                      value={valueOf(s)}
                      onChange={(v) => setEdits((p) => ({ ...p, [s.key]: v }))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
