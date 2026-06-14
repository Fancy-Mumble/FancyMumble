import { ShuffleIcon } from "../../icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { resolveThemePalette, randomThemeColors } from "../../utils/colorUtils";
import styles from "./CardColorPicker.module.css";

const MAX_COLORS = 5;
const DEFAULT_NEW_COLOR = "#6366f1";

interface CardColorPickerProps {
  colors: string[];
  onChange: (colors: string[]) => void;
  glass?: boolean;
  onGlassChange?: (glass: boolean) => void;
}

export function CardColorPicker({
  colors,
  onChange,
  glass,
  onGlassChange,
}: Readonly<CardColorPickerProps>) {
  const { t } = useTranslation("common");
  const handleAdd = useCallback(() => {
    if (colors.length >= MAX_COLORS) return;
    onChange([...colors, DEFAULT_NEW_COLOR]);
  }, [colors, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(colors.filter((_, i) => i !== index));
    },
    [colors, onChange],
  );

  const handleChange = useCallback(
    (index: number, value: string) => {
      const next = [...colors];
      next[index] = value;
      onChange(next);
    },
    [colors, onChange],
  );

  const handleRandom = useCallback(() => {
    onChange(randomThemeColors());
  }, [onChange]);

  const palette = colors.length > 0
    ? resolveThemePalette(colors, glass ?? false)
    : null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.randomBtn}
          onClick={handleRandom}
          title={t("cardColorPicker.randomTitle")}
        >
          <ShuffleIcon width={16} height={16} />
        </button>

        {colors.map((color, i) => (
          <div key={i} className={styles.swatch}>
            <input
              type="color"
              className={styles.colorInput}
              value={color}
              onChange={(e) => handleChange(i, e.target.value)}
            />
            {i < 3 && colors.length > 3 && (
              <span className={styles.roleBadge}>{t("cardColorPicker.roleBg")}</span>
            )}
            {i === 3 && (
              <span className={styles.roleBadge}>{t("cardColorPicker.roleBorder")}</span>
            )}
            {i === 4 && (
              <span className={styles.roleBadge}>{t("cardColorPicker.roleAccent")}</span>
            )}
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => handleRemove(i)}
              title={t("cardColorPicker.removeTitle")}
            >
              &times;
            </button>
          </div>
        ))}

        {colors.length < MAX_COLORS && (
          <button
            type="button"
            className={styles.addBtn}
            onClick={handleAdd}
            title={t("cardColorPicker.addTitle")}
          >
            +
          </button>
        )}
      </div>

      {onGlassChange && (
        <label className={styles.glassToggle}>
          <input
            type="checkbox"
            checked={glass ?? false}
            onChange={(e) => onGlassChange(e.target.checked)}
          />
          <span>{t("cardColorPicker.glassLabel")}</span>
        </label>
      )}

      {palette && (
        <div className={styles.previewRow}>
          <div
            className={styles.preview}
            style={{
              background: palette.gradient,
              borderColor: palette.borderColor,
              ...(glass ? { backdropFilter: "blur(16px) saturate(1.4)" } : {}),
            }}
          />
          {palette.accentColor && (
            <div
              className={styles.accentDot}
              style={{ background: palette.accentColor }}
              title={t("cardColorPicker.accentTitle")}
            />
          )}
        </div>
      )}
    </div>
  );
}
