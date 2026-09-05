import { describe, expect, it } from "vitest";
import { bodyToCopyText, bodyToPlainText } from "./bodyText";

describe("bodyToPlainText", () => {
  it("separates adjacent blocks instead of running them together", () => {
    // The defect this exists for: textContent gives "HelloWorld".
    expect(bodyToPlainText("<p>Hello</p><p>World</p>")).toBe("Hello World");
    expect(bodyToPlainText("<div>one</div><div>two</div>")).toBe("one two");
  });

  it("treats a line break as a boundary", () => {
    expect(bodyToPlainText("Hello<br>World")).toBe("Hello World");
    expect(bodyToPlainText("Hello<br/>World")).toBe("Hello World");
  });

  it("keeps list items apart", () => {
    expect(bodyToPlainText("<ul><li>a</li><li>b</li></ul>")).toBe("a b");
  });

  it("does not invent a space inside inline markup", () => {
    expect(bodyToPlainText("<b>Hello</b> <i>World</i>")).toBe("Hello World");
    // The word is one word: bolding half of it must not split it.
    expect(bodyToPlainText("<b>Hel</b>lo")).toBe("Hello");
    expect(bodyToPlainText('<a href="#">click</a>here')).toBe("clickhere");
  });

  it("separates on an unknown or custom element, which is the safe answer", () => {
    expect(bodyToPlainText("<fancy-thing>a</fancy-thing><fancy-thing>b</fancy-thing>")).toBe("a b");
  });

  it("decodes entities and collapses the source's own whitespace", () => {
    expect(bodyToPlainText("a &amp; b")).toBe("a & b");
    expect(bodyToPlainText("&lt;script&gt;")).toBe("<script>");
    expect(bodyToPlainText("<p>one\n   two</p>")).toBe("one two");
  });

  it("is empty for an empty body, not undefined", () => {
    expect(bodyToPlainText("")).toBe("");
    expect(bodyToPlainText("<p></p>")).toBe("");
  });
});

describe("bodyToCopyText", () => {
  it("gives back the lines the reader saw", () => {
    expect(bodyToCopyText("<p>Hello</p><p>World</p>")).toBe("Hello\n\nWorld");
    expect(bodyToCopyText("Hello<br>World")).toBe("Hello\nWorld");
  });

  it("keeps a list one item per line", () => {
    expect(bodyToCopyText("<ul><li>a</li><li>b</li></ul>")).toBe("a\n\nb");
  });

  it("never opens or closes with a blank line", () => {
    expect(bodyToCopyText("<p>only</p>")).toBe("only");
    expect(bodyToCopyText("<div><div><p>nested</p></div></div>")).toBe("nested");
  });

  it("squeezes a run of empty blocks down to one blank line", () => {
    expect(bodyToCopyText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });

  it("leaves inline runs on their own line", () => {
    expect(bodyToCopyText("<p><b>Hello</b> <i>World</i></p>")).toBe("Hello World");
  });

  it("collapses the source's indentation, which was never on screen", () => {
    expect(bodyToCopyText("<p>one     two</p>")).toBe("one two");
  });
});
