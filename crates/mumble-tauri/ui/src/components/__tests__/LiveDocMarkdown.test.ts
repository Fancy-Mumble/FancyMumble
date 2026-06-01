/**
 * Regression tests for LiveDoc markdown round-tripping.
 *
 * Exporting the editor's HTML to Markdown and re-parsing it must
 * preserve text alignment, line breaks, header levels, lists,
 * blockquotes, fenced code, links, inline marks, images, and inline
 * math.  These tests guard against regressions in the export path
 * the user reported (alignment, line breaks, header sizes "and much
 * more" being dropped).
 */

import { describe, expect, it } from "vitest";
import {
  editorHtmlToMarkdown,
  markdownToEditorHtml,
} from "../chat/livedoc/liveDocMarkdown";

function roundtrip(html: string): string {
  return markdownToEditorHtml(editorHtmlToMarkdown(html));
}

describe("editorHtmlToMarkdown", () => {
  it("emits ATX headings for all six levels", () => {
    const html =
      "<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>";
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("# One");
    expect(md).toContain("## Two");
    expect(md).toContain("### Three");
    expect(md).toContain("#### Four");
    expect(md).toContain("##### Five");
    expect(md).toContain("###### Six");
  });

  it("preserves text alignment by emitting raw HTML", () => {
    const html = '<p style="text-align: center">Centered text</p>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toMatch(/text-align:\s*center/);
    expect(md).toContain("Centered text");
  });

  it("preserves heading alignment", () => {
    const html = '<h2 style="text-align: right">Right title</h2>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("text-align: right");
    expect(md).toContain("Right title");
  });

  it("emits hard line breaks as two-space soft breaks", () => {
    const html = "<p>line one<br>line two</p>";
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("line one  \nline two");
  });

  it("round-trips a manual page break", () => {
    const html =
      '<p>before</p><div data-page-break="" class="livedoc-page-break"></div><p>after</p>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("data-page-break");
    const back = markdownToEditorHtml(md);
    // The page-break div survives the export/import cycle so the
    // PageBreak node can re-parse it.
    expect(back).toContain("data-page-break");
    expect(back).toContain("before");
    expect(back).toContain("after");
  });

  it("round-trips a manual section break", () => {
    const html =
      '<p>one</p><div data-section-break="" class="livedoc-section-break"></div><p>two</p>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("data-section-break");
    const back = markdownToEditorHtml(md);
    expect(back).toContain("data-section-break");
    expect(back).toContain("one");
    expect(back).toContain("two");
  });

  it("preserves empty paragraphs (Enter pressed multiple times)", () => {
    const html = "<p>before</p><p></p><p></p><p>after</p>";
    const md = editorHtmlToMarkdown(html);
    // Two empty paragraphs must survive as raw `<p></p>` markers.
    expect((md.match(/<p><\/p>/g) ?? []).length).toBe(2);
    expect(md).toContain("before");
    expect(md).toContain("after");
  });

  it("distinguishes paragraphs (Enter) from line breaks (Shift+Enter)", () => {
    // Two paragraphs: Enter key
    expect(editorHtmlToMarkdown("<p>a</p><p>b</p>")).toContain("a\n\nb");
    // Hard break inside a paragraph: Shift+Enter
    expect(editorHtmlToMarkdown("<p>a<br>b</p>")).toContain("a  \nb");
  });

  it("serialises ordered and unordered lists", () => {
    const html = "<ul><li>alpha</li><li>beta</li></ul><ol><li>first</li><li>second</li></ol>";
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("- alpha");
    expect(md).toContain("- beta");
    expect(md).toContain("1. first");
    expect(md).toContain("2. second");
  });

  it("serialises nested lists with indentation", () => {
    const html = "<ul><li>outer<ul><li>inner</li></ul></li></ul>";
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("- outer");
    expect(md).toMatch(/\n {2}- inner/);
  });

  it("serialises blockquotes", () => {
    const html = "<blockquote><p>quoted</p></blockquote>";
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("> quoted");
  });

  it("serialises fenced code with language", () => {
    const html = '<pre><code class="language-ts">const x = 1;</code></pre>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("```ts\nconst x = 1;\n```");
  });

  it("serialises horizontal rules", () => {
    const html = "<p>before</p><hr><p>after</p>";
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("---");
  });

  it("serialises inline marks", () => {
    const html =
      "<p><strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s> <code>tt</code></p>";
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("__under__");
    expect(md).toContain("~~strike~~");
    expect(md).toContain("`tt`");
  });

  it("serialises links", () => {
    const html = '<p><a href="https://example.com">site</a></p>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("[site](https://example.com)");
  });

  it("serialises subscript and superscript as raw inline HTML", () => {
    const html = "<p>H<sub>2</sub>O and E=mc<sup>2</sup></p>";
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("<sub>2</sub>");
    expect(md).toContain("<sup>2</sup>");
  });

  it("preserves color spans as raw inline HTML", () => {
    const html = '<p><span style="color: #ff0000">red</span></p>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("<span");
    expect(md).toContain("color:");
    expect(md).toContain("red");
  });

  it("converts inline math spans to $latex$", () => {
    const html = '<p><span data-type="inlineMath" data-latex="x^2"></span></p>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("$x^2$");
  });

  it("preserves images as raw HTML", () => {
    const html = '<p><img src="data:image/png;base64,AAA=" alt="img" width="32"></p>';
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("<img");
    expect(md).toContain("data:image/png;base64,AAA=");
    expect(md).toContain('width="32"');
  });
});

describe("markdownToEditorHtml", () => {
  it("parses ATX headings", () => {
    const html = markdownToEditorHtml("# Title\n\n## Subtitle");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h2>Subtitle</h2>");
  });

  it("parses inline marks", () => {
    const html = markdownToEditorHtml("**b** *i* __u__ ~~s~~ ==h== `c`");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<u>u</u>");
    expect(html).toContain("<s>s</s>");
    expect(html).toContain("<mark>h</mark>");
    expect(html).toContain("<code>c</code>");
  });

  it("parses fenced code with language", () => {
    const html = markdownToEditorHtml("```ts\nlet a = 1;\n```");
    expect(html).toContain('<pre><code class="language-ts">let a = 1;</code></pre>');
  });

  it("parses lists", () => {
    const html = markdownToEditorHtml("- one\n- two\n\n1. first\n2. second");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
  });

  it("parses nested lists", () => {
    const html = markdownToEditorHtml("- outer\n  - inner");
    expect(html).toMatch(/<li>outer<ul><li>inner<\/li><\/ul><\/li>/);
  });

  it("parses blockquotes", () => {
    const html = markdownToEditorHtml("> quoted");
    expect(html).toMatch(/<blockquote>.*quoted.*<\/blockquote>/s);
  });

  it("parses horizontal rule", () => {
    const html = markdownToEditorHtml("---");
    expect(html).toContain("<hr>");
  });

  it("parses inline math", () => {
    const html = markdownToEditorHtml("Equation: $x^2$");
    expect(html).toContain('<span data-type="inlineMath" data-latex="x^2">');
  });

  it("passes raw HTML blocks through", () => {
    const html = markdownToEditorHtml('<p style="text-align: center">aligned</p>');
    expect(html).toContain('style="text-align: center"');
    expect(html).toContain("aligned");
  });

  it("preserves img tags with data URLs", () => {
    const html = markdownToEditorHtml('<img src="data:image/png;base64,AAA=" alt="x">');
    expect(html).toContain('<img src="data:image/png;base64,AAA=" alt="x">');
  });

  it("converts two-space line endings to <br>", () => {
    const html = markdownToEditorHtml("line one  \nline two");
    expect(html).toContain("line one<br>");
  });
});

describe("LiveDoc round-trip", () => {
  it("preserves heading levels", () => {
    const html = "<h1>A</h1><h3>B</h3>";
    expect(roundtrip(html)).toContain("<h1>A</h1>");
    expect(roundtrip(html)).toContain("<h3>B</h3>");
  });

  it("preserves paragraph alignment", () => {
    const html = '<p style="text-align: center">hi</p>';
    expect(roundtrip(html)).toContain('style="text-align: center"');
  });

  it("preserves heading alignment", () => {
    const html = '<h2 style="text-align: right">Title</h2>';
    expect(roundtrip(html)).toContain('style="text-align: right"');
  });

  it("preserves line breaks", () => {
    const html = "<p>one<br>two</p>";
    expect(roundtrip(html)).toMatch(/one<br>\s*two/);
  });

  it("preserves subscript and superscript", () => {
    const html = "<p>H<sub>2</sub>O x<sup>n</sup></p>";
    const out = roundtrip(html);
    expect(out).toContain("<sub>2</sub>");
    expect(out).toContain("<sup>n</sup>");
  });

  it("preserves consecutive empty paragraphs across the round-trip", () => {
    const html = "<p>before</p><p></p><p></p><p>after</p>";
    const out = roundtrip(html);
    // Both empty paragraphs must reappear after re-import.
    expect((out.match(/<p><\/p>/g) ?? []).length).toBe(2);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("preserves bold + italic + link", () => {
    const html = '<p><strong>b</strong> <em>i</em> <a href="https://x.test">L</a></p>';
    const out = roundtrip(html);
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("<em>i</em>");
    expect(out).toMatch(/<a href="https:\/\/x\.test"[^>]*>L<\/a>/);
  });

  it("serialises mention chips into wire markers", () => {
    const html = [
      '<p>',
      '<span class="mention mention-user" data-mention-session="42">@alice</span>',
      ' please review ',
      '<span class="mention mention-role" data-mention-role="ops">@ops</span>',
      ' tag ',
      '<span class="mention mention-everyone" data-mention-everyone="1">@everyone</span>',
      ' and ',
      '<span class="mention mention-here" data-mention-here="1">@here</span>',
      '</p>',
    ].join("");
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("<@42>");
    expect(md).toContain("<@&ops>");
    expect(md).toContain("@everyone");
    expect(md).toContain("@here");
  });

  it("re-parses mention markers back into chip spans", () => {
    const md = "<@42> please review <@&ops> tag @everyone and @here\n";
    const html = markdownToEditorHtml(md);
    expect(html).toContain('data-mention-session="42"');
    expect(html).toContain('data-mention-role="ops"');
    expect(html).toContain('data-mention-everyone="1"');
    expect(html).toContain('data-mention-here="1"');
  });

  it("round-trips a task list with checked + unchecked items", () => {
    const html = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="true"><div><p>done</p></div></li>',
      '<li data-type="taskItem" data-checked="false"><div><p>todo</p></div></li>',
      "</ul>",
    ].join("");
    const md = editorHtmlToMarkdown(html);
    expect(md).toContain("- [x] done");
    expect(md).toContain("- [ ] todo");

    const back = markdownToEditorHtml(md);
    expect(back).toContain('<ul data-type="taskList">');
    expect(back).toContain('data-checked="true"');
    expect(back).toContain('data-checked="false"');
    expect(back).toContain(">done</p>");
    expect(back).toContain(">todo</p>");
  });

  it("preserves a task-list item that mixes mentions and plain text", () => {
    const md = "- [ ] <@7> ship the docs\n- [x] @everyone review\n";
    const back = markdownToEditorHtml(md);
    expect(back).toContain('<ul data-type="taskList">');
    expect(back).toContain('data-mention-session="7"');
    expect(back).toContain('data-mention-everyone="1"');
    expect(back).toContain('data-checked="true"');
    expect(back).toContain('data-checked="false"');
  });

  it("preserves a complete document with mixed content", () => {
    const html = [
      "<h1>Document</h1>",
      '<p style="text-align: center">Centered intro.</p>',
      "<p>Paragraph with <strong>bold</strong> and <em>italic</em>.</p>",
      "<ul><li>one</li><li>two</li></ul>",
      "<blockquote><p>quoted line</p></blockquote>",
      '<pre><code class="language-ts">const x = 1;</code></pre>',
      "<hr>",
      "<p>Final line one<br>final line two.</p>",
    ].join("");
    const out = roundtrip(html);
    expect(out).toContain("<h1>Document</h1>");
    expect(out).toContain('style="text-align: center"');
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<li>one</li>");
    expect(out).toMatch(/<blockquote>.*quoted line.*<\/blockquote>/s);
    expect(out).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(out).toContain("<hr>");
    expect(out).toMatch(/Final line one<br>\s*final line two\./);
  });
});
