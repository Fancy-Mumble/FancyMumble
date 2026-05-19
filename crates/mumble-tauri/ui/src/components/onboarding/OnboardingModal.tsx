import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";

import { useAppStore } from "../../store";
import type {
  OnboardingAnswer,
  OnboardingQuestion,
  OnboardingSelection,
} from "../../types";
import {
  dismissOnboardingForServer,
  isOnboardingSupported,
  useOnboardingStore,
} from "./onboardingStore";
import styles from "./OnboardingModal.module.css";

/**
 * Multi-step onboarding modal shown to new members on first connect to a
 * server with onboarding enabled.  Mirrors Discord's join-time flow:
 * default-channels preview, 3-5 questions, then a single submit that
 * applies the chosen ACL groups and adds the mapped channels.
 */
export default function OnboardingModal() {
  const config = useOnboardingStore((s) => s.config);
  const response = useOnboardingStore((s) => s.response);
  const open = useOnboardingStore((s) => s.modalOpen);
  const busy = useOnboardingStore((s) => s.busy);
  const error = useOnboardingStore((s) => s.error);
  const submit = useOnboardingStore((s) => s.submit);
  const setModalOpen = useOnboardingStore((s) => s.setModalOpen);

  const channels = useAppStore((s) => s.channels);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const supported = isOnboardingSupported(serverFancyVersion);

  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const { t } = useTranslation("settings");;

  // Seed with previous answers when the modal opens.
  useEffect(() => {
    if (!open) return;
    const seed: Record<string, Set<string>> = {};
    if (response) {
      for (const sel of response.selections) {
        seed[sel.question_id] = new Set(sel.answer_ids);
      }
    }
    setSelections(seed);
    setStepIndex(0);
  }, [open, response]);

  const stepCount = (config?.questions.length ?? 0) + 1;
  const isPreview = stepIndex === 0;
  const question: OnboardingQuestion | undefined = config?.questions[stepIndex - 1];

  const channelLookup = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of channels) map.set(c.id, c.name);
    return map;
  }, [channels]);

  // Hide the modal entirely on legacy / non-Fancy / pre-0.3.1 servers.
  if (!supported || !open || !config) return null;

  const toggleAnswer = (q: OnboardingQuestion, a: OnboardingAnswer) => {
    setSelections((prev) => {
      const next = { ...prev };
      const current = new Set(next[q.id] ?? []);
      if (q.multi_select) {
        if (current.has(a.id)) current.delete(a.id);
        else current.add(a.id);
      } else {
        current.clear();
        current.add(a.id);
      }
      next[q.id] = current;
      return next;
    });
  };

  const isStepValid = (): boolean => {
    if (isPreview) return true;
    if (!question) return false;
    if (!question.required) return true;
    return (selections[question.id]?.size ?? 0) > 0;
  };

  const handleNext = () => {
    if (stepIndex < stepCount - 1) {
      setStepIndex((i) => i + 1);
      return;
    }
    handleSubmit();
  };

  const handleSubmit = () => {
    const flat: OnboardingSelection[] = config.questions
      .map((q) => ({
        question_id: q.id,
        answer_ids: [...(selections[q.id] ?? [])],
      }))
      .filter((s) => s.answer_ids.length > 0);
    submit(flat, config.revision).catch(() => {
      // Error surfaces via store.error.
    });
  };

  const handleSkip = () => {
    dismissOnboardingForServer(activeServerId ?? null);
    setModalOpen(false);
  };

  return createPortal(
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-labelledby="onboarding-title"
      >
        <div className={styles.header}>
          <h2 id="onboarding-title" className={styles.title}>
            {isPreview ? t("onboarding.modal.welcomeTitle") : question?.text}
          </h2>
          <p className={styles.subtitle}>
            {isPreview
              ? t("onboarding.modal.welcomeSubtitle")
              : question?.multi_select
              ? t("onboarding.modal.pickMultiple")
              : t("onboarding.modal.pickOne")}
          </p>
        </div>

        <div className={styles.progress}>
          {Array.from({ length: stepCount }, (_, i) => (
            <div
              key={i}
              className={`${styles.progressStep} ${
                i <= stepIndex ? styles.progressStepActive : ""
              }`}
            />
          ))}
        </div>

        <div className={styles.body}>
          {isPreview ? (
            <DefaultChannelsPreview
              defaultIds={config.default_channel_ids}
              channelLookup={channelLookup}
            />
          ) : question ? (
            <>
              {question.required && (
                <p className={styles.questionMeta}>{t("onboarding.modal.required")}</p>
              )}
              <div className={styles.answers}>
                {question.answers.map((a) => {
                  const selected = selections[question.id]?.has(a.id) ?? false;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`${styles.answer} ${
                        selected ? styles.answerSelected : ""
                      }`}
                      onClick={() => toggleAnswer(question, a)}
                    >
                      {a.emoji ? (
                        <span className={styles.answerEmoji}>{a.emoji}</span>
                      ) : null}
                      <div className={styles.answerBody}>
                        <span className={styles.answerLabel}>{a.label}</span>
                        {a.description ? (
                          <span className={styles.answerDesc}>
                            {a.description}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={`${styles.checkmark} ${
                          selected ? styles.checkmarkSelected : ""
                        }`}
                      >
                        {selected ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.actions}>
          <button className={styles.btn} onClick={handleSkip} disabled={busy}>
            {t("onboarding.modal.skipBtn")}
          </button>
          <div className={styles.spacer} />
          {stepIndex > 0 ? (
            <button
              className={styles.btn}
              onClick={() => setStepIndex((i) => i - 1)}
              disabled={busy}
            >
              {t("onboarding.modal.backBtn")}
            </button>
          ) : null}
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleNext}
            disabled={busy || !isStepValid()}
          >
            {stepIndex < stepCount - 1 ? t("onboarding.modal.nextBtn") : t("onboarding.modal.finishBtn")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface PreviewProps {
  defaultIds: number[];
  channelLookup: Map<number, string>;
}

function DefaultChannelsPreview({ defaultIds, channelLookup }: PreviewProps) {
  const { t } = useTranslation("settings");
  if (defaultIds.length === 0) {
    return (
      <p className={styles.questionMeta}>
        {t("onboarding.modal.defaultChannelsEmpty")}
      </p>
    );
  }
  return (
    <div className={styles.defaultChannels}>
      <p className={styles.defaultChannelsTitle}>
        {t("onboarding.modal.defaultChannelsTitle")}
      </p>
      <div className={styles.defaultChannelsList}>
        {defaultIds.map((id) => (
          <span key={id} className={styles.defaultChannelChip}>
            #{channelLookup.get(id) ?? id}
          </span>
        ))}
      </div>
    </div>
  );
}
