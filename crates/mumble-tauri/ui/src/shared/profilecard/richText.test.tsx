import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichText, isRichTextEmpty, parseRichText, richTextToPlain } from "./richText";

/** The markup the editor writes, so the card and the editor cannot drift. */
const WRITTEN = '<p>Drum &amp; <strong>bass</strong> and <span style="color: #ff4d4d">ARAM</span></p>';

describe("parseRichText", () => {
  it("keeps the marks the editor writes", () => {
    expect(parseRichText(WRITTEN)).toEqual([
      {
        kind: "element",
        tag: "p",
        color: undefined,
        children: [
          { kind: "text", text: "Drum & " },
          { kind: "element", tag: "strong", color: undefined, children: [{ kind: "text", text: "bass" }] },
          { kind: "text", text: " and " },
          { kind: "element", tag: "span", color: "#ff4d4d", children: [{ kind: "text", text: "ARAM" }] },
        ],
      },
    ]);
  });

  it("folds the tags other clients write onto the same marks", () => {
    const nodes = parseRichText('<b>a</b><i>b</i><del>c</del><font color="red">d</font>');
    expect(nodes.map((node) => node.kind === "element" && node.tag)).toEqual(["strong", "em", "s", "span"]);
    expect(nodes.at(-1)).toMatchObject({ color: "red" });
  });

  it("keeps the words out of markup it has no mark for", () => {
    // A comment written anywhere else is still someone's words - losing the
    // box is right, losing the sentence is not.
    expect(richTextToPlain("<table><tr><td>still mine</td></tr></table>")).toBe("still mine");
  });

  it("drops markup whose content is not words either", () => {
    expect(richTextToPlain("<script>alert(1)</script>hi")).toBe("hi");
    expect(richTextToPlain("<style>p{}</style>hi")).toBe("hi");
  });

  it("flattens a status onto one line and takes no pictures", () => {
    const nodes = parseRichText('<p>one</p><p>two</p><img src="data:image/png;base64,AA">', true);
    expect(nodes.every((node) => node.kind !== "image")).toBe(true);
    expect(richTextToPlain("<p>one</p><p>two</p>")).toBe("one two");
  });
});

describe("parseRichText caching", () => {
  it("answers the same text without parsing it again", () => {
    // The card re-renders per pointer tick while a volume slider is dragged;
    // the tree it draws must not be a fresh HTML document each time.
    expect(parseRichText("<p>oi</p>")).toBe(parseRichText("<p>oi</p>"));
    // Inline is a different question about the same string, not the same one.
    expect(parseRichText("<p>a</p><p>b</p>", true)).not.toBe(parseRichText("<p>a</p><p>b</p>"));
  });
});

describe("isRichTextEmpty", () => {
  it("reads what an emptied editor leaves behind as nothing to draw", () => {
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("<p>  </p>")).toBe(true);
    expect(isRichTextEmpty("")).toBe(true);
    expect(isRichTextEmpty("<p>oi</p>")).toBe(false);
    expect(isRichTextEmpty('<p><img src="data:image/png;base64,AA"></p>')).toBe(false);
  });
});

describe("RichText", () => {
  it("draws the marks as elements", () => {
    const { container } = render(<RichText html={WRITTEN} />);
    expect(container.querySelector("strong")?.textContent).toBe("bass");
    expect(container.querySelector("span")?.getAttribute("style")).toContain("rgb(255, 77, 77)");
  });

  it("never lets an event handler off the comment and into the DOM", () => {
    const { container } = render(
      <RichText html={'<p onclick="steal()" onerror="steal()">hi<img src="x" onerror="steal()"></p>'} />,
    );
    expect(container.innerHTML).not.toContain("steal");
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("takes a picture only when it is carried in the comment, never fetched", () => {
    const { container } = render(
      <RichText html={'<img src="https://tracker.example/pixel.png"><img src="data:image/png;base64,AA">'} />,
    );
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("data:image/png;base64,AA");
  });

  it("follows a link only to the web, and never back into this window", () => {
    render(
      <RichText
        html={'<a href="https://magical.rocks">safe</a><a href="javascript:steal()">unsafe</a>'}
        linkColor="#41b4f9"
      />,
    );
    const safe = screen.getByText("safe");
    expect(safe.tagName).toBe("A");
    expect(safe.getAttribute("rel")).toContain("noopener");
    expect(safe.getAttribute("target")).toBe("_blank");
    // The dangerous scheme loses the anchor and keeps the words.
    expect(screen.getByText("unsafe").tagName).not.toBe("A");
  });

  it("takes a colour only when the whole value is one", () => {
    const { container } = render(
      <RichText
        html={
          '<span style="color:url(javascript:steal());background:red">a</span><span style="color:#0f0">b</span>'
        }
      />,
    );
    const spans = container.querySelectorAll("span");
    expect(spans[0].getAttribute("style")).toBeNull();
    expect(spans[1].getAttribute("style")).toContain("rgb(0, 255, 0)");
    expect(container.innerHTML).not.toContain("background");
  });
});
