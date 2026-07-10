import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { completeSetup } from "../preferencesStorage";
import BrandLogo from "../components/elements/BrandLogo";
import type { UserMode } from "../types";
// Hardware floors for the minimal-mode suggestion: the WebView-based full
// UI needs a few hundred MB, so on very small machines the native qt6ui
// client (~60-105 MB) is the better default. Values come from the repo-root
// constants.json (single source of truth, generated at build time).
import { WEAK_PC_MAX_MEMORY_MB, WEAK_PC_MAX_CPU_CORES } from "../utils/appConstants";
import styles from "./WelcomePage.module.css";

interface SystemSpecs {
  total_memory_mb: number;
  cpu_cores: number;
}

export default function WelcomePage({ onComplete }: Readonly<{ onComplete?: () => void }>) {
  const { t } = useTranslation("server");
  const navigate = useNavigate();
  const [mode, setMode] = useState<UserMode>("normal");
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);

  // First-run weak-PC check: WelcomePage only renders on the very first
  // startup, so this prompt appears at most once. Choosing "minimal"
  // persists the marker and hands off to the qt6ui client immediately.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const specs = await invoke<SystemSpecs>("get_system_specs");
        const weak =
          (specs.total_memory_mb > 0 && specs.total_memory_mb <= WEAK_PC_MAX_MEMORY_MB) ||
          (specs.cpu_cores > 0 && specs.cpu_cores <= WEAK_PC_MAX_CPU_CORES);
        if (!weak || cancelled) return;
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const useMinimal = await ask(t("weakPc.message"), {
          title: t("weakPc.title"),
          okLabel: t("weakPc.useMinimal"),
          cancelLabel: t("weakPc.keepFull"),
        });
        if (!useMinimal || cancelled) return;
        await invoke("set_ui_mode", { mode: "minimal" });
        await invoke("relaunch_in_minimal_mode");
      } catch (e) {
        // Non-fatal: specs unavailable or qt6ui missing - stay in full mode.
        console.warn("weak-PC minimal-mode prompt skipped:", e);
        await invoke("set_ui_mode", { mode: "full" }).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleSubmit = useCallback(
    async (e: { preventDefault: () => void }) => {
      e.preventDefault();
      if (!username.trim()) return;
      setSaving(true);
      await completeSetup(mode, username.trim());
      // Generate a default certificate for TLS client auth.
      try {
        await invoke("generate_certificate", { label: "default" });
      } catch {
        // Non-fatal - the user can still connect anonymously.
      }
      onComplete?.();
      navigate("/", { replace: true });
    },
    [mode, username, navigate, onComplete],
  );

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logo}>
          <BrandLogo size={52} className={styles.logoIcon} />
          <h1 className={styles.title}>{t("title")}</h1>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Username */}
          <div className={styles.field}>
            <label htmlFor="welcome-username" className={styles.label}>
              {t("username")}
            </label>
            <input
              id="welcome-username"
              className={styles.input}
              type="text"
              placeholder={t("usernamePlaceholder")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>

          {/* Mode selection */}
          <div className={styles.field}>
            <span className={styles.label}>{t("interface")}</span>
            <div className={styles.modeToggle} role="radiogroup">
              <button
                type="button"
                className={`${styles.modeOption} ${mode === "normal" ? styles.modeActive : ""}`}
                onClick={() => setMode("normal")}
                aria-pressed={mode === "normal"}
              >
                <span className={styles.modeTitle}>{t("mode.simple")}</span>
                <span className={styles.modeHint}>{t("mode.simpleHint")}</span>
              </button>
              <button
                type="button"
                className={`${styles.modeOption} ${mode === "expert" ? styles.modeActive : ""}`}
                onClick={() => setMode("expert")}
                aria-pressed={mode === "expert"}
              >
                <span className={styles.modeTitle}>{t("mode.advanced")}</span>
                <span className={styles.modeHint}>{t("mode.advancedHint")}</span>
              </button>
            </div>
          </div>

          <button
            className={styles.button}
            type="submit"
            disabled={!username.trim() || saving}
          >
            {saving ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
