import { describe, expect, it } from "vitest";
import { bodyToHtml, isMarkupBody } from "./bodyHtml";

/**
 * The screenshot this exists for: five bots posting through the protocol, and
 * every one of their messages printing its own asterisks and backticks in the
 * chat river. Their bodies are markdown, because a client that is not this one
 * has no reason to send HTML.
 */
describe("a body that arrived as plain markdown", () => {
  it("formats bold, italic and code", () => {
    expect(bodyToHtml("**Nice settings** _channel fox_ `code 2994` and sure")).toBe(
      "<b>Nice settings</b> <i>channel fox</i> <code>code 2994</code> and sure",
    );
  });

  it("formats the asterisk dialect too", () => {
    expect(bodyToHtml("*maybe* not")).toBe("<i>maybe</i> not");
  });

  it("linkifies a bare URL", () => {
    expect(bodyToHtml("see http://127.0.0.1/healthz?m=1 now")).toContain(
      '<a href="http://127.0.0.1/healthz?m=1"',
    );
  });

  it("keeps a plain line plain", () => {
    expect(bodyToHtml("Shares brb brb fine settings page :)")).toBe("Shares brb brb fine settings page :)");
  });

  it("escapes what it formats", () => {
    // The text is plain, so `<` in it is text: it must not become a tag.
    expect(bodyToHtml("**a** < b")).toBe("<b>a</b> &lt; b");
  });
});

/**
 * The far more common case, and the one that must not change: a body from this
 * client's own composer is HTML already. Reading it as markdown would escape
 * its tags and print them.
 */
describe("a body that is markup already", () => {
  it("passes a formatted body through untouched", () => {
    const body = "<b>Nice</b> and <i>fox</i>";
    expect(bodyToHtml(body)).toBe(body);
  });

  it("leaves an image alone", () => {
    const body = 'Look <img src="data:image/png;base64,AAA">';
    expect(bodyToHtml(body)).toBe(body);
  });

  it("leaves a body holding one of our markers alone", () => {
    // A marker is a comment; formatting the body would escape it into view.
    const body = "watching <!-- FANCY_WATCH:abc -->";
    expect(bodyToHtml(body)).toBe(body);
  });

  it("does not double-escape a body that is only entities", () => {
    // A legacy client can send escaped text with no tags in it at all.
    expect(bodyToHtml("a &gt; b &amp; c")).toBe("a &gt; b &amp; c");
  });

  it("recognises markup by tag or entity", () => {
    expect(isMarkupBody("<p>hi</p>")).toBe(true);
    expect(isMarkupBody("&amp;")).toBe(true);
    expect(isMarkupBody("a < b")).toBe(false);
    expect(isMarkupBody("2 * 3 * 4")).toBe(false);
  });
});
