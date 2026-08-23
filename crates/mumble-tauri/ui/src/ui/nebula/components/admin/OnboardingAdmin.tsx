import { useEffect, useMemo, useState, type FocusEvent, type ReactNode } from "react";
import { Autocomplete, Box, Button, Chip, IconButton, Switch, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { rootChannelId } from "@core/features/admin/rootChannel";
import { useChannelAcl } from "@core/features/admin/useChannelAcl";
import { isOnboardingSupported, useOnboardingStore } from "@core/features/onboarding/onboardingStore";
import type { OnboardingAnswer, OnboardingConfig, OnboardingQuestion } from "@core/types";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, TrashIcon } from "@ui/icons";
import { Stack, UserAvatar } from "../primitives";
import { Banner, EmptyState } from "../settings/controls";
import { AdminPage } from "./controls";
import { serverTint } from "../../selectors";
import { useServerLivery } from "../../useServerLivery";
import { radius } from "../../tokens";

const MAX_QUESTIONS = 5;

const emptyAnswer = (): OnboardingAnswer => ({
  id: crypto.randomUUID(),
  label: "",
  channel_ids: [],
  group_names: [],
});

const emptyQuestion = (): OnboardingQuestion => ({
  id: crypto.randomUUID(),
  text: "",
  multi_select: false,
  required: false,
  ask_before_join: false,
  answers: [emptyAnswer(), emptyAnswer()],
});

const emptyConfig = (): OnboardingConfig => ({
  version: 1,
  enabled: false,
  default_channel_ids: [],
  questions: [emptyQuestion()],
  revision: 0,
});

type TFn = (key: string, opts?: Record<string, unknown>) => string;

interface Template {
  id: string;
  emoji: string;
  multiSelect: boolean;
  chipKey: string;
  questionKey: string;
  answers: readonly { labelKey: string; emoji: string }[];
}

/**
 * The questions most servers were going to write anyway.
 *
 * Only the wording is seeded: an answer's channels and groups are this
 * server's, so a template that guessed at them would produce a questionnaire
 * that looks configured and places nobody anywhere.
 */
const TEMPLATES: readonly Template[] = [
  {
    id: "gaming",
    emoji: "🎮",
    multiSelect: true,
    chipKey: "onboarding.admin.templates.gaming.chip",
    questionKey: "onboarding.admin.templates.gaming.question",
    answers: [
      { labelKey: "onboarding.admin.templates.gaming.a1", emoji: "🔫" },
      { labelKey: "onboarding.admin.templates.gaming.a2", emoji: "🧙" },
      { labelKey: "onboarding.admin.templates.gaming.a3", emoji: "♟" },
      { labelKey: "onboarding.admin.templates.gaming.a4", emoji: "🏎" },
    ],
  },
  {
    id: "languages",
    emoji: "🌍",
    multiSelect: true,
    chipKey: "onboarding.admin.templates.languages.chip",
    questionKey: "onboarding.admin.templates.languages.question",
    answers: [
      { labelKey: "onboarding.admin.templates.languages.a1", emoji: "🇬🇧" },
      { labelKey: "onboarding.admin.templates.languages.a2", emoji: "🇩🇪" },
      { labelKey: "onboarding.admin.templates.languages.a3", emoji: "🇫🇷" },
      { labelKey: "onboarding.admin.templates.languages.a4", emoji: "🇪🇸" },
    ],
  },
  {
    id: "private",
    emoji: "🔒",
    multiSelect: false,
    chipKey: "onboarding.admin.templates.private.chip",
    questionKey: "onboarding.admin.templates.private.question",
    answers: [
      { labelKey: "onboarding.admin.templates.private.a1", emoji: "👋" },
      { labelKey: "onboarding.admin.templates.private.a2", emoji: "🔑" },
    ],
  },
];

function buildFromTemplate(template: Template, t: TFn): OnboardingQuestion {
  return {
    id: crypto.randomUUID(),
    text: t(template.questionKey),
    multi_select: template.multiSelect,
    required: false,
    ask_before_join: false,
    answers: template.answers.map((answer) => ({
      id: crypto.randomUUID(),
      label: t(answer.labelKey),
      emoji: answer.emoji,
      channel_ids: [],
      group_names: [],
    })),
  };
}

/** One thing an answer places the user into: a channel here, or an ACL group. */
type Mapping =
  | { kind: "channel"; id: number; label: string }
  | { kind: "group"; id: string; label: string };

const groupMapping = (name: string): Mapping => ({ kind: "group", id: `g:${name}`, label: name });

/**
 * The onboarding questionnaire an admin defines and new users answer.
 *
 * Edited as a whole draft and broadcast on save rather than field by field:
 * questions and their answers reference each other, and a half-applied change
 * would put users into channels for an answer that no longer exists.
 *
 * The page is the questionnaire's own shape - a rail of steps in the order a
 * new member meets them, one open at a time, with what that member will
 * actually see rendered beside it. An admin is writing a flow rather than
 * filling in a record, and a flat stack of forms hides both the order and the
 * consequence.
 *
 * Empty questions and answers are stripped on save, so a row left blank while
 * thinking is not published as a question with no text.
 */
export function OnboardingAdmin() {
  const { t } = useTranslation("settings");
  const tFn = t as TFn;
  const remote = useOnboardingStore((state) => state.config);
  const busy = useOnboardingStore((state) => state.busy);
  const error = useOnboardingStore((state) => state.error);
  const saveConfig = useOnboardingStore((state) => state.saveConfig);

  const channels = useAppStore((state) => state.channels);
  const serverFancyVersion = useAppStore((state) => state.serverFancyVersion);
  const supported = isOnboardingSupported(serverFancyVersion);

  // Root-channel groups are this server's roles, so they are what an answer can
  // grant. The picker stays free-text on top of them: a group may be created
  // after the questionnaire that references it.
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  const { acl } = useChannelAcl(supported ? rootId : null);

  const [draft, setDraft] = useState<OnboardingConfig>(() => remote ?? emptyConfig());
  const [openId, setOpenId] = useState<string | null>(() => draft.questions[0]?.id ?? null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Re-seeded when the server pushes a newer revision, so this editor does not
  // publish over another admin's change.
  useEffect(() => {
    if (remote) setDraft(remote);
  }, [remote]);

  // A step cannot stay open once the question behind it is gone - deleted here,
  // or replaced by another admin's revision - so the rail would otherwise show
  // every question collapsed and the preview nothing at all.
  const openQuestion = draft.questions.find((question) => question.id === openId) ?? null;
  useEffect(() => {
    if (openQuestion === null && draft.questions.length > 0) setOpenId(draft.questions[0].id);
  }, [openQuestion, draft.questions]);

  const channelMappings = useMemo<Mapping[]>(
    () => channels.map((channel) => ({ kind: "channel", id: channel.id, label: channel.name })),
    [channels],
  );
  const groupMappings = useMemo<Mapping[]>(
    () => (acl?.groups ?? []).map((group) => groupMapping(group.name)),
    [acl],
  );
  const channelById = useMemo(() => {
    const map = new Map<number, Mapping>();
    for (const mapping of channelMappings) if (mapping.kind === "channel") map.set(mapping.id, mapping);
    return map;
  }, [channelMappings]);

  // A channel that has since been deleted still has an id in the config; it is
  // shown as that id rather than dropped, or saving would quietly discard it.
  const toMappings = (answer: Pick<OnboardingAnswer, "channel_ids" | "group_names">): Mapping[] => [
    ...answer.channel_ids.map(
      (id): Mapping => channelById.get(id) ?? { kind: "channel", id, label: `#${id}` },
    ),
    ...answer.group_names.map(groupMapping),
  ];

  const fromMappings = (picked: readonly Mapping[]) => ({
    channel_ids: picked.filter((entry) => entry.kind === "channel").map((entry) => entry.id),
    group_names: picked.filter((entry) => entry.kind === "group").map((entry) => entry.label),
  });

  const updateQuestion = (id: string, patch: Partial<OnboardingQuestion>) =>
    setDraft((prev) => ({
      ...prev,
      questions: prev.questions.map((question) =>
        question.id === id ? { ...question, ...patch } : question,
      ),
    }));

  const updateAnswer = (questionId: string, answerId: string, patch: Partial<OnboardingAnswer>) =>
    setDraft((prev) => ({
      ...prev,
      questions: prev.questions.map((question) =>
        question.id !== questionId
          ? question
          : {
              ...question,
              answers: question.answers.map((answer) =>
                answer.id === answerId ? { ...answer, ...patch } : answer,
              ),
            },
      ),
    }));

  const addQuestion = (question: OnboardingQuestion) => {
    setDraft((prev) => ({ ...prev, questions: [...prev.questions, question] }));
    setOpenId(question.id);
    setAdvancedOpen(false);
  };

  const save = () => {
    const sanitized: OnboardingConfig = {
      ...draft,
      questions: draft.questions
        .filter((question) => question.text.trim().length > 0)
        .map((question) => ({
          ...question,
          answers: question.answers.filter((answer) => answer.label.trim().length > 0),
        }))
        .filter((question) => question.answers.length > 0),
    };
    saveConfig(sanitized).catch(() => undefined);
  };

  if (!supported) {
    return (
      <AdminPage title={t("onboarding.admin.heading")}>
        <EmptyState>{t("onboarding.admin.unsupportedServer")}</EmptyState>
      </AdminPage>
    );
  }

  const remaining = MAX_QUESTIONS - draft.questions.length;

  return (
    // The preview wraps under the editor rather than disappearing on a narrow
    // window: it is where the consequence of every control on this page is
    // shown, and a hidden one leaves the mapping invisible exactly when the
    // column is too tight to read the chips either.
    <Stack direction="row" gap={5} alignItems="flex-start" flexWrap="wrap" sx={{ maxWidth: 1080 }}>
      <Box sx={{ flex: "1 1 420px", minWidth: 0, maxWidth: 620 }}>
        <AdminPage
          title={t("onboarding.admin.heading")}
          hint={t("onboarding.admin.description")}
          toolbar={
            <>
              <Typography
                sx={(theme) => ({ alignSelf: "center", fontSize: 10.5, color: theme.palette.nebula.dim })}
              >
                {t("onboarding.admin.revShort", { n: draft.revision })}
              </Typography>
              <Switch
                checked={draft.enabled}
                onChange={() => setDraft({ ...draft, enabled: !draft.enabled })}
                slotProps={{ input: { "aria-label": t("onboarding.admin.enabledLabel") } }}
              />
            </>
          }
        >
          {error && <Banner tone="danger">{error}</Banner>}

          <Step marker="→" tone="start">
            <Typography sx={{ pt: "3px", fontSize: 12.5, fontWeight: 600 }}>
              {t("onboarding.admin.startsIn")}
            </Typography>
            <Box sx={{ mt: "8px" }}>
              <MappingPicker
                ariaLabel={t("onboarding.admin.startsIn")}
                placeholder={t("onboarding.admin.startsInPlaceholder")}
                options={channelMappings}
                value={toMappings({ channel_ids: draft.default_channel_ids, group_names: [] })}
                groups={false}
                onChange={(picked) =>
                  setDraft({ ...draft, default_channel_ids: fromMappings(picked).channel_ids })
                }
              />
            </Box>
          </Step>

          {draft.questions.map((question, index) =>
            question.id === openId ? (
              <Step key={question.id} marker={String(index + 1)} tone="open">
                <QuestionCard
                  question={question}
                  t={tFn}
                  canDelete={draft.questions.length > 1}
                  advancedOpen={advancedOpen}
                  onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
                  options={[...channelMappings, ...groupMappings]}
                  mappingsOf={toMappings}
                  onDelete={() =>
                    setDraft((prev) => ({
                      ...prev,
                      questions: prev.questions.filter((entry) => entry.id !== question.id),
                    }))
                  }
                  onChange={(patch) => updateQuestion(question.id, patch)}
                  onChangeAnswer={(answerId, patch) => updateAnswer(question.id, answerId, patch)}
                  onChangeMapping={(answerId, picked) =>
                    updateAnswer(question.id, answerId, fromMappings(picked))
                  }
                />
              </Step>
            ) : (
              <Step key={question.id} marker={String(index + 1)} tone="idle">
                <CollapsedQuestion
                  question={question}
                  t={tFn}
                  onOpen={() => {
                    setOpenId(question.id);
                    setAdvancedOpen(false);
                  }}
                />
              </Step>
            ),
          )}

          <Step marker="+" tone="add" last>
            <Stack direction="row" alignItems="center" gap={1.25} flexWrap="wrap">
              <Box
                component="button"
                disabled={remaining <= 0}
                onClick={() => addQuestion(emptyQuestion())}
                sx={(theme) => ({
                  all: "unset",
                  cursor: remaining > 0 ? "pointer" : "not-allowed",
                  fontSize: 12,
                  fontWeight: 500,
                  color: remaining > 0 ? theme.palette.nebula.muted : theme.palette.nebula.dim,
                  "&:hover": { color: remaining > 0 ? theme.palette.nebula.text : undefined },
                })}
              >
                {t("onboarding.admin.addQuestionBtn")}
              </Box>
              <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
                {t("onboarding.admin.questionsLeft", { n: Math.max(remaining, 0), max: MAX_QUESTIONS })} ·{" "}
                {t("onboarding.admin.templateIntro")}
              </Typography>
            </Stack>
            <Stack direction="row" gap={0.875} flexWrap="wrap" sx={{ mt: "9px" }}>
              {TEMPLATES.map((template) => (
                <Box
                  key={template.id}
                  component="button"
                  disabled={remaining <= 0}
                  onClick={() => addQuestion(buildFromTemplate(template, tFn))}
                  sx={(theme) => ({
                    all: "unset",
                    cursor: remaining > 0 ? "pointer" : "not-allowed",
                    px: "12px",
                    py: "6px",
                    borderRadius: radius("md"),
                    fontSize: 11,
                    opacity: remaining > 0 ? 1 : 0.5,
                    background: theme.palette.nebula.card,
                    border: `1px solid ${theme.palette.nebula.line}`,
                    "&:hover": {
                      borderColor: remaining > 0 ? theme.palette.nebula.accentLine : undefined,
                    },
                  })}
                >
                  {template.emoji} {tFn(template.chipKey)}
                </Box>
              ))}
            </Stack>
          </Step>

          <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "26px" }} flexWrap="wrap">
            <Button variant="contained" disabled={busy} onClick={save}>
              {busy ? t("onboarding.admin.savingBtn") : t("onboarding.admin.saveBroadcastBtn")}
            </Button>
            <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
              {t("onboarding.admin.broadcastHint")}
            </Typography>
          </Stack>
        </AdminPage>
      </Box>

      <Box sx={{ flex: "1 1 260px", maxWidth: 300, position: "sticky", top: 0 }}>
        <MemberPreview
          question={openQuestion}
          index={draft.questions.findIndex((entry) => entry.id === openId)}
          total={draft.questions.length}
          mappingsOf={toMappings}
          t={tFn}
        />
      </Box>
    </Stack>
  );
}

type StepTone = "start" | "open" | "idle" | "add";

/**
 * One stop on the rail, with the line that carries the eye to the next.
 *
 * The marker's four tones are the four things a step can be - where everyone
 * begins, the question being edited, a question waiting its turn, and the empty
 * slot at the end - so the rail alone says how far the questionnaire runs and
 * which part of it is open.
 */
function Step({
  marker,
  tone,
  last,
  children,
}: Readonly<{ marker: string; tone: StepTone; last?: boolean; children: ReactNode }>) {
  return (
    <Stack direction="row" gap={1.75}>
      <Stack sx={{ width: 26, flex: "none", alignItems: "center" }}>
        <Box
          aria-hidden
          sx={(theme) => {
            const { nebula } = theme.palette;
            const base = {
              flex: "none",
              width: 24,
              height: 24,
              display: "grid",
              placeItems: "center",
              borderRadius: "50%",
              fontSize: 11,
              fontWeight: 600,
            } as const;
            if (tone === "open") return { ...base, background: nebula.accent, color: "#fff" };
            if (tone === "start")
              return {
                ...base,
                // The arrow is a glyph rather than a digit and reads a size
                // smaller than the numbers beside it at the same point size.
                fontSize: 13,
                background: nebula.accentSoft,
                border: `1px solid ${nebula.accentLine}`,
                color: nebula.accent,
              };
            if (tone === "add")
              return {
                ...base,
                border: `1.5px dashed ${nebula.line2}`,
                color: nebula.dim,
                fontSize: 12,
              };
            return {
              ...base,
              background: nebula.card2,
              border: `1px solid ${nebula.line2}`,
              color: nebula.muted,
            };
          }}
        >
          {marker}
        </Box>
        {!last && (
          <Box sx={(theme) => ({ width: "1.5px", flex: 1, my: "4px", background: theme.palette.nebula.line2 })} />
        )}
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0, pb: last ? 0 : "18px" }}>{children}</Box>
    </Stack>
  );
}

/** A question the admin is not editing: what it asks and how it behaves. */
function CollapsedQuestion({
  question,
  t,
  onOpen,
}: Readonly<{ question: OnboardingQuestion; t: TFn; onOpen: () => void }>) {
  return (
    <Box
      component="button"
      onClick={onOpen}
      sx={(theme) => ({
        // `all: unset` is what makes a <button> stop looking like one, and it
        // takes the layout with it - so everything positional is restated
        // after it rather than handed to a Stack that it would erase.
        all: "unset",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        boxSizing: "border-box",
        cursor: "pointer",
        width: "100%",
        px: "14px",
        py: "11px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
        "&:hover": { borderColor: theme.palette.nebula.line2 },
      })}
    >
      <Typography sx={{ fontSize: 12.5, fontWeight: 500, minWidth: 0 }} noWrap>
        {question.text || t("onboarding.admin.untitledQuestion")}
      </Typography>
      <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })} noWrap>
        {t("onboarding.admin.answerCount", { count: question.answers.length })} ·{" "}
        {summaryOf(question, t)}
      </Typography>
      <Box sx={(theme) => ({ ml: "auto", flex: "none", display: "flex", color: theme.palette.nebula.dim })}>
        <ChevronDownIcon width={12} height={12} />
      </Box>
    </Box>
  );
}

function summaryOf(question: OnboardingQuestion, t: TFn): string {
  const choice = question.multi_select
    ? t("onboarding.admin.summaryMulti")
    : t("onboarding.admin.summarySingle");
  const need = question.required
    ? t("onboarding.admin.summaryRequired")
    : t("onboarding.admin.summaryOptional");
  return `${choice} · ${need}`;
}

/** The question being edited: its prompt, its answers, and its behaviour. */
function QuestionCard({
  question,
  t,
  canDelete,
  advancedOpen,
  onToggleAdvanced,
  options,
  mappingsOf,
  onDelete,
  onChange,
  onChangeAnswer,
  onChangeMapping,
}: Readonly<{
  question: OnboardingQuestion;
  t: TFn;
  canDelete: boolean;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  options: readonly Mapping[];
  mappingsOf: (answer: OnboardingAnswer) => Mapping[];
  onDelete: () => void;
  onChange: (patch: Partial<OnboardingQuestion>) => void;
  onChangeAnswer: (answerId: string, patch: Partial<OnboardingAnswer>) => void;
  onChangeMapping: (answerId: string, picked: readonly Mapping[]) => void;
}>) {
  return (
    <Box
      sx={(theme) => ({
        p: "14px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      <Stack direction="row" alignItems="center" gap={1}>
        <TextField
          fullWidth
          size="small"
          variant="standard"
          value={question.text}
          placeholder={t("onboarding.admin.promptPlaceholder")}
          onChange={(event) => onChange({ text: event.target.value })}
          slotProps={{
            input: { disableUnderline: true },
            htmlInput: { "aria-label": t("onboarding.admin.promptLabel") },
          }}
          sx={(theme) => ({
            flex: 1,
            "& .MuiInputBase-root": {
              px: "12px",
              py: "8px",
              borderRadius: radius("md"),
              background: theme.palette.nebula.card2,
              fontSize: 12.5,
              fontWeight: 500,
            },
          })}
        />
        <IconButton
          size="small"
          disabled={!canDelete}
          title={t("onboarding.admin.deleteBtn")}
          aria-label={t("onboarding.admin.deleteBtn")}
          onClick={onDelete}
        >
          <TrashIcon width={13} height={13} />
        </IconButton>
      </Stack>

      <Stack gap={0.75} sx={{ mt: "10px" }}>
        {question.answers.map((answer) => (
          <AnswerRow
            key={answer.id}
            answer={answer}
            t={t}
            canDelete={question.answers.length > 1}
            options={options}
            mappings={mappingsOf(answer)}
            onChange={(patch) => onChangeAnswer(answer.id, patch)}
            onChangeMapping={(picked) => onChangeMapping(answer.id, picked)}
            onDelete={() =>
              onChange({ answers: question.answers.filter((entry) => entry.id !== answer.id) })
            }
          />
        ))}

        <Box
          component="button"
          onClick={() => onChange({ answers: [...question.answers, emptyAnswer()] })}
          sx={(theme) => ({
            all: "unset",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxSizing: "border-box",
            cursor: "pointer",
            width: "100%",
            px: "10px",
            py: "7px",
            borderRadius: radius("md"),
            border: `1.5px dashed ${theme.palette.nebula.line2}`,
            fontSize: 11.5,
            color: theme.palette.nebula.dim,
            "&:hover": { color: theme.palette.nebula.muted },
          })}
        >
          {t("onboarding.admin.addAnswerBtn")}
          <Box component="span" sx={{ ml: "auto", fontSize: 10.5 }}>
            {t("onboarding.admin.mappingHint")}
          </Box>
        </Box>
      </Stack>

      <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "11px" }}>
        <Box
          component="button"
          aria-expanded={advancedOpen}
          onClick={onToggleAdvanced}
          sx={(theme) => ({
            all: "unset",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            cursor: "pointer",
            fontSize: 11.5,
            fontWeight: 500,
            color: advancedOpen ? theme.palette.nebula.text : theme.palette.nebula.muted,
          })}
        >
          <Box
            component="span"
            sx={{
              display: "flex",
              transform: advancedOpen ? "rotate(90deg)" : "none",
              transition: "transform 120ms",
            }}
          >
            <ChevronRightIcon width={9} height={9} />
          </Box>
          {t("onboarding.admin.advanced")}
        </Box>
        <Typography sx={(theme) => ({ ml: "auto", fontSize: 10.5, color: theme.palette.nebula.dim })}>
          {summaryOf(question, t)}
        </Typography>
      </Stack>

      {advancedOpen && (
        <Stack
          direction="row"
          gap={2}
          flexWrap="wrap"
          sx={(theme) => ({
            mt: "10px",
            px: "12px",
            py: "6px",
            borderRadius: radius("md"),
            background: theme.palette.nebula.panel,
            border: `1px solid ${theme.palette.nebula.line}`,
          })}
        >
          <CompactSwitch
            label={t("onboarding.admin.multiSelectLabel")}
            checked={question.multi_select}
            onChange={() => onChange({ multi_select: !question.multi_select })}
          />
          <CompactSwitch
            label={t("onboarding.admin.requiredLabel")}
            checked={question.required}
            onChange={() => onChange({ required: !question.required })}
          />
          <CompactSwitch
            label={t("onboarding.admin.askBeforeJoinLabel")}
            checked={question.ask_before_join}
            onChange={() => onChange({ ask_before_join: !question.ask_before_join })}
          />
        </Stack>
      )}
    </Box>
  );
}

function CompactSwitch({
  label,
  checked,
  onChange,
}: Readonly<{ label: string; checked: boolean; onChange: () => void }>) {
  return (
    <Stack direction="row" alignItems="center" gap={0.875}>
      <Switch
        size="small"
        checked={checked}
        onChange={onChange}
        slotProps={{ input: { "aria-label": label } }}
      />
      <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
        {label}
      </Typography>
    </Stack>
  );
}

/**
 * One answer: what it says, and where picking it puts you.
 *
 * The note under the label is the description new members read beside the
 * answer. It is revealed by working in the row rather than kept open, because
 * most answers do not need one and a permanently empty second line turns a list
 * of five answers into a wall.
 */
function AnswerRow({
  answer,
  t,
  canDelete,
  options,
  mappings,
  onChange,
  onChangeMapping,
  onDelete,
}: Readonly<{
  answer: OnboardingAnswer;
  t: TFn;
  canDelete: boolean;
  options: readonly Mapping[];
  mappings: Mapping[];
  onChange: (patch: Partial<OnboardingAnswer>) => void;
  onChangeMapping: (picked: readonly Mapping[]) => void;
  onDelete: () => void;
}>) {
  const [active, setActive] = useState(false);
  const showNote = active || Boolean(answer.description);

  return (
    <Box
      onFocus={() => setActive(true)}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
      }}
      sx={(theme) => ({
        px: "10px",
        py: "7px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.panel,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Stack direction="row" alignItems="center" gap={1}>
        <TextField
          size="small"
          variant="standard"
          value={answer.emoji ?? ""}
          placeholder="🙂"
          onChange={(event) => onChange({ emoji: event.target.value || undefined })}
          slotProps={{
            input: { disableUnderline: true },
            htmlInput: { maxLength: 4, "aria-label": t("onboarding.admin.emojiLabel") },
          }}
          sx={{ flex: "none", width: 30, "& input": { fontSize: 13, textAlign: "center", p: 0 } }}
        />
        <TextField
          size="small"
          variant="standard"
          value={answer.label}
          placeholder={t("onboarding.admin.answerLabelField")}
          onChange={(event) => onChange({ label: event.target.value })}
          slotProps={{
            input: { disableUnderline: true },
            htmlInput: { "aria-label": t("onboarding.admin.answerLabelField") },
          }}
          sx={{ flex: "0 1 150px", "& input": { fontSize: 12, fontWeight: 500, p: 0 } }}
        />
        <Box sx={{ flex: "0 1 auto", minWidth: 0, ml: "auto" }}>
          <MappingPicker
            ariaLabel={t("onboarding.admin.mappingLabel", { answer: answer.label })}
            placeholder={t("onboarding.admin.mappingPlaceholder")}
            options={options}
            value={mappings}
            onChange={onChangeMapping}
            dense
          />
        </Box>
        <IconButton
          size="small"
          disabled={!canDelete}
          title={t("onboarding.admin.deleteBtn")}
          aria-label={t("onboarding.admin.deleteBtn")}
          onClick={onDelete}
          sx={{ flex: "none" }}
        >
          <CloseIcon width={11} height={11} />
        </IconButton>
      </Stack>

      {showNote && (
        <TextField
          fullWidth
          size="small"
          variant="standard"
          value={answer.description ?? ""}
          placeholder={t("onboarding.admin.notePlaceholder")}
          onChange={(event) => onChange({ description: event.target.value || undefined })}
          slotProps={{
            input: { disableUnderline: true },
            htmlInput: { "aria-label": t("onboarding.admin.descriptionLabel") },
          }}
          sx={(theme) => ({
            mt: "2px",
            pl: "38px",
            "& input": { fontSize: 11, p: 0, color: theme.palette.nebula.muted },
          })}
        />
      )}
    </Box>
  );
}

/**
 * Channels and groups an answer grants, picked as one list.
 *
 * They are two different things to the server and one decision to the admin -
 * "where does this answer put someone" - so they share a picker, tinted apart
 * by their chips. Free text creates a group: the questionnaire is often written
 * before the roles it hands out exist.
 */
function MappingPicker({
  ariaLabel,
  placeholder,
  options,
  value,
  onChange,
  dense,
  groups = true,
}: Readonly<{
  ariaLabel: string;
  placeholder: string;
  options: readonly Mapping[];
  value: Mapping[];
  onChange: (picked: readonly Mapping[]) => void;
  dense?: boolean;
  /**
   * Whether typing a name that is not on the list creates a group. Off where
   * only channels mean anything, so a typed word is refused rather than
   * accepted into a list that then drops it on the next change.
   */
  groups?: boolean;
}>) {
  return (
    <Autocomplete
      multiple
      freeSolo={groups}
      size="small"
      options={options as Mapping[]}
      value={value}
      disableClearable
      isOptionEqualToValue={(option, selected) =>
        typeof selected !== "string" && option.kind === selected.kind && option.id === selected.id
      }
      getOptionLabel={(option) =>
        typeof option === "string" ? option : `${option.kind === "channel" ? "# " : ""}${option.label}`
      }
      onChange={(_, picked) =>
        onChange(
          picked.map((entry) => (typeof entry === "string" ? groupMapping(entry.trim()) : entry)),
        )
      }
      renderValue={(selected, getItemProps) =>
        selected.map((option, index) => {
          const mapping = typeof option === "string" ? groupMapping(option) : option;
          return (
            <Chip
              size="small"
              label={mapping.kind === "channel" ? `# ${mapping.label}` : mapping.label}
              color={mapping.kind === "channel" ? "primary" : "default"}
              variant={mapping.kind === "channel" ? "outlined" : "filled"}
              {...getItemProps({ index })}
              key={mapping.id}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          placeholder={value.length > 0 ? "" : placeholder}
          slotProps={{
            ...params.slotProps,
            input: { ...params.slotProps.input, disableUnderline: true },
            // The label has to reach the `input` itself: on the field it names
            // the wrapper, and the box a screen reader lands in stays unnamed.
            htmlInput: { ...params.slotProps.htmlInput, "aria-label": ariaLabel },
          }}
          sx={(theme) => ({
            "& .MuiInputBase-root": {
              px: dense ? "6px" : "12px",
              py: dense ? "2px" : "8px",
              borderRadius: radius("md"),
              fontSize: dense ? 11 : 12,
              background: dense ? "transparent" : theme.palette.nebula.card,
              border: dense ? "none" : `1px solid ${theme.palette.nebula.line2}`,
            },
          })}
        />
      )}
    />
  );
}

/**
 * The questionnaire from the other side.
 *
 * Every control on this page decides something a new member sees once, on their
 * way in, and never again - so the card that shows it is the page's second
 * column rather than a preview button. The line under it spells out the
 * consequence of the first answer, which is the part that is otherwise invisible
 * until someone has already been placed somewhere.
 */
function MemberPreview({
  question,
  index,
  total,
  mappingsOf,
  t,
}: Readonly<{
  question: OnboardingQuestion | null;
  index: number;
  total: number;
  mappingsOf: (answer: OnboardingAnswer) => Mapping[];
  t: TFn;
}>) {
  const livery = useServerLivery();
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const active = sessions.find((session) => session.id === activeServerId);
  const serverName = livery?.displayName || active?.label || active?.host || t("onboarding.admin.thisServer");
  const first = question?.answers[0] ?? null;
  const firstMappings = first ? mappingsOf(first) : [];

  return (
    <>
      <Typography
        sx={(theme) => ({
          mb: "10px",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: ".08em",
          color: theme.palette.nebula.dim,
        })}
      >
        {t("onboarding.admin.previewTitle")}
      </Typography>
      <Box
        sx={(theme) => ({
          p: "18px",
          borderRadius: radius("xl"),
          border: `1px solid ${theme.palette.nebula.line2}`,
          background: `${theme.palette.nebula.tint},${theme.palette.nebula.bg0}`,
          boxShadow: theme.palette.nebula.shadow,
          backdropFilter: "blur(16px)",
        })}
      >
        <Stack direction="row" alignItems="center" gap={1.125}>
          <UserAvatar
            name={serverName}
            size={30}
            square
            src={livery?.iconSrc ?? null}
            gradient={serverTint(active ? `${active.host}:${active.port}` : serverName)}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
              {t("onboarding.admin.previewWelcome", { server: serverName })}
            </Typography>
            <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
              {t("onboarding.admin.previewStep", { n: Math.max(index + 1, 1), m: Math.max(total, 1) })}
            </Typography>
          </Box>
        </Stack>

        <Typography sx={{ mt: "14px", fontSize: 13, fontWeight: 600 }}>
          {question?.text || t("onboarding.admin.untitledQuestion")}
        </Typography>

        <Stack gap={0.75} sx={{ mt: "10px" }}>
          {(question?.answers ?? []).map((answer, position) => {
            const picked = position === 0;
            return (
              <Stack
                key={answer.id}
                direction="row"
                alignItems="center"
                gap={1.125}
                sx={(theme) => ({
                  px: "11px",
                  py: "9px",
                  borderRadius: radius("md"),
                  fontSize: 12,
                  fontWeight: picked ? 500 : 400,
                  color: picked ? theme.palette.nebula.text : theme.palette.nebula.muted,
                  background: picked ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
                  border: `1px solid ${picked ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
                })}
              >
                <Box component="span" sx={{ minWidth: 0 }}>
                  {answer.emoji ? `${answer.emoji} ` : ""}
                  {answer.label || t("onboarding.admin.answerLabelField")}
                </Box>
                <Box
                  aria-hidden
                  sx={(theme) => ({
                    ml: "auto",
                    flex: "none",
                    width: 14,
                    height: 14,
                    borderRadius: question?.multi_select ? radius("sm") : "50%",
                    border: picked
                      ? `4.5px solid ${theme.palette.nebula.accent}`
                      : `1.5px solid ${theme.palette.nebula.line2}`,
                  })}
                />
              </Stack>
            );
          })}
        </Stack>

        <Stack direction="row" alignItems="center" sx={{ mt: "16px" }}>
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
            {question?.required ? t("onboarding.modal.required") : t("onboarding.modal.skipBtn")}
          </Typography>
          <Box
            sx={(theme) => ({
              ml: "auto",
              px: "16px",
              py: "7px",
              borderRadius: radius("md"),
              background: theme.palette.nebula.accent,
              color: "#fff",
              fontSize: 11.5,
              fontWeight: 600,
            })}
          >
            {index + 1 < total ? t("onboarding.modal.nextBtn") : t("onboarding.modal.finishBtn")}
          </Box>
        </Stack>
      </Box>

      <Typography
        sx={(theme) => ({
          mt: "8px",
          fontSize: 10.5,
          lineHeight: 1.5,
          textAlign: "center",
          color: theme.palette.nebula.dim,
        })}
      >
        {first && first.label && firstMappings.length > 0
          ? t("onboarding.admin.previewMapping", {
              answer: first.label,
              targets: firstMappings
                .map((mapping) => (mapping.kind === "channel" ? `# ${mapping.label}` : mapping.label))
                .join(", "),
            })
          : t("onboarding.admin.previewNoMapping")}
      </Typography>
    </>
  );
}
