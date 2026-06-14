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

import { useEffect, useMemo, useState, type CSSProperties, type ComponentType, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import * as Flags from "country-flag-icons/react/3x2";
import type { ServerSetting, ServerSettingsEvent } from "../../types";
import { COUNTRIES, countryName } from "../../utils/countries";
import { useServerSettingsStore } from "./serverSettingsStore";
import styles from "./ServerSettingsTab.module.css";

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

function TextField({ value, onChange }: FieldProps) {
  return (
    <input
      type="text"
      className={styles.input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function PasswordField({ setting, value, onChange }: FieldProps) {
  return (
    <input
      type="password"
      className={styles.input}
      value={value}
      placeholder={setting.secret ? "•••••••• (unchanged)" : ""}
      autoComplete="new-password"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function CodeField({ value, onChange }: FieldProps) {
  return (
    <textarea
      className={styles.code}
      value={value}
      rows={8}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function BoolField({ value, onChange }: FieldProps) {
  const checked = value === "true" || value === "1";
  return (
    <label className={styles.checkboxLabel}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? "true" : "false")}
      />
    </label>
  );
}

function IntField({ value, onChange }: FieldProps) {
  return (
    <input
      type="number"
      className={styles.input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EnumField({ setting, value, onChange }: FieldProps) {
  return (
    <select className={styles.input} value={value} onChange={(e) => onChange(e.target.value)}>
      {!setting.options.includes(value) && value !== "" && <option value={value}>{value}</option>}
      {setting.options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function CountryField({ value, onChange }: FieldProps) {
  const lower = value.toLowerCase();
  const known = COUNTRIES.some((c) => c.code === lower);
  return (
    <div className={styles.countryRow}>
      <CountryFlag code={value} />
      <select className={styles.input} value={lower} onChange={(e) => onChange(e.target.value)}>
        <option value="">-</option>
        {!known && value !== "" && <option value={lower}>{value}</option>}
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

/** The component-map factory: maps a setting `type` to a form control. */
const FIELD_FACTORY: Record<string, FieldComponent> = {
  string: TextField,
  text: CodeField,
  bool: BoolField,
  int: IntField,
  enum: EnumField,
  country: CountryField,
  password: PasswordField,
};

function fieldFor(type: string): FieldComponent {
  return FIELD_FACTORY[type] ?? TextField;
}

function originalValue(s: ServerSetting): string {
  return s.value ?? "";
}

export function ServerSettingsTab() {
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
              const Field = fieldFor(s.type);
              return (
                <div key={s.key} className={styles.row}>
                  <div className={styles.labelCol}>
                    <label className={styles.label} htmlFor={`set-${s.key}`}>{s.label || s.key}</label>
                    {s.help && <div className={styles.help}>{s.help}</div>}
                  </div>
                  <div className={styles.controlCol}>
                    <Field setting={s} value={valueOf(s)} onChange={(v) => setEdits((p) => ({ ...p, [s.key]: v }))} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className={styles.footer}>
        {error && <span className={styles.error}>{error}</span>}
        {!error && savedAt > 0 && changed.length === 0 && (
          <span className={styles.saved}>{t("serverSettings.saved", { defaultValue: "Saved" })}</span>
        )}
        <button
          type="button"
          className={styles.saveBtn}
          disabled={busy || changed.length === 0}
          onClick={() => void onSave()}
        >
          {busy
            ? t("serverSettings.saving", { defaultValue: "Saving…" })
            : t("serverSettings.save", { defaultValue: "Save changes" })}
          {changed.length > 0 ? ` (${changed.length})` : ""}
        </button>
      </div>
    </div>
  );
}
