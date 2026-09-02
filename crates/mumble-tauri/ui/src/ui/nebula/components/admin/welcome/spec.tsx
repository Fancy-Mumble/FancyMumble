import { createContext, useContext } from "react";
import { Typography } from "@mui/material";
import { Stack } from "../../primitives";
import {
  AddChip,
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
  type PortSide,
  type Tone,
} from "../nodes";
import { GreetingPreview } from "./GreetingPreview";
import {
  ACCOUNT_STATES,
  GATE_KINDS,
  describe,
  OS_CHOICES,
  TENURE_WINDOWS,
  graphStatus,
  inputsOf,
  labelOf,
  makeNode,
  mayBeUnknown,
  welcomeWiring,
  type GateKind,
  type PreviewSubject,
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
});

export const WelcomeSubjectProvider = SubjectContext.Provider;

/**
 * The blocks the browser lists, filed under what they are about.
 *
 * The logic gates are seven blocks rather than one: an operator looking for
 * "the one that is true when exactly one side is" searches for XOR, and a
 * single "Logic gate" that always arrives as an AND makes them add it, read the
 * dropdown, and change it. Every one of them still makes the same `gate` node -
 * the block is how it is *found*, not what it is.
 */
const WHO = "Who is connecting";
const LOGIC = "Logic";
const MESSAGE = "The message";

/** What a condition carries, as the browser's port pills print it. */
const CONDITION: PortSummary = { type: "condition" };
const TEXT: PortSummary = { type: "text" };

const gateBlock = (gate: GateKind, label: string, description: string): BlockDef<WelcomeNode> => ({
  id: `gate:${gate}`,
  label,
  description,
  category: LOGIC,
  tone: "muted",
  create: (x, y) => ({ ...(makeNode("gate", x, y) as WelcomeNode & { kind: "gate" }), gate }),
  inputs:
    gate === "not"
      ? [{ name: "A", type: "condition" }]
      : [
          { name: "A", type: "condition" },
          { name: "B", type: "condition" },
        ],
  outputs: [CONDITION],
});

const condition = (kind: WelcomeNode["kind"], label: string, description: string): BlockDef<WelcomeNode> => ({
  id: kind,
  label,
  description,
  category: WHO,
  tone: toneOf({ kind }),
  create: (x, y) => makeNode(kind, x, y),
  inputs: [],
  outputs: [CONDITION],
});

const BLOCKS: readonly BlockDef<WelcomeNode>[] = [
  condition("country", "Country", "True when the member connects from one of the picked countries."),
  condition("tenure", "On server since", "Compares how long the account has existed on this server."),
  condition(
    "clientVersion",
    "Client version",
    "Matches the Mumble/Fancy client build the member is running.",
  ),
  condition("account", "Account", "True for a specific registered user or certificate."),
  condition("group", "Group", "True when the member belongs to an ACL group."),
  condition("os", "OS", "Matches the operating system reported by the client."),

  gateBlock("and", "AND", "True when both inputs are true."),
  gateBlock("or", "OR", "True when either input is true."),
  gateBlock("xor", "XOR", "True when exactly one input is true."),
  gateBlock("nand", "NAND", "True unless both inputs are true."),
  gateBlock("nor", "NOR", "True when neither input is true."),
  gateBlock("xnor", "XNOR", "True when both inputs agree."),
  gateBlock("not", "NOT", "Inverts a single condition."),
  {
    id: "filter",
    label: "Filter",
    description: "Settles an undecided answer into a plain yes or no, so a gate can use it.",
    category: LOGIC,
    tone: "warn",
    create: (x, y) => makeNode("filter", x, y),
    inputs: [{ name: "A", type: "condition" }],
    outputs: [CONDITION],
  },

  {
    id: "text",
    label: "Reusable text",
    description: "Prose appended to a greeting, and to every other greeting that wires it in.",
    category: MESSAGE,
    tone: "ok",
    create: (x, y) => makeNode("text", x, y),
    inputs: [],
    outputs: [TEXT],
  },
  {
    id: "greeting",
    label: "Show this greeting",
    description: "The message itself: what it says, and the condition that decides who reads it.",
    category: MESSAGE,
    tone: "accent",
    create: (x, y) => makeNode("greeting", x, y),
    inputs: [
      { name: "WHEN", type: "condition" },
      { name: "PLUS", type: "text" },
    ],
    outputs: [],
  },
];

/** What a first-time operator finds starred, until they star their own. */
export const WELCOME_SUGGESTED = ["country", "gate:and", "text"];

/** How wide each kind of node sits. Fixed, so the canvas reads as a grid. */
const NODE_WIDTH: Record<string, number> = {
  gate: 135,
  filter: 168,
  text: 220,
  greeting: 270,
  default: 216,
};

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
  if (node.kind === "greeting") return port === "when" ? 44 : 150;
  return 44 + index * 20;
}

/**
 * The welcome editor's dialect.
 *
 * A constant rather than a factory: this page is not translated, and everything
 * that varies between one canvas and the next - who the preview greets - comes
 * through context instead.
 */
export const welcomeSpec: NodeSpec<WelcomeNode> = {
  ...welcomeWiring,
  id: "welcome",
  blocks: BLOCKS,
  label: labelOf,
  width: (node) => NODE_WIDTH[node.kind] ?? NODE_WIDTH.default,
  tone: toneOf,
  portTop,
  // A wire is coloured by what it *feeds*, not by where it comes from: one into
  // the greeting's WHEN is the condition and reads in the accent, one into PLUS
  // TEXT is prose and reads green, and everything upstream of a gate is quiet.
  wireTone: (port) => (port === "plus" ? "ok" : port === "when" ? "accent" : "muted"),
  body: WelcomeBody,
  attachment: WelcomeAttachment,
  emphasise: (node) => node.kind === "greeting",
  badge: (graph, node) => (node.kind === "text" ? `${usesOf(graph, node.id)}×` : null),
  // It is not an error - most useful graphs have undecided wires in them - but
  // it is the thing that silently withholds a greeting, so it is worth seeing
  // at a glance which parts of a canvas are decided and which are not.
  warnPort: (graph, node, _port, side) =>
    side === "out" && mayBeUnknown(graph, node.id)
      ? "May be undecided — wire it through a FILTER to settle it"
      : null,
  status: graphStatus,
  // Enabled and complete still reaches nobody when the greeting has no
  // condition wired to it, and that is the failure an operator cannot see.
  liveness: (graph) => (describe(graph) === null ? "idle" : "live"),
  strings: {
    add: "+ add",
    browse: "Browse blocks",
    search: "Search blocks",
    favorites: "Favorites",
    noMatches: "No block matches that.",
    complete: "Graph complete",
    toFix: (count) => `${count} to fix`,
    reset: "Reset",
    live: "LIVE",
    idle: "UNWIRED",
    enabled: "enabled",
  },
};

/* -- Bodies --------------------------------------------------------------- */

function WelcomeBody({ node, graph, onPatch }: NodeBodyProps<WelcomeNode>) {
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
          <PillSelect
            value={node.op === "less" ? "joined less than" : "joined more than"}
            options={["joined less than", "joined more than"]}
            onChange={(v) => onPatch({ op: v.endsWith("less than") ? "less" : "more" })}
          />
          <PillSelect
            value={`${node.window} ago`}
            options={TENURE_WINDOWS.map((w) => `${w} ago`)}
            onChange={(v) => onPatch({ window: v.replace(" ago", "") as typeof node.window })}
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

    case "account":
      return (
        <Stack direction="row" gap={0.75} alignItems="center">
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>is</Typography>
          <PillSelect
            value={node.state}
            options={[...ACCOUNT_STATES]}
            onChange={(v) => onPatch({ state: v as typeof node.state })}
          />
        </Stack>
      );

    case "os":
      return (
        <Stack direction="row" gap={0.75} alignItems="center">
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>is</Typography>
          <PillSelect
            value={node.os}
            options={[...OS_CHOICES]}
            onChange={(v) => onPatch({ os: v as typeof node.os })}
          />
        </Stack>
      );

    case "group":
      return (
        <PlainInput value={node.group} placeholder="group name" onChange={(group) => onPatch({ group })} />
      );

    case "filter":
      return (
        <Stack direction="row" alignItems="center" gap={0.75}>
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            unknown →
          </Typography>
          <PillSelect
            value={node.unknownAs}
            options={["no", "yes"]}
            onChange={(v) => onPatch({ unknownAs: v as typeof node.unknownAs })}
          />
        </Stack>
      );

    case "gate":
      return (
        <Stack gap={0.75}>
          {/* The input rows stay first: the ports on the left edge are
              placed against them, and a control above would shift every
              wire off the word it belongs to. */}
          <Stack gap={0.25}>
            {inputsOf(node).map((port) => (
              <Typography key={port} sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>
                {port.toUpperCase()}
              </Typography>
            ))}
          </Stack>
          <PillSelect
            value={node.gate}
            options={[...GATE_KINDS]}
            onChange={(v) => onPatch({ gate: v as typeof node.gate })}
          />
        </Stack>
      );

    case "text":
      return (
        <Stack gap={0.75} alignItems="flex-start">
          <PillSelect
            value={node.name || "unnamed"}
            options={[node.name || "unnamed"]}
            onChange={() => undefined}
          />
          <PlainInput
            value={node.body}
            placeholder="Text appended to a greeting"
            multiline
            onChange={(body) => onPatch({ body })}
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
  const snippets = graph.edges
    .filter((e) => e.to === node.id && e.port === "plus")
    .map((e) => graph.nodes.find((n) => n.id === e.from))
    .filter((n): n is WelcomeNode & { kind: "text" } => n?.kind === "text");

  return (
    <Stack gap={1}>
      <SectionLabel>When</SectionLabel>
      <PlainInput
        value={node.body}
        placeholder="What they read on arrival"
        multiline
        onChange={(body) => onPatch({ body })}
      />
      <SectionLabel>Plus text</SectionLabel>
      <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap", minHeight: 20 }}>
        {snippets.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            wire a reusable text here
          </Typography>
        )}
        {snippets.map((s) => (
          <TagChip key={s.id} label={s.name || "unnamed"} tone="ok" />
        ))}
      </Stack>
      <ToggleRow
        checked={node.once}
        label="Shown once, centered"
        onChange={() => onPatch({ once: !node.once })}
      />
    </Stack>
  );
}

/** The greeting's own preview, hung under the node it belongs to. */
function WelcomeAttachment({ node, graph }: NodeAttachmentProps<WelcomeNode>) {
  const subject = useContext(SubjectContext);
  if (node.kind !== "greeting") return null;
  return <GreetingPreview graph={graph} subject={subject} />;
}

/** ISO-3166 alpha-2, uppercased as the mock shows them. */
const COMMON_COUNTRIES = ["DE", "AT", "CH", "GB", "US", "FR", "NL", "PL", "SE", "ES", "IT"];
