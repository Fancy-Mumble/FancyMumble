import { describe, it, expect } from "vitest";
import { base64PayloadBytes, imageSizeFromSource } from "../imageSize";
import { bodyVisibleText, decodeHtmlEntities } from "../visibleText";
import { isEditableBody, prepareBodyHtml, relaxNonBreakingSpaces, trimBodyEdges } from "../bodyMarkup";
import { imagePopoutCaption } from "@core/features/chat/imagePopout";
import { stockImageSrc, stockImg, stockJpeg } from "./stockFixtures";

const JPEG = stockJpeg(640, 480);
const SRC = stockImageSrc(JPEG);

describe("the stock fixture", () => {
  it("is written the way Log::imageToImg writes it", () => {
    // If these fail the fixture no longer exercises what it is here for.
    expect(SRC.startsWith("data:image/JPEG;base64,%2F9j%2F4AAQ")).toBe(true);
    expect(SRC).toContain("%2B");
    expect(SRC).toContain("%3D%3D");
    expect(SRC).toContain("\n");
    expect(SRC.slice(SRC.indexOf(",") + 1)).not.toMatch(/[+/=]/);
  });
});

describe("imageSizeFromSource on a stock picture", () => {
  it("reads the frame size through the escapes and line breaks", () => {
    expect(imageSizeFromSource(SRC)).toEqual({ width: 640, height: 480 });
  });

  it("still reads an ordinary base64 payload", () => {
    let bin = "";
    for (const b of JPEG) bin += String.fromCharCode(b);
    expect(imageSizeFromSource(`data:image/jpeg;base64,${btoa(bin)}`)).toEqual({ width: 640, height: 480 });
  });

  it("gives up rather than throwing on a broken escape", () => {
    expect(imageSizeFromSource("data:image/JPEG;base64,%ZZ%2F9j")).toBeNull();
  });
});

describe("base64PayloadBytes", () => {
  it("weighs a stock payload at its decoded size", () => {
    expect(base64PayloadBytes(SRC, SRC.indexOf(",") + 1)).toBe(JPEG.length);
  });

  it("weighs a plain payload the same way", () => {
    expect(base64PayloadBytes("aGVsbG8=")).toBe(5);
    expect(base64PayloadBytes("aGk=")).toBe(2);
    expect(base64PayloadBytes("")).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named, decimal and hex references in one pass", () => {
    expect(decodeHtmlEntities("&quot;a&quot; &amp; &#39;b&#39; &#x41;&nbsp;&hellip;")).toBe(
      "\"a\" & 'b' A …",
    );
  });

  it("does not decode twice", () => {
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves what is not an entity alone", () => {
    expect(decodeHtmlEntities("a & b &#0; &nosuchthing;")).toBe("a & b &#0; &nosuchthing;");
  });
});

describe("bodyVisibleText on stock bodies", () => {
  it("reads the Send-Message dialog's paragraphs as separate words", () => {
    const body = 'a<p>b</p><p style="-qt-paragraph-type:empty"><br /></p><p>c</p>';
    expect(bodyVisibleText(body)).toBe("a b c");
    expect(bodyVisibleText(body, { multiline: true })).toBe("a\nb\n\nc");
  });

  it("decodes what the chat bar escapes", () => {
    expect(bodyVisibleText("say &quot;hi&quot; &amp; bye")).toBe('say "hi" & bye');
  });

  it("turns Ctrl+Enter's non-breaking spaces into spaces", () => {
    expect(bodyVisibleText("one&nbsp;two&nbsp;three<br>four")).toBe("one two three four");
  });

  it("keeps a quote's line break", () => {
    expect(bodyVisibleText("<div><i>quoted<br/>two</i></div>")).toBe("quoted two");
  });

  it("says nothing for a picture, a marker, or a stylesheet", () => {
    const body = `<!-- FANCY_QUOTE:x --><style>p{color:red}</style><br />${stockImg(JPEG)}`;
    expect(bodyVisibleText(body)).toBe("");
  });
});

describe("imagePopoutCaption", () => {
  it("is null for a bare stock picture", () => {
    expect(imagePopoutCaption(`<br />${stockImg(JPEG)}`)).toBeNull();
  });

  it("decodes entities", () => {
    expect(imagePopoutCaption(`<p>look&nbsp;&quot;here&quot;</p>${stockImg(JPEG)}`)).toBe('look "here"');
  });

  it("keeps a caption's lines", () => {
    expect(imagePopoutCaption(`one<br />two<p>three</p>${stockImg(JPEG)}`)).toBe("one\ntwo\nthree");
  });
});

describe("trimBodyEdges", () => {
  it("drops the break above a pasted stock picture", () => {
    expect(trimBodyEdges("<br />")).toBe("");
    expect(trimBodyEdges("<br /><b>x</b>")).toBe("<b>x</b>");
  });

  it("drops trailing empty Qt paragraphs but keeps inner ones", () => {
    const body =
      'a<p style="-qt-paragraph-type:empty"><br /></p><p>b</p><p style="-qt-paragraph-type:empty"><br /></p>';
    expect(trimBodyEdges(body)).toBe('a<p style="-qt-paragraph-type:empty"><br /></p><p>b</p>');
  });

  it("keeps leading indentation", () => {
    expect(trimBodyEdges("&nbsp;&nbsp;x")).toBe("&nbsp;&nbsp;x");
  });
});

describe("relaxNonBreakingSpaces", () => {
  it("lets Ctrl+Enter text wrap between words", () => {
    expect(relaxNonBreakingSpaces("one&nbsp;two&nbsp;three<br>four&nbsp;five")).toBe(
      "one two three<br>four five",
    );
  });

  it("keeps runs as wide as they were, breakable at their end", () => {
    expect(relaxNonBreakingSpaces("a&nbsp;&nbsp;&nbsp;b")).toBe("a   b");
  });

  it("keeps indentation at the start of a line", () => {
    expect(relaxNonBreakingSpaces("&nbsp;&nbsp;code<br>&nbsp;&nbsp;more")).toBe("  code<br>  more");
  });

  it("never touches a tag", () => {
    const body = '<span title="a&nbsp;b">x&nbsp;y</span>';
    expect(relaxNonBreakingSpaces(body)).toBe('<span title="a&nbsp;b">x y</span>');
  });

  it("hands back a body with none untouched", () => {
    const body = "<b>plain</b> text";
    expect(relaxNonBreakingSpaces(body)).toBe(body);
  });
});

describe("prepareBodyHtml", () => {
  it("leaves nothing of a pasted stock picture once it is lifted out", () => {
    expect(prepareBodyHtml("<br />")).toBe("");
  });
});

describe("isEditableBody", () => {
  it("refuses a body carrying a picture", () => {
    expect(isEditableBody(`<br />${stockImg(JPEG)}`)).toBe(false);
    expect(isEditableBody('<video src="x"></video>')).toBe(false);
  });

  it("allows text", () => {
    expect(isEditableBody("<b>hi</b> &quot;there&quot;")).toBe(true);
  });
});
