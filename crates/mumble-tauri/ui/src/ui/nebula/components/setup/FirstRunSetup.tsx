import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Box, Button, TextField, Typography } from "@mui/material";

import { completeSetup } from "@core/preferencesStorage";
import { WEAK_PC_MAX_CPU_CORES, WEAK_PC_MAX_MEMORY_MB } from "@core/utils/appConstants";
import type { UserMode } from "@core/types";
import {
  loadPersonalization,
  savePersonalization,
  type PersonalizationData,
} from "@standard/personalizationStorage";
import { applyTheme, THEMES, type ThemeId } from "@standard/themes";
import { CheckIcon, SettingsIcon, SparklesIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { Stack } from "../primitives";

const STEPS = ["identity", "interface", "appearance", "ready"] as const;
type StepId = (typeof STEPS)[number];

interface SystemSpecs {
  total_memory_mb: number;
  cpu_cores: number;
}

/**
 * The four questions asked once, before the client is ever shown.
 *
 * Nebula had no first run at all: a new user landed on the connect screen with
 * no name chosen, no mode set and `hasCompletedSetup` still false, and Nebula's
 * own Advanced page shipped a reset whose comment says it reloads "so
 * `isFirstRun()` re-evaluates and the welcome page shows" - which in this pack
 * showed nothing. Wiping your settings therefore looked like it had half
 * worked. This is the page that comment is describing.
 *
 * What it writes is what Standard's writes, through the same three calls, so a
 * user who sets up in one pack and switches to the other is already set up.
 * The strings are the shared `server:onboarding.*` set for the same reason -
 * this is the same conversation, and it was already translated into all four
 * languages before Nebula could hold it.
 *
 * The weak-hardware prompt runs here rather than at the end because relaunching
 * into the minimal client abandons this window: asking after the user has
 * filled the form in would throw the answers away.
 */
export function FirstRunSetup({ onComplete }: Readonly<{ onComplete: () => void }>) {
  const { t } = useTranslation("server");

  const [stepIndex, setStepIndex] = useState(0);
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<UserMode>("normal");
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [saving, setSaving] = useState(false);

  // The stored record, so finishing patches `theme` rather than replacing
  // personalization with this page's idea of it.
  const personalization = useRef<PersonalizationData | null>(null);

  const step: StepId = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const canProceed = step !== "identity" || username.trim().length > 0;

  useEffect(() => {
    void loadPersonalization().then((stored) => {
      personalization.current = stored;
      setTheme(stored.theme as ThemeId);
    });
  }, []);

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
      } catch (reason) {
        console.warn("weak-PC minimal-mode prompt skipped:", reason);
        await invoke("set_ui_mode", { mode: "full" }).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const pickTheme = useCallback((id: ThemeId) => {
    setTheme(id);
    // Applied on pick rather than on finish: the whole point of the step is
    // seeing it, and Nebula's own light/dark mode follows the app theme.
    applyTheme(id);
  }, []);

  const finish = useCallback(async () => {
    if (!username.trim() || saving) return;
    setSaving(true);
    try {
      const base = personalization.current ?? (await loadPersonalization());
      await savePersonalization({ ...base, theme });
      await completeSetup(mode, username.trim());
      // A default client certificate, so the first connect can be an identity
      // rather than an anonymous session. Not fatal: without one the user can
      // still connect, which is why nothing here is reported.
      await invoke("generate_certificate", { label: "default" }).catch(() => undefined);
    } finally {
      onComplete();
    }
  }, [username, saving, theme, mode, onComplete]);

  return (
    <Box
      sx={(muiTheme) => ({
        height: "100%",
        display: "grid",
        placeItems: "center",
        padding: 3,
        color: muiTheme.palette.nebula.text,
      })}
    >
      <Stack
        gap={2.5}
        sx={(muiTheme) => ({
          width: "min(560px, 100%)",
          padding: "26px 28px",
          borderRadius: radius("xl"),
          background: muiTheme.palette.nebula.card,
          border: `1px solid ${muiTheme.palette.nebula.line2}`,
        })}
      >
        <Stack gap={0.5}>
          <Typography sx={{ fontSize: 20, fontWeight: 600 }}>{t("title")}</Typography>
          <Typography sx={(muiTheme) => ({ fontSize: 13, color: muiTheme.palette.nebula.muted })}>
            {t("onboarding.subtitle")}
          </Typography>
        </Stack>

        <StepRail stepIndex={stepIndex} />

        <Stack gap={1.5} sx={{ minHeight: 210 }}>
          <Stack gap={0.5}>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
              {t(`onboarding.${step}.title`, { name: username.trim() })}
            </Typography>
            <Typography sx={(muiTheme) => ({ fontSize: 12.5, color: muiTheme.palette.nebula.muted })}>
              {t(`onboarding.${step}.hint`)}
            </Typography>
          </Stack>

          {step === "identity" && (
            <TextField
              autoFocus
              size="small"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canProceed) setStepIndex((index) => index + 1);
              }}
              slotProps={{ htmlInput: { maxLength: 64, "aria-label": t("onboarding.identity.title") } }}
            />
          )}

          {step === "interface" && (
            <Stack gap={1} role="radiogroup" aria-label={t("onboarding.interface.title")}>
              <ChoiceCard
                selected={mode === "normal"}
                icon={<SparklesIcon width={15} height={15} />}
                label={t("mode.simple")}
                description={t("mode.simpleHint")}
                onSelect={() => setMode("normal")}
              />
              <ChoiceCard
                selected={mode === "expert"}
                icon={<SettingsIcon width={15} height={15} />}
                label={t("mode.advanced")}
                description={t("mode.advancedHint")}
                onSelect={() => setMode("expert")}
              />
            </Stack>
          )}

          {step === "appearance" && (
            <Stack
              direction="row"
              gap={1}
              flexWrap="wrap"
              role="radiogroup"
              aria-label={t("onboarding.appearance.title")}
            >
              {THEMES.map((option) => (
                <ThemeSwatch
                  key={option.id}
                  label={option.label}
                  swatches={option.swatches}
                  selected={theme === option.id}
                  onSelect={() => pickTheme(option.id as ThemeId)}
                />
              ))}
            </Stack>
          )}

          {step === "ready" && (
            <Stack gap={0.75}>
              <ReadyLine label={t("onboarding.steps.identity")} value={username.trim()} />
              <ReadyLine
                label={t("onboarding.steps.interface")}
                value={mode === "normal" ? t("mode.simple") : t("mode.advanced")}
              />
              <ReadyLine
                label={t("onboarding.steps.appearance")}
                value={THEMES.find((option) => option.id === theme)?.label ?? theme}
              />
            </Stack>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" gap={1}>
          <Typography sx={(muiTheme) => ({ fontSize: 11.5, color: muiTheme.palette.nebula.dim })}>
            {t("onboarding.stepOf", { current: stepIndex + 1, total: STEPS.length })}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {stepIndex > 0 && (
            <Button onClick={() => setStepIndex((index) => index - 1)} disabled={saving}>
              {t("onboarding.back")}
            </Button>
          )}
          <Button
            variant="contained"
            disabled={!canProceed || saving}
            onClick={() => (isLast ? void finish() : setStepIndex((index) => index + 1))}
          >
            {isLast ? t("onboarding.finish") : t("onboarding.next")}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

/** Where in the four steps this is. Labelled, because the steps are named. */
function StepRail({ stepIndex }: Readonly<{ stepIndex: number }>) {
  const { t } = useTranslation("server");
  return (
    <Stack direction="row" gap={1} aria-hidden>
      {STEPS.map((step, index) => (
        <Stack key={step} gap={0.5} sx={{ flex: 1 }}>
          <Box
            sx={(muiTheme) => ({
              height: 3,
              borderRadius: 999,
              background: index <= stepIndex ? muiTheme.palette.nebula.accent : muiTheme.palette.nebula.line2,
            })}
          />
          <Typography
            sx={(muiTheme) => ({
              fontSize: 10.5,
              color: index <= stepIndex ? muiTheme.palette.nebula.muted : muiTheme.palette.nebula.dim,
            })}
          >
            {t(`onboarding.steps.${step}`)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** One of the two interface modes. */
function ChoiceCard({
  selected,
  icon,
  label,
  description,
  onSelect,
}: Readonly<{
  selected: boolean;
  icon: ReactNode;
  label: string;
  description: string;
  onSelect: () => void;
}>) {
  return (
    <Box
      component="button"
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      sx={(muiTheme) => ({
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "flex-start",
        gap: 1.25,
        padding: "11px 13px",
        borderRadius: radius("md"),
        background: selected ? muiTheme.palette.nebula.accentSoft : muiTheme.palette.nebula.card2,
        border: `1px solid ${selected ? muiTheme.palette.nebula.accentLine : muiTheme.palette.nebula.line}`,
      })}
    >
      <Box
        aria-hidden
        sx={(muiTheme) => ({ display: "flex", marginTop: "2px", color: muiTheme.palette.nebula.accent })}
      >
        {icon}
      </Box>
      <Stack gap={0.25}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>{label}</Typography>
        <Typography sx={(muiTheme) => ({ fontSize: 12, color: muiTheme.palette.nebula.muted })}>
          {description}
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * One colour theme, drawn as its own four colours.
 *
 * The same tile Personalize uses, at the size that fits eighteen of them into a
 * step: the choice is made on the colours, and a list of theme *names* would
 * make the user pick one to find out what it looks like.
 */
function ThemeSwatch({
  label,
  swatches,
  selected,
  onSelect,
}: Readonly<{ label: string; swatches: readonly string[]; selected: boolean; onSelect: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      sx={(muiTheme) => ({
        all: "unset",
        cursor: "pointer",
        width: 96,
        padding: "6px",
        borderRadius: radius("md"),
        background: selected ? muiTheme.palette.nebula.accentSoft : muiTheme.palette.nebula.card2,
        border: `1px solid ${selected ? muiTheme.palette.nebula.accentLine : muiTheme.palette.nebula.line}`,
      })}
    >
      <Box
        aria-hidden
        sx={{
          height: 34,
          display: "flex",
          overflow: "hidden",
          borderRadius: radius("sm"),
          border: "1px solid rgba(128,128,128,.2)",
        }}
      >
        {swatches.map((swatch) => (
          <Box key={swatch} sx={{ flex: 1, background: swatch }} />
        ))}
      </Box>
      <Typography
        sx={{ marginTop: "5px", fontSize: 11.5, fontWeight: selected ? 600 : 500, textAlign: "center" }}
      >
        {label}
      </Typography>
    </Box>
  );
}

/** One line of the summary on the last step. */
function ReadyLine({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Box aria-hidden sx={(muiTheme) => ({ display: "flex", color: muiTheme.palette.nebula.ok })}>
        <CheckIcon width={14} height={14} />
      </Box>
      <Typography sx={(muiTheme) => ({ fontSize: 12.5, color: muiTheme.palette.nebula.muted })}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 12.5, fontWeight: 500 }}>{value}</Typography>
    </Stack>
  );
}
