import { describe, it, expect } from "vitest";
import { extractMedia } from "@standard/components/chat/media/MediaPreview";
import { htmlToMarkdown } from "@standard/components/chat/markdown/MarkdownInput";
import { messageContent, splitBodyImages } from "@ui/nebula/selectors";
import { stockImg, stockJpeg } from "@core/utils/__tests__/stockFixtures";

/**
 * What the three packs make of bodies a stock Mumble 1.5 client sends.
 *
 * Every input here is byte-exact to what the stock client puts on the wire:
 * its Send-Message dialog, its chat-bar markdown, Ctrl+Enter plain text and a
 * pasted picture (see stockFixtures.ts for how that one is built).
 */

const JPEG = stockJpeg(320, 200);
const PASTED = `<br />${stockImg(JPEG)}`;

describe("standard: extractMedia on stock bodies", () => {
  it("tiles a pasted picture with its size and leaves no text behind", () => {
    const { cleaned, media } = extractMedia(PASTED);

    expect(cleaned).toBe("");
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ kind: "image", width: 320, height: 200 });
  });

  it("keeps a chat-bar quote's line break", () => {
    const { cleaned } = extractMedia("<div><i>quoted<br/>two</i></div>");

    expect(cleaned).toBe("<div><i>quoted<br>two</i></div>");
  });

  it("unwraps an unknown wrapper and keeps what is inside it", () => {
    const { cleaned } = extractMedia("<center><b>bold</b> and <i>it</i></center>");

    expect(cleaned).toBe("<b>bold</b> and <i>it</i>");
  });

  it("drops a stylesheet whole instead of printing it", () => {
    const { cleaned } = extractMedia("<style>p { color: red }</style>hello<script>alert(1)</script>");

    expect(cleaned).toBe("hello");
  });

  it("still strips attributes inside an unwrapped element", () => {
    const { cleaned } = extractMedia('<center><b onclick="x()">hi</b></center>');

    expect(cleaned).toBe("<b>hi</b>");
  });

  it("lets Ctrl+Enter plain text wrap between words", () => {
    const { cleaned } = extractMedia("one&nbsp;two&nbsp;three<br>&nbsp;&nbsp;indented");

    // The indentation is kept, as the character rather than the entity.
    expect(cleaned).toBe("one two three<br>  indented");
  });

  it("trims the Send-Message dialog's trailing empty paragraph", () => {
    const { cleaned } = extractMedia('a<p>b</p><p style="-qt-paragraph-type:empty"><br /></p>');

    expect(cleaned).toBe("a<p>b</p>");
  });
});

describe("nebula: stock bodies", () => {
  it("leaves no text beside a pasted picture", () => {
    const { html } = messageContent(PASTED);
    const split = splitBodyImages(html);

    expect(split.html).toBe("");
    expect(split.images).toHaveLength(1);
    expect(split.images[0]).toMatchObject({ width: 320, height: 200 });
  });

  it("lets Ctrl+Enter plain text wrap between words", () => {
    expect(messageContent("one&nbsp;two<br>three").html).toBe("one two<br>three");
  });
});

describe("htmlToMarkdown on stock entities", () => {
  it("decodes every entity, and a non-breaking space to a space", () => {
    expect(htmlToMarkdown("say&nbsp;&quot;hi&quot; &#39;x&#39; &amp;&lt;b&gt;")).toBe(`say "hi" 'x' &<b>`);
  });
});
