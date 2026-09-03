import { invoke } from "@tauri-apps/api/core";
import { requestOperatorTicket, type OperatorCreds } from "@standard/pages/admin/liveryAdmin";
import { richTextSurvives } from "../../primitives";
import { WINDOW_SECONDS, windowFor } from "./windows";
import type { Tone } from "../nodes";
import {
  ALIGNMENTS,
  ANNOTATION_SIZES,
  BAND_TONES,
  FANCY_OPS,
  PICTURES,
  SECTION_KINDS,
  annotationsOf,
  isLegacy,
  isScreen,
  markupOf,
  type Align,
  type AnnotationKind,
  type BandTone,
  type Picture,
  type Section,
  type SectionKind,
  type BodyView,
  type FancyOp,
  type UnknownAs,
  type VersionOp,
  type WelcomeGraph,
  type WelcomeNode,
} from "./model";

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
 * * a snippet and a greeting carry a markup half *and* a plain half, and which
 *   of them a node sends depends on how it is being written - see `markupOf`.
 *
 * The markup used to be carried past this module untouched, because nothing in
 * the editor authored it. The WYSIWYG views do now, so it travels on the node
 * like every other field, and the view a node opens in is worked out here
 * rather than stored: a node that arrived with markup opens in the editor when
 * the editor can hold it and as source when it cannot, which is the one rule
 * that keeps somebody from being shown a lossy copy of their own welcome text.
 */

/** The scope the operator API checks for both halves of this page. */
const SCOPES = ["server-config:read", "server-config:write"] as const;

/** A node as the wire carries it: the model, with the three translations. */
type WireNode = Record<string, unknown> & { id: string; x: number; y: number; kind: string };

/**
 * One band of a welcome screen on the wire.
 *
 * The editor's own shape minus the id, which is local: a band is addressed by
 * where it sits in the list, so there is nothing for the wire to carry.
 */
type WireSection = Omit<Section, "id">;

/** A note on the canvas, which the wire carries verbatim. */
interface WireAnnotation {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  kind: string;
  text?: string;
  tone?: string;
}

interface WireDoc {
  enabled: boolean;
  nodes: WireNode[];
  edges: { id: string; from: string; to: string; port: string }[];
  annotations?: WireAnnotation[];
}

/** A greeting on the wire also says which dialect its markup is written in. */

/** The four notes, as both ends spell them. */
const ANNOTATION_KINDS: readonly AnnotationKind[] = ["title", "note", "frame", "label"];
const TONES: readonly Tone[] = ["muted", "accent", "ok", "warn"];

/**
 * A size on its way out.
 *
 * Left off entirely when nobody dragged it, so a node the operator never
 * resized carries no size at all rather than this build's default for its
 * kind - which would freeze a layout decision that belongs to the editor into
 * the stored document, where the *next* version of the editor would be stuck
 * with it.
 */
function sizeOf(node: WelcomeNode): { w?: number; h?: number } {
  const size: { w?: number; h?: number } = {};
  if (node.w !== undefined && node.w > 0) size.w = Math.round(node.w);
  if (node.h !== undefined && node.h > 0) size.h = Math.round(node.h);
  return size;
}

/**
 * Which view a node arriving with `html` opens in.
 *
 * Source rather than the editor whenever Tiptap would rewrite the document.
 * The check runs once, here, on the value the server sent - not on what is
 * being typed - so an operator editing markup by hand is not thrown into the
 * WYSIWYG the moment their document happens to simplify.
 */
function viewFor(html: string): BodyView {
  if (html.trim() === "") return "plain";
  return richTextSurvives(html, "document") ? "rich" : "source";
}

function toWire(graph: WelcomeGraph): WireDoc {
  return {
    enabled: graph.enabled,
    nodes: graph.nodes.map((node) => {
      const base = {
        id: node.id,
        x: Math.round(node.x),
        y: Math.round(node.y),
        ...sizeOf(node),
        kind: node.kind,
      };
      switch (node.kind) {
        case "country":
          return { ...base, codes: node.codes };
        case "tenure":
          return { ...base, op: node.op, windowSeconds: WINDOW_SECONDS[node.window] };
        case "clientVersion":
          return { ...base, op: node.op, version: node.version };
        case "fancyVersion":
          // No version beside `any`: it compares against nothing, and the
          // server leaves the field off in the same case. A number here would
          // read as one the node uses.
          return { ...base, op: node.op, ...(node.op === "any" ? {} : { version: node.version }) };
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
          return { ...base, name: node.name, body: node.body, html: markupOf(node) };
        case "greeting":
          return {
            ...base,
            body: node.body,
            once: node.once,
            html: markupOf(node),
            // Only from a node actually built as a screen: a greeting written
            // as prose sends no bands at all, so a document that never used
            // one reads exactly as it did before bands existed.
            sections: (isScreen(node) ? node.sections : []).map(({ id: _id, ...band }): WireSection => band),
            legacy: isLegacy(node),
          };
      }
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      port: edge.port,
    })),
    annotations: annotationsOf(graph).map((note) => ({
      id: note.id,
      x: Math.round(note.x),
      y: Math.round(note.y),
      w: Math.round(note.w),
      h: Math.round(note.h),
      kind: note.kind,
      text: note.text,
      tone: note.tone,
    })),
  };
}

function fromWire(doc: WireDoc): WelcomeGraph {
  const nodes: WelcomeNode[] = [];
  for (const raw of doc.nodes ?? []) {
    // A size of zero from the wire means "the editor's default", which is
    // exactly what leaving the field off the node means here.
    const at = {
      id: raw.id,
      x: raw.x ?? 0,
      y: raw.y ?? 0,
      ...(Number(raw.w) > 0 ? { w: Number(raw.w) } : {}),
      ...(Number(raw.h) > 0 ? { h: Number(raw.h) } : {}),
    };
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
      case "fancyVersion":
        nodes.push({
          ...at,
          kind: "fancyVersion",
          // An op this build does not know falls back to `any`, which is the
          // widest of them: a rule about the fork's client read by an older
          // editor should still be *about* the fork's client.
          op: FANCY_OPS.includes(raw.op as FancyOp) ? (raw.op as FancyOp) : "any",
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
      case "text": {
        const html = String(raw.html ?? "");
        nodes.push({
          ...at,
          kind: "text",
          name: String(raw.name ?? ""),
          body: String(raw.body ?? ""),
          html,
          view: viewFor(html),
        });
        break;
      }
      case "greeting": {
        const html = String(raw.html ?? "");
        const sections = readSections(raw.sections);
        nodes.push({
          ...at,
          kind: "greeting",
          body: String(raw.body ?? ""),
          once: Boolean(raw.once),
          html,
          // Bands win over markup: a greeting that has them *is* a screen, and
          // the markup beside it is the copy generated for clients that cannot
          // draw one.
          // Bands win over markup: a greeting that has them *is* a screen, and
          // the markup beside it is the copy generated for clients that cannot
          // draw one. Which dialect that copy is in is carried rather than
          // guessed at - the two are both markup, and one recompiled as the
          // other would silently undo a greeting written for old clients.
          view: sections.length === 0 ? viewFor(html) : raw.legacy ? "legacy" : "screen",
          sections,
        });
        break;
      }
      default:
        // A kind this build does not know is dropped rather than guessed at.
        // It came from a newer server, and a node drawn wrong is worse than a
        // node missing - the operator can see the second one is not there.
        break;
    }
  }
  return {
    enabled: Boolean(doc.enabled),
    nodes,
    edges: (doc.edges ?? []).map((edge) => ({ ...edge, port: edge.port as never })),
    annotations: (doc.annotations ?? []).map((note) => ({
      id: note.id,
      x: note.x ?? 0,
      y: note.y ?? 0,
      // A note with no size is one from a server that stored none. It gets the
      // editor's default for its kind rather than a zero-sized box nobody can
      // find on the canvas to drag open.
      w: Number(note.w) > 0 ? Number(note.w) : ANNOTATION_SIZES[kindOf(note.kind)].w,
      h: Number(note.h) > 0 ? Number(note.h) : ANNOTATION_SIZES[kindOf(note.kind)].h,
      kind: kindOf(note.kind),
      text: String(note.text ?? ""),
      tone: TONES.includes(note.tone as Tone) ? (note.tone as Tone) : "muted",
    })),
  };
}

/**
 * The bands as the editor holds them.
 *
 * Every field defaulted rather than trusted: this document came from a server,
 * which may be running a build that writes a field this one has never heard of
 * or omits one it expects. A band with a kind this build does not know is read
 * as a header rather than dropped - the words in it are the part somebody
 * wrote.
 */
function readSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: Record<string, unknown>, index) => {
    const kind = SECTION_KINDS.includes(entry["kind"] as SectionKind)
      ? (entry["kind"] as SectionKind)
      : "header";
    return {
      // Ids are the editor's own, for React keys and for reordering; the wire
      // has no place for one and needs none, because a band is addressed by
      // where it sits.
      id: `s${index}:${kind}`,
      kind,
      title: String(entry["title"] ?? ""),
      subtitle: String(entry["subtitle"] ?? ""),
      html: String(entry["html"] ?? ""),
      url: String(entry["url"] ?? ""),
      glyph: String(entry["glyph"] ?? ""),
      primary: Boolean(entry["primary"]),
      // Each narrowed against its own list rather than trusted: these came
      // from a server, which may be running a build with a value this one has
      // never heard of, and an unknown alignment has to become "the kind's own
      // habit" rather than a string nothing in the renderer matches.
      align: ALIGNMENTS.includes(entry["align"] as Align) ? (entry["align"] as Align) : "default",
      tone: BAND_TONES.includes(entry["tone"] as BandTone) ? (entry["tone"] as BandTone) : "none",
      picture: PICTURES.includes(entry["picture"] as Picture) ? (entry["picture"] as Picture) : "icon",
      compact: Boolean(entry["compact"]),
      cards: Array.isArray(entry["cards"])
        ? (entry["cards"] as Record<string, unknown>[]).map((card) => ({
            eyebrow: String(card["eyebrow"] ?? ""),
            label: String(card["label"] ?? ""),
            url: String(card["url"] ?? ""),
          }))
        : [],
    };
  });
}

/** A kind this build does not know keeps its words, as a title. */
function kindOf(name: string): AnnotationKind {
  return ANNOTATION_KINDS.includes(name as AnnotationKind) ? (name as AnnotationKind) : "title";
}

/** A ticket for both halves of this page, minted from the live session. */
async function credentials(): Promise<OperatorCreds> {
  const ticket = await requestOperatorTicket(SCOPES);
  if (!ticket.token || !ticket.baseUrl) {
    throw new Error(ticket.deniedReason || "the server granted no operator credential");
  }
  return { baseUrl: ticket.baseUrl, token: ticket.token };
}

export async function loadGreeting(): Promise<WelcomeGraph> {
  const creds = await credentials();
  const doc = await invoke<WireDoc>("greeting_get", { ...creds });
  return fromWire(doc);
}

export async function saveGreeting(graph: WelcomeGraph): Promise<void> {
  const creds = await credentials();
  await invoke<void>("greeting_set", { ...creds, graph: toWire(graph) });
}
