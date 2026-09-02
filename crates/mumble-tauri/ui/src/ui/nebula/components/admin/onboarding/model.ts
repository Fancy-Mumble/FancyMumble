/**
 * The onboarding graph: what an admin draws, and the config it compiles to.
 *
 * The questionnaire is a *flow* - everyone starts somewhere, is asked a
 * question, and each answer they pick puts them into channels and groups - and
 * a flow is the one thing a list of forms cannot show. So it is drawn, on the
 * same canvas the welcome-message rule is drawn on, and this module is the half
 * that differs: the kinds of node, how they may be wired, and the
 * `OnboardingConfig` a finished drawing turns into.
 *
 * Both directions are here on purpose. `graphOf` is how a config the server
 * pushed becomes a drawing, `configOf` is how the drawing becomes the document
 * that is broadcast, and they round-trip: node ids carry the config's own ids,
 * so a question edited on the canvas is the same question the rail was editing.
 *
 * Nothing here throws and nothing here refuses to render a half-drawn graph.
 * What may be *saved* is `problemsOf`, and the words those problems are said in
 * belong to the page, not to this file - the editor is translated, so a model
 * that returned English sentences could not be.
 */

import type { OnboardingAnswer, OnboardingConfig, OnboardingQuestion } from "@core/types";
import {
  nextId,
  nodeOf,
  targetsOf,
  type Edge,
  type NodeGraph,
  type NodeId,
  type PortId,
  type Wiring,
} from "../nodes/graph";

/** How many questions a member may be asked, as the rail editor also caps it. */
export const MAX_QUESTIONS = 5;

export type OnboardingNode = {
  readonly id: NodeId;
  x: number;
  y: number;
} & (
  | { kind: "start" }
  | {
      kind: "question";
      text: string;
      multiSelect: boolean;
      required: boolean;
      askBeforeJoin: boolean;
    }
  | { kind: "answer"; label: string; emoji: string; note: string }
  | { kind: "channel"; channelId: number | null }
  | { kind: "group"; name: string }
);

export type OnboardingKind = OnboardingNode["kind"];
export type OnboardingGraph = NodeGraph<OnboardingNode>;

/** A node of one kind, for the many places that have already checked. */
export type NodeOf<K extends OnboardingKind> = Extract<OnboardingNode, { kind: K }> & {
  readonly id: NodeId;
  x: number;
  y: number;
};

/* -- Shape ---------------------------------------------------------------- */

/**
 * Which output a wire may leave by, and where it may land.
 *
 * The whole wiring rule in one table. A question emits two different things -
 * the question that follows it, and the answers it offers - and they are
 * different ports rather than one port with a rule about what is on the other
 * end, so a mis-drag is refused at the port instead of producing a flow that
 * loops through an answer.
 */
const WIRES: Record<PortId, { readonly port: PortId; readonly kinds: readonly OnboardingKind[] }> = {
  then: { port: "flow", kinds: ["question"] },
  picks: { port: "from", kinds: ["answer"] },
  grants: { port: "in", kinds: ["channel", "group"] },
  // The config carries default *channels* only, so a group wired here would be
  // dropped silently on save.
  place: { port: "in", kinds: ["channel"] },
};

export function inputsOf(node: OnboardingNode): readonly PortId[] {
  switch (node.kind) {
    case "start":
      return [];
    case "question":
      return ["flow"];
    case "answer":
      return ["from"];
    default:
      return ["in"];
  }
}

export function outputsOf(node: OnboardingNode): readonly PortId[] {
  switch (node.kind) {
    case "start":
      return ["then", "place"];
    case "question":
      return ["then", "picks"];
    case "answer":
      return ["grants"];
    default:
      return [];
  }
}

/**
 * Which ports hold more than one wire.
 *
 * The flow's own ports are single: one question follows another, and an answer
 * belongs to one question. Everything that is a *set* - the answers on a
 * question, what an answer grants, who grants a channel - holds several.
 */
export function multiPort(_node: OnboardingNode, port: PortId): boolean {
  return port === "picks" || port === "grants" || port === "place" || port === "in";
}

export function acceptsWire(
  _source: OnboardingNode,
  target: OnboardingNode,
  port: PortId,
  fromPort: PortId,
): boolean {
  const rule = WIRES[fromPort];
  return rule !== undefined && rule.port === port && rule.kinds.includes(target.kind);
}

/**
 * What the engine has to know before it can enforce a wire.
 *
 * Everything this dialect says about wiring, in one object. The generic rules -
 * a node is not wired to itself, a port exists, a flow does not loop - are the
 * engine's and are not repeated here.
 */
export const onboardingWiring: Wiring<OnboardingNode> = {
  inputs: inputsOf,
  outputs: outputsOf,
  multi: multiPort,
  accepts: acceptsWire,
};

/* -- Ids ------------------------------------------------------------------ */

const QUESTION = "q:";
const ANSWER = "a:";
const CHANNEL = "ch:";
const GROUP = "gr:";

/** The canonical start node's id, so its position survives a rebuild. */
export const START_ID = "start";

/** The config id behind a node id, which is what makes the round trip stable. */
const bare = (id: NodeId): string => id.slice(id.indexOf(":") + 1);

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id${nextId()}`;

/** A fresh node of `kind`, as the palette drops it. */
export function makeNode(kind: OnboardingKind, x: number, y: number): OnboardingNode {
  switch (kind) {
    case "start":
      return { id: `${START_ID}:${nextId()}`, x, y, kind };
    case "question":
      return {
        id: `${QUESTION}${uuid()}`,
        x,
        y,
        kind,
        text: "",
        multiSelect: false,
        required: false,
        askBeforeJoin: false,
      };
    case "answer":
      return { id: `${ANSWER}${uuid()}`, x, y, kind, label: "", emoji: "", note: "" };
    case "channel":
      return { id: `n${nextId()}`, x, y, kind, channelId: null };
    case "group":
      return { id: `n${nextId()}`, x, y, kind, name: "" };
  }
}

/* -- Reading the flow ------------------------------------------------------ */

export function startOf(graph: OnboardingGraph): OnboardingNode | undefined {
  return graph.nodes.find((node) => node.kind === "start");
}

/**
 * The questions, in the order a new member is asked them.
 *
 * Walked from the start node along `then` rather than read off the canvas:
 * where a node *sits* is the operator's business, and a questionnaire whose
 * order changed when somebody tidied the layout would be a trap. A question
 * nobody wired into the chain is not in this list, which is what makes
 * "not on the flow" a problem the status bar can name.
 */
export function questionsOf(graph: OnboardingGraph): NodeOf<"question">[] {
  const start = startOf(graph);
  if (!start) return [];
  const chain: NodeOf<"question">[] = [];
  const seen = new Set<NodeId>();
  let current = nextQuestion(graph, start.id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = nextQuestion(graph, current.id);
  }
  return chain;
}

function nextQuestion(graph: OnboardingGraph, from: NodeId): NodeOf<"question"> | undefined {
  return targetsOf(graph, from, "then").find((node): node is NodeOf<"question"> => node.kind === "question");
}

/** The answers a question offers, in the order they were wired. */
export function answersOf(graph: OnboardingGraph, question: NodeId): NodeOf<"answer">[] {
  return targetsOf(graph, question, "picks").filter(
    (node): node is NodeOf<"answer"> => node.kind === "answer",
  );
}

/** What picking an answer puts you into, in the order it was wired. */
export function grantsOf(graph: OnboardingGraph, answer: NodeId): OnboardingNode[] {
  return targetsOf(graph, answer, "grants").filter(
    (node) => node.kind === "channel" || node.kind === "group",
  );
}

/** The channels everyone lands in, whatever they answer. */
export function defaultChannelsOf(graph: OnboardingGraph): NodeOf<"channel">[] {
  const start = startOf(graph);
  if (!start) return [];
  return targetsOf(graph, start.id, "place").filter(
    (node): node is NodeOf<"channel"> => node.kind === "channel",
  );
}

/** How many answers grant this channel or group - the `3×` badge on it. */
export function grantedBy(graph: OnboardingGraph, id: NodeId): number {
  return graph.edges.filter((edge) => edge.to === id && edge.port === "in").length;
}

/* -- What the drawing does ------------------------------------------------- */

export interface FlowSummary {
  readonly questions: number;
  readonly answers: number;
  readonly channels: number;
  readonly groups: number;
  /** Questions that must be answered before the member is let in. */
  readonly beforeJoin: number;
}

/** The counts the status bar reads the drawing back with. */
export function summaryOf(graph: OnboardingGraph): FlowSummary {
  const questions = questionsOf(graph);
  const answers = questions.flatMap((question) => answersOf(graph, question.id));
  const granted = new Set<NodeId>();
  for (const answer of answers) for (const grant of grantsOf(graph, answer.id)) granted.add(grant.id);
  for (const channel of defaultChannelsOf(graph)) granted.add(channel.id);

  const kinds = [...granted].map((id) => nodeOf(graph, id)?.kind);
  return {
    questions: questions.length,
    answers: answers.length,
    channels: kinds.filter((kind) => kind === "channel").length,
    groups: kinds.filter((kind) => kind === "group").length,
    beforeJoin: questions.filter((question) => question.askBeforeJoin).length,
  };
}

/* -- Whether it may be saved ----------------------------------------------- */

/**
 * What still has to be drawn, as codes rather than sentences.
 *
 * Every entry names a node the admin can go and look at - "invalid graph" tells
 * somebody staring at fourteen nodes nothing at all - and the words are the
 * page's, because this editor is translated and English baked in here could not
 * be. `where` is the node's own caption, for the ones that name a node.
 */
export type OnboardingProblem =
  | { code: "noStart" }
  | { code: "twoStarts" }
  | { code: "noQuestions" }
  | { code: "tooManyQuestions"; max: number }
  | { code: "questionText" }
  | { code: "questionAnswers"; where: string }
  | { code: "offFlow" }
  | { code: "answerLabel" }
  | { code: "looseAnswer" }
  | { code: "channelUnset" }
  | { code: "groupUnset" };

export function problemsOf(graph: OnboardingGraph): OnboardingProblem[] {
  const problems: OnboardingProblem[] = [];
  const starts = graph.nodes.filter((node) => node.kind === "start");
  if (starts.length === 0) {
    problems.push({ code: "noStart" });
    return problems;
  }
  if (starts.length > 1) problems.push({ code: "twoStarts" });

  const flow = questionsOf(graph);
  const onFlow = new Set(flow.map((question) => question.id));
  if (flow.length === 0) problems.push({ code: "noQuestions" });
  if (flow.length > MAX_QUESTIONS) problems.push({ code: "tooManyQuestions", max: MAX_QUESTIONS });

  for (const node of graph.nodes) {
    switch (node.kind) {
      case "question":
        if (!onFlow.has(node.id)) problems.push({ code: "offFlow" });
        else if (node.text.trim() === "") problems.push({ code: "questionText" });
        else if (answersOf(graph, node.id).length === 0)
          problems.push({ code: "questionAnswers", where: node.text.trim() });
        break;
      case "answer":
        if (node.label.trim() === "") problems.push({ code: "answerLabel" });
        else if (!graph.edges.some((edge) => edge.to === node.id && edge.port === "from"))
          problems.push({ code: "looseAnswer" });
        break;
      case "channel":
        if (node.channelId === null) problems.push({ code: "channelUnset" });
        break;
      case "group":
        if (node.name.trim() === "") problems.push({ code: "groupUnset" });
        break;
      case "start":
        break;
    }
  }
  return problems;
}

/* -- The document it compiles to -------------------------------------------- */

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/**
 * The drawing as the document the server is sent.
 *
 * `base` carries everything the canvas has no opinion about - the version, the
 * revision the server assigned, who last touched it - so a graph edited here
 * publishes over the config it came from rather than resetting its history.
 *
 * Faithful rather than tidy: a half-written answer is kept, exactly as the rail
 * editor keeps one while you are thinking. Dropping the blank rows is a thing
 * that happens once, on save.
 */
export function configOf(graph: OnboardingGraph, base: OnboardingConfig): OnboardingConfig {
  return {
    ...base,
    enabled: graph.enabled,
    default_channel_ids: unique(
      defaultChannelsOf(graph)
        .map((node) => node.channelId)
        .filter((id): id is number => id !== null),
    ),
    questions: questionsOf(graph).map((question) => questionConfig(graph, question)),
  };
}

function questionConfig(graph: OnboardingGraph, question: NodeOf<"question">): OnboardingQuestion {
  return {
    id: bare(question.id),
    text: question.text,
    multi_select: question.multiSelect,
    required: question.required,
    ask_before_join: question.askBeforeJoin,
    answers: answersOf(graph, question.id).map((answer) => answerConfig(graph, answer)),
  };
}

function answerConfig(graph: OnboardingGraph, answer: NodeOf<"answer">): OnboardingAnswer {
  const grants = grantsOf(graph, answer.id);
  return {
    id: bare(answer.id),
    label: answer.label,
    emoji: answer.emoji || undefined,
    description: answer.note || undefined,
    channel_ids: unique(
      grants
        .map((node) => (node.kind === "channel" ? node.channelId : null))
        .filter((id): id is number => id !== null),
    ),
    group_names: unique(
      grants.map((node) => (node.kind === "group" ? node.name.trim() : "")).filter((name) => name !== ""),
    ),
  };
}

/**
 * The rows a save publishes: the whole draft, without the ones still being
 * written.
 *
 * The same rule the rail editor has always applied, kept in one place now that
 * two editors produce the document.
 */
export function publishable(config: OnboardingConfig): OnboardingConfig {
  return {
    ...config,
    questions: config.questions
      .filter((question) => question.text.trim().length > 0)
      .map((question) => ({
        ...question,
        answers: question.answers.filter((answer) => answer.label.trim().length > 0),
      }))
      .filter((question) => question.answers.length > 0),
  };
}

/* -- The drawing it comes from ---------------------------------------------- */

/**
 * Where the columns sit, and how far apart two rows are.
 *
 * The band is generous because a question node carries the preview of what a
 * new member sees hung underneath it, which is most of its height. Two bands
 * that overlapped would put one question's preview across the next question.
 */
const LAYOUT = {
  start: { x: 30, y: 30 },
  /**
   * The questions start below the start node rather than beside it, so that
   * the wires carrying the channels everyone lands in run across the empty
   * strip above the flow instead of over the first question's card.
   */
  firstBand: 240,
  question: 250,
  answer: 600,
  grant: 900,
  /** The least a question's band may be, however few answers hang off it. */
  band: 700,
  /** One answer node, which is three rows and its chips. */
  row: 152,
  /** One channel or group node, which is a caption and one control. */
  grantRow: 104,
} as const;

/** Positions to keep, so a rebuild does not shuffle a canvas somebody arranged. */
export type Positions = Readonly<Record<NodeId, { x: number; y: number }>>;

/**
 * A config as a drawing.
 *
 * Laid out as the flow reads: everyone starts at the left, the questions run
 * down the second column in the order they are asked, each question's answers
 * sit beside it, and the channels and groups they grant collect in the last
 * column - one node per channel, however many answers grant it, because "three
 * answers all put you in #Lounge" is a thing worth being able to see.
 *
 * A node keeps wherever it was last dragged to. That is what makes the two
 * editors one document rather than two: an admin can add a question on the rail
 * and come back to the canvas without their layout having been rearranged.
 */
export function graphOf(config: OnboardingConfig, positions: Positions = {}): OnboardingGraph {
  const nodes: OnboardingNode[] = [];
  const edges: Edge[] = [];
  let wires = 0;
  const wire = (from: NodeId, fromPort: PortId, to: NodeId, port: PortId) => {
    wires += 1;
    edges.push({ id: `w${wires}`, from, fromPort, to, port });
  };

  const at = (id: NodeId, x: number, y: number) => positions[id] ?? { x, y };
  const add = <N extends OnboardingNode>(node: N): N => {
    nodes.push(node);
    return node;
  };

  const start = add({ id: START_ID, kind: "start", ...at(START_ID, LAYOUT.start.x, LAYOUT.start.y) });

  // One node per channel and per group, wherever it is granted from, so the
  // last column is the list of places this questionnaire can put somebody.
  let grantCursor = LAYOUT.start.y;
  const grants = new Map<NodeId, OnboardingNode>();
  const grantNode = (id: NodeId, near: number, build: (x: number, y: number) => OnboardingNode) => {
    const existing = grants.get(id);
    if (existing) return existing;
    const y = Math.max(near, grantCursor);
    grantCursor = y + LAYOUT.grantRow;
    const node = add(build(LAYOUT.grant, y));
    grants.set(id, node);
    return node;
  };
  const channelNode = (channelId: number, near: number) =>
    grantNode(`${CHANNEL}${channelId}`, near, (x, y) => ({
      id: `${CHANNEL}${channelId}`,
      kind: "channel",
      channelId,
      ...at(`${CHANNEL}${channelId}`, x, y),
    }));
  const groupNode = (name: string, near: number) =>
    grantNode(`${GROUP}${name}`, near, (x, y) => ({
      id: `${GROUP}${name}`,
      kind: "group",
      name,
      ...at(`${GROUP}${name}`, x, y),
    }));

  for (const channelId of config.default_channel_ids) {
    wire(start.id, "place", channelNode(channelId, LAYOUT.start.y).id, "in");
  }

  let band = LAYOUT.firstBand;
  let previous: NodeId = start.id;
  for (const question of config.questions) {
    const id = `${QUESTION}${question.id}`;
    const node = add({
      id,
      kind: "question",
      text: question.text,
      multiSelect: question.multi_select,
      required: question.required,
      askBeforeJoin: question.ask_before_join,
      ...at(id, LAYOUT.question, band),
    });
    wire(previous, "then", node.id, "flow");
    previous = node.id;

    question.answers.forEach((answer, index) => {
      const answerId = `${ANSWER}${answer.id}`;
      const top = band + index * LAYOUT.row;
      const answerNode = add({
        id: answerId,
        kind: "answer",
        label: answer.label,
        emoji: answer.emoji ?? "",
        note: answer.description ?? "",
        ...at(answerId, LAYOUT.answer, top),
      });
      wire(node.id, "picks", answerNode.id, "from");

      for (const channelId of answer.channel_ids) {
        wire(answerNode.id, "grants", channelNode(channelId, top).id, "in");
      }
      for (const name of answer.group_names) {
        wire(answerNode.id, "grants", groupNode(name, top).id, "in");
      }
    });

    band += Math.max(LAYOUT.band, question.answers.length * LAYOUT.row + 40);
  }

  return { nodes, edges, enabled: config.enabled };
}

/** Where every node currently sits, to hand back to `graphOf` after an edit. */
export function positionsOf(graph: OnboardingGraph): Positions {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}
