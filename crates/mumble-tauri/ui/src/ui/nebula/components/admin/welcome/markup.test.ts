import { describe as suite, expect, it } from "vitest";
import {
  MAX_BODY,
  composeMarkup,
  composePlain,
  escapeHtml,
  inlineSlotsOf,
  paragraphsOf,
  plainTextOf,
  renameInlineSlot,
  setInlineSlotHidden,
  splitInlineSlots,
  withoutSlotTokens,
} from "./markup";

suite("the plain half of a formatted greeting", () => {
  it("turns structure into line breaks rather than running it together", () => {
    const plain = plainTextOf("<h2>Welcome</h2><p>Good to have you.</p><p>Rules are pinned.</p>");
    expect(plain).toBe("Welcome\n\nGood to have you.\n\nRules are pinned.");
  });

  it("marks list items, so the fallback is still readable", () => {
    // The plain form is what a client with `allow_html` off actually shows
    // somebody. Three bullets flattened into one line is lossless and unusable.
    const plain = plainTextOf("<p>Two things:</p><ul><li>First</li><li>Second</li></ul>");
    expect(plain).toBe("Two things:\n\n• First\n• Second");
  });

  it("collapses the whitespace the markup was written with", () => {
    const plain = plainTextOf("<p>\n  One    two\n</p>\n\n<p>\n  three\n</p>");
    expect(plain).toBe("One two\n\nthree");
  });

  it("reads entities as the characters they stand for", () => {
    // What comes back has to be text, not markup: an operator switching a
    // formatted node to plain must not find `&amp;` in their own sentence.
    expect(plainTextOf("<p>Tea &amp; biscuits &rarr; kitchen</p>")).toBe("Tea & biscuits → kitchen");
  });

  it("does not mistake an attribute for the end of a tag", () => {
    // The reason this uses a parser rather than a regex over angle brackets.
    expect(plainTextOf('<p title="a > b">Body</p>')).toBe("Body");
  });

  it("keeps a line break where a break was typed", () => {
    expect(plainTextOf("<p>One<br>Two</p>")).toBe("One\nTwo");
  });

  it("is empty for markup that says nothing", () => {
    expect(plainTextOf("")).toBe("");
    expect(plainTextOf("<p></p>")).toBe("");
  });
});

suite("plain text on its way into the editor", () => {
  it("makes one paragraph per line and drops the blank ones", () => {
    expect(paragraphsOf("First\n\nSecond")).toBe("<p>First</p><p>Second</p>");
  });

  it("escapes what it is given, so a typed tag stays typed", () => {
    expect(paragraphsOf("a < b & <b>bold</b>")).toBe("<p>a &lt; b &amp; &lt;b&gt;bold&lt;/b&gt;</p>");
  });

  it("survives the round trip through the plain half", () => {
    const written = "Welcome.\n\nRules are in #Lounge.";
    expect(plainTextOf(paragraphsOf(written))).toBe(written);
  });

  it("is empty for nothing typed, so an untouched node sends no markup", () => {
    expect(paragraphsOf("")).toBe("");
    expect(paragraphsOf("\n \n")).toBe("");
  });
});

suite("assembling a greeting the way the server does", () => {
  it("joins markup with nothing and plain text with a space", () => {
    // The server's own rule: each markup part is a block that closes itself,
    // and each plain part is not.
    expect(composeMarkup(["<p>One</p>", "<p>Two</p>"])).toBe("<p>One</p><p>Two</p>");
    expect(composePlain(["One", "Two"])).toBe("One Two");
  });

  it("drops the parts that are empty rather than leaving their gaps", () => {
    expect(composePlain(["One", "   ", "Two"])).toBe("One Two");
    expect(composeMarkup(["", "<p>Only</p>"])).toBe("<p>Only</p>");
  });
});

suite("the cap", () => {
  it("is the server's own, so an over-long body is caught before the save", () => {
    // `MAX_BODY` in starling/crates/runtime/src/greeting.rs. The server
    // refuses the whole document over it, so this number drifting apart from
    // that one costs an operator a rejected canvas with no node named.
    expect(MAX_BODY).toBe(4096);
  });
});

suite("escaping", () => {
  it("handles the three characters that change how markup parses", () => {
    expect(escapeHtml("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });
});

suite("an input used inside a sentence", () => {
  it("finds every token in reading order, hidden ones included", () => {
    const found = inlineSlotsOf("Hi {{name}}, welcome to {{server|hidden}} today.");
    expect(found).toEqual([
      { name: "name", hidden: false, at: 0 },
      { name: "server", hidden: true, at: 1 },
    ]);
  });

  it("splits copy into the runs the compiler sends separately", () => {
    expect(splitInlineSlots("Some words about {{rules}} in a sentence.")).toEqual([
      { literal: "Some words about " },
      { slot: "rules", hidden: false },
      { literal: " in a sentence." },
    ]);
  });

  it("hides one usage without touching the other of the same input", () => {
    const next = setInlineSlotHidden("{{rules}} and {{rules}}", 1, true);
    expect(next).toBe("{{rules}} and {{rules|hidden}}");
  });

  it("keeps a hidden usage's marker when it is renamed", () => {
    // Hiding is meant to be reversible, so a rename must not quietly show it
    // again - which is what dropping the flag would do.
    expect(renameInlineSlot("{{rules|hidden}}", "rules", "house_rules")).toBe("{{house_rules|hidden}}");
  });

  it("reads a shown usage as its name and a hidden one as nothing", () => {
    expect(withoutSlotTokens("A {{one}} and a {{two|hidden}} here")).toBe("A $one and a here");
  });

  it("leaves copy with no tokens exactly as it was", () => {
    const body = "<p>Nothing dynamic about this.</p>";
    expect(splitInlineSlots(body)).toEqual([{ literal: body }]);
    expect(withoutSlotTokens(body)).toBe(body);
  });
});
