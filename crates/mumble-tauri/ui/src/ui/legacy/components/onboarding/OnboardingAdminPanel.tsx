import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useAppStore } from "@core/store";
import type {
  OnboardingAnswer,
  OnboardingConfig,
  OnboardingQuestion,
} from "@core/types";
import { type AutocompleteOption } from "../elements/Autocomplete";
import { MultiSelectField } from "../elements/MultiSelectField";
import { PlusIcon, TrashIcon, HashIcon, SparklesIcon } from "../../icons";
import { isOnboardingSupported, useOnboardingStore } from "@core/features/onboarding/onboardingStore";
import styles from "./OnboardingAdminPanel.module.css";
import tabStyles from "../elements/TabbedPage.module.css";
import { TextField } from "../elements/TextField";
import { TextInput } from "../elements/TextInput";

export interface OnboardingAdminPanelProps {
  /** Hands the panel's Save bar up to `AdminPanel`'s shared pinned footer. */
  readonly setFooter?: (footer: ReactNode) => void;
}

const MAX_QUESTIONS = 5;

function emptyAnswer(): OnboardingAnswer {
  return { id: crypto.randomUUID(), label: "", channel_ids: [], group_names: [] };
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
  return { version: 1, enabled: false, default_channel_ids: [], questions: [emptyQuestion()], revision: 0 };
}

function parseStringList(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A labelled on/off switch that matches the app's design system. */
function Toggle({
  checked,
  onChange,
  label,
  hint,
}: Readonly<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }>) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleTrack} aria-hidden="true">
        <span className={styles.toggleThumb} />
      </span>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {hint ? <span className={styles.toggleHint}>{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Admin editor for the server onboarding workflow.  Pre-populates from the
 * server-broadcast config and persists changes via `save_onboarding_config`.
 */
export default function OnboardingAdminPanel({ setFooter }: Readonly<OnboardingAdminPanelProps>) {
  const remote = useOnboardingStore((s) => s.config);
  const busy = useOnboardingStore((s) => s.busy);
  const error = useOnboardingStore((s) => s.error);
  const saveConfig = useOnboardingStore((s) => s.saveConfig);

  const channels = useAppStore((s) => s.channels);
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const supported = isOnboardingSupported(serverFancyVersion);
  const { t } = useTranslation("settings");

  const [draft, setDraft] = useState<OnboardingConfig>(() => remote ?? emptyConfig());

  // Re-seed when the server pushes a new revision so we don't overwrite a
  // newer admin's edit.
  useEffect(() => {
    if (remote) setDraft(remote);
  }, [remote]);

  // Channel picker: real names instead of raw numeric IDs.
  const channelOptions = useMemo<readonly AutocompleteOption<number>[]>(
    () => channels.map((c) => ({ key: c.id, label: `# ${c.name}`, value: c.id })),
    [channels],
  );
  const optionById = useMemo(() => {
    const m = new Map<number, AutocompleteOption<number>>();
    for (const o of channelOptions) m.set(o.value, o);
    return m;
  }, [channelOptions]);
  const toOptions = (ids: number[]): AutocompleteOption<number>[] =>
    ids.map((id) => optionById.get(id) ?? { key: id, label: `#${id}`, value: id });

  const updateQuestion = (idx: number, patch: Partial<OnboardingQuestion>) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, i) => (i === idx ? { ...q, ...patch } : q)) }));

  const updateAnswer = (qIdx: number, aIdx: number, patch: Partial<OnboardingAnswer>) =>
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) =>
        i !== qIdx ? q : { ...q, answers: q.answers.map((a, j) => (j === aIdx ? { ...a, ...patch } : a)) },
      ),
    }));

  const addQuestion = () =>
    setDraft((d) =>
      d.questions.length >= MAX_QUESTIONS ? d : { ...d, questions: [...d.questions, emptyQuestion()] },
    );

  const removeQuestion = (idx: number) =>
    setDraft((d) => ({ ...d, questions: d.questions.filter((_, i) => i !== idx) }));

  const addAnswer = (qIdx: number) =>
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) => (i === qIdx ? { ...q, answers: [...q.answers, emptyAnswer()] } : q)),
    }));

  const removeAnswer = (qIdx: number, aIdx: number) =>
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) =>
        i === qIdx ? { ...q, answers: q.answers.filter((_, j) => j !== aIdx) } : q,
      ),
    }));

  const handleSave = () => {
    const sanitized: OnboardingConfig = {
      ...draft,
      questions: draft.questions
        .filter((q) => q.text.trim().length > 0)
        .map((q) => ({ ...q, answers: q.answers.filter((a) => a.label.trim().length > 0) }))
        .filter((q) => q.answers.length > 0),
    };
    saveConfig(sanitized).catch(() => {});
  };

  const footerNode = useMemo(() => {
    if (!supported) return null;
    return (
      <>
        {error ? <span className={styles.error}>{error}</span> : null}
        <div className={tabStyles.actionBtnGroup}>
          <button
            type="button"
            className={`${tabStyles.actionBtn} ${tabStyles.actionBtnPrimary}`}
            onClick={handleSave}
            disabled={busy}
          >
            {busy ? t("onboarding.admin.savingBtn") : t("onboarding.admin.saveBroadcastBtn")}
          </button>
        </div>
      </>
    );
    // `handleSave` closes over `draft`, so depending on `draft` here (rather
    // than on `handleSave` itself, which is a new closure every render) is
    // what keeps this memoized button from firing a stale save.
  }, [supported, draft, error, busy, t]);

  useEffect(() => {
    setFooter?.(footerNode);
    return () => setFooter?.(null);
  }, [footerNode, setFooter]);

  if (!supported) {
    return (
      <div className={styles.panel}>
        <header className={styles.pageHead}>
          <SparklesIcon className={styles.pageIcon} width={20} height={20} />
          <h3 className={styles.heading}>{t("onboarding.admin.heading")}</h3>
        </header>
        <p className={styles.subtle}>{t("onboarding.admin.unsupportedServer")}</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <header className={styles.pageHead}>
        <SparklesIcon className={styles.pageIcon} width={20} height={20} />
        <div>
          <h3 className={styles.heading}>{t("onboarding.admin.heading")}</h3>
          <p className={styles.subtle}>
            {t("onboarding.admin.description")}{" "}
            {t("onboarding.admin.maxQuestionsHint", { max: MAX_QUESTIONS })}
          </p>
        </div>
        <span className={styles.tag}>{t("onboarding.admin.revisionTag", { n: draft.revision, m: channels.length })}</span>
      </header>

      <div className={styles.card}>
        <Toggle
          checked={draft.enabled}
          onChange={(v) => setDraft({ ...draft, enabled: v })}
          label={t("onboarding.admin.enabledLabel")}
        />
        <MultiSelectField
          className={styles.field}
          label={<><HashIcon width={13} height={13} /> {t("onboarding.admin.defaultChannelIdsLabel")}</>}
          options={channelOptions}
          value={toOptions(draft.default_channel_ids)}
          onChange={(opts) => setDraft({ ...draft, default_channel_ids: opts.map((o) => o.value) })}
          placeholder={t("onboarding.admin.defaultChannelIdsLabel")}
          noOptionsText={t("onboarding.admin.noChannels", { defaultValue: "No channels" })}
        />
      </div>

      {draft.questions.map((q, qIdx) => (
        <section key={q.id} className={styles.questionCard}>
          <div className={styles.cardHeader}>
            <span className={styles.cardBadge}>{qIdx + 1}</span>
            <p className={styles.cardTitle}>{t("onboarding.admin.questionTitle", { n: qIdx + 1 })}</p>
            <span className={styles.grow} />
            <button
              className={styles.iconBtn}
              onClick={() => removeQuestion(qIdx)}
              disabled={draft.questions.length <= 1}
              aria-label={t("onboarding.admin.deleteBtn")}
              title={t("onboarding.admin.deleteBtn")}
            >
              <TrashIcon width={15} height={15} />
            </button>
          </div>

          <TextField
            className={styles.field}
            label={t("onboarding.admin.promptLabel")}
            inputClassName={styles.input}
            value={q.text}
            onChange={(e) => updateQuestion(qIdx, { text: e.target.value })}
            placeholder={t("onboarding.admin.promptPlaceholder")}
          />

          <div className={styles.toggleRow}>
            <Toggle
              checked={q.multi_select}
              onChange={(v) => updateQuestion(qIdx, { multi_select: v })}
              label={t("onboarding.admin.multiSelectLabel")}
            />
            <Toggle
              checked={q.required}
              onChange={(v) => updateQuestion(qIdx, { required: v })}
              label={t("onboarding.admin.requiredLabel")}
            />
            <Toggle
              checked={q.ask_before_join}
              onChange={(v) => updateQuestion(qIdx, { ask_before_join: v })}
              label={t("onboarding.admin.askBeforeJoinLabel")}
            />
          </div>

          <div className={styles.answers}>
            {q.answers.map((a, aIdx) => (
              <div key={a.id} className={styles.answerCard}>
                <div className={styles.answerTop}>
                  {/* Bare TextInput, not TextField: these sit directly in the
                      .answerTop flex row, so a wrapping field element would
                      break the row's layout. */}
                  <TextInput
                    className={styles.emojiInput}
                    size="small"
                    value={a.emoji ?? ""}
                    onChange={(e) => updateAnswer(qIdx, aIdx, { emoji: e.target.value || undefined })}
                    maxLength={4}
                    placeholder="🙂"
                    aria-label={t("onboarding.admin.emojiLabel")}
                  />
                  <TextInput
                    className={styles.grow}
                    size="small"
                    value={a.label}
                    onChange={(e) => updateAnswer(qIdx, aIdx, { label: e.target.value })}
                    placeholder={t("onboarding.admin.answerLabelField")}
                    aria-label={t("onboarding.admin.answerLabelField")}
                  />
                  <button
                    className={styles.iconBtn}
                    onClick={() => removeAnswer(qIdx, aIdx)}
                    disabled={q.answers.length <= 1}
                    aria-label={t("onboarding.admin.deleteBtn")}
                    title={t("onboarding.admin.deleteBtn")}
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>

                <MultiSelectField
                  className={styles.field}
                  label={<><HashIcon width={13} height={13} /> {t("onboarding.admin.channelIdsLabel")}</>}
                  options={channelOptions}
                  value={toOptions(a.channel_ids)}
                  onChange={(opts) => updateAnswer(qIdx, aIdx, { channel_ids: opts.map((o) => o.value) })}
                  placeholder={t("onboarding.admin.channelIdsLabel")}
                  noOptionsText={t("onboarding.admin.noChannels", { defaultValue: "No channels" })}
                />

                <div className={styles.row}>
                  <TextField
                    className={styles.field}
                    label={t("onboarding.admin.aclGroupNamesLabel")}
                    inputClassName={styles.input}
                    value={a.group_names.join(", ")}
                    onChange={(e) => updateAnswer(qIdx, aIdx, { group_names: parseStringList(e.target.value) })}
                    placeholder="gamers, newcomer"
                  />
                </div>

                <TextField
                  className={styles.field}
                  label={t("onboarding.admin.descriptionLabel")}
                  multiline
                  rows={2}
                  value={a.description ?? ""}
                  onChange={(e) => updateAnswer(qIdx, aIdx, { description: e.target.value || undefined })}
                />
              </div>
            ))}

            <button className={styles.ghostBtn} onClick={() => addAnswer(qIdx)}>
              <PlusIcon width={15} height={15} /> {t("onboarding.admin.addAnswerBtn")}
            </button>
          </div>
        </section>
      ))}

      {draft.questions.length < MAX_QUESTIONS ? (
        <button className={styles.addQuestionBtn} onClick={addQuestion}>
          <PlusIcon width={16} height={16} /> {t("onboarding.admin.addQuestionBtn")}
        </button>
      ) : null}

    </div>
  );
}
