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

import { makeNode, type WelcomeNode } from "./model";
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
