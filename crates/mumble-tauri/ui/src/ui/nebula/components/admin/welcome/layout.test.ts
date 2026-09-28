import { describe as suite, expect, it } from "vitest";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import {
  isWebUrl,
  makeSection,
  markupOfScreen,
  plainOfScreen,
  screenSpeaks,
  urlsOf,
  type Section,
} from "./layout";

const band = (kind: Section["kind"], fields: Partial<Section> = {}): Section => ({
  ...makeSection(kind),
  ...fields,
});

/** The screen from the design: header, hero, prose, button, links. */
function frontDoor(): Section[] {
  return [
    band("header", { title: "MAGICAL.ROCKS · V0.2.18" }),
    band("hero", { glyph: "◆", title: "Welcome to Magical.Rocks", subtitle: "The home of Fancy Mumble" }),
    band("prose", { html: "<p>A small community of enthusiasts.</p>" }),
    band("action", {
      title: "Register your account",
      subtitle: "Takes about thirty seconds.",
      url: "https://magical.rocks/register",
      primary: true,
    }),
    band("cards", {
      cards: [
        { eyebrow: "BROWSE", label: "Channel Viewer", url: "https://magical.rocks/channels" },
        { eyebrow: "LIVE", label: "Server Status", url: "https://magical.rocks/status" },
      ],
    }),
  ];
}

suite("a screen as markup, for clients that draw no bands", () => {
  it("keeps every word", () => {
    // The whole point of generating this half: a client that has never heard
    // of a band still gets the greeting, not a blank.
    const plain = plainOfScreen(frontDoor());
    for (const words of [
      "MAGICAL.ROCKS",
      "Welcome to Magical.Rocks",
      "The home of Fancy Mumble",
      "A small community of enthusiasts.",
      "Register your account",
      "Takes about thirty seconds.",
      "Channel Viewer",
      "Server Status",
    ]) {
      expect(plain).toContain(words);
    }
  });

  it("keeps every link, because a button is a link underneath", () => {
    const markup = markupOfScreen(frontDoor());
    expect(markup).toContain('href="https://magical.rocks/register"');
    expect(markup).toContain('href="https://magical.rocks/channels"');
    expect(markup).toContain('href="https://magical.rocks/status"');
  });

  it("survives the sanitiser every surface renders through", () => {
    const clean = sanitizeHtml(markupOfScreen(frontDoor()));
    expect(clean).toContain("<h2");
    expect(clean).toContain("<ul");
    expect(clean).toContain("magical.rocks/register");
  });

  it("escapes what an operator typed rather than letting it become markup", () => {
    const markup = markupOfScreen([band("hero", { title: "<script>x</script>" })]);
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("leaves a band with nothing in it out entirely", () => {
    // Rather than emitting an empty heading, which reads as a rendering fault
    // on the receiving end.
    expect(markupOfScreen([band("hero", { title: "", subtitle: "", glyph: "" })])).toBe("");
    expect(markupOfScreen([band("action", { title: "" })])).toBe("");
  });

  it("draws a button with no link as text rather than as a dead link", () => {
    const markup = markupOfScreen([band("action", { title: "Soon", url: "" })]);
    expect(markup).toContain("Soon");
    expect(markup).not.toContain("<a");
  });
});

suite("whether a screen says anything", () => {
  it("is false for a screen of nothing but furniture", () => {
    // Its generated markup is a row of rules, so "is the body empty" answers
    // the wrong question - the status bar would call the graph complete and
    // the arriving member would read a horizontal line.
    expect(screenSpeaks([band("divider"), band("divider")])).toBe(false);
    expect(screenSpeaks([band("prose", { html: "<p></p>" })])).toBe(false);
  });

  it("is true as soon as one band has words", () => {
    expect(screenSpeaks([band("divider"), band("hero", { title: "Hello" })])).toBe(true);
    expect(screenSpeaks([band("prose", { html: "<p>Hello</p>" })])).toBe(true);
    expect(screenSpeaks([band("cards", { cards: [{ eyebrow: "", label: "Docs", url: "" }] })])).toBe(true);
  });
});

suite("links", () => {
  it("accepts only what a client will actually follow", () => {
    expect(isWebUrl("https://example.org")).toBe(true);
    expect(isWebUrl("http://example.org")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("data:text/html,x")).toBe(false);
    expect(isWebUrl("example.org")).toBe(false);
  });

  it("collects every link on a screen in one pass", () => {
    // So the status bar can name a bad one before the server refuses the
    // whole document over it.
    expect(urlsOf(frontDoor()).filter(Boolean)).toHaveLength(3);
  });
});

suite("a fresh band", () => {
  it("arrives saying what it is, rather than as an empty box", () => {
    expect(makeSection("hero").title).not.toBe("");
    expect(makeSection("action").title).not.toBe("");
    // The first button somebody adds is the thing they want people to do; a
    // screen of equal buttons has no call to action in it at all.
    expect(makeSection("action").primary).toBe(true);
    expect(makeSection("cards").cards).toHaveLength(1);
  });

  it("gives every band its own id, so reordering is stable", () => {
    const ids = [makeSection("hero").id, makeSection("hero").id, makeSection("prose").id];
    expect(new Set(ids).size).toBe(3);
  });
});
