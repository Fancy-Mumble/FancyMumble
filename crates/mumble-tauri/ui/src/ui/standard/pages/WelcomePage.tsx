import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { completeSetup } from "@core/preferencesStorage";
import {
  loadPersonalization,
  savePersonalization,
  type PersonalizationData,
} from "../personalizationStorage";
import { THEMES, applyTheme, getCurrentTheme, type ThemeId } from "../themes";
import { RadioCardGroup, type RadioCardOption } from "../components/elements/RadioCardGroup";
import BrandLogo from "../components/elements/BrandLogo";
import {
  UserIcon,
  SparklesIcon,
  SlidersIcon,
  PaletteIcon,
  CheckIcon,
  ChevronLeftIcon,
  ArrowRightIcon,
} from "../icons";
// Hardware floors for the minimal-mode suggestion (repo-root constants.json).
import { WEAK_PC_MAX_MEMORY_MB, WEAK_PC_MAX_CPU_CORES } from "@core/utils/appConstants";
import type { UserMode } from "@core/types";
import styles from "./WelcomePage.module.css";

interface SystemSpecs {
  total_memory_mb: number;
  cpu_cores: number;
}

const STEPS = ["identity", "interface", "appearance", "ready"] as const;
type StepId = (typeof STEPS)[number];

export default function WelcomePage({ onComplete }: Readonly<{ onComplete?: () => void }>) {
  const { t } = useTranslation("server");
  const navigate = useNavigate();

  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<UserMode>("normal");
  const [username, setUsername] = useState("");
  const [theme, setTheme] = useState<ThemeId>(getCurrentTheme());
  const [saving, setSaving] = useState(false);
  // Remember the persisted personalization so we only patch `theme` on finish.
  const personalizationRef = useRef<PersonalizationData | null>(null);

  const step: StepId = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const canProceed = step !== "identity" || username.trim().length > 0;

  useEffect(() => {
    void loadPersonalization().then((p) => {
      personalizationRef.current = p;
      setTheme(p.theme);
    });
  }, []);

  // First-run weak-PC check: offer the lightweight native qt6ui client.
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
        console.warn("weak-PC minimal-mode prompt skipped:", e);
        await invoke("set_ui_mode", { mode: "full" }).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const pickTheme = useCallback((id: ThemeId) => {
    setTheme(id);
    applyTheme(id); // live preview
  }, []);

  const finish = useCallback(async () => {
    if (!username.trim() || saving) return;
    setSaving(true);
    try {
      const base = personalizationRef.current ?? (await loadPersonalization());
      await savePersonalization({ ...base, theme });
      await completeSetup(mode, username.trim());
      // Generate a default certificate for TLS client auth (non-fatal).
      try {
        await invoke("generate_certificate", { label: "default" });
      } catch {
        /* user can still connect anonymously */
      }
    } finally {
      onComplete?.();
      navigate("/", { replace: true });
    }
  }, [username, saving, theme, mode, onComplete, navigate]);

  const goNext = useCallback(() => {
    if (!canProceed) return;
    if (isLast) void finish();
    else setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }, [canProceed, isLast, finish]);

  const goBack = useCallback(() => setStepIndex((i) => Math.max(i - 1, 0)), []);

  const modeOptions: readonly RadioCardOption<UserMode>[] = [
    { value: "normal", label: t("mode.simple"), description: t("mode.simpleHint"), Icon: SparklesIcon },
    { value: "expert", label: t("mode.advanced"), description: t("mode.advancedHint"), Icon: SlidersIcon },
  ];

  const activeThemeLabel = THEMES.find((th) => th.id === theme)?.label ?? theme;
  const activeModeLabel = mode === "normal" ? t("mode.simple") : t("mode.advanced");

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <BrandLogo size={44} className={styles.logoIcon} />
          <div>
            <h1 className={styles.title}>{t("title")}</h1>
            <p className={styles.subtitle}>{t("onboarding.subtitle")}</p>
          </div>
        </header>

        {/* Stepper */}
        <div className={styles.stepper} aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`${styles.stepDot} ${i === stepIndex ? styles.stepCurrent : ""} ${
                i < stepIndex ? styles.stepDone : ""
              }`}
            >
              <span className={styles.stepBar} />
              <span className={styles.stepLabel}>{t(`onboarding.steps.${s}`)}</span>
            </span>
          ))}
        </div>

        <form
          className={styles.body}
          onSubmit={(e) => {
            e.preventDefault();
            goNext();
          }}
        >
          {step === "identity" && (
            <section className={styles.step}>
              <div className={styles.stepHead}>
                <UserIcon className={styles.stepIcon} width={18} height={18} />
                <h2 className={styles.stepTitle}>{t("onboarding.identity.title")}</h2>
              </div>
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
                maxLength={64}
              />
              <p className={styles.hint}>{t("onboarding.identity.hint")}</p>
            </section>
          )}

          {step === "interface" && (
            <section className={styles.step}>
              <div className={styles.stepHead}>
                <SlidersIcon className={styles.stepIcon} width={18} height={18} />
                <h2 className={styles.stepTitle}>{t("onboarding.interface.title")}</h2>
              </div>
              <RadioCardGroup name="ui-mode" options={modeOptions} value={mode} onChange={setMode} />
              <p className={styles.hint}>{t("onboarding.interface.hint")}</p>
            </section>
          )}

          {step === "appearance" && (
            <section className={styles.step}>
              <div className={styles.stepHead}>
                <PaletteIcon className={styles.stepIcon} width={18} height={18} />
                <h2 className={styles.stepTitle}>{t("onboarding.appearance.title")}</h2>
              </div>
              <div className={styles.themeGrid} role="radiogroup" aria-label={t("onboarding.appearance.title")}>
                {THEMES.map((th) => {
                  const active = th.id === theme;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      className={`${styles.themeCard} ${active ? styles.themeActive : ""}`}
                      onClick={() => pickTheme(th.id)}
                      aria-pressed={active}
                    >
                      <span className={styles.swatches}>
                        {th.swatches.map((c, i) => (
                          <span key={i} className={styles.swatch} style={{ background: c }} />
                        ))}
                      </span>
                      <span className={styles.themeLabel}>{th.label}</span>
                      {active && <CheckIcon className={styles.themeCheck} width={13} height={13} />}
                    </button>
                  );
                })}
              </div>
              <p className={styles.hint}>{t("onboarding.appearance.hint")}</p>
            </section>
          )}

          {step === "ready" && (
            <section className={`${styles.step} ${styles.ready}`}>
              <BrandLogo size={64} className={styles.readyLogo} />
              <h2 className={styles.readyTitle}>{t("onboarding.ready.title", { name: username.trim() })}</h2>
              <p className={styles.hint}>{t("onboarding.ready.hint")}</p>
              <div className={styles.summary}>
                <span className={styles.summaryChip}>
                  <UserIcon width={14} height={14} /> {username.trim()}
                </span>
                <span className={styles.summaryChip}>
                  <SlidersIcon width={14} height={14} /> {activeModeLabel}
                </span>
                <span className={styles.summaryChip}>
                  <PaletteIcon width={14} height={14} /> {activeThemeLabel}
                </span>
              </div>
            </section>
          )}

          <footer className={styles.footer}>
            {stepIndex > 0 ? (
              <button type="button" className={styles.ghostButton} onClick={goBack} disabled={saving}>
                <ChevronLeftIcon width={16} height={16} /> {t("onboarding.back")}
              </button>
            ) : (
              <span />
            )}
            <button className={styles.button} type="submit" disabled={!canProceed || saving}>
              {isLast ? (
                <>
                  {saving ? t("submitting") : t("onboarding.finish")}
                  {!saving && <CheckIcon width={16} height={16} />}
                </>
              ) : (
                <>
                  {t("onboarding.next")}
                  <ArrowRightIcon width={16} height={16} />
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
