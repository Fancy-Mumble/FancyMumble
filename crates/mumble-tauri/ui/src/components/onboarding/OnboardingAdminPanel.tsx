import { useEffect, useState } from "react";

import { useAppStore } from "../../store";
import type {
  OnboardingAnswer,
  OnboardingConfig,
  OnboardingQuestion,
} from "../../types";
import { isOnboardingSupported, useOnboardingStore } from "./onboardingStore";
import styles from "./OnboardingAdminPanel.module.css";

const MAX_QUESTIONS = 5;

function emptyAnswer(): OnboardingAnswer {
  return {
    id: crypto.randomUUID(),
    label: "",
    channel_ids: [],
    group_names: [],
  };
}

function emptyQuestion(): OnboardingQuestion {
  return {
    id: crypto.randomUUID(),
    text: "",
    multi_select: false,
    required: false,
    ask_before_join: false,
    answers: [emptyAnswer(), emptyAnswer()],
  };
}

function emptyConfig(): OnboardingConfig {
  return {
    version: 1,
    enabled: false,
    default_channel_ids: [],
    questions: [emptyQuestion()],
    revision: 0,
  };
}

function parseIdList(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function parseStringList(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Admin editor for the onboarding workflow.  Pre-populates from the
 * server-broadcast config and persists changes via
 * `save_onboarding_config`.
 */
export default function OnboardingAdminPanel() {
  const remote = useOnboardingStore((s) => s.config);
  const busy = useOnboardingStore((s) => s.busy);
  const error = useOnboardingStore((s) => s.error);
  const saveConfig = useOnboardingStore((s) => s.saveConfig);

  const channels = useAppStore((s) => s.channels);
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const supported = isOnboardingSupported(serverFancyVersion);

  const [draft, setDraft] = useState<OnboardingConfig>(
    () => remote ?? emptyConfig(),
  );

  // Re-seed when the server pushes a new revision so we don't overwrite a
  // newer admin's edit.
  useEffect(() => {
    if (remote) setDraft(remote);
  }, [remote]);

  const updateQuestion = (idx: number, patch: Partial<OnboardingQuestion>) => {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) => (i === idx ? { ...q, ...patch } : q)),
    }));
  };

  const updateAnswer = (
    qIdx: number,
    aIdx: number,
    patch: Partial<OnboardingAnswer>,
  ) => {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) => {
        if (i !== qIdx) return q;
        return {
          ...q,
          answers: q.answers.map((a, j) =>
            j === aIdx ? { ...a, ...patch } : a,
          ),
        };
      }),
    }));
  };

  const addQuestion = () =>
    setDraft((d) =>
      d.questions.length >= MAX_QUESTIONS
        ? d
        : { ...d, questions: [...d.questions, emptyQuestion()] },
    );

  const removeQuestion = (idx: number) =>
    setDraft((d) => ({
      ...d,
      questions: d.questions.filter((_, i) => i !== idx),
    }));

  const addAnswer = (qIdx: number) =>
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) =>
        i === qIdx ? { ...q, answers: [...q.answers, emptyAnswer()] } : q,
      ),
    }));

  const removeAnswer = (qIdx: number, aIdx: number) =>
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) =>
        i === qIdx
          ? { ...q, answers: q.answers.filter((_, j) => j !== aIdx) }
          : q,
      ),
    }));

  const handleSave = () => {
    // Drop questions/answers without a label/text so we never save UI placeholders.
    const sanitized: OnboardingConfig = {
      ...draft,
      questions: draft.questions
        .filter((q) => q.text.trim().length > 0)
        .map((q) => ({
          ...q,
          answers: q.answers.filter((a) => a.label.trim().length > 0),
        }))
        .filter((q) => q.answers.length > 0),
    };
    saveConfig(sanitized).catch(() => {});
  };

  if (!supported) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.heading}>Onboarding</h3>
        <p className={styles.subtle}>
          The connected server does not support the onboarding workflow.
          It requires a Fancy Mumble server running 0.3.1 or newer.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>Onboarding</h3>
      <p className={styles.subtle}>
        Show new members a welcome questionnaire that maps their answers to
        channels and Mumble ACL groups. Mirrors Discord&apos;s Community
        Onboarding model. Up to {MAX_QUESTIONS} questions.
      </p>

      <div className={styles.checkboxRow}>
        <label>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) =>
              setDraft({ ...draft, enabled: e.target.checked })
            }
          />{" "}
          Enabled
        </label>
        <span className={styles.spacer} />
        <span className={styles.tag}>
          Revision {draft.revision} {channels.length} channels available
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>
          Default channel IDs (comma-separated)
        </label>
        <input
          className={styles.input}
          value={draft.default_channel_ids.join(", ")}
          onChange={(e) =>
            setDraft({
              ...draft,
              default_channel_ids: parseIdList(e.target.value),
            })
          }
          placeholder="0, 1"
        />
      </div>

      {draft.questions.map((q, qIdx) => (
        <div key={q.id} className={styles.questionCard}>
          <div className={styles.cardHeader}>
            <p className={styles.cardTitle}>Question {qIdx + 1}</p>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => removeQuestion(qIdx)}
              disabled={draft.questions.length <= 1}
            >
              Delete
            </button>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>Prompt</label>
            <input
              className={styles.input}
              value={q.text}
              onChange={(e) => updateQuestion(qIdx, { text: e.target.value })}
              placeholder="What brings you here?"
            />
          </div>

          <div className={styles.checkboxRow}>
            <label>
              <input
                type="checkbox"
                checked={q.multi_select}
                onChange={(e) =>
                  updateQuestion(qIdx, { multi_select: e.target.checked })
                }
              />{" "}
              Multi-select
            </label>
            <label>
              <input
                type="checkbox"
                checked={q.required}
                onChange={(e) =>
                  updateQuestion(qIdx, { required: e.target.checked })
                }
              />{" "}
              Required
            </label>
            <label>
              <input
                type="checkbox"
                checked={q.ask_before_join}
                onChange={(e) =>
                  updateQuestion(qIdx, { ask_before_join: e.target.checked })
                }
              />{" "}
              Ask before join
            </label>
          </div>

          {q.answers.map((a, aIdx) => (
            <div key={a.id} className={styles.answerCard}>
              <div className={styles.cardHeader}>
                <p className={styles.cardTitle}>Answer {aIdx + 1}</p>
                <button
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() => removeAnswer(qIdx, aIdx)}
                  disabled={q.answers.length <= 1}
                >
                  Delete
                </button>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Label</label>
                  <input
                    className={styles.input}
                    value={a.label}
                    onChange={(e) =>
                      updateAnswer(qIdx, aIdx, { label: e.target.value })
                    }
                    placeholder="Gaming"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Emoji</label>
                  <input
                    className={styles.input}
                    value={a.emoji ?? ""}
                    onChange={(e) =>
                      updateAnswer(qIdx, aIdx, {
                        emoji: e.target.value || undefined,
                      })
                    }
                    maxLength={4}
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  Channel IDs (comma-separated)
                </label>
                <input
                  className={styles.input}
                  value={a.channel_ids.join(", ")}
                  onChange={(e) =>
                    updateAnswer(qIdx, aIdx, {
                      channel_ids: parseIdList(e.target.value),
                    })
                  }
                  placeholder="5, 6"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  ACL group names (comma-separated)
                </label>
                <input
                  className={styles.input}
                  value={a.group_names.join(", ")}
                  onChange={(e) =>
                    updateAnswer(qIdx, aIdx, {
                      group_names: parseStringList(e.target.value),
                    })
                  }
                  placeholder="gamers, newcomer"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Description</label>
                <textarea
                  className={styles.textarea}
                  value={a.description ?? ""}
                  onChange={(e) =>
                    updateAnswer(qIdx, aIdx, {
                      description: e.target.value || undefined,
                    })
                  }
                />
              </div>
            </div>
          ))}

          <button className={styles.btn} onClick={() => addAnswer(qIdx)}>
            + Add answer
          </button>
        </div>
      ))}

      {draft.questions.length < MAX_QUESTIONS ? (
        <button className={styles.btn} onClick={addQuestion}>
          + Add question
        </button>
      ) : null}

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.actions}>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleSave}
          disabled={busy}
        >
          {busy ? "Saving..." : "Save & broadcast"}
        </button>
      </div>
    </div>
  );
}
