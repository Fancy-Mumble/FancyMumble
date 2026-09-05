import { useState } from "react";
import { describe as suite, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import { createNebulaTheme } from "@nebula/theme";
import { DesignBody } from "@nebula/components/admin/welcome/DesignBody";
import { DesignEditor } from "@nebula/components/admin/welcome/DesignEditor";
import {
  PALETTE,
  carriesInline,
  isRichBody,
  inkOn,
  starterDesign,
  type Design,
} from "@nebula/components/admin/welcome/design";

// jsdom implements neither of these, and the canvas reaches for both the
// moment a pan begins. Stubbed rather than guarded in the product: a real
// webview has them, and code that checks would be checking for the test.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}

/**
 * The editor with somewhere to put its changes.
 *
 * It is a controlled component, so a test that passes a no-op `onChange` is
 * testing a design that can never change - every insertion is dropped on the
 * floor and every block appears to draw nothing.
 */
function Live({ design: initial }: Readonly<{ design: Design }>) {
  const [design, setDesign] = useState(initial);
  return (
    <DesignEditor
      design={design}
      name="Greeting #1"
      detail="matches nobody"
      onChange={setDesign}
      onClose={() => undefined}
    />
  );
}

const wrap = (ui: React.ReactNode) =>
  render(<ThemeProvider theme={createNebulaTheme("dark")}>{ui}</ThemeProvider>);

suite("getting into the design editor", () => {
  // Both halves of the path a click takes, because a break in either shows up
  // to an operator as the same thing: the button does nothing.
  it("the node's way in actually calls back", () => {
    const onOpen = vi.fn();
    const view = wrap(
      <DesignBody design={starterDesign()} onOpen={onOpen} />,
    );
    fireEvent.click(view.getByText(/^Design ·/));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("the editor mounts on the design a fresh node carries", () => {
    const view = wrap(
      <DesignEditor
        design={starterDesign()}
        name="Greeting #1"
        detail="matches nobody"
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(view.getByText("Insert")).toBeTruthy();
    // The artboard drew the design, not just the chrome around it.
    expect(view.getAllByText("Welcome aboard").length).toBeGreaterThan(0);
    expect(view.getByRole("dialog", { name: "Design editor" })).toBeTruthy();
  });
});

suite("what is selected on the artboard", () => {
  const editor = () =>
    wrap(
      <DesignEditor
        design={starterDesign()}
        name="Greeting #1"
        detail="matches nobody"
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );

  /**
   * The handles a selection draws, which is what an operator actually sees.
   *
   * Matched on the edge suffix, not on "Resize the" alone: the panel's own
   * width grip is labelled that way too, and counting it made an empty
   * selection look like a selection of one.
   */
  const handles = (view: ReturnType<typeof editor>) =>
    view.container.querySelectorAll('[aria-label$="edge"]');

  it("draws handles on the block that was picked", () => {
    const view = editor();
    fireEvent.click(view.getByText("Welcome aboard", { selector: "button *" }));
    expect(handles(view).length).toBeGreaterThan(0);
  });

  it("drops the selection when the press lands on empty artboard", () => {
    // The bug: a block, its handles and the in-place editor all stop a press at
    // themselves, so anything reaching the sheet is empty space - but the
    // handler only cleared the selection when the press landed on the viewport
    // element itself, which the artboard covers. Clicking beside a block left
    // it selected with its handles still drawn.
    const view = editor();
    fireEvent.click(view.getByText("Welcome aboard", { selector: "button *" }));
    expect(handles(view).length).toBeGreaterThan(0);

    const sheet = view.getByRole("dialog", { name: "Design editor" });
    fireEvent.pointerDown(within(sheet).getByLabelText("Design sheet"), { button: 0 });
    expect(handles(view).length).toBe(0);
  });

  it("keeps the selection while the view is being panned", () => {
    // Middle and right drag are the pan. Panning away from something is not
    // letting go of it.
    const view = editor();
    fireEvent.click(view.getByText("Welcome aboard", { selector: "button *" }));
    const sheet = view.getByRole("dialog", { name: "Design editor" });
    fireEvent.pointerDown(within(sheet).getByLabelText("Design sheet"), { button: 1 });
    expect(handles(view).length).toBeGreaterThan(0);
  });
});

suite("the keyboard, once something is selected", () => {
  const editor = (onChange = () => undefined) =>
    wrap(
      <DesignEditor
        design={starterDesign()}
        name="Greeting #1"
        detail="matches nobody"
        onChange={onChange}
        onClose={() => undefined}
      />,
    );

  const pick = (view: ReturnType<typeof editor>, label: string) =>
    fireEvent.click(view.getByText(label, { selector: "button *" }));

  const panel = (view: ReturnType<typeof editor>) =>
    view.getByRole("dialog", { name: "Design editor" });

  it("deletes the selected block on Delete", () => {
    // The bug: the shortcuts lived on the sheet, which only hears keys while it
    // holds focus - and selecting a block starts a drag, which defaults the
    // press away and so never moves focus there. The one gesture that gave you
    // something to delete was the one that stopped Delete working.
    const onChange = vi.fn();
    const view = editor(onChange);
    pick(view, "Welcome aboard");
    fireEvent.keyDown(panel(view), { key: "Delete" });

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as ReturnType<typeof starterDesign>;
    expect(next.blocks.some((block) => block.text === "Welcome aboard")).toBe(false);
  });

  it("nudges by a grid step on an arrow, and by one pixel with Shift", () => {
    const onChange = vi.fn();
    const view = editor(onChange);
    pick(view, "Welcome aboard");

    fireEvent.keyDown(panel(view), { key: "ArrowRight" });
    const coarse = onChange.mock.calls[0][0] as ReturnType<typeof starterDesign>;
    expect(coarse.blocks.find((b) => b.text === "Welcome aboard")?.x).toBe(48);

    onChange.mockClear();
    fireEvent.keyDown(panel(view), { key: "ArrowRight", shiftKey: true });
    const fine = onChange.mock.calls[0][0] as ReturnType<typeof starterDesign>;
    expect(fine.blocks.find((b) => b.text === "Welcome aboard")?.x).toBe(45);
  });

  it("leaves a properties field's own Delete alone", () => {
    // Inside an input a bare Delete is the character under the caret, not the
    // block being edited.
    const onChange = vi.fn();
    const view = editor(onChange);
    pick(view, "Welcome aboard");
    onChange.mockClear();

    fireEvent.keyDown(view.getByLabelText("Search blocks"), { key: "Delete" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the selection on Escape", () => {
    const view = editor();
    pick(view, "Welcome aboard");
    expect(view.container.querySelectorAll('[aria-label$="edge"]').length).toBeGreaterThan(0);
    fireEvent.keyDown(panel(view), { key: "Escape" });
    expect(view.container.querySelectorAll('[aria-label$="edge"]').length).toBe(0);
  });
});

suite("every block the palette offers", () => {
  // The palette grew from ten entries to twenty-eight, and sixteen of them had
  // no `Preview` case - so they inserted, took up space in the layer list, and
  // drew literally nothing on the sheet. One test over the whole palette rather
  // than a case each, because the failure mode is "somebody added a type and
  // stopped at the model".
  for (const item of PALETTE) {
    it(`${item.label} draws something once inserted`, () => {
      const view = wrap(
        <Live design={{ sheetW: 520, slots: [], conditions: [], blocks: [], overrides: {} }} />,
      );

      fireEvent.click(view.getByTitle(item.label));
      const drawn = view.container.querySelector(`[data-kind="${item.type}"]`);
      expect(drawn, `${item.label} put nothing on the sheet`).toBeTruthy();

      // Deselected, so what is left in the wrapper is the block's own drawing
      // rather than the selection outline and handles around it.
      fireEvent.keyDown(view.getByRole("dialog", { name: "Design editor" }), { key: "Escape" });
      const quiet = view.container.querySelector(`[data-kind="${item.type}"]`);
      expect(quiet?.childElementCount ?? 0, `${item.label} rendered an empty box`).toBeGreaterThan(0);
    });
  }
});

suite("blocks whose body is prose", () => {
  // The bug behind this: a rich editor was pointed at fields that were escaped
  // on the way out, so bold typed into a callout reached readers as literal
  // `<strong>` tags. The first fix took the editor away, which made the output
  // correct by making the block less useful. These blocks carry markup end to
  // end instead.
  it("edits and draws the same set as markup", () => {
    const prose = PALETTE.filter((item) => carriesInline(item.type)).map((item) => item.type);
    expect(prose).toContain("callout");
    for (const type of prose) expect(isRichBody(type), type).toBe(true);
  });

  it("leaves a label block out of it", () => {
    // A heading compiles to one `<h2>` and a button to one `<a>`, so markup
    // inside either is markup around nothing.
    for (const type of ["heading", "button", "countdown"] as const) {
      expect(isRichBody(type), type).toBe(false);
    }
  });

  it("draws a callout's markup as words rather than as tags", () => {
    const view = wrap(
      <Live
        design={{
          sheetW: 520,
          slots: [],
          conditions: [],
          blocks: [
            { id: "c", type: "callout", x: 44, y: 40, w: 432, text: "<p><strong>Bold</strong> bit.</p>" },
          ],
          overrides: {},
        }}
      />,
    );
    const drawn = view.container.querySelector('[data-kind="callout"]');
    expect(drawn?.textContent).not.toContain("<strong>");
    expect(drawn?.textContent).toContain("Bold");
    expect(drawn?.querySelector("strong")).toBeTruthy();
  });
});

suite("preview mode", () => {
  // Preview's whole job is to stop showing the machinery. Leaving `{{name}}`
  // and `$name` on screen showed nothing but.
  const design = (): Design => ({
    sheetW: 520,
    slots: [{ id: "s1", name: "rules" }],
    conditions: [],
    blocks: [
      { id: "t", type: "text", x: 44, y: 40, w: 432, text: "Rules: {{rules}} and {{user.country}}." },
      { id: "b", type: "slot", x: 44, y: 120, w: 432, slot: "rules", fallback: "ask an admin" },
    ],
    overrides: {},
  });

  const preview = (values?: ReadonlyMap<string, string>) => {
    const view = wrap(
      <DesignEditor
        design={design()}
        name="Greeting #1"
        detail="matches nobody"
        values={values}
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(view.getByText("Preview"));
    return view;
  };

  it("puts the wired value in, not the input's name", () => {
    const view = preview(new Map([["rules", "Be kind."]]));
    const sheet = view.container.querySelector('[data-kind="text"]');
    expect(sheet?.textContent).toContain("Be kind.");
    expect(sheet?.textContent).not.toContain("{{rules}}");
    expect(sheet?.textContent).not.toContain("$rules");
  });

  it("uses a built-in's sample where nothing is wired", () => {
    const view = preview(new Map());
    expect(view.container.querySelector('[data-kind="text"]')?.textContent).toContain("DE");
  });

  it("falls back to the text set on the element", () => {
    const view = preview(new Map());
    expect(view.container.querySelector('[data-kind="slot"]')?.textContent).toContain("ask an admin");
  });
});

/**
 * Which block is on top, and the colour behind one.
 *
 * Blocks are positioned, so they overlap; until now the only way to change
 * which one covered which was to delete a block and add it again, losing
 * everything written in it.
 */
suite("stacking and filling", () => {
  const withDesign = (design: Design, onChange: (next: Design) => void = () => undefined) =>
    wrap(
      <DesignEditor
        design={design}
        name="Greeting #1"
        detail="matches nobody"
        onChange={onChange}
        onClose={() => undefined}
      />,
    );

  it("offers to move the picked block through the stack", () => {
    const view = withDesign(starterDesign());
    fireEvent.click(view.getByText("Welcome aboard", { selector: "button *" }));
    expect(view.getByTitle("Bring to front")).toBeTruthy();
    expect(view.getByTitle("Bring forward (Ctrl+])")).toBeTruthy();
    expect(view.getByTitle("Send backward (Ctrl+[)")).toBeTruthy();
    expect(view.getByTitle("Send to back")).toBeTruthy();
  });

  it("brings a block to the front by putting it last, which is what draws on top", () => {
    // The layer list reads top to bottom, so the last block in the document is
    // the one nearest the reader - see `reorderBlock`.
    const design = starterDesign();
    const heading = design.blocks.find((block) => block.type === "heading");
    const seen: { design?: Design } = {};
    const view = withDesign(design, (next) => {
      seen.design = next;
    });
    fireEvent.click(view.getByText("Welcome aboard", { selector: "button *" }));
    fireEvent.click(view.getByTitle("Bring to front"));
    expect(seen.design).toBeDefined();
    expect(seen.design?.blocks.at(-1)?.id).toBe(heading?.id);
  });

  it("sends it to the back the same way, at the other end", () => {
    const design = starterDesign();
    const heading = design.blocks.find((block) => block.type === "heading");
    const seen: { design?: Design } = {};
    const view = withDesign(design, (next) => {
      seen.design = next;
    });
    fireEvent.click(view.getByText("Welcome aboard", { selector: "button *" }));
    fireEvent.click(view.getByTitle("Send to back"));
    expect(seen.design?.blocks[0]?.id).toBe(heading?.id);
  });

  it("gives a panel a colour to be, and picks the ink to go on it", () => {
    // A fill without an ink is the one way a coloured box goes wrong: pale on
    // a client drawing light text, dark on one drawing dark.
    expect(inkOn("#eef2f7")).toBe("#1c2430");
    expect(inkOn("#1c2430")).toBe("#ffffff");
    expect(inkOn("#3399dd")).toBe("#ffffff");
  });

  it("offers both colours on a block that draws words", () => {
    const view = withDesign(starterDesign());
    fireEvent.click(view.getByText("Welcome aboard", { selector: "button *" }));
    // The fills, the inks, and the way back to neither.
    expect(view.getByLabelText("Paper")).toBeTruthy();
    expect(view.getByLabelText("Ink")).toBeTruthy();
    expect(view.getByLabelText("Amber")).toBeTruthy();
    expect(view.getByLabelText("None — no fill behind it")).toBeTruthy();
    expect(view.getByLabelText("Default — the reader's own colour")).toBeTruthy();
  });

  it("sets the colour that was picked, and takes it away again", () => {
    const seen: { design?: Design } = {};
    const view = withDesign(starterDesign(), (next) => {
      seen.design = next;
    });
    fireEvent.click(view.getByText("Welcome aboard", { selector: "button *" }));
    fireEvent.click(view.getByLabelText("Sand"));
    const heading = () => seen.design?.blocks.find((block) => block.type === "heading");
    expect(heading()?.bg).toBe("#f6efe2");
    fireEvent.click(view.getByLabelText("None — no fill behind it"));
    expect(heading()?.bg).toBeUndefined();
  });
});
