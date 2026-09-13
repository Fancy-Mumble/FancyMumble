import { createContext, useContext } from "react";
import { Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { Stack } from "../../primitives";
import {
  AddChip,
  PillMenu,
  PillSelect,
  PlainInput,
  SectionLabel,
  TagChip,
  ToggleRow,
  usesOf,
  type BlockDef,
  type NodeAttachmentProps,
  type NodeBodyProps,
  type NodeSpec,
  type PortSummary,
  type PortId,
  type PortInfo,
  type PortSide,
  type Tone,
} from "../nodes";
import { GreetingPreview } from "./GreetingPreview";
import { SETTLED, type Conflicts } from "./solver";
import { BodyEditor } from "./BodyEditor";
import { DesignBody } from "./DesignBody";
import { starterDesign } from "./design";
import { TEMPLATE_CATEGORIES, WELCOME_TEMPLATES } from "./templates";
import {
  ACCOUNT_STATE_KEYS,
  ACCOUNT_STATES,
  FANCY_OPS,
  GATE_KINDS,
  describeGreeting,
  greetingsOf,
  OS_CHOICES,
  TENURE_WINDOW_KEYS,
  TENURE_WINDOWS,
  graphStatus,
  inputKindOf,
  inputOfPort,
  inputsOf,
  isDesign,
  isEveryone,
  isLegacy,
  isMessage,
  labelOf,
  type MessageNode,
  makeNode,
  mayBeUnknown,
  switchView,
  welcomeWiring,
  type GateKind,
  type NodeId,
  type PreviewSubject,
  type Say,
  type WelcomeGraph,
  type WelcomeNode,
} from "./model";

/**
 * The welcome-message dialect of the node editor.
 *
 * The canvas, the wires, the dragging and the chrome are the shared editor's;
 * this file is the half that is about greetings - which kinds are on the
 * palette, how each one draws itself, and how wide it sits. The rules a wire
 * obeys are `welcomeWiring`, in the model beside this, so that the meaning of a
 * graph can be tested without rendering one.
 */

/**
 * Who the greeting preview pretends to be talking to.
 *
 * Through context rather than handed to the spec, so the components the spec
 * names stay the same objects between renders - a body rebuilt on every
 * keystroke would drop focus out of the field being typed into.
 */
const SubjectContext = createContext<PreviewSubject>({
  name: "Lyn",
  channel: "#Gaming",
  server: "this server",
  allowHtml: true,
});

export const WelcomeSubjectProvider = SubjectContext.Provider;

/**
 * What the solver found, for the previews to read.
 *
 * Through context for the same reason the subject is, and computed once by the
 * page: settling which greetings shadow which is a search over every visitor
 * the graph can distinguish, and doing it per node would run it once per
 * greeting on every keystroke.
 */
const ConflictContext = createContext<Conflicts>(SETTLED);

export const WelcomeConflictProvider = ConflictContext.Provider;

/**
 * How a design block opens its editor.
 *
 * Through context because the editor is the *page's* - it slides in over the
 * whole canvas, so the thing that owns it is the thing that owns the canvas.
 * A node body cannot mount it and should not try.
 */
const OpenDesignContext = createContext<(node: NodeId) => void>(() => undefined);

export const WelcomeOpenDesignProvider = OpenDesignContext.Provider;

/**
 * The blocks the browser lists, filed under what they are about.
 *
 * The logic gates are seven blocks rather than one: an operator looking for
 * "the one that is true when exactly one side is" searches for XOR, and a
 * single "Logic gate" that always arrives as an AND makes them add it, read the
 * dropdown, and change it. Every one of them still makes the same `gate` node -
 * the block is how it is *found*, not what it is.
 */
/**
 * The fork's releases, for the version pill.
 *
 * A short list rather than a text field: these are the numbers a rule is
 * actually written about - the release that first spoke the fork's own
 * messages, the one that changed voice crypto - and an operator typing a
 * version that never existed gets a condition that is true of nobody with
 * nothing on screen to say so.
 */
const FANCY_RELEASES = ["0.2.12", "0.3.0", "0.4.0", "0.4.2"] as const;

/**
 * Every block on the palette, with its words read off `say`.
 *
 * The seven gates keep their operator as their name in every language: AND is
 * what somebody searching for one types, whatever language the rest is in.
 */
function blocksOf(say: Say): BlockDef<WelcomeNode>[] {
  const who = say("categories.who");
  const logic = say("categories.logic");
  const message = say("categories.message");

  // What each port carries, as the browser's port pills print it.
  const condition: PortSummary = { type: say("portTypes.condition") };
  const text: PortSummary = { type: say("portTypes.text") };
  const a: PortSummary = { name: "A", type: condition.type };
  const b: PortSummary = { name: "B", type: condition.type };
  const when: PortSummary = { name: say("ports.when"), type: condition.type };
  const plus: PortSummary = { name: say("ports.plus"), type: text.type };

  const gateBlock = (gate: GateKind): BlockDef<WelcomeNode> => ({
    id: `gate:${gate}`,
    label: gate.toUpperCase(),
    description: say(`blocks.gates.${gate}`),
    category: logic,
    tone: "muted",
    create: (x, y) => ({ ...(makeNode("gate", x, y) as WelcomeNode & { kind: "gate" }), gate }),
    inputs: gate === "not" ? [a] : [a, b],
    outputs: [condition],
  });

  const conditionBlock = (kind: WelcomeNode["kind"]): BlockDef<WelcomeNode> => ({
    id: kind,
    label: say(`blocks.${kind}.label`),
    description: say(`blocks.${kind}.description`),
    category: who,
    tone: toneOf({ kind }),
    create: (x, y) => makeNode(kind, x, y),
    inputs: [],
    outputs: [condition],
  });

  /** A block filed under the message; `key` is where its words live. */
  const messageBlock = (block: {
    id: string;
    key: string;
    tone: Tone;
    create: (x: number, y: number) => WelcomeNode;
    inputs: readonly PortSummary[];
    outputs: readonly PortSummary[];
  }): BlockDef<WelcomeNode> => ({
    id: block.id,
    label: say(`blocks.${block.key}.label`),
    description: say(`blocks.${block.key}.description`),
    category: message,
    tone: block.tone,
    create: block.create,
    inputs: block.inputs,
    outputs: block.outputs,
  });

  return [
    {
      id: "everyone",
      label: say("blocks.everyone.label"),
      description: say("blocks.everyone.description"),
      category: who,
      tone: "ok",
      // A filter that settles `unknown` to yes, with nothing wired into it. Both
      // evaluators already read that as true of everybody, so this needs nothing
      // the server does not already understand.
      create: (x, y) => ({ ...(makeNode("filter", x, y) as WelcomeNode & { kind: "filter" }), unknownAs: "yes" }),
      // It is a filter underneath, so it has a filter's input - and leaving that
      // input empty is precisely what makes it mean everybody. Wire something
      // into it and it stops being "everyone" and starts being that condition,
      // which is a useful thing to be able to do and a dishonest thing to hide.
      inputs: [a],
      outputs: [condition],
    },
    conditionBlock("country"),
    conditionBlock("tenure"),
    conditionBlock("clientVersion"),
    conditionBlock("fancyVersion"),
    conditionBlock("account"),
    conditionBlock("group"),
    conditionBlock("os"),

    ...GATE_KINDS.map(gateBlock),
    {
      id: "filter",
      label: say("blocks.filter.label"),
      description: say("blocks.filter.description"),
      category: logic,
      tone: "warn",
      create: (x, y) => makeNode("filter", x, y),
      inputs: [a],
      outputs: [condition],
    },

    messageBlock({
      id: "text",
      key: "text",
      tone: "ok",
      create: (x, y) => makeNode("text", x, y),
      inputs: [],
      outputs: [text],
    }),
    messageBlock({
      id: "text:rich",
      key: "textRich",
      tone: "ok",
      create: (x, y) => rich(makeNode("text", x, y)),
      inputs: [],
      outputs: [text],
    }),
    messageBlock({
      id: "greeting",
      key: "greeting",
      tone: "accent",
      create: (x, y) => makeNode("greeting", x, y),
      inputs: [when, plus],
      outputs: [],
    }),
    messageBlock({
      id: "greeting:rich",
      key: "greetingRich",
      tone: "accent",
      create: (x, y) => rich(makeNode("greeting", x, y)),
      inputs: [when, plus],
      outputs: [],
    }),
    messageBlock({
      id: "greeting:screen",
      key: "greetingScreen",
      tone: "accent",
      create: screenBlock("screen"),
      inputs: [when, plus],
      outputs: [],
    }),
    {
      ...messageBlock({
        id: "greeting:design",
        key: "greetingDesign",
        tone: "accent",
        create: (x, y) => {
          const made = makeNode("greeting", x, y);
          return made.kind === "greeting"
            ? { ...made, view: "design", design: starterDesign(), once: true }
            : made;
        },
        // WHEN is the only port this block has before it has a design. The rest
        // are the design's signature, so the card says how many there will be
        // rather than naming ports that do not exist yet.
        inputs: [when, { type: say("portTypes.designInputs") }],
        outputs: [],
      }),
      dynamicPorts: true,
    },
    messageBlock({
      id: "greeting:legacy",
      key: "greetingLegacy",
      tone: "warn",
      create: screenBlock("legacy"),
      inputs: [when, plus],
      outputs: [],
    }),
  ];
}

/**
 * A greeting that opens as a welcome screen, in one of its two dialects.
 *
 * Two blocks rather than one with a switch, for the reason the seven logic
 * gates are seven blocks: an operator looking for "the one that works on old
 * Mumble" searches for it by name, and a single "Welcome screen" that always
 * arrives modern makes them add it, find the view row, and change it.
 */
function screenBlock(view: "screen" | "legacy") {
  return (x: number, y: number): WelcomeNode => {
    const made = makeNode("greeting", x, y);
    return made.kind === "greeting" ? { ...made, ...switchView(made, view), view } : made;
  };
}

/**
 * The same node, opened in the WYSIWYG rather than as one line of prose.
 *
 * A block rather than a node kind, exactly as the seven logic gates are: what
 * goes on the wire is a body and a markup half either way, and "formatted" is
 * how an operator *finds* the node, not a second thing for the graph, the
 * server or the store to know about. The view is still a switch on the node
 * once it is down, so nobody is stuck with the choice they made in the browser.
 */
function rich(node: WelcomeNode): WelcomeNode {
  return isMessage(node) ? { ...node, view: "rich" } : node;
}

/** What a first-time operator finds starred, until they star their own. */
export const WELCOME_SUGGESTED = ["country", "gate:and", "greeting:rich"];

/**
 * How wide each kind of node sits.
 *
 * Fixed per kind, so the canvas reads as a grid - with one exception, and it
 * has to be an exception: a WYSIWYG toolbar is eight buttons wide, and a
 * document written in a 270px column is a document nobody can judge the
 * line breaks of. A node being written in the editor is therefore wider than
 * the same node holding one line of prose.
 */
const NODE_WIDTH: Record<string, number> = {
  gate: 135,
  filter: 168,
  text: 220,
  greeting: 270,
  default: 216,
};

/** What a message node widens to once there is a toolbar on it. */
const RICH_WIDTH = 372;

function widthOf(node: WelcomeNode): number {
  // What the operator dragged wins over both defaults: they were looking at
  // the document while they did it.
  if (node.w !== undefined && node.w > 0) return node.w;
  // A design block is a signature and a thumbnail, both of which need room to
  // be read at a glance - which is the only thing this node is for.
  if (isDesign(node)) return 268;
  if (isMessage(node) && node.view !== "plain") return RICH_WIDTH;
  return NODE_WIDTH[node.kind] ?? NODE_WIDTH.default;
}

/**
 * Which nodes may be dragged bigger.
 *
 * The two that hold a document, and nothing else. A condition is a dropdown
 * and a chip row - there is no writing in it that a wider box would show more
 * of - and a gate is a word. Offering a handle on all ten would be offering
 * nine ways to make a canvas untidy for no gain.
 */
function resizable(node: WelcomeNode): boolean {
  return isMessage(node);
}

/**
 * The tone a node is marked with, in the header square.
 *
 * By what the node *asks about*, not by node type: every fact about where
 * somebody is is amber, everything about their account is blue, and prose is
 * green. An operator scanning a full canvas is looking for a kind of question.
 */
function toneOf(node: Pick<WelcomeNode, "kind">): Tone {
  switch (node.kind) {
    case "country":
    case "filter":
      return "warn";
    case "tenure":
    case "text":
      return "ok";
    case "clientVersion":
    case "fancyVersion":
    case "greeting":
      return "accent";
    default:
      return "muted";
  }
}

/**
 * Where a port sits on its node.
 *
 * Inputs are placed against the row they belong to rather than spread down the
 * edge: a gate's A and B ports have to line up with the words A and B, or the
 * operator is guessing which wire they are about to replace. The greeting's two
 * inputs are the same idea against its two sections.
 */
function portTop(node: WelcomeNode, port: PortId, index: number, side: PortSide): number | string {
  if (side === "out") return node.kind === "gate" ? 47 : "50%";
  if (node.kind === "greeting") {
    if (port === "when") return 44;
    // Against the row each input is drawn on, so a wire lands beside the name
    // it belongs to: the caption, then 20px per row.
    if (isDesign(node)) {
      const at = inputsOf(node).indexOf(port);
      return at <= 0 ? 44 : 62 + at * 21;
    }
    // PLUS sits against the "Plus text" caption, which a formatted body pushes
    // a long way down - the toolbar, the editor and the view row are all above
    // it. Measured from the bottom of the card in that case, because the one
    // thing whose height is not known is the document somebody is writing.
    return node.view === "plain" ? 150 : "calc(100% - 74px)";
  }
  return 44 + index * 20;
}

/**
 * The two things a wire can carry here, and the colour each reads in.
 *
 * A condition is an answer about the person arriving; text is prose that ends
 * up in what they read. Everything on this canvas is one or the other, and the
 * colour is the type's rather than the wire's role: a condition reads in the
 * accent whether it is feeding a gate or a greeting, because what matters when
 * you are dragging one is whether the far end takes the same thing.
 */
const CONDITION_TONE = "accent" as const;
const TEXT_TONE = "ok" as const;

/**
 * What each socket carries, and the word drawn beside it.
 *
 * Outputs are labelled with their *type* and inputs with their *name*, which
 * is the split every node editor settles on: a node has one output and the
 * only useful thing to say about it is what comes out, while an input is one
 * of several and the useful thing is which one.
 */
function portInfoOf(say: Say): (node: WelcomeNode, port: PortId, side: PortSide) => PortInfo {
  return (node, port, side) => {
    if (side === "out") {
      return node.kind === "text"
        ? { label: say("ports.text"), type: "text", tone: TEXT_TONE }
        : { label: say("ports.condition"), type: "condition", tone: CONDITION_TONE };
    }
    if (port === "when") return { label: say("ports.when"), type: "condition", tone: CONDITION_TONE };
    if (port === "plus") return { label: say("ports.plus"), type: "text", tone: TEXT_TONE };

    // A design's own inputs are named by the design and typed by which list it
    // declared them in.
    const named = inputOfPort(port);
    if (named !== null) {
      const kind = inputKindOf(node, port);
      if (kind === "text") return { label: named, type: "text", tone: TEXT_TONE };
      if (kind === "bool") return { label: named, type: "condition", tone: CONDITION_TONE };
      // A port left behind by an input the design no longer declares. Drawn
      // quiet because nothing wired here reaches anything.
      return { label: named, type: "gone", tone: "muted" };
    }

    // A gate's or a filter's inputs, which are named on the node as A and B.
    return { label: port.toUpperCase(), type: "condition", tone: CONDITION_TONE };
  };
}

/** The template gallery, with every card said in the operator's language. */
function galleryOf(say: Say) {
  const section = (category: string) => {
    const key = Object.keys(TEMPLATE_CATEGORIES).find((candidate) => TEMPLATE_CATEGORIES[candidate] === category);
    return key === undefined ? category : say(`templateCategories.${key}`);
  };
  return {
    items: WELCOME_TEMPLATES.map((template) => ({
      ...template,
      label: say(`templates.${template.id}.label`),
      description: say(`templates.${template.id}.description`),
      category: section(template.category),
      ...(template.shows === undefined ? {} : { shows: say(`templates.${template.id}.shows`) }),
    })),
    strings: {
      open: say("gallery.open"),
      empty: say("gallery.empty"),
      add: say("gallery.add"),
      replace: say("gallery.replace"),
      replaceHint: say("gallery.replaceHint"),
    },
  };
}

/**
 * The welcome editor's dialect, said in the operator's language.
 *
 * Rebuilt whenever the translation function changes, which is cheap: the
 * components it names are module-level, so a new spec re-renders the canvas
 * without remounting anything an operator is typing into. Everything that
 * varies between one canvas and the next - who the preview greets - comes
 * through context instead.
 */
export function welcomeSpec(say: Say): NodeSpec<WelcomeNode> {
  return {
    ...welcomeWiring,
    id: "welcome",
    blocks: blocksOf(say),
    templates: galleryOf(say),
    label: (node) => {
      if (isDesign(node)) return say("nodes.greeting");
      return isLegacy(node) ? say("nodes.greetingClassic") : labelOf(node, say);
    },
    width: widthOf,
    resizable,
    // Narrow enough to still be a column of text; the toolbar sets the floor.
    minSize: () => ({ w: 240, h: 120 }),
    // The welcome document has a layer for them, so the canvas offers them.
    annotate: true,
    tone: toneOf,
    portTop,
    portInfo: portInfoOf(say),
    body: WelcomeBody,
    attachment: WelcomeAttachment,
    emphasise: (node) => node.kind === "greeting",
    badge: (graph, node) => {
      // The filter that means "everybody" says so, rather than reading as a
      // filter somebody forgot to wire up.
      if (isEveryone(graph, node)) return say("nodes.everyone");
      if (node.kind === "text") return `${usesOf(graph, node.id)}×`;
      // Which greeting this is in the order the server tries them, but only once
      // there is more than one - the order is what decides who sees which, and
      // on a single-greeting canvas it is noise.
      if (node.kind === "greeting") {
        const order = greetingsOf(graph);
        if (order.length < 2) return null;
        return `#${order.findIndex((candidate) => candidate.id === node.id) + 1}`;
      }
      return null;
    },
    // It is not an error - most useful graphs have undecided wires in them - but
    // it is the thing that silently withholds a greeting, so it is worth seeing
    // at a glance which parts of a canvas are decided and which are not.
    warnPort: (graph, node, _port, side) =>
      side === "out" && mayBeUnknown(graph, node.id) ? say("nodes.undecided") : null,
    status: (graph) => graphStatus(graph, say),
    // Enabled and complete still reaches nobody when the greeting has no
    // condition wired to it, and that is the failure an operator cannot see.
    // Any greeting with a condition on it makes the graph live; a canvas of
    // greetings none of which is wired reaches nobody however many there are.
    liveness: (graph) =>
      greetingsOf(graph).some((greeting) => describeGreeting(graph, greeting.id, say) !== null)
        ? "live"
        : "idle",
    strings: {
      add: say("editor.add"),
      browse: say("editor.browse"),
      search: say("editor.search"),
      favorites: say("editor.favorites"),
      noMatches: say("editor.noMatches"),
      complete: say("editor.complete"),
      toFix: (count) => say("editor.toFix", { count }),
      reset: say("editor.reset"),
      live: say("editor.live"),
      idle: say("editor.idle"),
      enabled: say("editor.enabled"),
    },
  };
}

/**
 * How tall the editor inside a node is allowed to be.
 *
 * A dragged height is spent on the field rather than on padding, because the
 * field is the only thing in the node whose size the operator could have
 * wanted: everything else - the caption, the view row, the toggle - is fixed.
 * The chrome above and below it is taken off the top.
 */
const CHROME = 96;

function editorHeight(node: MessageNode, fallback: number): number {
  const dragged = node.h ?? 0;
  return dragged > CHROME ? dragged - CHROME : fallback;
}

/* -- Bodies --------------------------------------------------------------- */

function WelcomeBody({ node, graph, onPatch }: NodeBodyProps<WelcomeNode>) {
  const { t } = useTranslation("nebulaWelcome");
  const say = t as Say;
  switch (node.kind) {
    case "country":
      return (
        <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap" }}>
          {node.codes.map((code) => (
            <TagChip
              key={code}
              label={code}
              onRemove={() => onPatch({ codes: node.codes.filter((c) => c !== code) })}
            />
          ))}
          <AddChip
            options={COMMON_COUNTRIES.filter((code) => !node.codes.includes(code))}
            onAdd={(code) => onPatch({ codes: [...node.codes, code] })}
          />
        </Stack>
      );

    case "tenure":
      return (
        <Stack gap={0.75} alignItems="flex-start">
          <PillMenu
            value={node.op === "less" ? "less" : "more"}
            options={[
              { id: "less", label: t("body.joinedLess") },
              { id: "more", label: t("body.joinedMore") },
            ]}
            onChange={(v) => onPatch({ op: v === "less" ? "less" : "more" })}
          />
          <PillMenu
            value={node.window}
            options={TENURE_WINDOWS.map((w) => ({ id: w, label: say(`windows.${TENURE_WINDOW_KEYS[w]}`) }))}
            onChange={(v) => onPatch({ window: v as typeof node.window })}
          />
        </Stack>
      );

    case "clientVersion":
      return (
        <Stack direction="row" gap={0.75} alignItems="center">
          <PillSelect
            value={node.op}
            options={["<", "<=", "=", ">=", ">"]}
            onChange={(v) => onPatch({ op: v as typeof node.op })}
          />
          <PillSelect
            value={node.version}
            options={["1.4.0", "1.5.0", "1.5.735", "2.0.0"]}
            onChange={(v) => onPatch({ version: v })}
          />
        </Stack>
      );

    case "fancyVersion":
      return (
        <Stack direction="row" gap={0.75} alignItems="center">
          <PillMenu
            value={node.op}
            options={FANCY_OPS.map((op) => ({ id: op, label: op === "any" ? t("body.any") : op }))}
            onChange={(v) => onPatch({ op: v as typeof node.op, ...(v === "any" ? { version: "" } : {}) })}
          />
          {/* Nothing to compare against under `any`, so nothing is drawn: a
              version pill beside it would be a control that changes no rule. */}
          {node.op !== "any" && (
            <PillSelect
              value={node.version || FANCY_RELEASES[0]}
              options={[...FANCY_RELEASES]}
              onChange={(v) => onPatch({ version: v })}
            />
          )}
        </Stack>
      );

    case "account":
      return (
        <Stack direction="row" gap={0.75} alignItems="center">
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {t("body.is")}
          </Typography>
          <PillMenu
            value={node.state}
            options={ACCOUNT_STATES.map((state) => ({
              id: state,
              label: say(`accountStates.${ACCOUNT_STATE_KEYS[state]}`),
            }))}
            onChange={(v) => onPatch({ state: v as typeof node.state })}
          />
        </Stack>
      );

    case "os":
      return (
        <Stack direction="row" gap={0.75} alignItems="center">
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {t("body.is")}
          </Typography>
          <PillSelect
            value={node.os}
            options={[...OS_CHOICES]}
            onChange={(v) => onPatch({ os: v as typeof node.os })}
          />
        </Stack>
      );

    case "group":
      return (
        <PlainInput value={node.group} placeholder={t("body.groupName")} onChange={(group) => onPatch({ group })} />
      );

    case "filter":
      return (
        <Stack direction="row" alignItems="center" gap={0.75}>
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {t("body.unknown")}
          </Typography>
          <PillMenu
            value={node.unknownAs}
            options={[
              { id: "no", label: t("body.no") },
              { id: "yes", label: t("body.yes") },
            ]}
            onChange={(v) => onPatch({ unknownAs: v as typeof node.unknownAs })}
          />
        </Stack>
      );

    case "gate":
      return (
        // The inputs are named on the edge beside their own sockets, so the
        // body no longer writes A and B out itself - it did, and it was the
        // one place on the canvas where the same word was drawn twice, twenty
        // pixels apart. What it keeps is the height: the ports are spaced down
        // the left edge, and a card shorter than they are would hang the lower
        // one off its own bottom corner.
        <Stack gap={0.75} sx={{ minHeight: 44, justifyContent: "flex-end" }}>
          <PillSelect
            value={node.gate}
            options={[...GATE_KINDS]}
            onChange={(v) => onPatch({ gate: v as typeof node.gate })}
          />
        </Stack>
      );

    case "text":
      return (
        <Stack gap={0.75}>
          <PlainInput
            value={node.name}
            placeholder={t("body.snippetName")}
            ariaLabel={t("body.snippetNameLabel")}
            onChange={(name) => onPatch({ name })}
          />
          <BodyEditor
            node={node}
            placeholder={t("body.snippetText")}
            ariaLabel={t("body.snippetTextLabel")}
            minHeight={editorHeight(node, 92)}
            maxHeight={editorHeight(node, 220)}
            onPatch={onPatch}
          />
        </Stack>
      );

    case "greeting":
      return <GreetingBody node={node} graph={graph} onPatch={onPatch} />;
  }
}

function GreetingBody({
  node,
  graph,
  onPatch,
}: Readonly<{
  node: WelcomeNode & { kind: "greeting" };
  graph: WelcomeGraph;
  onPatch: (patch: Partial<WelcomeNode>) => void;
}>) {
  const { t } = useTranslation("nebulaWelcome");
  const openDesign = useContext(OpenDesignContext);
  const snippets = graph.edges
    .filter((e) => e.to === node.id && e.port === "plus")
    .map((e) => graph.nodes.find((n) => n.id === e.from))
    .filter((n): n is WelcomeNode & { kind: "text" } => n?.kind === "text");

  // A design is a page, and a page inside a 268px node is neither readable nor
  // editable - so the node shows its signature and a way in, and the design
  // itself opens in the editor.
  if (node.view === "design" && node.design) {
    return (
      <DesignBody design={node.design} onOpen={() => openDesign(node.id)} />
    );
  }

  return (
    <Stack gap={1}>
      <SectionLabel>{t("body.theyRead")}</SectionLabel>
      <BodyEditor
        node={node}
        placeholder={t("body.greetingText")}
        ariaLabel={t("body.greetingTextLabel")}
        minHeight={editorHeight(node, 116)}
        maxHeight={editorHeight(node, 300)}
        onPatch={onPatch}
      />
      <SectionLabel>{t("body.plusText")}</SectionLabel>
      <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap", minHeight: 20 }}>
        {snippets.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {t("body.wireSnippet")}
          </Typography>
        )}
        {snippets.map((s) => (
          <TagChip key={s.id} label={s.name || t("body.unnamed")} tone="ok" />
        ))}
      </Stack>
      <ToggleRow
        checked={node.once}
        label={t("body.once")}
        onChange={() => onPatch({ once: !node.once })}
      />
    </Stack>
  );
}

/**
 * The greeting's own preview, hung under the node it belongs to.
 *
 * `node.id` is handed down, and that is the whole fix for the bug this used to
 * have: a canvas with two greetings on it drew the *first* greeting's text
 * under both of them, because everything the preview asked about the graph
 * answered for the first greeting it found.
 */
function WelcomeAttachment({ node, graph }: NodeAttachmentProps<WelcomeNode>) {
  const subject = useContext(SubjectContext);
  const conflicts = useContext(ConflictContext);
  if (node.kind !== "greeting") return null;
  return <GreetingPreview graph={graph} greeting={node.id} subject={subject} conflicts={conflicts} />;
}

/** ISO-3166 alpha-2, uppercased as the mock shows them. */
const COMMON_COUNTRIES = ["DE", "AT", "CH", "GB", "US", "FR", "NL", "PL", "SE", "ES", "IT"];
