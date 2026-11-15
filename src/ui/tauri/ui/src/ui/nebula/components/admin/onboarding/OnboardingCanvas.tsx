import { useMemo, type ReactNode } from "react";
import { Button } from "@mui/material";
import { NodeEditor } from "../nodes";
import { ONBOARDING_SUGGESTED, OnboardingCanvasProvider, onboardingSpec } from "./spec";
import { summaryOf, type OnboardingGraph } from "./model";
import type { TFn } from "./mapping";

/**
 * The onboarding questionnaire as a drawing.
 *
 * The page's second way of editing one document: the rail shows the steps a new
 * member walks through, and this shows the shape of the thing - which questions
 * follow which, and that four different answers all put somebody in the same
 * channel. Both write the same `OnboardingConfig`, so switching between them
 * mid-edit loses nothing.
 *
 * Everything visible here is the shared node editor. What this file adds is the
 * dialect, the ambient data its bodies need, and the sentence the footer reads
 * the drawing back with.
 */
export function OnboardingCanvas({
  graph,
  onChange,
  channels,
  t,
  busy,
  onSave,
  onRebuild,
  leading,
}: Readonly<{
  graph: OnboardingGraph;
  onChange: (next: OnboardingGraph) => void;
  channels: readonly { id: number; name: string }[];
  t: TFn;
  busy: boolean;
  onSave: () => void;
  /** Lay the drawing out again from the questionnaire, discarding the layout. */
  onRebuild: () => void;
  leading?: ReactNode;
}>) {
  const spec = useMemo(() => onboardingSpec(t), [t]);
  const ambient = useMemo(() => ({ t, channels }), [t, channels]);
  const counts = summaryOf(graph);

  const summary =
    counts.questions === 0
      ? t("onboarding.admin.canvas.summaryEmpty")
      : t("onboarding.admin.canvas.summary", {
          questions: t("onboarding.admin.canvas.summaryQuestions", { count: counts.questions }),
          answers: t("onboarding.admin.canvas.summaryAnswers", { count: counts.answers }),
          channels: t("onboarding.admin.canvas.summaryChannels", { count: counts.channels }),
          groups: t("onboarding.admin.canvas.summaryGroups", { count: counts.groups }),
        });

  return (
    <OnboardingCanvasProvider value={ambient}>
      <NodeEditor
        spec={spec}
        graph={graph}
        onChange={onChange}
        leading={leading}
        summary={summary}
        onReset={onRebuild}
        suggested={ONBOARDING_SUGGESTED}
        actions={
          <Button variant="contained" size="small" disabled={busy} onClick={onSave}>
            {busy ? t("onboarding.admin.savingBtn") : t("onboarding.admin.saveBroadcastBtn")}
          </Button>
        }
      />
    </OnboardingCanvasProvider>
  );
}
