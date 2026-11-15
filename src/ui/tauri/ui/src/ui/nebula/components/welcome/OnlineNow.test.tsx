import { describe as suite, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { PRESENCE_CLASS, compileTarget } from "../admin/welcome/compile";
import type { Block, Design } from "../admin/welcome/design";
import { pickOnline } from "./OnlineNow";
import { WelcomeMarkup } from "./WelcomeMarkup";

const sheet = (blocks: Block[]): Design => ({
  sheetW: 560,
  slots: [],
  conditions: [],
  overrides: {},
  blocks,
});

const presence = (fields: Partial<Block> = {}): Design =>
  sheet([{ id: "p", type: "presence", x: 0, y: 0, w: 300, ...fields }]);

const sheetOf = (blocks: Block[]): Design => sheet(blocks);

const markupOf = (design: Design): string =>
  compileTarget(design, "rich")
    .map((part) => part.literal ?? "")
    .join("");

suite("the marker a live block leaves behind", () => {
  it("survives the sanitiser every reader renders through", () => {
    // The whole mechanism rests on this. `class` is on the attribute list and
    // `data-` is not - the sanitiser runs with `ALLOW_DATA_ATTR: false` - so a
    // marker written any other way would arrive stripped and the block would
    // silently render as nothing but its fallback, on every client, for ever.
    const clean = sanitizeHtml(markupOf(presence({ text: "online", faces: 4 })));
    expect(clean).toContain(PRESENCE_CLASS);
    expect(clean).toContain("fm-faces-4");
  });

  it("carries the operator's own words as the fallback", () => {
    // Not a placeholder. A reader whose client does not do the swap sees the
    // words rather than a gap, and never a count that is not true.
    expect(markupOf(presence({ text: "members here" }))).toContain(">members here<");
  });

  it("says something sensible when the operator wrote nothing", () => {
    expect(markupOf(presence())).toContain(">online<");
  });

  it("escapes the words, which are typed into a field", () => {
    expect(markupOf(presence({ text: "<b>x</b>" }))).not.toContain("<b>x</b>");
  });

  it("reserves the height the cluster will take", () => {
    // Without this the marker is one text line tall, the component that
    // replaces it is a 34px row, and the whole greeting jumps down four
    // pixels the moment the swap happens - in front of somebody who is
    // reading it.
    const html = markupOf(presence({ h: 34, text: "online" }));
    expect(html).toContain("height:34px");
    expect(html).toContain("line-height:34px");
  });

  it("says the words and no number where nothing can ever run", () => {
    // A count in plain text goes to a client that will never run the
    // component, so it could only ever be wrong.
    const plain = compileTarget(presence({ text: "online" }), "plain")
      .map((part) => part.literal ?? "")
      .join("");
    expect(plain).toBe("online");
  });
});

suite("who is drawn in the cluster", () => {
  const user = (session: number, name: string) => ({ session, name });

  it("draws them in a stable order, so a reconnect does not reshuffle it", () => {
    // Sessions change when somebody reconnects. A greeting read twice should
    // look the same both times unless the room actually changed.
    const { shown } = pickOnline([user(9, "Zoe"), user(2, "Ada"), user(5, "Mo")], 3);
    expect(shown.map((u) => u.name)).toEqual(["Ada", "Mo", "Zoe"]);
  });

  it("stops drawing faces where the count takes over", () => {
    const { shown, total } = pickOnline(
      [user(1, "A"), user(2, "B"), user(3, "C"), user(4, "D")],
      2,
    );
    expect(shown).toHaveLength(2);
    expect(total).toBe(4);
  });
});

suite("rendering a greeting that has a live block in it", () => {
  it("puts the component where the marker was", () => {
    const view = render(<WelcomeMarkup html={markupOf(presence({ text: "online" }))} />);
    const marker = view.container.querySelector(`.${PRESENCE_CLASS}`);
    // An *element* inside the marker, not the fallback text that was already
    // there. This used to assert only that the word "online" appeared, which
    // the fallback satisfies on its own - so it passed for weeks while React
    // was quietly putting the markup back and the portal never mounted at all.
    expect(marker?.firstElementChild).toBeTruthy();
    // Nobody is online in a test, which is the honest empty state: the words,
    // and no cluster of people who are not there.
    expect(screen.getByText("online")).toBeTruthy();
  });

  it("leaves the words alone where there is nothing to be live about", () => {
    const view = render(<WelcomeMarkup html={markupOf(presence({ text: "online" }))} live={false} />);
    expect(view.container.querySelector(`.${PRESENCE_CLASS}`)?.textContent).toBe("online");
  });

  it("clips a shadow so a greeting cannot paint over the client", () => {
    // `box-shadow` is the one paint property on the allow-list that draws
    // outside its own element, which is why it is safe to allow only with the
    // container clipping it.
    const view = render(<WelcomeMarkup html="<p>x</p>" />);
    const host = view.container.firstElementChild as HTMLElement;
    expect(getComputedStyle(host).overflow).toBe("clip");
  });

  it("puts a picture where its marker was", () => {
    // The bytes travelled beside the markup rather than inside it, so what the
    // markup carries is a name. Resolving it here is the last step of that.
    const sheet = sheetOf([
      { id: "i", type: "image", x: 0, y: 0, w: 200, h: 120, asset: "hero" } as Block,
    ]);
    const view = render(
      <WelcomeMarkup
        html={markupOf(sheet)}
        assets={new Map([["hero", "data:image/webp;base64,AAAA"]])}
      />,
    );
    const picture = view.container.querySelector("img");
    expect(picture?.getAttribute("src")).toBe("data:image/webp;base64,AAAA");
    // It fills the box the block reserved rather than bringing a size of its
    // own, so a layout drawn against that box does not move when the picture
    // turns out to be a different shape.
    expect(picture?.style.objectFit).toBe("cover");
  });

  it("paints a picture behind a block without touching its contents", () => {
    const sheet = sheetOf([
      { id: "g", type: "group", x: 0, y: 0, w: 400, h: 200, bgAsset: "hero" } as Block,
      { id: "t", type: "text", x: 20, y: 20, w: 200, h: 40, bare: true, text: "over it" } as Block,
    ]);
    const view = render(
      <WelcomeMarkup html={markupOf(sheet)} assets={new Map([["hero", "data:image/webp;base64,AA"]])} />,
    );
    const card = view.container.querySelector(".fm-backdrop") as HTMLElement;
    expect(card.style.backgroundImage).toContain("data:image/webp;base64,AA");
    // The words are still inside it: a backdrop is painted behind, not swapped
    // for - which is the whole difference between it and a picture block.
    expect(card.textContent).toContain("over it");
  });

  it("draws nothing where the picture never arrived", () => {
    // A greeting is not worth showing somebody a broken-image icon about.
    const sheet = sheetOf([
      { id: "i", type: "image", x: 0, y: 0, w: 200, h: 120, asset: "gone" } as Block,
    ]);
    const view = render(<WelcomeMarkup html={markupOf(sheet)} assets={new Map()} />);
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("renders ordinary markup exactly as the surfaces used to", () => {
    const view = render(<WelcomeMarkup html="<p>Hello <b>there</b></p>" />);
    expect(view.container.querySelector("p")?.innerHTML).toBe("Hello <b>there</b>");
  });
});
