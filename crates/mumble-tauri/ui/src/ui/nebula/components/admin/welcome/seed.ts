import { plainTextOf } from "./markup";
import type { Edge, WelcomeGraph, WelcomeNode } from "./model";

/**
 * The graph the page opens on until the server has one to send.
 *
 * The smallest thing that is already a working greeting: **everybody who
 * arrives, and what they read**. Two nodes and one wire.
 *
 * It used to be the design mock's own example - eleven nodes, four conditions,
 * four filters and three logic gates, reading back as "((country in DE/AT/CH
 * and joined less than 1 month ago) xor (version < 1.5.0 or account is
 * guest))". That demonstrated everything the canvas can do and taught nobody
 * where to start: an operator opening the page for the first time had to
 * understand a boolean expression before they could change a word of the
 * welcome, and the safe move in front of somebody else's eleven-node drawing
 * is to not touch it.
 *
 * So the scaffold is now the first sentence rather than the whole vocabulary.
 * Everything the old seed showed off is still one press away in the template
 * gallery, which is where a worked example belongs - it can be *chosen*, and
 * choosing it is not the same as being handed it.
 *
 * Replaced wholesale once `server-config` answers a `WelcomeQuery`; nothing
 * else imports it, so deleting this file is the whole removal.
 */

/** What a fresh server greets people with, as the WYSIWYG would write it. */
const GREETING_HTML = [
  '<h2 style="text-align: center">Welcome aboard</h2>',
  "<p>Glad you found us. Have a look around, and say hello.</p>",
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
    // "Everyone": a filter with nothing wired to it, settling `unknown` to
    // yes. Both evaluators read that as true of every arrival - see
    // `isEveryone` - so this is the whole condition, and there is nothing
    // about gates or unknown facts to learn before editing the words.
    node({ id: "everyone", kind: "filter", x: 40, y: 120, unknownAs: "yes" }),
    node({
      id: "greeting",
      kind: "greeting",
      x: 320,
      y: 40,
      once: true,
      body: plainTextOf(GREETING_HTML),
      html: GREETING_HTML,
      view: "rich",
      sections: [],
    }),
  ];

  const edges: Edge[] = [wire("e1", "everyone", "greeting", "when")];

  return { nodes, edges, enabled: true };
}
