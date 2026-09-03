import { Box, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  setGameOverlayRule,
  useGameOverlayState,
  type GameOverlayReason,
} from "@core/features/overlay/gameOverlay";
import type { GameOverlayCorner, GameOverlayMode } from "@core/types/preferences";
import { NEBULA_MONO, radius } from "../../tokens";
import { Stack } from "../primitives";
import { Banner, Field, GroupRule, GroupTitle, PageTitle, PillGroup, ToggleRow } from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";

/**
 * The Overlay page.
 *
 * Two things share it, and both belong here. The settings are ordinary
 * preferences. The diagnostics panel underneath is not decoration: the
 * detector decides, on its own, when a window appears over whatever the user
 * is doing, and a feature like that has to be able to say why. It is also how
 * the heuristic gets tuned - "what did it think my game was" is a question
 * only the user's own machine can answer.
 */
export function OverlaySettings() {
  const { t } = useTranslation(["nebulaSettings", "settings", "common"]);
  const { prefs, set } = usePreferenceSettings();
  const state = useGameOverlayState();

  if (!prefs) return null;
  const overlay = prefs.gameOverlay;

  const update = (patch: Partial<typeof overlay>) => set({ gameOverlay: { ...overlay, ...patch } });

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle
        title={t("nebulaSettings:overlay.title", { defaultValue: "Game overlay" })}
        hint={t("nebulaSettings:overlay.hint", {
          defaultValue:
            "A small card over your game showing who is talking and the last message. It is a separate window, not code inside the game.",
        })}
      />

      <Field label={t("nebulaSettings:overlay.mode", { defaultValue: "Show the overlay" })}>
        <PillGroup<GameOverlayMode>
          ariaLabel={t("nebulaSettings:overlay.mode", { defaultValue: "Show the overlay" })}
          value={overlay.mode}
          onChange={(mode) => update({ mode })}
          options={[
            { id: "off", label: t("nebulaSettings:overlay.modeOff", { defaultValue: "Never" }) },
            {
              id: "whileActive",
              label: t("nebulaSettings:overlay.modeWhileActive", { defaultValue: "While talking" }),
            },
            {
              id: "always",
              label: t("nebulaSettings:overlay.modeAlways", { defaultValue: "In any game" }),
            },
          ]}
        />
      </Field>

      {overlay.mode === "always" && (
        <Banner
          tone="warn"
          title={t("nebulaSettings:overlay.alwaysWarning", {
            defaultValue: "A permanently visible overlay can cost you variable refresh rate",
          })}
        >
          {t("nebulaSettings:overlay.alwaysWarningPara", {
            defaultValue:
              "Anything drawn over a game forces Windows to compose the frame instead of handing it straight to the display. On machines where multi-plane overlay is off, that disables G-Sync and FreeSync while the card is on screen. Showing it only while someone is talking avoids that for the rest of the time.",
          })}
        </Banner>
      )}

      <GroupRule />

      <Field label={t("nebulaSettings:overlay.corner", { defaultValue: "Position" })} sx={{ mb: "18px" }}>
        <PillGroup<GameOverlayCorner>
          ariaLabel={t("nebulaSettings:overlay.corner", { defaultValue: "Position" })}
          value={overlay.corner}
          onChange={(corner) => update({ corner })}
          options={[
            {
              id: "topLeft",
              label: t("nebulaSettings:overlay.cornerTopLeft", { defaultValue: "Top left" }),
            },
            {
              id: "topRight",
              label: t("nebulaSettings:overlay.cornerTopRight", { defaultValue: "Top right" }),
            },
            {
              id: "bottomLeft",
              label: t("nebulaSettings:overlay.cornerBottomLeft", { defaultValue: "Bottom left" }),
            },
            {
              id: "bottomRight",
              label: t("nebulaSettings:overlay.cornerBottomRight", { defaultValue: "Bottom right" }),
            },
          ]}
        />
      </Field>

      <ToggleRow
        title={t("nebulaSettings:overlay.lastMessage", { defaultValue: "Show the last message" })}
        hint={t("nebulaSettings:overlay.lastMessageHint", {
          defaultValue: "The most recent message in your channel, under the roster.",
        })}
        checked={overlay.showLastMessage}
        onChange={() => update({ showLastMessage: !overlay.showLastMessage })}
      />

      <ToggleRow
        title={t("nebulaSettings:overlay.hideFromCapture", {
          defaultValue: "Hide from screen capture",
        })}
        hint={t("nebulaSettings:overlay.hideFromCaptureHint", {
          defaultValue:
            "Keeps the overlay out of your own screen share, recordings and streams - which also means it cannot appear in a screenshot. Turn it off if you want viewers to see who is talking, or to capture the overlay yourself.",
        })}
        checked={overlay.hideFromCapture}
        onChange={() => update({ hideFromCapture: !overlay.hideFromCapture })}
      />

      <GroupTitle
        space="wide"
        hint={t("nebulaSettings:overlay.diagnosticsHint", {
          defaultValue:
            "What the detector makes of whatever is in the foreground right now, and why. Games are recognised from your installed games, from what Windows itself calls a game, and from what a program says it is - never by looking inside it.",
        })}
      >
        {t("nebulaSettings:overlay.diagnostics", { defaultValue: "What it sees" })}
      </GroupTitle>

      <Diagnostics state={state} mode={overlay.mode} />

      {overlay.mode !== "off" && state?.exePath && (
        <Stack direction="row" gap={1} sx={{ mt: "12px" }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void setGameOverlayRule(state.exePath ?? "", "allow")}
          >
            {t("nebulaSettings:overlay.ruleAllow", { defaultValue: "Always show here" })}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void setGameOverlayRule(state.exePath ?? "", "deny")}
          >
            {t("nebulaSettings:overlay.ruleDeny", { defaultValue: "Never show here" })}
          </Button>
          <Button size="small" onClick={() => void setGameOverlayRule(state.exePath ?? "", null)}>
            {t("nebulaSettings:overlay.ruleClear", { defaultValue: "Forget" })}
          </Button>
        </Stack>
      )}
    </Box>
  );
}

/** The live verdict, its evidence, and the one case nothing can be drawn. */
function Diagnostics({
  state,
  mode,
}: Readonly<{ state: ReturnType<typeof useGameOverlayState>; mode: GameOverlayMode }>) {
  const { t } = useTranslation("nebulaSettings");

  if (mode === "off") {
    return (
      <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
        {t("overlay.diagnosticsOff", {
          defaultValue: "The detector only runs while the overlay is switched on.",
        })}
      </Typography>
    );
  }
  if (!state) {
    return (
      <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
        {t("overlay.diagnosticsWaiting", { defaultValue: "Waiting for the first reading…" })}
      </Typography>
    );
  }

  const verdictLabel = {
    game: t("overlay.verdictGame", { defaultValue: "A game - the overlay may show" }),
    probably: t("overlay.verdictProbably", { defaultValue: "Might be a game - asking first" }),
    notGame: t("overlay.verdictNotGame", { defaultValue: "Not a game" }),
    cannotShow: t("overlay.verdictCannotShow", {
      defaultValue: "A game in exclusive fullscreen - nothing can be drawn over it",
    }),
  }[state.verdict ?? "notGame"];

  return (
    <Box
      sx={(theme) => ({
        borderRadius: radius("md"),
        border: `1px solid ${theme.palette.nebula.line}`,
        background: theme.palette.nebula.card2,
        px: "14px",
        py: "12px",
      })}
    >
      <Stack direction="row" alignItems="baseline" gap={1}>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
          {state.title ?? state.exeStem ?? t("overlay.nothing", { defaultValue: "Nothing in focus" })}
        </Typography>
        <Typography sx={(theme) => ({ ml: "auto", fontSize: 11, color: theme.palette.nebula.dim })}>
          {t("overlay.score", { defaultValue: "score {{score}}", score: state.score })}
        </Typography>
      </Stack>

      <Typography
        sx={(theme) => ({
          mt: "2px",
          fontSize: 12,
          color: state.verdict === "game" ? theme.palette.nebula.ok : theme.palette.nebula.muted,
        })}
      >
        {verdictLabel}
      </Typography>

      {/* The window's own answer, not the policy's intention: without this a
          panel cannot tell "showing" from "tried to show and failed". */}
      <Typography
        sx={(theme) => ({
          mt: "4px",
          fontSize: 11.5,
          color: state.windowError ? theme.palette.nebula.bad : theme.palette.nebula.dim,
        })}
      >
        {state.windowError
          ? t("overlay.windowFailed", {
              defaultValue: "The overlay window could not be created: {{error}}",
              error: state.windowError,
            })
          : state.visible
            ? t("overlay.windowVisible", { defaultValue: "Window: open and on screen" })
            : hiddenBecause(t, state)}
      </Typography>

      {state.exePath && (
        <Typography
          sx={(theme) => ({
            mt: "6px",
            fontFamily: NEBULA_MONO,
            fontSize: 10.5,
            color: theme.palette.nebula.dim,
            wordBreak: "break-all",
          })}
        >
          {state.exePath}
          {state.windowClass ? ` · ${state.windowClass}` : ""}
        </Typography>
      )}

      {/* A visible window that paints nothing is indistinguishable from a
          missing one; this is the difference, in words. */}
      <Typography sx={(theme) => ({ mt: "2px", fontSize: 11.5, color: theme.palette.nebula.dim })}>
        {contentLine(t, state)}
      </Typography>

      {state.reasons.length > 0 && (
        <Stack sx={{ mt: "10px", gap: "3px" }}>
          {state.reasons.map((reason) => (
            <ReasonRow key={`${reason.code}:${reason.detail ?? ""}`} reason={reason} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** What the overlay window is actually painting, and where it is. */
function contentLine(
  t: ReturnType<typeof useTranslation<"nebulaSettings">>["t"],
  state: NonNullable<ReturnType<typeof useGameOverlayState>>,
): string {
  const place = state.placement
    ? ` · ${state.placement.w}x${state.placement.h} at ${state.placement.x},${state.placement.y}`
    : "";
  const status = state.pageStatus;
  if (!status) {
    return t("overlay.contentUnknown", { defaultValue: "Content: the page has not reported yet" }) + place;
  }
  if (status.failed) {
    return t("overlay.contentFailed", { defaultValue: "Content: the page could not read its data" }) + place;
  }
  if (!status.connected) {
    return (
      t("overlay.contentDisconnected", {
        defaultValue: "Content: nothing - not connected to a server",
      }) + place
    );
  }
  return (
    t("overlay.contentDrawing", {
      defaultValue: "Content: {{count}} in the channel",
      count: status.occupants,
    }) + place
  );
}

/**
 * The one line that turns "it does not work" into a diagnosis.
 *
 * Every branch here is a state the policy can legitimately be in; naming them
 * is what lets someone tell "waiting for you to speak" from "the window never
 * opened" without reading the source.
 */
function hiddenBecause(
  t: ReturnType<typeof useTranslation<"nebulaSettings">>["t"],
  state: NonNullable<ReturnType<typeof useGameOverlayState>>,
): string {
  if (!state.windowCreated) {
    return t("overlay.windowAbsent", { defaultValue: "Window: not created" });
  }
  const detail = {
    visible: t("overlay.hiddenVisible", { defaultValue: "on screen" }),
    modeOff: t("overlay.hiddenOff", { defaultValue: "the overlay is switched off" }),
    pageNotReady: t("overlay.hiddenPageNotReady", {
      defaultValue: "waiting for the overlay to finish loading",
    }),
    noGame: t("overlay.hiddenNoGame", { defaultValue: "no game in the foreground" }),
    exclusiveFullscreen: t("overlay.hiddenExclusive", {
      defaultValue: "the game is in exclusive fullscreen, so nothing can be drawn over it",
    }),
    waitingForActivity: t("overlay.hiddenWaiting", {
      defaultValue: "nobody is talking and no message is recent",
    }),
    manuallyHidden: t("overlay.hiddenManual", { defaultValue: "you hid it with the shortcut" }),
  }[state.hiddenReason];
  return t("overlay.windowHiddenBecause", {
    defaultValue: "Window: open, hidden - {{detail}}",
    detail,
  });
}

function ReasonRow({ reason }: Readonly<{ reason: GameOverlayReason }>) {
  const vetoed = reason.code.startsWith("veto:");
  return (
    <Stack direction="row" alignItems="baseline" gap={1}>
      <Typography
        sx={(theme) => ({
          fontFamily: NEBULA_MONO,
          fontSize: 10.5,
          color: vetoed ? theme.palette.nebula.bad : theme.palette.nebula.muted,
        })}
      >
        {reason.code}
      </Typography>
      {reason.detail && (
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim, minWidth: 0 })} noWrap>
          {reason.detail}
        </Typography>
      )}
      {reason.weight !== 0 && (
        <Typography
          sx={(theme) => ({
            ml: "auto",
            fontFamily: NEBULA_MONO,
            fontSize: 10.5,
            color: theme.palette.nebula.dim,
          })}
        >
          {reason.weight > 0 ? `+${reason.weight}` : reason.weight}
        </Typography>
      )}
    </Stack>
  );
}
