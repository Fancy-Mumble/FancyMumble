import { plainTextOf } from "./markup";
import type { Edge, WelcomeGraph, WelcomeNode } from "./model";

/**
 * The graph the page opens on until the server has one to send.
 *
 * Scaffolding, and deliberately the mock's own example rather than something
 * empty: a node canvas with nothing on it teaches an operator nothing about
 * what it is for, and this one reads back as a sentence they can recognise -
 * "((country in DE/AT/CH and joined less than 1 month ago) xor (version < 1.5.0
 * or account is guest))".
 *
 * The greeting itself is formatted, and that is deliberate too: the editor can
 * write markup now, and a scaffold that opened on one line of plain prose would
 * be teaching the older half of the page.
 *
 * Replaced wholesale once `server-config` answers a `WelcomeQuery`; nothing
 * else imports it, so deleting this file is the whole removal.
 */

/** The German greeting the mock shows, as the WYSIWYG would write it. */
const GREETING_HTML = [
  '<h2 style="text-align: center">Willkommen, {name}!</h2>',
  "<p>Deutschsprachige Runden laufen in {channel} - schreib gern auf Deutsch.</p>",
].join("");

const node = (n: WelcomeNode): WelcomeNode => n;
const wire = (id: string, from: string, to: string, port: Edge["port"]): Edge => ({
  id,
  from,
  to,
  port,
});

export function seedGraph(): WelcomeGraph {
  const nodes: WelcomeNode[] = [
    node({ id: "country", kind: "country", x: 30, y: 34, codes: ["DE", "AT", "CH"] }),
    node({ id: "tenure", kind: "tenure", x: 30, y: 152, op: "less", window: "1 month" }),
    node({ id: "version", kind: "clientVersion", x: 30, y: 270, op: "<", version: "1.5.0" }),
    node({ id: "account", kind: "account", x: 30, y: 388, state: "guest" }),
    // One filter per condition: a gate takes settled answers only, so this
    // is where each condition's maybe becomes a yes or a no.
    node({ id: "fc", kind: "filter", x: 268, y: 34, unknownAs: "no" }),
    node({ id: "ft", kind: "filter", x: 268, y: 152, unknownAs: "no" }),
    node({ id: "fv", kind: "filter", x: 268, y: 270, unknownAs: "no" }),
    node({ id: "fa", kind: "filter", x: 268, y: 388, unknownAs: "no" }),
    node({ id: "and", kind: "gate", x: 486, y: 66, gate: "and" }),
    node({ id: "or", kind: "gate", x: 486, y: 300, gate: "or" }),
    node({ id: "xor", kind: "gate", x: 686, y: 174, gate: "xor" }),
    node({
      id: "rules",
      kind: "text",
      x: 686,
      y: 390,
      name: "rules",
      body: "House rules are pinned in #Lounge - two minutes, worth it.",
      html: "",
      view: "plain",
    }),
    node({
      id: "schedule",
      kind: "text",
      x: 686,
      y: 506,
      name: "schedule",
      body: "Rotation nights: Tue & Fri, 20:00 CET.",
      html: "",
      view: "plain",
    }),
    node({
      id: "greeting",
      kind: "greeting",
      x: 958,
      y: 122,
      once: true,
      // Derived, not written twice: the plain half is what a server with
      // `allow_html` off sends, and a scaffold that let the two drift would be
      // demonstrating the bug this editor exists to prevent.
      body: plainTextOf(GREETING_HTML),
      html: GREETING_HTML,
      view: "rich",
      // Prose, not a screen: the scaffold is about the wiring.
      sections: [],
    }),
  ];

  const edges: Edge[] = [
    wire("c1", "country", "fc", "a"),
    wire("c2", "tenure", "ft", "a"),
    wire("c3", "version", "fv", "a"),
    wire("c4", "account", "fa", "a"),
    wire("e1", "fc", "and", "a"),
    wire("e2", "ft", "and", "b"),
    wire("e3", "fv", "or", "a"),
    wire("e4", "fa", "or", "b"),
    wire("e5", "and", "xor", "a"),
    wire("e6", "or", "xor", "b"),
    wire("e7", "xor", "greeting", "when"),
    wire("e8", "rules", "greeting", "plus"),
    wire("e9", "schedule", "greeting", "plus"),
  ];

  return { nodes, edges, enabled: true };
}
