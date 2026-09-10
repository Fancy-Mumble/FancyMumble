import { describe, expect, it } from "vitest";

import { isOnlyLinks, prettyLinks, prettyUrl } from "./prettyLinks";

describe("prettyUrl", () => {
  it("drops the scheme, the www and the whole query string", () => {
    // The query is where a copied link keeps its tracking parameters, and the
    // ones that are not tracking are unreadable anyway.
    expect(prettyUrl("https://www.youtube.com/watch?v=B5EwrXHvE5o&t=2941s")).toBe("youtube.com/watch");
  });

  it("cuts a long path from the end, whole segments at a time", () => {
    // Where it is going, not what it is called: the headline is on the card,
    // and the slug that ends an article URL is the ugliest part of it.
    expect(prettyUrl("https://www.tagesschau.de/ausland/europa/israel-siedler-westjordanland-100.html")).toBe(
      "tagesschau.de/ausland/europa/…",
    );
    const trimmed = prettyUrl(
      "https://www.reddit.com/r/dataisbeautiful/comments/1abcdef/oc_eli_lilly_first_half_of_2026_revenue/",
    );
    expect(trimmed).toBe("reddit.com/r/dataisbeautiful/comments/1abcdef/…");
    expect(trimmed!.length).toBeLessThanOrEqual(48);
  });

  it("leaves a short link alone and drops a bare host's trailing slash", () => {
    expect(prettyUrl("https://example.org/a/b")).toBe("example.org/a/b");
    expect(prettyUrl("https://example.org/")).toBe("example.org");
  });

  it("is not interested in anything that is not a web link", () => {
    expect(prettyUrl("not a url")).toBeUndefined();
    // A `javascript:` href is not a link to anywhere, and a trimmed display
    // for one would be a disguise.
    expect(prettyUrl("javascript:alert(1)")).toBeUndefined();
  });
});

describe("prettyLinks", () => {
  it("trims an anchor that is its own URL and keeps the whole thing on the title", () => {
    const html = prettyLinks(
      '<a href="https://www.youtube.com/watch?v=B5EwrXHvE5o&amp;t=2941s">https://www.youtube.com/watch?v=B5EwrXHvE5o&amp;t=2941s</a>',
    );
    expect(html).toContain(">youtube.com/watch<");
    // The href is untouched, so copy, paste and the click all still get the
    // link somebody actually sent.
    expect(html).toContain('href="https://www.youtube.com/watch?v=B5EwrXHvE5o&amp;t=2941s"');
    expect(html).toContain('title="https://www.youtube.com/watch?v=B5EwrXHvE5o&amp;t=2941s"');
  });

  it("leaves a link somebody wrote words for exactly as it was", () => {
    const html = '<a href="https://github.com/fancy-mumble">docs for the client</a>';
    expect(prettyLinks(html)).toBe(html);
  });

  it("passes through a body with no links at all", () => {
    expect(prettyLinks("<p>hello</p>")).toBe("<p>hello</p>");
  });
});

describe("isOnlyLinks", () => {
  it("knows a message that is nothing but its link", () => {
    expect(isOnlyLinks('<a href="https://example.org/a">https://example.org/a</a>')).toBe(true);
    // Two of them, and the whitespace between: still nothing anybody typed.
    expect(isOnlyLinks('<a href="https://a.example/">a</a> <a href="https://b.example/">b</a>')).toBe(true);
  });

  it("leaves a sentence alone, and anything that is not text", () => {
    expect(isOnlyLinks('see <a href="https://example.org/a">this</a>')).toBe(false);
    // A picture, a mention chip, an emoji: the body carries something of its
    // own, whatever else is in it.
    expect(isOnlyLinks('<a href="https://example.org/a">a</a><img src="x.png">')).toBe(false);
    expect(isOnlyLinks("<p>no links here</p>")).toBe(false);
  });
});
