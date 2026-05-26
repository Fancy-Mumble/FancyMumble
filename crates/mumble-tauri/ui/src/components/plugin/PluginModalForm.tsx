// Plugin-driven modal form.  Owns typed `fields` state for every
// modal-eligible component and submits both the legacy string-only
// `values` map (for schema-1 plugins) and the new typed `fields` map
// (for schema-2 plugins) on confirm.

import { useState, useEffect, useCallback } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  dismissPluginModal,
  sendPluginInteraction,
  useAppStore,
} from "../../store";
import { useAclGroups } from "../../hooks/useAclGroups";
import { CloseIcon } from "../../icons";
import type {
  Component,
  ModalFieldValue,
} from "../../plugins/tier1/types";
import type { PluginModalState } from "../../plugins/tier1/store";
import { RenderComponent } from "./PluginComponentRenderer";
import styles from "./PluginInteractionLayer.module.css";

type FieldMap = Record<string, ModalFieldValue>;

/** Top-level modal renderer.  Walks the component tree once to compute
 *  initial field values, then renders the form rows. */
export default function PluginModalForm({
  modal,
}: {
  readonly modal: PluginModalState;
}) {
  const [fields, setFields] = useState<FieldMap>(() => initialFields(modal));
  useEffect(() => {
    setFields(initialFields(modal));
  }, [modal]);

  const setField = useCallback(
    (customId: string, value: ModalFieldValue) =>
      setFields((prev) => ({ ...prev, [customId]: value })),
    [],
  );

  const onSubmit = () => {
    const values = legacyValuesFrom(fields);
    void sendPluginInteraction(
      modal.pluginName,
      {
        kind: "modal-submit",
        custom_id: modal.customId,
        values,
        fields,
      },
      modal.channelId,
    );
    dismissPluginModal();
  };

  return (
    <div
      className={styles.modalScrim}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismissPluginModal();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span>{modal.title}</span>
          <button
            type="button"
            className={styles.cardClose}
            onClick={dismissPluginModal}
            aria-label="Close"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div className={styles.modalBody}>
          {modal.components.flatMap((row, ri) =>
            row.components.map((c, ci) => (
              <ModalNode
                key={`${ri}:${ci}`}
                component={c}
                fields={fields}
                setField={setField}
                channelId={modal.channelId}
                pluginName={modal.pluginName}
              />
            )),
          )}
        </div>
        <div className={styles.modalFooter}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={dismissPluginModal}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onSubmit}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initial state & legacy-values projection
// ---------------------------------------------------------------------------

function initialFields(modal: PluginModalState): FieldMap {
  const out: FieldMap = {};
  for (const row of modal.components) {
    for (const c of row.components) {
      collectInitial(c, out);
    }
  }
  return out;
}

function collectInitial(component: Component, out: FieldMap): void {
  switch (component.type) {
    case "text-input":
      out[component.custom_id] = { kind: "string", value: component.value ?? "" };
      return;
    case "checkbox":
      out[component.custom_id] = { kind: "bool", value: component.default ?? false };
      return;
    case "checkbox-group":
      out[component.custom_id] = {
        kind: "strings",
        values: component.options.filter((o) => o.default).map((o) => o.value),
      };
      return;
    case "radio-group": {
      const initial =
        component.options.find((o) => o.default)?.value ??
        component.options[0]?.value ??
        "";
      out[component.custom_id] = { kind: "string", value: initial };
      return;
    }
    case "file-upload":
      out[component.custom_id] = { kind: "files", values: [] };
      return;
    case "user-select":
      out[component.custom_id] = {
        kind: "users",
        values: component.default_values ?? [],
      };
      return;
    case "channel-select":
      out[component.custom_id] = {
        kind: "channels",
        values: component.default_values ?? [],
      };
      return;
    case "role-select":
      out[component.custom_id] = {
        kind: "roles",
        values: component.default_values ?? [],
      };
      return;
    case "mentionable-select":
      out[component.custom_id] = {
        kind: "mentionables",
        values: component.default_values ?? [],
      };
      return;
    case "string-select":
      out[component.custom_id] = {
        kind: "strings",
        values: component.options.filter((o) => o.default).map((o) => o.value),
      };
      return;
    case "label":
      collectInitial(component.component, out);
      return;
    case "container":
      for (const c of component.components) collectInitial(c, out);
      return;
    case "section":
      for (const c of component.components) collectInitial(c, out);
      return;
    case "button":
    case "text-display":
    case "thumbnail":
    case "media-gallery":
    case "file":
    case "separator":
      return;
  }
}

function legacyValuesFrom(fields: FieldMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(fields)) {
    switch (value.kind) {
      case "string":
        out[id] = value.value;
        break;
      case "bool":
        out[id] = value.value ? "true" : "false";
        break;
      case "strings":
      case "roles":
      case "files":
        out[id] = value.values.join(",");
        break;
      case "users":
      case "channels":
        out[id] = value.values.map(String).join(",");
        break;
      case "mentionables":
        out[id] = value.values
          .map((m) => (m.kind === "user" ? `user:${m.id}` : `role:${m.name}`))
          .join(",");
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Node dispatcher
// ---------------------------------------------------------------------------

interface NodeProps {
  readonly component: Component;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
  readonly channelId: number | null;
  readonly pluginName: string;
}

function ModalNode({ component, fields, setField, channelId, pluginName }: NodeProps) {
  switch (component.type) {
    case "text-input":
      return (
        <ModalTextInput
          component={component}
          fields={fields}
          setField={setField}
        />
      );
    case "checkbox":
      return (
        <ModalCheckbox component={component} fields={fields} setField={setField} />
      );
    case "checkbox-group":
      return (
        <ModalCheckboxGroup
          component={component}
          fields={fields}
          setField={setField}
        />
      );
    case "radio-group":
      return (
        <ModalRadioGroup
          component={component}
          fields={fields}
          setField={setField}
        />
      );
    case "file-upload":
      return (
        <ModalFileUpload
          component={component}
          fields={fields}
          setField={setField}
          channelId={channelId}
        />
      );
    case "user-select":
      return (
        <ModalUserSelect
          component={component}
          fields={fields}
          setField={setField}
        />
      );
    case "channel-select":
      return (
        <ModalChannelSelect
          component={component}
          fields={fields}
          setField={setField}
        />
      );
    case "role-select":
      return (
        <ModalRoleSelect
          component={component}
          fields={fields}
          setField={setField}
        />
      );
    case "mentionable-select":
      return (
        <ModalMentionableSelect
          component={component}
          fields={fields}
          setField={setField}
        />
      );
    case "string-select":
      return (
        <ModalStringSelect
          component={component}
          fields={fields}
          setField={setField}
        />
      );
    case "label":
      return (
        <div className={styles.label}>
          <span className={styles.labelTitle}>{component.label}</span>
          {component.description && (
            <span className={styles.labelDescription}>
              {component.description}
            </span>
          )}
          <ModalNode
            component={component.component}
            fields={fields}
            setField={setField}
            channelId={channelId}
            pluginName={pluginName}
          />
        </div>
      );
    case "container":
      return (
        <div className={styles.container}>
          {component.components.map((c, i) => (
            <ModalNode
              key={i}
              component={c}
              fields={fields}
              setField={setField}
              channelId={channelId}
              pluginName={pluginName}
            />
          ))}
        </div>
      );
    case "section":
      return (
        <div className={styles.section}>
          <div className={styles.sectionMain}>
            {component.components.map((c, i) => (
              <ModalNode
                key={i}
                component={c}
                fields={fields}
                setField={setField}
                channelId={channelId}
                pluginName={pluginName}
              />
            ))}
          </div>
          <RenderComponent
            component={component.accessory}
            ctx={{ pluginName, channelId }}
          />
        </div>
      );
    case "button":
    case "text-display":
    case "thumbnail":
    case "media-gallery":
    case "file":
    case "separator":
      return (
        <RenderComponent
          component={component}
          ctx={{ pluginName, channelId }}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Individual modal field renderers
// ---------------------------------------------------------------------------

function getString(fields: FieldMap, id: string): string {
  const v = fields[id];
  if (v?.kind === "string") return v.value;
  return "";
}

function getStringArray(fields: FieldMap, id: string): readonly string[] {
  const v = fields[id];
  if (v?.kind === "strings" || v?.kind === "roles" || v?.kind === "files") {
    return v.values;
  }
  return [];
}

function getNumberArray(fields: FieldMap, id: string): readonly number[] {
  const v = fields[id];
  if (v?.kind === "users" || v?.kind === "channels") return v.values;
  return [];
}

function getBool(fields: FieldMap, id: string): boolean {
  const v = fields[id];
  if (v?.kind === "bool") return v.value;
  return false;
}

function ModalTextInput({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "text-input" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const value = getString(fields, component.custom_id);
  const max =
    component.max_length && component.max_length > 0 ? component.max_length : undefined;
  const min =
    component.min_length && component.min_length > 0 ? component.min_length : undefined;
  const required = component.required !== false;
  const onChange = (next: string) =>
    setField(component.custom_id, { kind: "string", value: next });
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {component.label}
        {required ? " *" : ""}
      </span>
      {component.style === "paragraph" ? (
        <textarea
          className={styles.textarea}
          value={value}
          maxLength={max}
          minLength={min}
          placeholder={component.placeholder ?? ""}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={styles.input}
          type="text"
          value={value}
          maxLength={max}
          minLength={min}
          placeholder={component.placeholder ?? ""}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function ModalCheckbox({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "checkbox" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const checked = getBool(fields, component.custom_id);
  return (
    <label className={styles.choiceRow}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) =>
          setField(component.custom_id, { kind: "bool", value: e.target.checked })
        }
      />
      <span>{component.label ?? component.custom_id}</span>
    </label>
  );
}

function ModalCheckboxGroup({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "checkbox-group" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const selected = new Set(getStringArray(fields, component.custom_id));
  const toggle = (val: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(val);
    else next.delete(val);
    setField(component.custom_id, {
      kind: "strings",
      values: Array.from(next),
    });
  };
  return (
    <div className={styles.choiceList}>
      {component.options.map((o) => (
        <label key={o.value} className={styles.choiceRow}>
          <input
            type="checkbox"
            checked={selected.has(o.value)}
            onChange={(e) => toggle(o.value, e.target.checked)}
          />
          <span>
            {o.label}
            {o.description && (
              <span className={styles.choiceDescription}>{o.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

function ModalRadioGroup({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "radio-group" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const selected = getString(fields, component.custom_id);
  return (
    <div className={styles.choiceList}>
      {component.options.map((o) => (
        <label key={o.value} className={styles.choiceRow}>
          <input
            type="radio"
            name={component.custom_id}
            value={o.value}
            checked={selected === o.value}
            onChange={() =>
              setField(component.custom_id, { kind: "string", value: o.value })
            }
          />
          <span>
            {o.label}
            {o.description && (
              <span className={styles.choiceDescription}>{o.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

function ModalFileUpload({
  component,
  fields,
  setField,
  channelId,
}: {
  readonly component: Extract<Component, { type: "file-upload" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
  readonly channelId: number | null;
}) {
  const ids = getStringArray(fields, component.custom_id);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const multi = (component.max_values ?? 1) > 1;
  const targetChannel = channelId ?? selectedChannel ?? 0;
  const pick = async () => {
    const picked = await openFileDialog({ multiple: multi });
    if (picked == null) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const next: string[] = [...ids];
    for (const filePath of paths) {
      try {
        const resp = await uploadFile({
          filePath,
          channelId: targetChannel,
          mode: "session",
        });
        next.push(resp.file_id);
      } catch (e) {
        console.warn("[plugin-modal] file upload failed:", e);
      }
    }
    setField(component.custom_id, { kind: "files", values: next });
  };
  return (
    <div className={styles.fileUpload}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnSecondary}`}
        onClick={() => void pick()}
      >
        {multi ? "Add files" : "Choose file"}
      </button>
      {ids.length > 0 && (
        <span className={styles.fileUploadPicked}>
          {ids.length} file{ids.length === 1 ? "" : "s"} attached
        </span>
      )}
    </div>
  );
}

function ModalUserSelect({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "user-select" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const users = useAppStore((s) => s.users);
  const selected = new Set(getNumberArray(fields, component.custom_id).map(String));
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      value={multi ? Array.from(selected) : (Array.from(selected)[0] ?? "")}
      onChange={(e) => {
        const sel = multi
          ? Array.from(e.target.selectedOptions, (o) => Number(o.value))
          : [Number(e.target.value)];
        setField(component.custom_id, { kind: "users", values: sel });
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick a user"}
        </option>
      )}
      {users.map((u) => (
        <option key={u.session} value={String(u.session)}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

function ModalChannelSelect({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "channel-select" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const channels = useAppStore((s) => s.channels);
  const selected = new Set(getNumberArray(fields, component.custom_id).map(String));
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      value={multi ? Array.from(selected) : (Array.from(selected)[0] ?? "")}
      onChange={(e) => {
        const sel = multi
          ? Array.from(e.target.selectedOptions, (o) => Number(o.value))
          : [Number(e.target.value)];
        setField(component.custom_id, { kind: "channels", values: sel });
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick a channel"}
        </option>
      )}
      {channels.map((c) => (
        <option key={c.id} value={String(c.id)}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function ModalRoleSelect({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "role-select" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const groups = useAclGroups();
  const selected = new Set(getStringArray(fields, component.custom_id));
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      value={multi ? Array.from(selected) : (Array.from(selected)[0] ?? "")}
      onChange={(e) => {
        const sel = multi
          ? Array.from(e.target.selectedOptions, (o) => o.value)
          : [e.target.value];
        setField(component.custom_id, { kind: "roles", values: sel });
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick a role"}
        </option>
      )}
      {groups.map((g) => (
        <option key={g.name} value={g.name}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

function ModalMentionableSelect({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "mentionable-select" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const users = useAppStore((s) => s.users);
  const groups = useAclGroups();
  const value = fields[component.custom_id];
  const selectedKeys = new Set<string>(
    value?.kind === "mentionables"
      ? value.values.map((m) => (m.kind === "user" ? `user:${m.id}` : `role:${m.name}`))
      : [],
  );
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      value={multi ? Array.from(selectedKeys) : (Array.from(selectedKeys)[0] ?? "")}
      onChange={(e) => {
        const keys = multi
          ? Array.from(e.target.selectedOptions, (o) => o.value)
          : [e.target.value];
        const decoded = keys
          .map((k): { kind: "user"; id: number } | { kind: "role"; name: string } | null => {
            if (k.startsWith("user:")) return { kind: "user", id: Number(k.slice(5)) };
            if (k.startsWith("role:")) return { kind: "role", name: k.slice(5) };
            return null;
          })
          .filter((m): m is { kind: "user"; id: number } | { kind: "role"; name: string } => m != null);
        setField(component.custom_id, { kind: "mentionables", values: decoded });
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick someone"}
        </option>
      )}
      <optgroup label="Users">
        {users.map((u) => (
          <option key={`user:${u.session}`} value={`user:${u.session}`}>
            {u.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Roles">
        {groups.map((g) => (
          <option key={`role:${g.name}`} value={`role:${g.name}`}>
            {g.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function ModalStringSelect({
  component,
  fields,
  setField,
}: {
  readonly component: Extract<Component, { type: "string-select" }>;
  readonly fields: FieldMap;
  readonly setField: (id: string, value: ModalFieldValue) => void;
}) {
  const selected = new Set(getStringArray(fields, component.custom_id));
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      value={multi ? Array.from(selected) : (Array.from(selected)[0] ?? "")}
      onChange={(e) => {
        const sel = multi
          ? Array.from(e.target.selectedOptions, (o) => o.value)
          : [e.target.value];
        setField(component.custom_id, { kind: "strings", values: sel });
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick one"}
        </option>
      )}
      {component.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
