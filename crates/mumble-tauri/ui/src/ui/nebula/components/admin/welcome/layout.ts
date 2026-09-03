/**
 * The welcome *screen*: a greeting built out of bands rather than typed as
 * markup.
 *
 * The rich-text editor beside this one gets an operator a formatted paragraph,
 * and a formatted paragraph is not what a welcome screen is. The screen in
 * every design worth copying is a badge and a big title, a line of prose, one
 * button that matters, and a row of links - and writing that as HTML means
 * hand-building a layout that then has to be legible in a client whose type
 * scale and colours the operator has never seen.
 *
 * So the operator picks *what each part is* and the client decides how that
 * looks. A closed set of six bands, not a layout tree, and that is the whole
 * design decision. A tree of rows, columns and styles is a second CSS: the
 * operator can build something unreadable, every client has to implement a
 * layout engine to draw it, and the two drift apart the first time one of them
 * ships a change. Six bands with fixed shapes means a welcome screen matches
 * the client it is read in, on every platform, including ones written later.
 *
 * A screen still carries the two prose halves, generated from the bands by
 * `markupOfScreen` and `plainOfScreen`. That is not a fallback nobody uses: it
 * is what stock Mumble sees, what a server with `allow_html` off sends, and
 * what every client that predates bands will show. The generation is here, in
 * one place, so the three can never say different things.
 */

import { escapeHtml, plainTextOf } from "./markup";

/** The bands a screen is built from, in the order the palette offers them. */
export const SECTION_KINDS = ["header", "hero", "image", "prose", "action", "cards", "divider"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/**
 * How a band sits.
 *
 * The one layout choice an operator genuinely has to make, and the one that
 * cannot be guessed from the kind: a centred hero and a left-aligned paragraph
 * are both right, and so are the opposites of both. `default` is the kind's
 * own habit, which is what most bands want.
 */
export const ALIGNMENTS = ["default", "left", "center"] as const;
export type Align = (typeof ALIGNMENTS)[number];

/**
 * What a band is *for*, painted as its background.
 *
 * A title bar across the top and a "registration is closed" notice at the
 * bottom are the same band with two tones, which is why this is one property
 * rather than two more kinds. A tone rather than a colour, and that is the
 * whole point: an operator picking `#8b1a1a` is picking it against the theme
 * they happen to be running, and it will be unreadable in the other one. The
 * client maps a tone onto its own palette, in whichever theme the reader has.
 */
export const BAND_TONES = ["none", "accent", "muted", "warn", "danger"] as const;
export type BandTone = (typeof BAND_TONES)[number];

/**
 * Which of the server's own pictures an `image` band draws.
 *
 * Its livery, never bytes carried in the greeting. The artwork already exists,
 * every client already has it, and a logo embedded here would be a data: URL
 * several times the whole document's budget - paid on every single join.
 */
export const PICTURES = ["icon", "banner"] as const;
export type Picture = (typeof PICTURES)[number];

/** One link in a `cards` row. */
export interface ScreenCard {
  /** The small-caps line above the link: "BROWSE", "LIVE". */
  eyebrow: string;
  label: string;
  url: string;
}

/**
 * One band.
 *
 * A single shape with the union of the fields rather than a discriminated
 * union per kind, because that is what the wire carries - and a model that
 * split them would spend its life converting between the two for no reader's
 * benefit. Which fields a kind reads is in `SECTION_FIELDS`, and the editor
 * shows only those.
 */
export interface Section {
  readonly id: string;
  kind: SectionKind;
  /** The heading, the button's label, the header strip's text. */
  title: string;
  /** The second line: a hero's subtitle, a button's caption. */
  subtitle: string;
  /** `prose` only: the paragraph, as markup. */
  html: string;
  /** `action` only. http(s) only, which the server enforces on save. */
  url: string;
  /** `hero` only: one or two characters drawn in the badge. */
  glyph: string;
  cards: ScreenCard[];
  /** `action` only: drawn as the screen's primary button. */
  primary: boolean;
  align: Align;
  /** Painted as the band's background, full width. */
  tone: BandTone;
  /** `image` only. */
  picture: Picture;
  /** `cards` only: a centred list of links rather than a row of boxes. */
  compact: boolean;
}

/** Which fields each band actually uses, for the editor and for the compiler. */
export const SECTION_FIELDS: Record<SectionKind, readonly (keyof Section)[]> = {
  header: ["title"],
  hero: ["glyph", "title", "subtitle"],
  image: ["picture"],
  prose: ["html"],
  action: ["title", "url", "subtitle", "primary"],
  cards: ["title", "cards", "compact"],
  divider: [],
};

/**
 * Which bands can be painted, and which can be re-aligned.
 *
 * Not all of them, on purpose. A divider has no content to align and a tone on
 * one is a coloured stripe nobody asked for; the editor offers neither, so
 * there is no way to build that by accident.
 */
export const TONEABLE: readonly SectionKind[] = ["header", "hero", "prose", "action", "cards"];
export const ALIGNABLE: readonly SectionKind[] = ["header", "hero", "image", "prose", "cards"];

/** What each band is called, and what it is for, in the editor. */
export const SECTION_LABELS: Record<SectionKind, { label: string; hint: string }> = {
  header: { label: "Header strip", hint: "A small line across the top: the server, a version." },
  hero: { label: "Hero", hint: "The badge, the big title, and the line under it." },
  image: { label: "Server artwork", hint: "This server's own icon or banner, from its livery." },
  prose: { label: "Paragraph", hint: "Formatted text, written the way every other body is." },
  action: { label: "Button", hint: "One thing to do, with a caption under it." },
  cards: { label: "Link row", hint: "Small cards side by side, each pointing somewhere." },
  divider: { label: "Divider", hint: "A rule between two bands." },
};

let counter = 0;

/** A fresh band, with the words that make it read as itself straight away. */
export function makeSection(kind: SectionKind): Section {
  counter += 1;
  const base: Section = {
    id: `s${Date.now().toString(36)}${counter.toString(36)}`,
    kind,
    title: "",
    subtitle: "",
    html: "",
    url: "",
    glyph: "",
    cards: [],
    primary: false,
    align: "default",
    tone: "none",
    picture: "icon",
    compact: false,
  };
  switch (kind) {
    case "hero":
      return { ...base, glyph: "◆", title: "Welcome", subtitle: "" };
    case "action":
      // Primary by default: the first button somebody adds is the thing they
      // want people to do, and a screen of equal buttons has no call to action
      // in it at all.
      return { ...base, title: "Register your account", primary: true };
    case "cards":
      return { ...base, cards: [makeCard()] };
    case "prose":
      return { ...base, html: "<p></p>" };
    default:
      return base;
  }
}

export function makeCard(): ScreenCard {
  return { eyebrow: "", label: "", url: "" };
}

/* -- The prose halves ----------------------------------------------------- */

/**
 * How the markup half centres a band.
 *
 * Written out rather than left to a stylesheet: this markup is rendered inside
 * somebody else's surface - a chat log, a modal, stock Mumble - and there is no
 * stylesheet of ours anywhere near it. `text-align` is the one alignment
 * property that survives every renderer this reaches, Qt's included.
 */
const CENTRED = ' style="text-align: center"';

/** What a band's alignment becomes in the markup half. */
function aligned(section: Section, fallback: "left" | "center"): string {
  const align = section.align === "default" ? fallback : section.align;
  return align === "center" ? CENTRED : "";
}

/**
 * A toned band, in markup that has no colours in it.
 *
 * Structure rather than a background, and deliberately: this half is rendered
 * in somebody else's stylesheet, on a surface whose colour is unknown, and a
 * hard-coded background is the one way to guarantee unreadable text on half of
 * them. A blockquote is what every renderer since 1995 draws as "this part is
 * set apart", which is what a tone means.
 */
function toned(section: Section, body: string): string {
  if (body === "" || section.tone === "none") return body;
  return `<blockquote>${body}</blockquote>`;
}

/**
 * The screen as markup, for every client that has no idea what a band is.
 *
 * Deliberately plain markup - headings, paragraphs, a list of links - rather
 * than an attempt to reproduce the layout with inline CSS. A client rendering
 * this is showing it in a box the size of a chat message, in its own
 * stylesheet, and a nested table of coloured divs would look worse there than
 * the honest document does. What it must not lose is the *content*: every
 * word, and every link, survives.
 */
export function markupOfScreen(sections: readonly Section[]): string {
  return sections
    .map((section) => toned(section, bandMarkup(section)))
    .filter(Boolean)
    .join("");
}

function bandMarkup(section: Section): string {
  switch (section.kind) {
    case "header":
      return section.title
        ? `<p${aligned(section, "center")}><strong>${escapeHtml(section.title)}</strong></p>`
        : "";
    // The server's own artwork is not in this half at all. It lives in the
    // livery, which a client fetches for itself; there is no URL here that
    // a stock client could resolve, and embedding the bytes would cost
    // more than the whole document is allowed on every single join.
    case "image":
      return "";
    case "hero": {
      // The badge is its own line, never a word in front of the title.
      // Concatenated - which is what this did - a glyph of "M" and a title
      // of "Welcome" arrive as the heading "M Welcome", which reads as a
      // typo in somebody's welcome message rather than as a logo.
      const at = aligned(section, "center");
      const badge = section.glyph ? `<p${at}>${escapeHtml(section.glyph)}</p>` : "";
      const title = section.title ? `<h2${at}>${escapeHtml(section.title)}</h2>` : "";
      const subtitle = section.subtitle ? `<p${at}>${escapeHtml(section.subtitle)}</p>` : "";
      return badge + title + subtitle;
    }
    case "prose":
      return section.html;
    case "action": {
      if (!section.title) return "";
      // A button becomes the link it always was underneath. Nothing else
      // is honest: there is no markup for "a button", and a client that
      // drew a div like one would have a button that does nothing.
      const label = escapeHtml(section.title);
      const link = section.url
        ? `<a href="${escapeHtml(section.url)}"><strong>${label}</strong></a>`
        : `<strong>${label}</strong>`;
      const caption = section.subtitle ? `<br><small>${escapeHtml(section.subtitle)}</small>` : "";
      return `<p${aligned(section, "center")}>${link}${caption}</p>`;
    }
    case "cards": {
      const heading = section.title ? `<h3${aligned(section, "left")}>${escapeHtml(section.title)}</h3>` : "";
      const items = section.cards
        .filter((card) => card.label !== "")
        .map((card) => {
          const eyebrow = card.eyebrow ? `${escapeHtml(card.eyebrow)}: ` : "";
          const label = escapeHtml(card.label);
          const link = card.url ? `<a href="${escapeHtml(card.url)}">${label}</a>` : label;
          return `<li><p>${eyebrow}${link}</p></li>`;
        })
        .join("");
      return items ? `${heading}<ul>${items}</ul>` : heading;
    }
    case "divider":
      return "<hr>";
  }
  return "";
}

/** The screen as text, for a server that will not send tags at all. */
export function plainOfScreen(sections: readonly Section[]): string {
  return plainTextOf(markupOfScreen(sections));
}

/**
 * Whether these bands say anything at all.
 *
 * A screen of nothing but dividers is a screen with no greeting in it, and it
 * must not count as a written body - otherwise the status bar calls the graph
 * complete and the arriving member reads a horizontal rule.
 */
export function screenSpeaks(sections: readonly Section[]): boolean {
  return sections.some(
    (section) =>
      (section.kind === "prose" && plainTextOf(section.html) !== "") ||
      (section.kind !== "prose" && section.kind !== "divider" && hasWords(section)),
  );
}

function hasWords(section: Section): boolean {
  return (
    section.title.trim() !== "" ||
    section.subtitle.trim() !== "" ||
    section.cards.some((card) => card.label.trim() !== "")
  );
}

/** The links a screen points at, for checking them all in one pass. */
export function urlsOf(sections: readonly Section[]): string[] {
  return sections.flatMap((section) => [section.url, ...section.cards.map((card) => card.url)]);
}

/** http(s) and nothing else - the same rule the server enforces on save. */
export function isWebUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}
