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
  selectableStreamViewerStrategyIds,
  setStreamViewerStrategyPreference,
  STRATEGY_AUTO,
  StreamViewerStrategyId,
  type StreamViewerStrategyPreference,
} from "../../components/chat/stream/viewerStrategy";
import { registerSettings } from "@core/features/settings/settingsSearchRegistry";
import { GlobeIcon, MonitorIcon, SparklesIcon } from "../../icons";
import { RadioCardGroup, type RadioCardOption } from "../../components/elements/RadioCardGroup";
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

/** Choices in display order, with their i18n key stems. */
const OPTIONS = [
  { value: STRATEGY_AUTO, key: "Auto", Icon: SparklesIcon },
  { value: StreamViewerStrategyId.Webview, key: "Webview", Icon: GlobeIcon },
  { value: StreamViewerStrategyId.Native, key: "Native", Icon: MonitorIcon },
] as const satisfies readonly {
  value: StreamViewerStrategyPreference;
  key: string;
  Icon: typeof SparklesIcon;
}[];

export function StreamViewerBackendSetting() {
  const [preference, setPreference] = useState<StreamViewerStrategyPreference>(
    getStreamViewerStrategyPreference,
  );
  // The active strategy is latched at first stream use, so a change only
  // reliably applies on the next page load - surface that once dirty.
  const [changed, setChanged] = useState(false);
  const { t } = useTranslation("settings");
  const tStr = t as (key: string) => string;

  if (!backendSelectable) return null;

  const options: RadioCardOption<StreamViewerStrategyPreference>[] = OPTIONS.map(({ value, key, Icon }) => ({
    value,
    label: tStr(`advanced.streamBackend${key}`),
    description: tStr(`advanced.streamBackend${key}Desc`),
    Icon,
  }));

  const handleChange = (next: StreamViewerStrategyPreference) => {
    setStreamViewerStrategyPreference(next);
    setPreference(next);
    setChanged(true);
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("advanced.streamBackend")}</h3>
      <p className={styles.fieldHint}>{t("advanced.streamBackendHint")}</p>
      <RadioCardGroup
        name="stream_viewer_backend"
        options={options}
        value={preference}
        onChange={handleChange}
      />
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
