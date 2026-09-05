import { createContext, useContext } from "react";
import { Box, Typography } from "@mui/material";
import type { OnboardingAnswer, OnboardingQuestion } from "@core/types";
import { Stack } from "../../primitives";
import {
  PillMenu,
  PlainInput,
  targetsOf,
  SectionLabel,
  TagChip,
  ToggleRow,
  type BlockDef,
  type NodeBodyProps,
  type NodeSpec,
  type PortId,
  type PortInfo,
  type PortSide,
  type PortSummary,
  type Tone,
} from "../nodes";
import { MemberPreview } from "./MemberPreview";
import { type Mapping, type TFn } from "./mapping";
import {
  MAX_QUESTIONS,
  answersOf,
  grantedBy,
  grantsOf,
  makeNode,
  onboardingWiring,
  problemsOf,
  questionsOf,
  type NodeOf,
  type OnboardingGraph,
  type OnboardingKind,
  type OnboardingNode,
} from "./model";

/**
 * The onboarding dialect of the node editor.
 *
 * The questionnaire drawn rather than listed: everyone starts somewhere, a
 * question follows, each of its answers is its own node, and the channels and
 * groups an answer grants are nodes that several answers can point at. What
 * that buys over the rail of steps is the two things a list cannot show - the
 * order of the flow, and that three different answers all put somebody in
 * #Lounge.
 *
 * Everything here is *this* dialect. The canvas, the wiring, the dragging and
 * the chrome are the same components the welcome-message editor draws itself
 * with; what differs is on this page: the kinds, their bodies, and the
 * `OnboardingConfig` the drawing compiles to.
 */

/**
 * What the bodies need and the graph does not carry.
 *
 * Through context rather than closed over by the spec, so the components stay
 * the same objects between renders: a body that was rebuilt on every keystroke
 * would drop focus out of the field being typed into.
 */
export interface OnboardingCanvasContext {
  readonly t: TFn;
  /** The server's channels, for the channel node's picker. */
  readonly channels: readonly { id: number; name: string }[];
}

const Ambient = createContext<OnboardingCanvasContext>({ t: (key) => key, channels: [] });
export const OnboardingCanvasProvider = Ambient.Provider;

const useAmbient = () => useContext(Ambient);

/** The dialect's own corner of the settings bundle. */
const key = (suffix: string) => `onboarding.admin.canvas.${suffix}`;

const TONES: Record<OnboardingKind, Tone> = {
  start: "accent",
  question: "accent",
  answer: "muted",
  channel: "ok",
  group: "warn",
};

const WIDTHS: Record<OnboardingKind, number> = {
  start: 216,
  question: 300,
  answer: 230,
  channel: 200,
  group: 200,
};

/**
 * Where each port sits, against the row it names.
 *
 * The numbers are the body's own rows: a caption is 14px, the gap between rows
 * is 8, and a node's body starts 39px below its top. A port that drifted off
 * its row would leave the operator guessing which wire they are about to
 * replace.
 */
function portTop(node: OnboardingNode, port: PortId, _index: number, _side: PortSide): number | string {
  switch (node.kind) {
    case "start":
      return port === "then" ? 44 : 74;
    case "question":
      // `flow` in and `then` out are the spine, level with the prompt; `picks`
      // is level with the answers it fans out to.
      return port === "picks" ? 128 : 44;
    case "answer":
      return port === "from" ? 44 : 96;
    default:
      return "50%";
  }
}

/**
 * What each socket carries, and the word drawn beside it.
 *
 * Three types, and they are what this dialect is about: the **flow** is the
 * spine the interview runs along, a **choice** is one answer branching off a
 * question, and a **place** is somewhere an answer puts the member. Each reads
 * in its own colour on the socket, on the word beside it and on the wire, so a
 * canvas can be followed without tracing any single strand.
 *
 * The ports are named on both sides here, unlike the welcome dialect's, so the
 * label is the port's own name throughout: `then` leaving a question and
 * `flow` arriving at the next one are two ends of one step, and calling them
 * both "FLOW" would lose which end you were looking at.
 */
function portInfo(_node: OnboardingNode, port: PortId): PortInfo {
  const label = port.toUpperCase();
  if (port === "flow" || port === "then") return { label, type: "flow", tone: "accent" };
  if (port === "in" || port === "place" || port === "grants") return { label, type: "place", tone: "ok" };
  return { label, type: "choice", tone: "muted" };
}

/* -- Bodies ---------------------------------------------------------------- */

function OnboardingBody({ node, graph, onPatch }: NodeBodyProps<OnboardingNode>) {
  switch (node.kind) {
    case "start":
      return <StartBody node={node} graph={graph} />;
    case "question":
      return <QuestionBody node={node} graph={graph} onPatch={onPatch} />;
    case "answer":
      return <AnswerBody node={node} graph={graph} onPatch={onPatch} />;
    case "channel":
      return <ChannelBody node={node} onPatch={onPatch} />;
    case "group":
      return <GroupBody node={node} onPatch={onPatch} />;
  }
}

function StartBody({ node, graph }: Readonly<{ node: OnboardingNode; graph: OnboardingGraph }>) {
  const { t, channels } = useAmbient();
  const landing = targetsOf(graph, node.id, "place").filter(
    (target): target is NodeOf<"channel"> => target.kind === "channel",
  );

  return (
    <Stack gap={1}>
      <SectionLabel>{t(key("thenAsk"))}</SectionLabel>
      <SectionLabel>{t(key("landsIn"))}</SectionLabel>
      <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap", minHeight: 20 }}>
        {landing.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {t("onboarding.admin.startsInPlaceholder")}
          </Typography>
        )}
        {landing.map((channel) => (
          <TagChip
            key={channel.id}
            tone="ok"
            label={`# ${channels.find((entry) => entry.id === channel.channelId)?.name ?? channel.channelId}`}
          />
        ))}
      </Stack>
    </Stack>
  );
}

function QuestionBody({
  node,
  graph,
  onPatch,
}: Readonly<{
  node: NodeOf<"question">;
  graph: OnboardingGraph;
  onPatch: (patch: Partial<OnboardingNode>) => void;
}>) {
  const { t } = useAmbient();
  const answers = answersOf(graph, node.id);

  return (
    <Stack gap={1}>
      <SectionLabel>{t(key("asks"))}</SectionLabel>
      <PlainInput
        value={node.text}
        multiline
        ariaLabel={t("onboarding.admin.promptLabel")}
        placeholder={t("onboarding.admin.promptPlaceholder")}
        onChange={(text) => onPatch({ text })}
      />
      <SectionLabel>{t(key("answers"))}</SectionLabel>
      <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap", minHeight: 20 }}>
        {answers.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {t(key("wireAnswers"))}
          </Typography>
        )}
        {answers.map((answer) => (
          <TagChip key={answer.id} label={answer.label || t("onboarding.admin.answerLabelField")} />
        ))}
      </Stack>
      <Stack gap={0.5}>
        <ToggleRow
          checked={node.multiSelect}
          label={t("onboarding.admin.multiSelectLabel")}
          onChange={() => onPatch({ multiSelect: !node.multiSelect })}
        />
        <ToggleRow
          checked={node.required}
          label={t("onboarding.admin.requiredLabel")}
          onChange={() => onPatch({ required: !node.required })}
        />
        <ToggleRow
          checked={node.askBeforeJoin}
          label={t("onboarding.admin.askBeforeJoinLabel")}
          onChange={() => onPatch({ askBeforeJoin: !node.askBeforeJoin })}
        />
      </Stack>
    </Stack>
  );
}

function AnswerBody({
  node,
  graph,
  onPatch,
}: Readonly<{
  node: NodeOf<"answer">;
  graph: OnboardingGraph;
  onPatch: (patch: Partial<OnboardingNode>) => void;
}>) {
  const { t, channels } = useAmbient();
  const grants = grantsOf(graph, node.id);

  return (
    <Stack gap={0.75}>
      <Stack direction="row" alignItems="center" gap={0.75}>
        <Box sx={{ flex: "none", width: 22 }}>
          <PlainInput
            value={node.emoji}
            placeholder="🙂"
            align="center"
            maxLength={4}
            ariaLabel={t("onboarding.admin.emojiLabel")}
            onChange={(emoji) => onPatch({ emoji })}
          />
        </Box>
        <PlainInput
          value={node.label}
          ariaLabel={t("onboarding.admin.answerLabelField")}
          placeholder={t("onboarding.admin.answerLabelField")}
          onChange={(label) => onPatch({ label })}
        />
      </Stack>
      <PlainInput
        value={node.note}
        ariaLabel={t("onboarding.admin.descriptionLabel")}
        placeholder={t(key("note"))}
        onChange={(note) => onPatch({ note })}
      />
      <SectionLabel>{t(key("grants"))}</SectionLabel>
      <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap", minHeight: 20 }}>
        {grants.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {t(key("wireGrants"))}
          </Typography>
        )}
        {grants.map((grant) => (
          <TagChip
            key={grant.id}
            tone={grant.kind === "channel" ? "ok" : "warn"}
            label={
              grant.kind === "channel"
                ? `# ${channels.find((entry) => entry.id === grant.channelId)?.name ?? grant.channelId}`
                : grant.kind === "group"
                  ? grant.name || t(key("unnamedGroup"))
                  : ""
            }
          />
        ))}
      </Stack>
    </Stack>
  );
}

function ChannelBody({
  node,
  onPatch,
}: Readonly<{ node: NodeOf<"channel">; onPatch: (patch: Partial<OnboardingNode>) => void }>) {
  const { t, channels } = useAmbient();
  return (
    <PillMenu
      value={node.channelId === null ? null : String(node.channelId)}
      placeholder={t(key("pickChannel"))}
      ariaLabel={t(key("pickChannel"))}
      options={channels.map((channel) => ({ id: String(channel.id), label: `# ${channel.name}` }))}
      onChange={(id) => onPatch({ channelId: Number(id) })}
    />
  );
}

function GroupBody({
  node,
  onPatch,
}: Readonly<{ node: NodeOf<"group">; onPatch: (patch: Partial<OnboardingNode>) => void }>) {
  const { t } = useAmbient();
  return (
    <PlainInput
      value={node.name}
      ariaLabel={t(key("groupName"))}
      placeholder={t(key("groupName"))}
      onChange={(name) => onPatch({ name })}
    />
  );
}

/* -- The preview under a question ------------------------------------------- */

/**
 * What a new member sees, hung under the question that asks it.
 *
 * A property of *that* node rather than of the page, exactly as the greeting's
 * preview is: a flow with four questions in it needs four previews, and one
 * floating panel would have to pick a winner and then explain which question it
 * was showing.
 */
function QuestionPreview({ node, graph }: Readonly<{ node: OnboardingNode; graph: OnboardingGraph }>) {
  const { t, channels } = useAmbient();
  if (node.kind !== "question") return null;

  const flow = questionsOf(graph);
  const index = flow.findIndex((entry) => entry.id === node.id);
  const answers = answersOf(graph, node.id);
  const question: OnboardingQuestion = {
    id: node.id,
    text: node.text,
    multi_select: node.multiSelect,
    required: node.required,
    ask_before_join: node.askBeforeJoin,
    answers: answers.map((answer) => ({
      id: answer.id,
      label: answer.label,
      emoji: answer.emoji || undefined,
      description: answer.note || undefined,
      channel_ids: [],
      group_names: [],
    })),
  };

  // The preview asks what an answer grants by id, so the mapping is read off
  // the wires rather than off the config the canvas has not compiled yet.
  const mappingsOf = (answer: OnboardingAnswer): Mapping[] =>
    grantsOf(graph, answer.id).map((grant) =>
      grant.kind === "channel"
        ? {
            kind: "channel",
            id: grant.channelId ?? -1,
            label: channels.find((entry) => entry.id === grant.channelId)?.name ?? String(grant.channelId),
          }
        : { kind: "group", id: grant.id, label: grant.kind === "group" ? grant.name : "" },
    );

  return (
    <Box sx={{ mt: "16px" }}>
      <MemberPreview
        question={question}
        index={Math.max(index, 0)}
        total={Math.max(flow.length, 1)}
        mappingsOf={mappingsOf}
        t={t}
        heading={false}
      />
    </Box>
  );
}

/* -- The dialect ------------------------------------------------------------ */

/**
 * The onboarding editor's spec.
 *
 * Rebuilt whenever the translation function changes, which is cheap: the
 * components it names are module-level, so a new spec object re-renders the
 * canvas without remounting anything an admin might be typing into.
 */
export function onboardingSpec(t: TFn): NodeSpec<OnboardingNode> {
  return {
    ...onboardingWiring,
    id: "onboarding",
    blocks: blocksOf(t),
    label: (node) => t(key(`nodes.${node.kind}`)).toUpperCase(),
    width: (node) => WIDTHS[node.kind],
    tone: (node) => TONES[node.kind],
    portTop,
    portInfo,
    body: OnboardingBody,
    attachment: QuestionPreview,
    emphasise: (node) => node.kind === "start",
    badge: (graph, node) => {
      if (node.kind === "question") {
        const step = questionsOf(graph).findIndex((entry) => entry.id === node.id);
        return step < 0 ? t(key("offFlowBadge")) : `#${step + 1}`;
      }
      if (node.kind === "channel" || node.kind === "group") {
        const uses = grantedBy(graph, node.id);
        return uses > 1 ? `${uses}×` : null;
      }
      return null;
    },
    // An orphan is the one mistake this canvas can make silently: a question
    // nobody wired into the flow, or an answer that belongs to no question,
    // looks finished and is never shown to anybody.
    warnPort: (graph, node, port, side) => {
      if (side !== "in") return null;
      if (port !== "flow" && port !== "from") return null;
      const wired = graph.edges.some((edge) => edge.to === node.id && edge.port === port);
      return wired ? null : t(key(port === "flow" ? "offFlowHint" : "looseAnswerHint"));
    },
    status: (graph) => {
      const problems = problemsOf(graph).map((problem) =>
        t(key(`problems.${problem.code}`), {
          max: "max" in problem ? problem.max : MAX_QUESTIONS,
          where: "where" in problem ? problem.where : "",
        }),
      );
      return { complete: problems.length === 0, problems };
    },
    // A questionnaire with nothing on the flow is drawn but asks nobody
    // anything, which the badge says rather than claiming to be live.
    liveness: (graph) => (questionsOf(graph).length === 0 ? "idle" : "live"),
    strings: {
      add: t(key("add")),
      browse: t(key("browse")),
      search: t(key("search")),
      favorites: t(key("favorites")),
      noMatches: t(key("noMatches")),
      complete: t(key("complete")),
      toFix: (count) => t(key("toFix"), { n: count }),
      reset: t(key("reset")),
      live: t(key("live")),
      idle: t(key("idle")),
      enabled: t("onboarding.admin.enabledLabel"),
    },
  };
}

/**
 * The blocks the browser lists.
 *
 * One section, because a questionnaire has five kinds of part and filing five
 * things under three headings is filing for its own sake. The order is the
 * order somebody builds a flow in: the question first, then what it offers,
 * then where the answers put people.
 */
function blocksOf(t: TFn): BlockDef<OnboardingNode>[] {
  const block = (
    kind: OnboardingKind,
    inputs: readonly PortSummary[],
    outputs: readonly PortSummary[],
  ): BlockDef<OnboardingNode> => ({
    id: kind,
    label: t(key(`nodes.${kind}`)),
    description: t(key(`blocks.${kind}`)),
    category: t(key("blocks.category")),
    tone: TONES[kind],
    create: (x, y) => makeNode(kind, x, y),
    inputs,
    outputs,
  });

  const step: PortSummary = { name: "FLOW", type: t(key("ports.step")) };
  const answer: PortSummary = { type: t(key("ports.answer")) };
  const place: PortSummary = { type: t(key("ports.place")) };

  return [
    block("question", [step], [step, answer]),
    block("answer", [answer], [place]),
    block("channel", [place], []),
    block("group", [place], []),
    block("start", [], [step, place]),
  ];
}

/** What a first-time admin finds starred, until they star their own. */
export const ONBOARDING_SUGGESTED = ["question", "answer", "channel"];
