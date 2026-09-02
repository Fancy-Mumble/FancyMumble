/**
 * What the editor can hold, and whether it admits when it cannot.
 *
 * The reason this file exists: a Tiptap schema drops what it has no node for,
 * without saying so, and the loss only shows up as a document that came back
 * smaller than it went in. A server's welcome text is the worst case - written
 * by hand, possibly years ago, and re-saved by an admin fixing one word.
 */

import { describe, it, expect } from "vitest";
import { richTextSurvives } from "./richText";

/** The shape a welcome screen actually has. */
const WELCOME = [
  '<h1 style="text-align: center">Welcome to Magical.Rocks</h1>',
  '<p style="text-align: center">The Home of <a href="https://example.test">Fancy Mumble</a>.</p>',
  "<h3>Links</h3>",
  "<ul><li><p>Channel Viewer</p></li><li><p>Server Status</p></li></ul>",
].join("");

describe("richTextSurvives", () => {
  it("keeps the structure a welcome screen is made of", () => {
    // Headings, centring and a list: the three things the bio schema dropped,
    // which is what made the editor render the MOTD as a wall of paragraphs.
    expect(richTextSurvives(WELCOME, "document")).toBe(true);
  });

  it("reports the same document as lost under the prose schema", () => {
    // Not a hypothetical: this is what the field did before it had a preset.
    expect(richTextSurvives(WELCOME, "prose")).toBe(false);
  });

  it("treats an empty value as safe", () => {
    expect(richTextSurvives("", "document")).toBe(true);
    expect(richTextSurvives("   ", "document")).toBe(true);
  });

  it("does not call quoting and spacing a loss", () => {
    // A check this strict would send every operator to the source view, and a
    // warning everybody learns to ignore protects nothing.
    expect(richTextSurvives("<p style='text-align: center;'>hi<br></p>", "document")).toBe(true);
  });

  it("says so when markup has nowhere to go", () => {
    // A `div` has no node in any preset here: it comes back as a bare
    // paragraph, taking whatever it was carrying - a layout, a button - with
    // it. The operator has to be shown source rather than a lossy copy.
    expect(richTextSurvives('<div class="card"><p>Register</p></div>', "document")).toBe(false);
  });

  it("refuses a document laid out with tables", () => {
    // Tiptap's table is an *editor* table. Parsing one rewrites it into that
    // model - a `<colgroup>`, a `min-width` per column, `colspan="1"` on every
    // cell - so a welcome screen built as a table comes back structurally
    // different having been merely opened. Which is what happened.
    const layout =
      '<table><tbody><tr><td style="text-align: center"><p>Register</p></td></tr></tbody></table>';
    expect(richTextSurvives(layout, "document")).toBe(false);
  });

  it("does not stamp its own attributes onto a link it was only shown", () => {
    // The defaults add `target="_blank" rel="noopener noreferrer nofollow"`,
    // which makes an untouched document come back different from how it
    // arrived - and the sanitiser that renders it decides those for itself.
    expect(richTextSurvives('<p><a href="https://example.test">home</a></p>', "document")).toBe(true);
  });

  it("notices an attribute going missing even when the tags all survive", () => {
    // The subtlest loss and the one worth most: every tag is still there, the
    // text is unchanged, and the page is no longer centred.
    expect(richTextSurvives('<p style="padding: 20px">boxed</p>', "document")).toBe(false);
  });
});
