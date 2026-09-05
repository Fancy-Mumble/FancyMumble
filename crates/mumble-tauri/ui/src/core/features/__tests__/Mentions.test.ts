import { describe, it, expect } from "vitest";
import {
  parseMentionTrigger,
  formatUserMention,
  formatRoleMention,
  applyMentionsToHtml,
  extractMentionTargets,
  containsSelfMention,
  type MentionResolver,
} from "../../utils/mentions";

const resolver: MentionResolver = {
  resolveSession(session) {
    if (session === 1) return { name: "Alice" };
    if (session === 2) return { name: "Bob" };
    return null;
  },
};

describe("parseMentionTrigger", () => {
  it("returns null when there is no @", () => {
    expect(parseMentionTrigger("hello world", 5)).toBeNull();
  });

  it("detects a user trigger at the start", () => {
    const t = parseMentionTrigger("@al", 3);
    expect(t).toEqual({ anchor: 0, query: "al", kind: "user" });
  });

  it("detects a role trigger with @& prefix", () => {
    const t = parseMentionTrigger("hi @&mod", 8);
    expect(t).toEqual({ anchor: 3, query: "mod", kind: "role" });
  });

  it("does not trigger for inline @ (no preceding whitespace)", () => {
    expect(parseMentionTrigger("a@b", 3)).toBeNull();
  });

  it("does not trigger across whitespace", () => {
    expect(parseMentionTrigger("@al ", 4)).toBeNull();
  });

  it("does not trigger when cursor is before the @", () => {
    expect(parseMentionTrigger("@al", 0)).toBeNull();
  });

  it("trigger continues with empty query right after @", () => {
    const t = parseMentionTrigger("hi @", 4);
    expect(t).toEqual({ anchor: 3, query: "", kind: "user" });
  });
});

describe("applyMentionsToHtml", () => {
  it("replaces escaped <@N> with a chip", () => {
    const out = applyMentionsToHtml("&lt;@1&gt; hello", resolver);
    expect(out).toContain('class="mention mention-user"');
    expect(out).toContain('data-mention-session="1"');
    expect(out).toContain("@Alice");
  });

  it("falls back to user-N when session is unknown", () => {
    const out = applyMentionsToHtml("&lt;@99&gt;", resolver);
    expect(out).toContain("@user-99");
  });

  it("renders @everyone and @here chips", () => {
    const out = applyMentionsToHtml("hello @everyone and @here", resolver);
    expect(out).toContain('class="mention mention-everyone"');
    expect(out).toContain('class="mention mention-here"');
    expect(out).toContain('data-mention-everyone="1"');
    expect(out).toContain('data-mention-here="1"');
  });

  it("renders role chips", () => {
    const out = applyMentionsToHtml("&lt;@&amp;moderators&gt;", resolver);
    expect(out).toContain('data-mention-role="moderators"');
    expect(out).toContain("@moderators");
  });

  it("does not match @everyone mid-word", () => {
    const out = applyMentionsToHtml("foo@everyone", resolver);
    expect(out).not.toContain("mention-everyone");
  });
});

describe("extractMentionTargets", () => {
  it("collects sessions, roles, everyone, here from chip HTML", () => {
    const html =
      '<span data-mention-session="1">@A</span> ' +
      '<span data-mention-role="mods">@mods</span> ' +
      '<span data-mention-everyone="1">@everyone</span> ' +
      '<span data-mention-here="1">@here</span>';
    const t = extractMentionTargets(html);
    expect(t.sessions.has(1)).toBe(true);
    expect(t.roles.has("mods")).toBe(true);
    expect(t.everyone).toBe(true);
    expect(t.here).toBe(true);
  });

  it("also recognises raw markers from older clients", () => {
    const t = extractMentionTargets("hi <@5> and <@&team> @everyone");
    expect(t.sessions.has(5)).toBe(true);
    expect(t.roles.has("team")).toBe(true);
    expect(t.everyone).toBe(true);
  });
});

describe("containsSelfMention", () => {
  const html = '<span data-mention-session="42">@me</span>';

  it("matches by own session id", () => {
    expect(containsSelfMention(html, { ownSession: 42, isInMessageChannel: false })).toBe(true);
  });

  it("does not match other sessions", () => {
    expect(containsSelfMention(html, { ownSession: 7, isInMessageChannel: false })).toBe(false);
  });

  it("matches @everyone only when in the message's channel", () => {
    const ev = '<span data-mention-everyone="1">@everyone</span>';
    expect(containsSelfMention(ev, { ownSession: 1, isInMessageChannel: true })).toBe(true);
    expect(containsSelfMention(ev, { ownSession: 1, isInMessageChannel: false })).toBe(false);
  });

  it("matches a role when receiver belongs to it", () => {
    const r = '<span data-mention-role="mods">@mods</span>';
    expect(
      containsSelfMention(r, {
        ownSession: 1,
        ownRoles: new Set(["mods"]),
        isInMessageChannel: false,
      }),
    ).toBe(true);
    expect(
      containsSelfMention(r, {
        ownSession: 1,
        ownRoles: new Set(["admins"]),
        isInMessageChannel: false,
      }),
    ).toBe(false);
  });
});

describe("format helpers", () => {
  it("formatUserMention produces the wire marker", () => {
    expect(formatUserMention(7)).toBe("<@7>");
  });
  it("formatRoleMention produces the wire marker", () => {
    expect(formatRoleMention("admins")).toBe("<@&admins>");
  });
});

describe("role names that are not plain words", () => {
  const resolver = { resolveSession: () => ({ name: "Ada" }), resolveRole: () => null };

  /** What the composer's marker looks like once markdownToHtml has escaped it. */
  const escapedMarker = (name: string) =>
    `&lt;@&amp;${name.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;")}&gt;`;

  it("renders a chip for a role with an ampersand in its name", () => {
    // Before: the marker matched nothing and `<@&R&D>` was shown as text.
    const html = applyMentionsToHtml(escapedMarker("R&D"), resolver);
    expect(html).toContain('data-mention-role="R&amp;D"');
    expect(html).not.toContain("&lt;@&amp;");
  });

  it("notifies a member of that role", () => {
    const html = applyMentionsToHtml(escapedMarker("R&D"), resolver);
    expect([...extractMentionTargets(html).roles]).toEqual(["R&D"]);
    expect(
      containsSelfMention(html, {
        ownSession: 1,
        isInMessageChannel: false,
        ownRoles: new Set(["R&D"]),
      }),
    ).toBe(true);
  });

  it("handles an apostrophe the same way", () => {
    const html = applyMentionsToHtml(escapedMarker("The'Team"), resolver);
    expect([...extractMentionTargets(html).roles]).toEqual(["The'Team"]);
  });

  it("reads a role name back as itself, not as its escaped form", () => {
    // The regression: `ownRoles` holds real ACL group names, so a target of
    // "R&amp;D" silently matched nobody.
    const targets = extractMentionTargets('<span data-mention-role="R&amp;D"></span>');
    expect(targets.roles.has("R&D")).toBe(true);
    expect(targets.roles.has("R&amp;D")).toBe(false);
  });

  it("still renders a plain role name unchanged", () => {
    const html = applyMentionsToHtml(escapedMarker("Admins"), resolver);
    expect(html).toContain('data-mention-role="Admins"');
    expect([...extractMentionTargets(html).roles]).toEqual(["Admins"]);
  });
});

describe("@everyone written rather than said", () => {
  const everyoneIn = (body: string) => extractMentionTargets(body).everyone;

  it("does not ping a channel for a message asking how the word works", () => {
    // The regression: this drew no chip and notified everyone anyway.
    expect(everyoneIn("how do I use <code>@everyone</code>?")).toBe(false);
    expect(everyoneIn("<pre>@everyone</pre>")).toBe(false);
  });

  it("still hears one that opens a paragraph, as a legacy client sends it", () => {
    expect(everyoneIn("<p>@everyone standup in five</p>")).toBe(true);
  });

  it("still hears a plain one mid-sentence", () => {
    expect(everyoneIn("heads up @everyone")).toBe(true);
    expect(extractMentionTargets("heads up @here").here).toBe(true);
  });

  it("hears the chip whatever surrounds it", () => {
    expect(everyoneIn('<span data-mention-everyone="1">@everyone</span>')).toBe(true);
  });

  it("is not fooled by a word that merely ends in the name", () => {
    expect(everyoneIn("mail me at foo@everyone.example")).toBe(false);
  });

  it("keeps @here on the same rule", () => {
    expect(extractMentionTargets("what does <code>@here</code> do?").here).toBe(false);
    expect(extractMentionTargets("<p>@here</p>").here).toBe(true);
  });
});

describe("the renderer only ever rewrites text", () => {
  const r: MentionResolver = { resolveSession: () => ({ name: "Ada" }), resolveRole: () => null };

  it("leaves an attribute value alone", () => {
    // The regression: this spliced a `<span class="...` into the `alt`, whose
    // own quote closed the attribute and corrupted the tag - on the send path,
    // so every recipient stored the broken markup.
    const out = applyMentionsToHtml('<img alt="ping @here now">', r);
    expect(out).toBe('<img alt="ping @here now">');
  });

  it("leaves a URL alone", () => {
    const out = applyMentionsToHtml('<a href="https://x.test/a b @everyone">link</a>', r);
    expect(out).toContain('href="https://x.test/a b @everyone"');
    expect(out).not.toContain("<span");
  });

  it("chips the link's text even so", () => {
    const out = applyMentionsToHtml('<a href="https://x.test/">ping @everyone</a>', r);
    expect(out).toContain('data-mention-everyone="1"');
  });

  it("chips a mention that opens a paragraph", () => {
    // Was: no chip, but the receive side notified anyway.
    expect(applyMentionsToHtml("<p>@everyone standup</p>", r)).toContain('data-mention-everyone="1"');
  });

  it("does not chip one inside code", () => {
    const out = applyMentionsToHtml("use <code>@everyone</code> sparingly", r);
    expect(out).not.toContain("data-mention-everyone");
    expect(out).toContain("<code>@everyone</code>");
  });

  it("does not chip a word that merely ends in the name", () => {
    expect(applyMentionsToHtml("mail foo@everyone.example", r)).not.toContain("<span");
  });

  it("does not split a word across an inline tag", () => {
    // "hi@everyone" reads as one word, and the receive side agrees.
    expect(applyMentionsToHtml("<b>hi</b>@everyone", r)).not.toContain("data-mention-everyone");
  });

  it("returns an ordinary message byte for byte", () => {
    const plain = "<p>just talking about the weather</p>";
    expect(applyMentionsToHtml(plain, r)).toBe(plain);
  });

  it("escapes a role name through the DOM rather than by hand", () => {
    const out = applyMentionsToHtml("<p>&lt;@&amp;R&amp;D&gt;</p>", r);
    expect(out).toContain('data-mention-role="R&amp;D"');
    expect(out).toContain("@R&amp;D</span>");
  });
});

describe("chip and notification agree", () => {
  const r: MentionResolver = { resolveSession: () => ({ name: "Ada" }), resolveRole: () => null };

  /** The invariant: a ping fires exactly when a chip is drawn. */
  const agree = (body: string) => {
    const rendered = applyMentionsToHtml(body, r);
    const chip = rendered.includes("data-mention-everyone") || rendered.includes("data-mention-here");
    const targets = extractMentionTargets(rendered);
    return { chip, notified: targets.everyone || targets.here };
  };

  it.each([
    ["a code span", "use <code>@everyone</code> sparingly"],
    ["a pre block", "<pre>@here</pre>"],
    ["the start of a paragraph", "<p>@everyone standup</p>"],
    ["mid-sentence", "heads up @everyone"],
    ["an attribute", '<img alt="ping @here now">'],
    ["an address", "mail foo@everyone.example"],
    ["a word split by markup", "<b>hi</b>@everyone"],
  ])("agree on %s", (_case, body) => {
    const { chip, notified } = agree(body);
    expect(notified).toBe(chip);
  });
});

