import { useEffect, useState } from "react";
import { FONT_FAMILIES, applyFont } from "@core/utils/fonts";
import {
  loadPersonalization,
  savePersonalization,
  type FontSize,
  type PersonalizationData,
} from "@ui/standard/personalizationStorage";
import { THEMES, applyTheme, type ThemeId } from "@ui/standard/themes";
import { getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import { Button } from "../primitives";
import styles from "./AppearanceSettings.module.css";

export function applyAuroraAppearance(data: PersonalizationData): void {
  applyTheme(data.theme);
  applyFont(data.fontFamily);
  document.documentElement.dataset.uiDensity = data.compactMode ? "compact" : "comfortable";
  document.documentElement.style.setProperty(
    "--new-ui-font-size",
    data.fontSize === "small" ? "12px" : data.fontSize === "large" ? `${data.fontSizeCustomPx}px` : "14px",
  );
  document.documentElement.dataset.messageActions = data.alwaysShowMessageActions ? "always" : "hover";
}

export default function AppearanceSettings() {
  const [data, setData] = useState<PersonalizationData | null>(null);
  useEffect(() => {
    void loadPersonalization().then((value) => {
      setData(value);
      applyAuroraAppearance(value);
    });
  }, []);
  const patch = async (change: Partial<PersonalizationData>) => {
    if (!data) return;
    const next = { ...data, ...change };
    setData(next);
    applyAuroraAppearance(next);
    await savePersonalization(next);
  };
  if (!data) return <div className={styles.loading}>Loading appearance…</div>;
  const uiDesignOverride = getUiDesignOverride();
  return (
    <div className={styles.root}>
      <section>
        <h4>Color theme</h4>
        <p>Theme tokens apply to both client interfaces.</p>
        <div className={styles.themes}>
          {THEMES.map((theme) => (
            <Button
              variant="bare"
              className={data.theme === theme.id ? styles.selected : undefined}
              key={theme.id}
              onClick={() => void patch({ theme: theme.id as ThemeId })}
            >
              <span>
                {theme.swatches.map((swatch) => (
                  <i key={swatch} style={{ background: swatch }} />
                ))}
              </span>
              <b>{theme.label}</b>
            </Button>
          ))}
        </div>
      </section>
      <section>
        <h4>Typography</h4>
        <div className={styles.fields}>
          <label>
            Font family
            <select
              value={data.fontFamily}
              onChange={(event) => void patch({ fontFamily: event.target.value })}
            >
              {FONT_FAMILIES.map((font) => (
                <option value={font.id} key={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Text size
            <select
              value={data.fontSize}
              onChange={(event) => void patch({ fontSize: event.target.value as FontSize })}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large / custom</option>
            </select>
          </label>
          {data.fontSize === "large" && (
            <label>
              Custom size
              <input
                type="number"
                min={14}
                max={22}
                value={data.fontSizeCustomPx}
                onChange={(event) => void patch({ fontSizeCustomPx: Number(event.target.value) })}
              />
            </label>
          )}
        </div>
      </section>
      <section>
        <h4>Density and interaction</h4>
        <Button
          variant="bare"
          className={styles.toggle}
          onClick={() => void patch({ compactMode: !data.compactMode })}
        >
          <span>
            <strong>Compact density</strong>
            <small>Tighten navigation, messages, and supporting panels.</small>
          </span>
          <i className={data.compactMode ? styles.on : ""}>
            <b />
          </i>
        </Button>
        <Button
          variant="bare"
          className={styles.toggle}
          onClick={() => void patch({ alwaysShowMessageActions: !data.alwaysShowMessageActions })}
        >
          <span>
            <strong>Always show message actions</strong>
            <small>Keep reply, reaction, copy and moderation actions visible.</small>
          </span>
          <i className={data.alwaysShowMessageActions ? styles.on : ""}>
            <b />
          </i>
        </Button>
      </section>
      <section>
        <h4>Interface design</h4>
        <p>Choose which UI design pack loads. Standard is the default; Aurora is a design beta.</p>
        <Button
          variant="bare"
          className={styles.toggle}
          disabled={uiDesignOverride !== null}
          onClick={() => void setSelectedUiDesign("standard")}
        >
          <span>
            <strong>Aurora design (beta)</strong>
            <small>
              {uiDesignOverride
                ? `Locked to the ${uiDesignOverride} design by the launch URL.`
                : "You’re using the Aurora design beta. Turn this off to return to the Standard interface."}
            </small>
          </span>
          <i className={styles.on}>
            <b />
          </i>
        </Button>
      </section>
    </div>
  );
}
