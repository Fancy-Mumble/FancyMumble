/**
 * The welcome editor's template catalogue.
 *
 * Each entry is a finished rule: the conditions, the wires between them, and a
 * written message - so an operator who presses one gets a graph the status bar
 * already calls complete, and can then change the words rather than work out
 * what a filter is for. That is the whole intent. The canvas is a good way to
 * *edit* a greeting and a poor way to *begin* one, and "greet the people who
 * just got here, nicely" is six nodes and a paragraph of markup away from an
 * empty grid.
 *
 * Three rules every body here follows, and the tests hold them to all three:
 *
 * 1. **It survives the editor.** A template that opened in the HTML view
 *    instead of the WYSIWYG would be a template nobody could edit the easy
 *    way, which defeats the point of shipping one. Tiptap rewrites what it
 *    cannot represent, so the markup is written the way Tiptap writes it -
 *    `style="text-align: center"` and not `align="center"`, no tables at all.
 * 2. **It survives the sanitiser.** Every surface in this client renders
 *    untrusted markup through one allow-list, so anything not on it is missing
 *    from what people actually read.
 * 3. **It fits.** The server takes 4096 characters per body and refuses the
 *    whole document over it.
 *
 * No `{name}`. The editor's preview substitutes it, and *nothing else in the
 * stack does* - not the server that composes the greeting at handshake, not the
 * client that shows it - so a template built around it would ship a greeting
 * that reads "Welcome, {name}" to everybody. The placeholders stay supported
 * for the operator who knows what they are for; they are not put in anybody's
 * mouth by default.
 */

import { inputPort, makeNode, type WelcomeNode } from "./model";
import { assemble, compileTarget } from "./compile";
import type { Block, BlockType, Design } from "./design";
import { plainTextOf } from "./markup";
import { makeSection, markupOfScreen, plainOfScreen, type Section } from "./layout";
import { legacyMarkupOfScreen } from "./qtHtml";
import { wire, type Fragment, type GraphTemplate } from "../nodes";

/* -- Building one --------------------------------------------------------- */

/** A node of `kind` with its fields set, at a place in the fragment. */
function node<K extends WelcomeNode["kind"]>(
  kind: K,
  x: number,
  y: number,
  fields: Omit<Extract<WelcomeNode, { kind: K }>, "id" | "kind" | "x" | "y">,
): Extract<WelcomeNode, { kind: K }> {
  return { ...(makeNode(kind, x, y) as Extract<WelcomeNode, { kind: K }>), ...fields };
}

/**
 * A greeting node whose plain half is derived rather than written twice.
 *
 * The same invariant the editor keeps while somebody types, kept here so a
 * catalogue cannot drift: a template with a hand-written plain half is one
 * paragraph edit away from sending two different greetings, and only one of
 * them is visible on this page.
 */
function greeting(
  x: number,
  y: number,
  html: string,
  options: Readonly<{ once?: boolean }> = {},
): Extract<WelcomeNode, { kind: "greeting" }> {
  return node("greeting", x, y, {
    html,
    body: plainTextOf(html),
    once: options.once ?? true,
    view: "rich",
    // Written as prose. A screen is a different starting point, and the
    // catalogue offers one of those separately.
    sections: [],
  });
}

/**
 * A greeting built as a screen: bands, with the two prose halves generated.
 *
 * The same invariant every other message keeps - all three representations
 * written together - so the client that draws bands and the one that cannot
 * are never shown different greetings.
 */
function screen(
  x: number,
  y: number,
  sections: Section[],
  view: "screen" | "legacy" = "screen",
): Extract<WelcomeNode, { kind: "greeting" }> {
  return node("greeting", x, y, {
    sections,
    html: view === "legacy" ? legacyMarkupOfScreen(sections) : markupOfScreen(sections),
    body: plainOfScreen(sections),
    once: true,
    view,
  });
}

/**
 * The bands of the full welcome screen.
 *
 * A function rather than a constant because a band carries an id, and two
 * templates on one canvas must not share one.
 */
function fullScreenBands(): Section[] {
  return [
    band("header", { title: "This server" }),
    ...frontDoorBands(),
    band("cards", {
      cards: [
        { eyebrow: "BROWSE", label: "Channel viewer", url: "https://example.org/channels" },
        { eyebrow: "LIVE", label: "Server status", url: "https://example.org/status" },
      ],
    }),
  ];
}

/**
 * The whole front page, band for band.
 *
 * Deliberately the busiest thing in the catalogue: it exists to show that a
 * painted bar, artwork, a centred column and a footer notice are all available,
 * because an operator who cannot see that they are will conclude the editor
 * cannot do it and go back to writing HTML by hand.
 */
function frontPageBands(): Section[] {
  return [
    band("header", { title: "Welcome to Magical.Rocks", tone: "muted", align: "center" }),
    band("image", { picture: "icon" }),
    band("hero", { glyph: "", title: "Magical.Rocks", subtitle: "The home of Fancy Mumble." }),
    band("prose", {
      align: "center",
      html:
        "<p>We are a small community of enthusiasts who love to share knowledge and " +
        "experiences. Explore new ideas, join the discussions, make a few friends.</p>",
    }),
    band("prose", { align: "center", html: "<p><strong>Version:</strong> 0.2.18</p>" }),
    band("cards", {
      title: "Links",
      align: "center",
      compact: true,
      cards: [
        { eyebrow: "", label: "Channel viewer", url: "https://example.org/channels" },
        { eyebrow: "", label: "Server status", url: "https://example.org/status" },
      ],
    }),
    band("action", {
      title: "Register",
      url: "https://example.org/register",
      primary: true,
    }),
    band("prose", {
      tone: "danger",
      align: "center",
      html:
        "<p>Registration is currently disabled. Check the " +
        '<a href="https://example.org/status">registration status page</a> for more.</p>',
    }),
  ];
}

/** The bands both halves of the old-and-new template share. */
function frontDoorBands(): Section[] {
  return [
    band("hero", {
      glyph: "◆",
      title: "Welcome aboard",
      subtitle: "A small community, and glad you found it.",
    }),
    band("prose", {
      html: "<p>Grab a channel, say hello, and shout if anything is broken.</p>",
    }),
    band("action", {
      title: "Register your account",
      subtitle: "Takes about thirty seconds.",
      url: "https://example.org/register",
      primary: true,
    }),
  ];
}

/** A band of `kind` with its fields filled in. */
function band(kind: Section["kind"], fields: Partial<Section> = {}): Section {
  return { ...makeSection(kind), ...fields };
}

/** A reusable snippet, likewise derived. */
function snippet(x: number, y: number, name: string, html: string): Extract<WelcomeNode, { kind: "text" }> {
  return node("text", x, y, { name, html, body: plainTextOf(html), view: "rich" });
}

/**
 * A condition on its way into a gate or a greeting, with its filter.
 *
 * Every condition rests on a fact the server may not have - no geo-IP
 * database, a guest with no account age - so every one of them has to pass
 * through a filter before a gate will take it. Two nodes and a wire, every
 * time, which is exactly the shape an operator gets wrong when they draw it by
 * hand and then wonders why the greeting reaches nobody.
 */
function settled(
  condition: WelcomeNode,
  unknownAs: "yes" | "no" = "no",
): { nodes: WelcomeNode[]; wires: ReturnType<typeof wire>[]; out: WelcomeNode } {
  const filter = node("filter", condition.x + 238, condition.y, { unknownAs });
  return {
    nodes: [condition, filter],
    wires: [wire(condition, filter, "a")],
    out: filter,
  };
}

/* -- Designed greetings ---------------------------------------------------- */

/**
 * A greeting laid out in the design editor, rather than written as prose.
 *
 * The design *is* the message here: there is no `html` and no `body` on the
 * node, because a design compiles to a different document per target and the
 * server assembles it per peer. Everything else about the node is a greeting
 * like any other, which is what lets one of these be gated and wired the same
 * way the prose templates are.
 */
function designed(
  x: number,
  y: number,
  design: Design,
  fallback?: { html: string; body: string },
): Extract<WelcomeNode, { kind: "greeting" }> {
  return node("greeting", x, y, {
    design,
    view: "design",
    once: true,
    // What a reader on a target the sheet does not claim is sent. The server
    // falls back to these halves when a design has nothing compiled for
    // somebody, so a sheet that is deliberately only for the markup clients
    // needs them written - or the old client gets a greeting of nothing at
    // all, which is worse than the flattened one it was avoiding.
    html: fallback?.html ?? "",
    body: fallback?.body ?? "",
    sections: [],
  });
}

/** What the modern sheet says to a client that cannot draw a word of it. */
const MODERN_FALLBACK_HTML =
  "<p><strong>Welcome to Magical Rocks.</strong></p>" +
  "<p>A small room for people who like the same things you do. " +
  "Pick a channel, say hello, and shout if anything breaks.</p>" +
  "<p>Push-to-talk is under Settings \u2192 Audio.</p>";
const MODERN_FALLBACK_TEXT =
  "Welcome to Magical Rocks.\n\n" +
  "A small room for people who like the same things you do. " +
  "Pick a channel, say hello, and shout if anything breaks.\n\n" +
  "Push-to-talk is under Settings > Audio.";

/** Ids unique within one catalogue build, which is all a block id has to be. */
let block = 0;
const at = (
  type: BlockType,
  x: number,
  y: number,
  w: number,
  fields: Partial<Block> = {},
): Block => {
  block += 1;
  return { id: `t${block.toString(36)}`, type, x, y, w, ...fields };
};

/**
 * A designed front page: the blocks the old client can now draw too.
 *
 * Chosen to be exactly the set that used to be dropped or flattened on Qt - a
 * card, a callout, a row of columns, a filled button, a footer - because the
 * point of shipping this one is that an operator can press it, open the Qt tab
 * and see that it survived.
 */
function designedFrontPage(): Design {
  return {
    sheetW: 520,
    slots: [{ id: "s1", name: "rules" }],
    conditions: [{ id: "c1", name: "is_new_member", on: true }],
    blocks: [
      at("mark", 216, 24, 88, { h: 72, glyph: "◆", align: "center" }),
      at("heading", 40, 108, 440, { size: 30, align: "center", text: "Welcome aboard" }),
      at("text", 40, 160, 440, {
        size: 14,
        align: "center",
        text: "A small community, and glad you found it. Have a look around, and say hello.",
      }),
      at("divider", 40, 220, 440),
      at("columns", 40, 244, 440, {
        items: [
          { kicker: "Browse", label: "Channel viewer", url: "https://example.org/channels" },
          { kicker: "Live", label: "Server status", url: "https://example.org/status" },
        ],
      }),
      at("notice", 40, 320, 440, {
        tone: "info",
        text: "<p>Push-to-talk is the default. You can change it in Settings &rarr; Audio.</p>",
      }),
      at("callout", 40, 392, 440, {
        text: "The house rules are pinned in #Lounge. Two minutes, worth it.",
        gate: "is_new_member",
      }),
      at("slot", 40, 460, 440, { slot: "rules", fallback: "<p>Be kind, and mind the channel topics.</p>" }),
      at("button", 40, 524, 440, {
        align: "center",
        style: "button",
        text: "Register your account",
        url: "https://example.org/register",
      }),
      at("divider", 40, 570, 440),
      at("footer", 40, 596, 440, { align: "center", text: "You will only see this once." }),
    ],
    overrides: {},
  };
}

/**
 * The line icons the modern template draws, inlined.
 *
 * A data URI because that is the only picture the sanitiser every reader
 * renders through will keep: an `<img>` pointing anywhere else is dropped, so
 * that a greeting cannot be used to log the address of everybody who joins.
 *
 * Hand-written and small, at the 1.5px stroke on a 24 grid that current icon
 * sets are drawn to, because the whole compiled greeting is capped at 4096
 * characters and each of these is about 300 of them.
 */
const ICON_HASH =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOGE4Zjk4IiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIj48cGF0aCBkPSJNNSA3aDExTTQgMTJoMTFNOCAzbC0yIDEyTTE0IDNsLTIgMTIiLz48L3N2Zz4=";
const ICON_MIC =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOGE4Zjk4IiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIj48cmVjdCB4PSI2LjUiIHk9IjIiIHdpZHRoPSI1IiBoZWlnaHQ9IjkiIHJ4PSIyLjUiLz48cGF0aCBkPSJNNCA4LjVhNSA1IDAgMCAwIDEwIDBNOSAxMy41VjE2Ii8+PC9zdmc+";

/** One tile of the two-up: a hairline card holding an icon and two lines. */
function tile(x: number, src: string, title: string, body: string): Block[] {
  return [
    at("group", x, 250, 240, {
      h: 96,
      bg: "rgba(255,255,255,.025)",
      border: "rgba(255,255,255,.06)",
      radius: 10,
      pad: 15,
      gap: 5,
    }),
    at("image", x + 8, 258, 18, { h: 18, src }),
    at("text", x + 8, 282, 200, {
      h: 20,
      bare: true,
      size: 13.5,
      weight: 590,
      fg: "#e8ebf2",
      margin: "9px 0 3px",
      text: title,
    }),
    at("text", x + 8, 306, 200, {
      h: 30,
      bare: true,
      size: 12.5,
      leading: 150,
      fg: "#858d9a",
      text: body,
    }),
  ];
}

/**
 * A greeting that looks like it was made this decade.
 *
 * There have been three versions of this, and the first two were wrong in
 * instructive ways. The first was honest about what the editor could do and
 * that was the problem: square corners, six pixels of padding everywhere, one
 * type size doing all the work. It read as 2003 because every one of those
 * *was* 2003 - not a style choice but the absence of any control to make
 * another one. The second had controls and used them the way 2010 did: a
 * full-width saturated hero with white type centred on it, because a coloured
 * slab was the only way the editor knew to say "these things belong together".
 *
 * This one was designed as a flat mock first, with no blocks in mind at all,
 * and then rebuilt here until the compiled markup rendered pixel-for-pixel
 * identical to it. Everything the rebuild could not express became a control -
 * the group, the gradient, the inlined image, the lit top edge, the fitted
 * box, free weights and fractional tracking - which is a better way to find
 * out what a design system is missing than asking it.
 *
 * What makes it current, concretely, and each is a thing the editor could not
 * do before:
 *
 * * **A group** holding everything, with a hairline rule, a lit top edge and a
 *   wash of the accent over one corner at 11% - depth from light rather than
 *   from a drop shadow, which is what dark interfaces do now and which no
 *   sanitiser here would have passed as a shadow anyway.
 * * **A live presence cluster**: real faces of the people actually on the
 *   server, and a real count, drawn by the client that reads the greeting.
 *   Not a number written at save time, which could never be true for whoever
 *   is reading it.
 * * **The display line at weight 510**, not 700 - the client ships Inter as a
 *   variable font and the stops current interfaces use are between the named
 *   ones - tracked at -0.022em, which is Inter's own metric for 32px.
 * * **A two-up of hairline tiles**, each with a real line icon inlined.
 * * **One accent moment**: the primary button, with a lighter top border
 *   standing in for the inner highlight. The secondary is a ghost.
 *
 * It is for the markup clients only. Classic Mumble has no gradient, no data
 * URI and no rounded corner, and this design is mostly those three things - so
 * a server whose readers are on 1.5 wants one of the other templates rather
 * than this one flattened into something it is not.
 */
function designedModern(): Design {
  return {
    sheetW: 560,
    slots: [],
    conditions: [{ id: "c1", name: "is_new_member", on: true }],
    // The markup clients only. Classic Mumble has no gradient, no data URI and
    // no rounded corner, and this sheet is mostly those three - flattened into
    // its table markup it is both unrecognisable and over the 4096-character
    // cap, because Qt needs a whole table around each block where a browser
    // needs a span. Those readers get the greeting's written halves instead,
    // which is what the fallback is for.
    only: ["rich", "html"],
    blocks: [
      // The panel. Everything else is drawn inside this rectangle, which is
      // how it becomes a child of it: the nesting is the geometry.
      at("group", 0, 0, 560, {
        h: 470,
        grad: "radial-gradient(110% 80% at 0% 0%,rgba(110,139,255,.11),rgba(0,0,0,0) 62%)",
        bg: "rgba(255,255,255,.02)",
        border: "rgba(255,255,255,.07)",
        borderTop: "rgba(255,255,255,.13)",
        radius: 14,
        pad: 30,
      }),
      // Who is on the server, drawn by the client that reads this. It was
      // three hand-drawn circles and the words "+38 online" - a picture of a
      // presence indicator rather than one - and no number written here could
      // ever have been true for the person reading it.
      at("presence", 10, 10, 320, { h: 34, faces: 3, text: "online", margin: "0 0 20px" }),
      at("text", 10, 70, 500, {
        h: 40,
        bare: true,
        size: 32,
        weight: 510,
        leading: 113,
        tracking: -2.2,
        fg: "#f7f8f8",
        margin: "0 0 10px",
        text: "Welcome to Magical Rocks",
      }),
      at("text", 10, 130, 500, {
        h: 50,
        bare: true,
        size: 15,
        leading: 160,
        tracking: -1.1,
        fg: "#aeb5c2",
        measure: 430,
        margin: "0 0 24px",
        text:
          "A small room for people who like the same things you do. " +
          "Pick a channel, say hello, and shout if anything breaks.",
      }),
      at("group", 10, 240, 500, { h: 120, flow: "cells", margin: "0 0 22px" }),
      ...tile(20, ICON_HASH, "Find a channel", "Nine of them. General is the loud one."),
      ...tile(270, ICON_MIC, "Set push to talk", "Settings, then Audio. Ten seconds."),
      at("group", 10, 380, 500, { h: 46, flow: "row" }),
      at("button", 16, 388, 180, {
        h: 34,
        style: "button",
        text: "Register your account",
        url: "https://example.org/register",
        bg: "#5e6ad2",
        border: "#6e79e0",
        borderTop: "#8b94ea",
        fg: "#f7f8f8",
        radius: 7,
        padCss: "9px 17px",
        size: 13.5,
        weight: 510,
        grow: true,
        gate: "is_new_member",
      }),
      at("button", 210, 388, 120, {
        h: 34,
        style: "button",
        text: "House rules",
        url: "https://example.org/rules",
        gap: 10,
        bg: "rgba(255,255,255,.03)",
        border: "rgba(255,255,255,.09)",
        fg: "#b6bcc8",
        radius: 7,
        padCss: "9px 15px",
        size: 13.5,
        weight: 510,
        grow: true,
      }),
    ],
    overrides: {},
  };
}

/**
 * A designed notice: one card, a deadline and a way to act on it.
 *
 * The short one. A design does not have to be a front page, and an operator
 * who only ever saw the busy template would reasonably conclude that it does.
 */
function designedNotice(): Design {
  return {
    sheetW: 520,
    slots: [],
    conditions: [{ id: "c1", name: "is_registered", on: true }],
    blocks: [
      at("heading", 40, 28, 440, { size: 22, text: "Maintenance this weekend" }),
      at("card", 40, 76, 440, {
        text:
          "<p>The server moves to new hardware on Saturday morning. " +
          "Expect a short outage, and nothing else to change.</p>",
      }),
      at("notice", 40, 176, 440, {
        tone: "warning",
        text: "<p>Voice will drop for about ten minutes while the move happens.</p>",
      }),
      at("countdown", 40, 248, 440, { text: "Planned for", until: "2026-10-03" }),
      at("button", 40, 296, 440, {
        style: "ghost",
        text: "Read the details",
        url: "https://example.org/status",
        gate: "is_registered",
      }),
    ],
    overrides: {},
  };
}

/**
 * The finished sheets an operator can start a design from.
 *
 * Separate from the graph gallery above, and reached from inside the design
 * editor rather than from the canvas, because it answers a different question.
 * The graph gallery is "what rule do I want"; this is "what should the message
 * look like", and somebody who has already drawn the rule and opened the sheet
 * should not have to go back out to the canvas and lose it to find out.
 *
 * Each one replaces the blocks and leaves the wiring alone - the inputs a
 * design declares are what the canvas has edges to, and swapping the look of a
 * message is not a reason to unplug it.
 */
export interface DesignTemplate {
  readonly id: string;
  readonly label: string;
  /** One line: what this sheet is for, not what is on it. */
  readonly description: string;
  /** The targets it is worth using. A design of gradients is not worth Qt. */
  readonly targets: string;
  build(): Design;
}

export const DESIGN_TEMPLATES: readonly DesignTemplate[] = [
  {
    id: "modern",
    label: "Modern welcome",
    description:
      "A hairline panel with a lit top edge, an avatar cluster, a display line set large and tight, two icon tiles and one accent button.",
    targets: "Fancy Mumble only",
    build: designedModern,
  },
  {
    id: "front-page",
    label: "Front page",
    description:
      "The busy one: a mark, a heading, a card, a callout, a row of link cards, a filled button and a footer. Everything the old client can draw too.",
    targets: "Every target, Classic included",
    build: designedFrontPage,
  },
  {
    id: "notice",
    label: "Short notice",
    description:
      "One card, a deadline and a way to act on it. A design does not have to be a front page.",
    targets: "Every target, Classic included",
    build: designedNotice,
  },
];

/**
 * What a designed template shows in the gallery.
 *
 * Compiled from the design itself rather than written beside it, for the
 * reason the screen templates' previews are: a hand-copied preview is a second
 * copy that stops matching the first the day either is edited.
 */
function designPreview(design: Design): string {
  return assemble(compileTarget(design, "html"), "html", {
    condition: (name) => design.conditions.find((input) => input.name === name)?.on !== false,
    slot: () => "",
  });
}

/* -- The catalogue -------------------------------------------------------- */

const ARRIVING = "For people arriving";
const HOUSEKEEPING = "Housekeeping";
const OCCASION = "For an occasion";

/**
 * The palette these bodies paint with.
 *
 * The client's own accent and its two status tones, as literals rather than
 * theme values: a greeting is rendered on somebody else's screen, in whatever
 * theme they are running, and colour that came from *this* operator's theme
 * would be picked to read against the wrong background. These three read on
 * both a light surface and a dark one.
 *
 * Written as `rgb()` rather than as hex, and that is not a style choice.
 * Tiptap's colour extension normalises every colour to this form, and
 * `richTextSurvives` compares attribute values - so a hex literal here would
 * make each coloured template look like a document the editor cannot hold, and
 * every one of them would open in the HTML view. `#41b4f9`, `#ff9933` and
 * `#00ffaa`, in the order below.
 */
const ACCENT = "rgb(65, 180, 249)";
const WARM = "rgb(255, 153, 51)";
const GOOD = "rgb(0, 255, 170)";

/**
 * A list item, written the way Tiptap writes one.
 *
 * Its `listItem` node contains a paragraph, so `<li>text</li>` comes back out
 * as `<li><p>text</p></li>` - a difference of no consequence to a reader and
 * all the consequence in the world to the round-trip check, which would send
 * every template with a list in it to the source view.
 */
const item = (html: string) => "<li><p>" + html + "</p></li>";

const WELCOME_HTML = [
  '<h2 style="text-align: center">Welcome aboard</h2>',
  "<p>Good to have you here. Grab a channel, say hello, and shout if anything is broken.</p>",
  "<hr>",
  "<ul>",
  item("<strong>Push-to-talk</strong> is under Settings &rarr; Audio."),
  item("Ask for a nudge in <strong>#Lounge</strong> if nobody is talking."),
  item("Moderators wear a coloured tag beside their name."),
  "</ul>",
].join("");

const RULES_HTML = [
  '<h3><span style="color: ' + ACCENT + '">House rules</span></h3>',
  "<ul>",
  item("Be someone people want in their channel."),
  item("No recording without saying so first."),
  item("Keep the shared channels roughly work-safe."),
  "</ul>",
].join("");

const GUEST_HTML = [
  "<h2>You are in as a guest</h2>",
  "<p>Everything works, but a registered account remembers you: your name, your channel, and the greeting you have already read.</p>",
  '<p><span style="color: ' +
    GOOD +
    '"><strong>Ask any moderator to register you</strong></span> - it takes a moment.</p>',
].join("");

const OUTDATED_HTML = [
  '<h3><span style="color: ' + WARM + '">Your client is a few versions behind</span></h3>',
  "<p>Voice will work, but some things on this server will not: newer codecs, the file browser, and the live documents in chat.</p>",
  "<p>Updating is worth the two minutes.</p>",
].join("");

const GERMAN_HTML = [
  '<h2 style="text-align: center">Willkommen!</h2>',
  "<p>Sch&ouml;n, dass du da bist. Deutschsprachige Runden laufen meistens abends - schreib gern auf Deutsch.</p>",
  "<p><em>English works everywhere too.</em></p>",
].join("");

const EVENT_HTML = [
  '<h2 style="text-align: center"><span style="color: ' + ACCENT + '">Rotation night</span></h2>',
  '<p style="text-align: center"><strong>Tuesday and Friday, 20:00 CET</strong></p>',
  "<hr>",
  "<p>Turn up in <strong>#Staging</strong> ten minutes early and someone will sort you into a squad. No signup, no obligation, no hard feelings if you drop out halfway.</p>",
].join("");

const QUIET_HTML = [
  "<p>Welcome. The house rules are pinned in <strong>#Lounge</strong>, and the people with coloured tags can fix things.</p>",
].join("");

/**
 * What an operator can start from.
 *
 * Ordered by how likely each is to be the one somebody came for, which is
 * roughly "a warm welcome for everybody" first and the conditional ones after
 * it. The gallery keeps this order.
 */
export const WELCOME_TEMPLATES: readonly GraphTemplate<WelcomeNode>[] = [
  {
    id: "warm-welcome",
    label: "Warm welcome, with the rules",
    description:
      "A formatted greeting for anyone who has just joined, plus the house rules as a reusable snippet you can wire into later greetings too.",
    category: ARRIVING,
    tone: "accent",
    shows: "Shown to accounts less than a week old.",
    preview: WELCOME_HTML + RULES_HTML,
    build: (): Fragment<WelcomeNode> => {
      const tenure = settled(node("tenure", 0, 40, { op: "less", window: "1 week" }));
      const greet = greeting(500, 0, WELCOME_HTML);
      const rules = snippet(500, 330, "rules", RULES_HTML);
      return {
        nodes: [...tenure.nodes, greet, rules],
        wires: [...tenure.wires, wire(tenure.out, greet, "when"), wire(rules, greet, "plus")],
      };
    },
  },
  {
    id: "quiet-welcome",
    label: "One short line",
    description:
      "The smallest greeting worth sending: a sentence, no heading, shown once. Start here when the formatted ones feel like too much.",
    category: ARRIVING,
    tone: "ok",
    shows: "Shown to accounts less than a month old.",
    preview: QUIET_HTML,
    build: (): Fragment<WelcomeNode> => {
      const tenure = settled(node("tenure", 0, 40, { op: "less", window: "1 month" }));
      const greet = greeting(500, 0, QUIET_HTML);
      return {
        nodes: [...tenure.nodes, greet],
        wires: [...tenure.wires, wire(tenure.out, greet, "when")],
      };
    },
  },
  {
    id: "german-welcome",
    label: "German-speaking welcome",
    description:
      "A greeting in German for people connecting from DE, AT or CH. The pattern to copy for any other language: change the countries, change the words.",
    category: ARRIVING,
    tone: "warn",
    shows:
      "Shown when the country is DE, AT or CH - and to nobody whose country the server cannot determine.",
    preview: GERMAN_HTML,
    build: (): Fragment<WelcomeNode> => {
      // `no` on the filter, deliberately: a server with no geo-IP database
      // cannot name a country, and a German greeting sent on a maybe is a
      // German greeting sent to everybody.
      const country = settled(node("country", 0, 40, { codes: ["DE", "AT", "CH"] }), "no");
      const greet = greeting(500, 0, GERMAN_HTML);
      return {
        nodes: [...country.nodes, greet],
        wires: [...country.wires, wire(country.out, greet, "when")],
      };
    },
  },
  {
    id: "guest-nudge",
    label: "Nudge guests to register",
    description:
      "For people connecting without an account: what registering gets them, and who to ask. Shown once, so it is not a monthly reminder.",
    category: HOUSEKEEPING,
    tone: "ok",
    shows: "Shown to guests.",
    preview: GUEST_HTML,
    build: (): Fragment<WelcomeNode> => {
      const account = settled(node("account", 0, 40, { state: "guest" }));
      const greet = greeting(500, 0, GUEST_HTML);
      return {
        nodes: [...account.nodes, greet],
        wires: [...account.wires, wire(account.out, greet, "when")],
      };
    },
  },
  {
    id: "outdated-client",
    label: "Ask outdated clients to update",
    description:
      "For anyone on a client older than 1.5: what will not work, and that updating is quick. The filter is set to warn on a maybe rather than stay quiet.",
    category: HOUSEKEEPING,
    tone: "warn",
    shows: "Shown when the client is older than 1.5.0, including when the server cannot tell.",
    preview: OUTDATED_HTML,
    build: (): Fragment<WelcomeNode> => {
      // `yes` here, and this is the one place it is the right answer: "I could
      // not tell whether their client is current, so warn them anyway" costs a
      // reader one paragraph, and being wrong the other way costs them the
      // feature they cannot work out why they do not have.
      const version = settled(node("clientVersion", 0, 40, { op: "<", version: "1.5.0" }), "yes");
      const greet = greeting(500, 0, OUTDATED_HTML, { once: false });
      return {
        nodes: [...version.nodes, greet],
        wires: [...version.wires, wire(version.out, greet, "when")],
      };
    },
  },
  {
    id: "event-night",
    label: "Announce a regular night",
    description:
      "A centred announcement with the time and where to turn up, shown on every connect rather than once - which is what an announcement is for.",
    category: OCCASION,
    tone: "accent",
    shows: "Shown to registered members, on every connect.",
    preview: EVENT_HTML,
    build: (): Fragment<WelcomeNode> => {
      const account = settled(node("account", 0, 40, { state: "registered" }));
      const greet = greeting(500, 0, EVENT_HTML, { once: false });
      return {
        nodes: [...account.nodes, greet],
        wires: [...account.wires, wire(account.out, greet, "when")],
      };
    },
  },
  {
    id: "designed-modern",
    label: "A modern welcome",
    description:
      "The one to start from: a display line set large and tight on the left, a small tinted badge above it, the rules in a hairline box, and one button in the reader's accent. Restrained rather than colourful, and it follows each reader's theme and their light or dark mode.",
    category: ARRIVING,
    tone: "accent",
    shows: "Shown to accounts less than a month old, once.",
    preview: designPreview(designedModern()),
    build: (): Fragment<WelcomeNode> => {
      const tenure = settled(node("tenure", 0, 40, { op: "less", window: "1 month" }));
      const fresh = settled(node("tenure", 0, 300, { op: "less", window: "1 week" }));
      const greet = designed(560, 0, designedModern(), {
        html: MODERN_FALLBACK_HTML,
        body: MODERN_FALLBACK_TEXT,
      });
      const rules = snippet(560, 460, "rules", RULES_HTML);
      return {
        nodes: [...tenure.nodes, ...fresh.nodes, greet, rules],
        wires: [
          ...tenure.wires,
          ...fresh.wires,
          wire(tenure.out, greet, "when"),
          wire(rules, greet, inputPort("rules")),
          wire(fresh.out, greet, inputPort("is_new_member")),
        ],
      };
    },
  },
  {
    id: "designed-front-page",
    label: "A designed front page",
    description:
      "The same welcome, laid out in the design editor instead of written as prose: a badge, a heading, two link columns, a notice, your house rules in a slot, and one button. Every block on it is one the old Qt clients can draw too.",
    category: ARRIVING,
    tone: "accent",
    shows: "Shown to accounts less than a month old, once.",
    preview: designPreview(designedFrontPage()),
    build: (): Fragment<WelcomeNode> => {
      const design = designedFrontPage();
      const tenure = settled(node("tenure", 0, 40, { op: "less", window: "1 month" }));
      const fresh = settled(node("tenure", 0, 300, { op: "less", window: "1 week" }));
      const greet = designed(560, 0, design);
      const rules = snippet(560, 420, "rules", RULES_HTML);
      return {
        nodes: [...tenure.nodes, ...fresh.nodes, greet, rules],
        wires: [
          ...tenure.wires,
          ...fresh.wires,
          wire(tenure.out, greet, "when"),
          // The design's own inputs: a snippet into the text slot, and a
          // condition into the toggle that shows its notice. Wiring both is
          // the whole point of shipping a designed template - a design block
          // with nothing on its inputs looks like it does not have any.
          wire(rules, greet, inputPort("rules")),
          wire(fresh.out, greet, inputPort("is_new_member")),
        ],
      };
    },
  },
  {
    id: "designed-notice",
    label: "A designed notice",
    description:
      "The short kind of design: a heading, a bordered card, the date it matters by, and a quiet button for the people with accounts. Start here when the front page is more than the occasion needs.",
    category: OCCASION,
    tone: "warn",
    shows: "Shown to everyone with an account, once.",
    preview: designPreview(designedNotice()),
    build: (): Fragment<WelcomeNode> => {
      const account = settled(node("account", 0, 40, { state: "registered" }));
      const also = settled(node("account", 0, 300, { state: "registered" }));
      const greet = designed(560, 0, designedNotice());
      return {
        nodes: [...account.nodes, ...also.nodes, greet],
        wires: [
          ...account.wires,
          ...also.wires,
          wire(account.out, greet, "when"),
          wire(also.out, greet, inputPort("is_registered")),
        ],
      };
    },
  },
  {
    id: "front-door",
    label: "A front door",
    description:
      "The full welcome screen: a badge, a title, a paragraph, one button that matters, and a row of links. Built from bands, so it is drawn in the client's own type scale rather than as pasted-in HTML.",
    category: ARRIVING,
    tone: "accent",
    shows: "Shown to guests, once.",
    // Generated from the same bands the template builds, never written out
    // beside them: a hand-copied preview is a second copy of the design that
    // stops matching the first the day either one is edited, and it did.
    preview: markupOfScreen(fullScreenBands()),
    build: (): Fragment<WelcomeNode> => {
      const account = settled(node("account", 0, 40, { state: "guest" }));
      const greet = screen(500, 0, fullScreenBands());
      return {
        nodes: [...account.nodes, greet],
        wires: [...account.wires, wire(account.out, greet, "when")],
      };
    },
  },
  {
    id: "server-front-page",
    label: "The full front page",
    description:
      "Everything a welcome screen can be: a painted title bar, the server's own artwork, a centred introduction, a version line, a list of links, the button, and a notice bar at the bottom. Start here and delete what you do not want.",
    category: OCCASION,
    tone: "accent",
    shows: "Shown to guests, once.",
    preview: markupOfScreen(frontPageBands()),
    build: (): Fragment<WelcomeNode> => {
      const account = settled(node("account", 0, 40, { state: "guest" }));
      const greet = screen(500, 0, frontPageBands());
      return {
        nodes: [...account.nodes, greet],
        wires: [...account.wires, wire(account.out, greet, "when")],
      };
    },
  },
  {
    id: "old-and-new",
    label: "One screen for new clients, one for old",
    description:
      "The same welcome twice: bands for clients that draw them, and the identical bands compiled to Qt tables for Mumble 1.5 and older. Split on client version, so nobody gets the wrong one.",
    category: HOUSEKEEPING,
    tone: "warn",
    shows: "Two rules - clients newer than 1.5.0, and 1.5.0 or older.",
    preview: markupOfScreen(frontDoorBands()),
    build: (): Fragment<WelcomeNode> => {
      // `no` on the modern side and `yes` on the legacy side, so a client that
      // announced no version at all gets the markup that renders everywhere
      // rather than the markup that needs a modern engine. An unknown version
      // is far more likely to be something old than something new.
      const modern = settled(node("clientVersion", 0, 40, { op: ">", version: "1.5.0" }), "no");
      const old = settled(node("clientVersion", 0, 300, { op: "<=", version: "1.5.0" }), "yes");
      const rich = screen(500, 0, frontDoorBands());
      const qt = screen(500, 260, frontDoorBands(), "legacy");
      return {
        nodes: [...modern.nodes, rich, ...old.nodes, qt],
        wires: [...modern.wires, wire(modern.out, rich, "when"), ...old.wires, wire(old.out, qt, "when")],
      };
    },
  },
  {
    id: "newcomer-and-regular",
    label: "Newcomers here, regulars there",
    description:
      "Two greetings on one canvas: the long welcome for the first week, the short announcement for everybody else. The shape most servers end up with.",
    category: OCCASION,
    tone: "muted",
    shows: "Two rules - under a week old, and everyone registered.",
    preview: WELCOME_HTML,
    build: (): Fragment<WelcomeNode> => {
      const fresh = settled(node("tenure", 0, 40, { op: "less", window: "1 week" }));
      const welcome = greeting(500, 0, WELCOME_HTML);
      const rules = snippet(500, 330, "rules", RULES_HTML);
      const member = settled(node("account", 0, 560, { state: "registered" }));
      const notice = greeting(500, 520, EVENT_HTML, { once: false });
      return {
        nodes: [...fresh.nodes, welcome, rules, ...member.nodes, notice],
        wires: [
          ...fresh.wires,
          wire(fresh.out, welcome, "when"),
          wire(rules, welcome, "plus"),
          ...member.wires,
          wire(member.out, notice, "when"),
        ],
      };
    },
  },
];
