import { invoke } from "@tauri-apps/api/core";
import { requestOperatorTicket, type OperatorCreds } from "@standard/pages/admin/liveryAdmin";
import { TENURE_WINDOWS, type UnknownAs, type VersionOp, type WelcomeGraph, type WelcomeNode } from "./model";

/** The comparisons a version condition offers, for reading one back. */
const VERSION_OPS: readonly VersionOp[] = ["<", "<=", "=", ">=", ">"];

/**
 * Reading and writing the welcome graph.
 *
 * Over the operator API rather than the control channel, for the reason livery's
 * artwork goes the same way: this is a nested document the control connection
 * has no arm for, and the ticket that reaches the API is minted from the session
 * this client already holds - nobody types an address or a token.
 *
 * The JSON is the editor's own model, near enough to send verbatim. Three
 * fields are translated here because the server's shape is the honest one and
 * the editor's is the readable one:
 *
 * * a tenure window is a label on screen and seconds on the wire;
 * * a version is a string both ways, but the *server* packs it - a client that
 *   packed it would be a second implementation of an encoding that has already
 *   gone wrong once in this codebase;
 * * a snippet and a greeting carry a markup half nothing here authors, which is
 *   round-tripped untouched so an operator who set it through the API does not
 *   lose it the moment somebody opens the canvas.
 */

/** The scope the operator API checks for both halves of this page. */
const SCOPES = ["server-config:read", "server-config:write"] as const;

/** Seconds per window, in the order the dropdown offers them. */
const WINDOW_SECONDS: Record<(typeof TENURE_WINDOWS)[number], number> = {
  "1 day": 86_400,
  "1 week": 604_800,
  "1 month": 2_592_000,
  "6 months": 15_552_000,
  "1 year": 31_536_000,
};

/** The nearest window to `seconds`, so a hand-written value still reads. */
function windowFor(seconds: number): (typeof TENURE_WINDOWS)[number] {
  // Widened deliberately: `TENURE_WINDOWS[0]` narrows to its own literal, and
  // the loop below has to be able to move off it.
  let nearest: (typeof TENURE_WINDOWS)[number] = TENURE_WINDOWS[0];
  for (const label of TENURE_WINDOWS) {
    if (Math.abs(WINDOW_SECONDS[label] - seconds) < Math.abs(WINDOW_SECONDS[nearest] - seconds)) {
      nearest = label;
    }
  }
  return nearest;
}

/** A node as the wire carries it: the model, with the three translations. */
type WireNode = Record<string, unknown> & { id: string; x: number; y: number; kind: string };

interface WireDoc {
  enabled: boolean;
  nodes: WireNode[];
  edges: { id: string; from: string; to: string; port: string }[];
}

/**
 * The markup halves the editor does not author, kept beside the graph so a save
 * can hand them back exactly as they arrived.
 *
 * Keyed by node id. A node the operator deletes drops out of the graph and its
 * entry here is simply never read again.
 */
export type CarriedMarkup = ReadonlyMap<string, string>;

function toWire(graph: WelcomeGraph, markup: CarriedMarkup): WireDoc {
  return {
    enabled: graph.enabled,
    nodes: graph.nodes.map((node) => {
      const base = { id: node.id, x: Math.round(node.x), y: Math.round(node.y), kind: node.kind };
      switch (node.kind) {
        case "country":
          return { ...base, codes: node.codes };
        case "tenure":
          return { ...base, op: node.op, windowSeconds: WINDOW_SECONDS[node.window] };
        case "clientVersion":
          return { ...base, op: node.op, version: node.version };
        case "account":
          return { ...base, state: node.state };
        case "group":
          return { ...base, group: node.group };
        case "os":
          return { ...base, os: node.os };
        case "gate":
          return { ...base, gate: node.gate };
        case "filter":
          return { ...base, unknownAs: node.unknownAs };
        case "text":
          return { ...base, name: node.name, body: node.body, html: markup.get(node.id) ?? "" };
        case "greeting":
          return { ...base, body: node.body, once: node.once, html: markup.get(node.id) ?? "" };
      }
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      port: edge.port,
    })),
  };
}

function fromWire(doc: WireDoc): { graph: WelcomeGraph; markup: CarriedMarkup } {
  const markup = new Map<string, string>();
  const nodes: WelcomeNode[] = [];
  for (const raw of doc.nodes ?? []) {
    const at = { id: raw.id, x: raw.x ?? 0, y: raw.y ?? 0 };
    switch (raw.kind) {
      case "country":
        nodes.push({ ...at, kind: "country", codes: (raw.codes as string[]) ?? [] });
        break;
      case "tenure":
        nodes.push({
          ...at,
          kind: "tenure",
          op: raw.op === "more" ? "more" : "less",
          window: windowFor(Number(raw.windowSeconds ?? 0)),
        });
        break;
      case "clientVersion":
        nodes.push({
          ...at,
          kind: "clientVersion",
          // A comparison this build does not know falls back to `<` rather
          // than being carried through as an unrenderable string.
          op: VERSION_OPS.includes(raw.op as VersionOp) ? (raw.op as VersionOp) : "<",
          version: String(raw.version ?? ""),
        });
        break;
      case "account":
        nodes.push({ ...at, kind: "account", state: raw.state as never });
        break;
      case "group":
        nodes.push({ ...at, kind: "group", group: String(raw.group ?? "") });
        break;
      case "os":
        nodes.push({ ...at, kind: "os", os: raw.os as never });
        break;
      case "gate":
        nodes.push({ ...at, kind: "gate", gate: raw.gate as never });
        break;
      case "filter":
        nodes.push({ ...at, kind: "filter", unknownAs: (raw.unknownAs as UnknownAs) ?? "no" });
        break;
      case "text":
        if (raw.html) markup.set(raw.id, String(raw.html));
        nodes.push({
          ...at,
          kind: "text",
          name: String(raw.name ?? ""),
          body: String(raw.body ?? ""),
        });
        break;
      case "greeting":
        if (raw.html) markup.set(raw.id, String(raw.html));
        nodes.push({
          ...at,
          kind: "greeting",
          body: String(raw.body ?? ""),
          once: Boolean(raw.once),
        });
        break;
      default:
        // A kind this build does not know is dropped rather than guessed at.
        // It came from a newer server, and a node drawn wrong is worse than a
        // node missing - the operator can see the second one is not there.
        break;
    }
  }
  return {
    graph: {
      enabled: Boolean(doc.enabled),
      nodes,
      edges: (doc.edges ?? []).map((edge) => ({ ...edge, port: edge.port as never })),
    },
    markup,
  };
}

/** A ticket for both halves of this page, minted from the live session. */
async function credentials(): Promise<OperatorCreds> {
  const ticket = await requestOperatorTicket(SCOPES);
  if (!ticket.token || !ticket.baseUrl) {
    throw new Error(ticket.deniedReason || "the server granted no operator credential");
  }
  return { baseUrl: ticket.baseUrl, token: ticket.token };
}

export async function loadGreeting(): Promise<{ graph: WelcomeGraph; markup: CarriedMarkup }> {
  const creds = await credentials();
  const doc = await invoke<WireDoc>("greeting_get", { ...creds });
  return fromWire(doc);
}

export async function saveGreeting(graph: WelcomeGraph, markup: CarriedMarkup): Promise<void> {
  const creds = await credentials();
  await invoke<void>("greeting_set", { ...creds, graph: toWire(graph, markup) });
}
