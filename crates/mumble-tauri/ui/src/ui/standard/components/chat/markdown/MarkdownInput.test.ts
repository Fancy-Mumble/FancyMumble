import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "./MarkdownInput";

/**
 * Lists are the only block-level construct this converter draws, which makes
 * them the only place where a newline means something other than `<br>`. Both
 * directions are tested together because the pair has to be an exact round
 * trip: editing a message re-encodes it, so any drift here rewrites bodies on
 * every save.
 */
describe("markdown lists", () => {
  it("turns a run of bullets into one list", () => {
    expect(markdownToHtml("- milk\n- eggs")).toBe("<ul><li>milk</li><li>eggs</li></ul>");
  });

  it("numbers an ordered list itself rather than trusting what was typed", () => {
    // Someone who typed 1. 1. 1. meant a list, not three firsts.
    expect(markdownToHtml("1. one\n1. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(markdownToHtml("3) three\n4) four")).toBe("<ol><li>three</li><li>four</li></ol>");
  });

  it("does not put a <br> between two items", () => {
    // The bug this guards: a break inside a <ul> is a blank line the browser
    // draws between the bullets.
    expect(markdownToHtml("- a\n- b")).not.toContain("<br>");
  });

  it("starts a second list when the marker changes", () => {
    // One <ul> holding both would silently renumber the half typed with digits.
    expect(markdownToHtml("- a\n1. b")).toBe("<ul><li>a</li></ul><br><ol><li>b</li></ol>");
  });

  it("keeps inline formatting inside an item", () => {
    expect(markdownToHtml("- **bold** and `code`")).toBe(
      "<ul><li><b>bold</b> and <code>code</code></li></ul>",
    );
  });

  it("keeps the break between a list and the text around it", () => {
    expect(markdownToHtml("shopping:\n- milk\nthat is all")).toBe(
      "shopping:<br><ul><li>milk</li></ul><br>that is all",
    );
  });

  it("leaves a line that only looks like a list alone", () => {
    expect(markdownToHtml("-no space")).toBe("-no space");
    // A year opening a line is commoner in a chat window than a list running
    // past its thousandth item, so four digits is a sentence.
    expect(markdownToHtml("2024. what a year")).toBe("2024. what a year");
  });

  it("round-trips a list back to what was typed", () => {
    for (const typed of [
      "- milk\n- eggs",
      "1. one\n2. two",
      "shopping:\n- milk\n- eggs",
      "- milk\nthat is all",
      "before\n- a\nafter",
      "- **bold**",
    ]) {
      expect(htmlToMarkdown(markdownToHtml(typed))).toBe(typed);
    }
  });

  it("round-trips text that has no list in it at all", () => {
    for (const typed of ["a < b & c\nsecond line", "**bold** and *italic*", "plain"]) {
      expect(htmlToMarkdown(markdownToHtml(typed))).toBe(typed);
    }
  });

  it("leaves a fenced block alone even when it holds list markers", () => {
    // The fence is stashed before the list pass, so its contents are text.
    const html = markdownToHtml("```\n- not a list\n```");
    expect(html).toBe("<pre><code>- not a list</code></pre>");
  });
});
