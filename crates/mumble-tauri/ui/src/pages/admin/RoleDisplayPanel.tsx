import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AclGroup } from "../../types";
import { RoleColorPicker } from "../../components/elements/role/RoleColorPicker";
import { RoleIconPicker } from "../../components/elements/role/RoleIconPicker";
import { RolePreviewCard } from "../../components/elements/role/RolePreviewCard";
import styles from "./AdminPanel.module.css";

export interface RoleDisplayPanelProps {
  readonly role: AclGroup;
  readonly onPatch: (patch: Partial<AclGroup>) => void;
  readonly disabled?: boolean;
}

/** Display sub-tab of the role editor: name, color, icon, style preset, metadata. */
export function RoleDisplayPanel({ role, onPatch, disabled }: RoleDisplayPanelProps) {
  const { t } = useTranslation("settings");
  const stylePresets = useMemo(() => [
    { id: "", label: t("roleDisplay.presetDefault") },
    { id: "neon", label: t("roleDisplay.presetNeon") },
    { id: "gradient", label: t("roleDisplay.presetGradient") },
    { id: "minimal", label: t("roleDisplay.presetMinimal") },
  ], [t]);
  const metadataEntries = useMemo(
    () => Object.entries(role.metadata ?? {}),
    [role.metadata],
  );
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const setMetadata = (key: string, value: string | null) => {
    const next: Record<string, string> = { ...(role.metadata ?? {}) };
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onPatch({ metadata: next });
  };

  return (
    <div className={styles.editorGrid}>
      <div className={styles.editorMain}>
        <label className={styles.fieldLabel}>
          {t("roleDisplay.fieldName")}
          <input
            type="text"
            className={styles.input}
            value={role.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            disabled={disabled || role.inherited}
          />
        </label>

        <fieldset className={styles.fieldset}>
          <legend>{t("roleDisplay.fieldColor")}</legend>
          <RoleColorPicker
            value={role.color}
            onChange={(color) => onPatch({ color })}
            disabled={disabled || role.inherited}
          />
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>{t("roleDisplay.fieldIcon")}</legend>
          <RoleIconPicker
            value={role.icon}
            onChange={(icon) => onPatch({ icon })}
            disabled={disabled || role.inherited}
          />
        </fieldset>

        <label className={styles.fieldLabel}>
          {t("roleDisplay.fieldStylePreset")}
          <select
            className={styles.select}
            value={role.style_preset ?? ""}
            onChange={(e) => onPatch({ style_preset: e.target.value || null })}
            disabled={disabled || role.inherited}
          >
            {stylePresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className={styles.fieldset}>
          <legend>{t("roleDisplay.fieldMetadata")}</legend>
          {metadataEntries.length === 0 && (
            <span className={styles.dimText}>{t("roleDisplay.noMetadata")}</span>
          )}
          <ul className={styles.metadataList}>
            {metadataEntries.map(([k, v]) => (
              <li key={k} className={styles.metadataRow}>
                <span className={styles.metadataKey}>{k}</span>
                <input
                  type="text"
                  className={styles.input}
                  value={v}
                  onChange={(e) => setMetadata(k, e.target.value)}
                  disabled={disabled || role.inherited}
                />
                {!disabled && !role.inherited && (
                  <button
                    type="button"
                    className={styles.removeSmallBtn}
                    onClick={() => setMetadata(k, null)}
                    aria-label={t("roleDisplay.removeKey", { key: k })}
                  >
                    &times;
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!disabled && !role.inherited && (
            <div className={styles.metadataAddRow}>
              <input
                type="text"
                className={styles.input}
                placeholder={t("roleDisplay.keyPlaceholder")}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
              <input
                type="text"
                className={styles.input}
                placeholder={t("roleDisplay.valuePlaceholder")}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => {
                  const k = newKey.trim();
                  if (!k) return;
                  setMetadata(k, newValue);
                  setNewKey("");
                  setNewValue("");
                }}
              >
                {t("roleDisplay.addButton")}
              </button>
            </div>
          )}
        </fieldset>
      </div>

      <aside className={styles.editorAside}>
        <RolePreviewCard
          name={role.name}
          color={role.color}
          icon={role.icon}
        />
      </aside>
    </div>
  );
}
