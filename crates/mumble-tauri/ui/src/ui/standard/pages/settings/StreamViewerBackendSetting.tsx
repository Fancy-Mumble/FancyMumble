/**
 * Advanced setting: which stream-viewer strategy family receives screen
 * shares - "auto" (capability-driven), the webview's own WebRTC, or the
 * native Rust peer (see viewerStrategy.ts, the strategy/abstract-factory
 * layer this switch drives).
 *
 * Rendered only where the choice exists (>= 2 families available - i.e.
 * Windows, where WebView2 has WebRTC and the Rust backend is compiled).
 * On Linux the native family is the only one that works and on platforms
 * without the Rust viewer the webview is, so the section hides itself.
 *
 * The preference is persisted by the strategy layer itself (localStorage,
 * readable synchronously at the strategy latch) rather than the async
 * preferences store - same reasoning as the UI-mode marker in
 * AdvancedPanel, which also lives outside preferences.json.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
// Selection needs the families registered: registration is a module load
// side effect of the two family modules, so import them explicitly instead
// of relying on some chat component having loaded them first.
import "../../components/chat/stream/useScreenShare";
import "../../components/chat/stream/nativeStreamView";
import {
  getStreamViewerStrategyPreference,
  parseStreamViewerStrategyId,
  selectableStreamViewerStrategyIds,
  setStreamViewerStrategyPreference,
  STRATEGY_AUTO,
  StreamViewerStrategyId,
  type StreamViewerStrategyPreference,
} from "../../components/chat/stream/viewerStrategy";
import { registerSettings } from "@core/features/settings/settingsSearchRegistry";
import styles from "./SettingsPage.module.css";

/** Whether this platform/build offers more than one viewer family. */
const backendSelectable = selectableStreamViewerStrategyIds().length >= 2;

// Searchable only where the section actually renders (see module doc).
if (backendSelectable) {
  registerSettings("advanced").add("advanced.streamBackend", [
    "stream",
    "screen share",
    "webrtc",
    "signaling",
    "viewer",
    "backend",
    "native",
    "rust",
  ]);
}

/** Choices in display order, with their i18n label keys. */
const OPTIONS = [
  { value: STRATEGY_AUTO, labelKey: "advanced.streamBackendAuto" },
  { value: StreamViewerStrategyId.Webview, labelKey: "advanced.streamBackendWebview" },
  { value: StreamViewerStrategyId.Native, labelKey: "advanced.streamBackendNative" },
] as const satisfies readonly { value: StreamViewerStrategyPreference; labelKey: string }[];

export function StreamViewerBackendSetting() {
  const [preference, setPreference] = useState<StreamViewerStrategyPreference>(
    getStreamViewerStrategyPreference,
  );
  // The active strategy is latched at first stream use, so a change only
  // reliably applies on the next page load - surface that once dirty.
  const [changed, setChanged] = useState(false);
  const { t } = useTranslation("settings");

  if (!backendSelectable) return null;

  const handleChange = (value: string) => {
    // The DOM hands back a raw string; the strategy layer's parser is the
    // one place that may turn it into an enum member.
    const next: StreamViewerStrategyPreference = parseStreamViewerStrategyId(value) ?? STRATEGY_AUTO;
    setStreamViewerStrategyPreference(next);
    setPreference(next);
    setChanged(true);
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("advanced.streamBackend")}</h3>
      <p className={styles.fieldHint}>{t("advanced.streamBackendHint")}</p>
      <select className={styles.select} value={preference} onChange={(e) => handleChange(e.target.value)}>
        {OPTIONS.map(({ value, labelKey }) => (
          <option key={value} value={value}>
            {t(labelKey)}
          </option>
        ))}
      </select>
      {changed && (
        <>
          <p className={styles.fieldHint} style={{ marginTop: "0.75rem" }}>
            {t("advanced.streamBackendReloadHint")}
          </p>
          <div className={styles.confirmBtns}>
            <button type="button" className={styles.ghostBtn} onClick={() => window.location.reload()}>
              {t("advanced.streamBackendReloadBtn")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
