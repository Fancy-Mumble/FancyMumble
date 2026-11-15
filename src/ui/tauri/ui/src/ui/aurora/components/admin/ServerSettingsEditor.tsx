import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useServerSettingsStore } from "@core/features/admin/serverSettingsStore";
import { isRichTextSetting } from "@core/features/admin/serverSettingKinds";
import type { ServerSetting, ServerSettingsEvent } from "@core/types";
import { Button, RichTextEditor, TextAreaField, TextField } from "../primitives";
import styles from "./ServerSettingsEditor.module.css";

export default function ServerSettingsEditor() {
  const snapshot = useServerSettingsStore((state) => state.snapshot);
  const busy = useServerSettingsStore((state) => state.busy);
  const error = useServerSettingsStore((state) => state.error);
  const load = useServerSettingsStore((state) => state.load);
  const save = useServerSettingsStore((state) => state.save);
  const setSnapshot = useServerSettingsStore((state) => state.setSnapshot);
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    void load();
    const cleanup = listen<ServerSettingsEvent>("server-settings", (event) =>
      setSnapshot(event.payload.settings),
    );
    return () => {
      void cleanup.then((off) => off());
    };
  }, [load, setSnapshot]);
  useEffect(() => setEdits({}), [snapshot?.revision]);
  const groups = useMemo(() => {
    const result = new Map<string, ServerSetting[]>();
    for (const setting of snapshot?.settings ?? [])
      result.set(setting.group, [...(result.get(setting.group) ?? []), setting]);
    return [...result];
  }, [snapshot]);
  const changed = (snapshot?.settings ?? [])
    .filter(
      (setting) =>
        setting.key in edits &&
        (setting.secret ? edits[setting.key]!.length > 0 : edits[setting.key] !== (setting.value ?? "")),
    )
    .map((setting) => ({ ...setting, value: edits[setting.key] }));
  const update = (key: string, value: string) => setEdits((current) => ({ ...current, [key]: value }));
  const field = (setting: ServerSetting) => {
    const value = edits[setting.key] ?? setting.value ?? "";
    if (setting.type === "bool")
      return (
        <Button
          variant={value === "true" || value === "1" ? "secondary" : "bare"}
          onClick={() => update(setting.key, value === "true" || value === "1" ? "false" : "true")}
        >
          {value === "true" || value === "1" ? "Enabled" : "Disabled"}
        </Button>
      );
    if (setting.type === "enum" || setting.type === "country")
      return (
        <select
          aria-label={setting.label || setting.key}
          value={value}
          onChange={(event) => update(setting.key, event.target.value)}
        >
          {!setting.options.includes(value) && <option value={value}>{value || "-"}</option>}
          {setting.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    // A value the server calls markup - or one it only calls "text" while
    // naming it like the setting that has always been markup.
    if (isRichTextSetting(setting)) {
      return (
        <RichTextEditor
          label={setting.label || setting.key}
          value={value}
          onChange={(html) => update(setting.key, html)}
          ariaLabel={setting.label || setting.key}
        />
      );
    }
    if (setting.type === "text")
      return (
        <TextAreaField
          label={setting.label || setting.key}
          value={value}
          onChange={(event) => update(setting.key, event.target.value)}
        />
      );
    return (
      <TextField
        label={setting.label || setting.key}
        type={
          setting.type === "int"
            ? "number"
            : setting.type === "password" || setting.secret
              ? "password"
              : "text"
        }
        value={value}
        placeholder={setting.secret ? "Leave empty to keep the current value" : undefined}
        onChange={(event) => update(setting.key, event.target.value)}
      />
    );
  };
  if (!snapshot) return <div className={styles.empty}>{error || "Loading runtime server settings…"}</div>;
  return (
    <div className={styles.editor}>
      <header>
        <div>
          <h3>Runtime server configuration</h3>
          <p>The schema is supplied by the server, including settings exposed by loaded plugins.</p>
        </div>
        <Button
          variant="primary"
          disabled={busy || changed.length === 0}
          onClick={() => void save(changed).then(() => setEdits({}))}
        >
          {busy ? "Saving…" : `Save changes${changed.length ? ` (${changed.length})` : ""}`}
        </Button>
      </header>
      {error && <p className={styles.error}>{error}</p>}
      {groups.map(([group, settings]) => (
        <section key={group}>
          <h4>{group}</h4>
          {settings.map((setting) => (
            <div className={styles.row} key={setting.key}>
              <div>
                <strong>{setting.label || setting.key}</strong>
                {setting.help && <small>{setting.help}</small>}
              </div>
              <div className={styles.control}>{field(setting)}</div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
