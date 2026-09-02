import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import { CheckIcon, SparklesIcon } from "@ui/icons";

import { useAppStore } from "@core/store";
import {
  dismissOnboardingForServer,
  isOnboardingSupported,
  useOnboardingStore,
} from "@core/features/onboarding/onboardingStore";
import type { OnboardingAnswer, OnboardingQuestion, OnboardingSelection } from "@core/types";
import { Stack } from "../primitives";

/**
 * The questions a server asks a new member on first connect.
 *
 * Nebula shipped the administration page that *authors* this flow and no
 * surface that asks it, so an admin could sit in Nebula, write the questions,
 * save them to the server, and never be asked one - the answers only ever
 * arrived from someone running Standard. This is the missing half.
 *
 * There is no state of its own beyond the step and the selections. Whether the
 * flow should run at all - server new enough, config enabled, this user still
 * owing an answer, not dismissed this session - is decided in
 * `onboardingStore.evaluateAutoOpen`, which the *core* store already drives on
 * connect and on the config event. Both packs therefore open on exactly the
 * same evidence, and a fix to that rule lands in both at once.
 *
 * The strings are the shared `settings:onboarding.modal.*` set Standard uses,
 * not Nebula's own catalogue: the questions themselves are the server's text in
 * whatever language it was written, and the chrome around them is asking the
 * same thing in both packs. They were already complete in all four languages.
 */
export default function OnboardingModal() {
  const config = useOnboardingStore((state) => state.config);
  const response = useOnboardingStore((state) => state.response);
  const open = useOnboardingStore((state) => state.modalOpen);
  const busy = useOnboardingStore((state) => state.busy);
  const error = useOnboardingStore((state) => state.error);
  const submit = useOnboardingStore((state) => state.submit);
  const setModalOpen = useOnboardingStore((state) => state.setModalOpen);

  const channels = useAppStore((state) => state.channels);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const serverFancyVersion = useAppStore((state) => state.serverFancyVersion);
  const supported = isOnboardingSupported(serverFancyVersion);

  const { t } = useTranslation("settings");
  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});

  // Seed from the stored response when the modal opens: a user re-asked after
  // an admin added a question should find their earlier answers still ticked
  // rather than have to rebuild them.
  useEffect(() => {
    if (!open) return;
    const seed: Record<string, Set<string>> = {};
    for (const selection of response?.selections ?? []) {
      seed[selection.question_id] = new Set(selection.answer_ids);
    }
    setSelections(seed);
    setStepIndex(0);
  }, [open, response]);

  const channelNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const channel of channels) names.set(channel.id, channel.name);
    return names;
  }, [channels]);

  // Step 0 previews the channels everyone gets; the questions follow it.
  const questions = config?.questions ?? [];
  const stepCount = questions.length + 1;
  const isPreview = stepIndex === 0;
  const question: OnboardingQuestion | undefined = questions[stepIndex - 1];
  const isLastStep = stepIndex >= stepCount - 1;

  // Legacy, non-Fancy and pre-0.3.1 servers have no flow to run.
  if (!supported || !open || !config) return null;

  const toggleAnswer = (target: OnboardingQuestion, answer: OnboardingAnswer) => {
    setSelections((previous) => {
      const chosen = new Set(previous[target.id] ?? []);
      if (!target.multi_select) {
        // Single-select: picking the chosen one again leaves it chosen, because
        // an unanswered required question is a dead end at the footer.
        chosen.clear();
        chosen.add(answer.id);
      } else if (chosen.has(answer.id)) {
        chosen.delete(answer.id);
      } else {
        chosen.add(answer.id);
      }
      return { ...previous, [target.id]: chosen };
    });
  };

  const stepAnswered = isPreview || !question?.required || (selections[question.id]?.size ?? 0) > 0;

  const handleSubmit = () => {
    const flat: OnboardingSelection[] = questions
      .map((each) => ({ question_id: each.id, answer_ids: [...(selections[each.id] ?? [])] }))
      .filter((selection) => selection.answer_ids.length > 0);
    // Errors surface through the store's `error`, which is rendered below.
    submit(flat, config.revision).catch(() => undefined);
  };

  const handleSkip = () => {
    dismissOnboardingForServer(activeServerId ?? null);
    setModalOpen(false);
  };

  return (
    <Dialog
      open
      // Neither escape nor the backdrop closes it: leaving by accident and
      // leaving on purpose need to be different acts, because the deliberate
      // one is what records the dismissal and stops the server re-asking.
      onClose={() => undefined}
      maxWidth="sm"
      fullWidth
      aria-labelledby="nebula-onboarding-title"
    >
      <DialogContent>
        <Stack gap={2}>
          <Stack gap={1}>
            <Stack direction="row" alignItems="center" gap={1}>
              <Box
                aria-hidden
                sx={(theme) => ({
                  display: "grid",
                  placeItems: "center",
                  width: 28,
                  height: 28,
                  borderRadius: "9px",
                  color: theme.palette.nebula.accent,
                  background: theme.palette.nebula.accentSoft,
                })}
              >
                <SparklesIcon width={16} height={16} />
              </Box>
              <Typography id="nebula-onboarding-title" sx={{ fontWeight: 600, fontSize: 15 }}>
                {isPreview ? t("onboarding.modal.welcomeTitle") : question?.text}
              </Typography>
            </Stack>
            <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
              {isPreview
                ? t("onboarding.modal.welcomeSubtitle")
                : question?.multi_select
                  ? t("onboarding.modal.pickMultiple")
                  : t("onboarding.modal.pickOne")}
            </Typography>
          </Stack>

          <ProgressRail stepCount={stepCount} stepIndex={stepIndex} />

          {isPreview ? (
            <DefaultChannels defaultIds={config.default_channel_ids} channelNames={channelNames} />
          ) : question ? (
            <Stack gap={1} role={question.multi_select ? "group" : "radiogroup"} aria-label={question.text}>
              {question.required && (
                <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
                  {t("onboarding.modal.required")}
                </Typography>
              )}
              {question.answers.map((answer) => (
                <AnswerRow
                  key={answer.id}
                  answer={answer}
                  multiSelect={question.multi_select}
                  selected={selections[question.id]?.has(answer.id) ?? false}
                  onToggle={() => toggleAnswer(question, answer)}
                />
              ))}
            </Stack>
          ) : null}

          {error && (
            <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.bad })}>
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleSkip} disabled={busy}>
          {t("onboarding.modal.skipBtn")}
        </Button>
        <Box sx={{ flex: 1 }} />
        {stepIndex > 0 && (
          <Button onClick={() => setStepIndex((index) => index - 1)} disabled={busy}>
            {t("onboarding.modal.backBtn")}
          </Button>
        )}
        <Button
          variant="contained"
          disabled={busy || !stepAnswered}
          onClick={() => (isLastStep ? handleSubmit() : setStepIndex((index) => index + 1))}
        >
          {isLastStep ? t("onboarding.modal.finishBtn") : t("onboarding.modal.nextBtn")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * How far in the flow this is. A rail of segments rather than "3 of 5" because
 * the count is the reassuring part - these flows are short, and seeing that is
 * what stops the first question reading as the start of a long form.
 */
function ProgressRail({ stepCount, stepIndex }: Readonly<{ stepCount: number; stepIndex: number }>) {
  return (
    <Stack direction="row" gap={0.5} aria-hidden>
      {Array.from({ length: stepCount }, (_, index) => (
        <Box
          key={index}
          sx={(theme) => ({
            height: 3,
            flex: 1,
            borderRadius: 999,
            background: index <= stepIndex ? theme.palette.nebula.accent : theme.palette.nebula.line2,
          })}
        />
      ))}
    </Stack>
  );
}

/**
 * One answer chip. A button rather than a list row: the whole card is the
 * target, and the tick on the right reports the state the border is already
 * showing, so the two readings agree for anyone who cannot see the accent.
 *
 * The role follows the question rather than the widget - `radio` where only one
 * answer can stand, `checkbox` where several can - because that is the part
 * that tells a screen reader whether picking a second answer will drop the
 * first, which is exactly what the click does.
 */
function AnswerRow({
  answer,
  multiSelect,
  selected,
  onToggle,
}: Readonly<{
  answer: OnboardingAnswer;
  multiSelect: boolean;
  selected: boolean;
  onToggle: () => void;
}>) {
  return (
    <Box
      component="button"
      type="button"
      role={multiSelect ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onToggle}
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: "11px",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
        background: selected ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
        border: `1px solid ${selected ? theme.palette.nebula.accentLine : theme.palette.nebula.line2}`,
        "&:hover": { borderColor: theme.palette.nebula.accentLine },
      })}
    >
      {answer.emoji && <Box sx={{ fontSize: 17, lineHeight: 1 }}>{answer.emoji}</Box>}
      <Stack gap={0.25} sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>{answer.label}</Typography>
        {answer.description && (
          <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
            {answer.description}
          </Typography>
        )}
      </Stack>
      <Box
        aria-hidden
        sx={(theme) => ({
          display: "flex",
          flex: "none",
          color: theme.palette.nebula.accent,
          visibility: selected ? "visible" : "hidden",
        })}
      >
        <CheckIcon width={16} height={16} />
      </Box>
    </Box>
  );
}

/**
 * The channels everyone lands in regardless of what they answer, shown before
 * the first question so the flow opens with what the user gets rather than with
 * what it wants from them.
 */
function DefaultChannels({
  defaultIds,
  channelNames,
}: Readonly<{ defaultIds: number[]; channelNames: Map<number, string> }>) {
  const { t } = useTranslation("settings");

  if (defaultIds.length === 0) {
    return (
      <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
        {t("onboarding.modal.defaultChannelsEmpty")}
      </Typography>
    );
  }

  return (
    <Stack gap={1}>
      <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
        {t("onboarding.modal.defaultChannelsTitle")}
      </Typography>
      <Stack direction="row" gap={0.75} flexWrap="wrap">
        {defaultIds.map((id) => (
          <Box
            key={id}
            sx={(theme) => ({
              fontSize: 12.5,
              padding: "4px 10px",
              borderRadius: 999,
              background: theme.palette.nebula.card2,
              border: `1px solid ${theme.palette.nebula.line2}`,
            })}
          >
            {`#${channelNames.get(id) ?? id}`}
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
