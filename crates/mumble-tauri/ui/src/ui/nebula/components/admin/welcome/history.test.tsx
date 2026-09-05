import { describe as suite, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import { createNebulaTheme } from "@nebula/theme";
import { NodeEditor } from "@nebula/components/admin/nodes";
import { welcomeSpec } from "@nebula/components/admin/welcome/spec";
import { seedGraph } from "@nebula/components/admin/welcome/seed";
import { DesignEditor } from "@nebula/components/admin/welcome/DesignEditor";
import { starterDesign } from "@nebula/components/admin/welcome/design";

// The canvas measures its ports with one; jsdom has neither this nor pointer
// capture, and a real webview has both.
if (typeof ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}

function editor() {
  const history = { undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: true };
  const view = render(
    <ThemeProvider theme={createNebulaTheme("dark")}>
      <NodeEditor
        spec={welcomeSpec}
        graph={seedGraph()}
        onChange={() => undefined}
        history={history}
        summary=""
      />
    </ThemeProvider>,
  );
  return { history, view };
}

const press = (from: Element, key = "z", shift = false) =>
  from.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: true, shiftKey: shift }),
  );

/**
 * The chords reaching the history the *page* holds.
 *
 * Worth testing through the real editor rather than only against the hook: the
 * thing that was broken was not the chord but where it was bound, and a canvas
 * that answered undo only while it held focus passed every test anyone had
 * written about undo.
 */
suite("undo from the keyboard, through the editor", () => {
  it("reaches the history from the Undo button, which is not on the canvas", () => {
    // Exactly the sequence that used to fail: press Undo once, then reach for
    // the keyboard. Focus is on the button by then, well outside the canvas.
    const { history, view } = editor();
    const button = view.getByTitle("Undo (Ctrl+Z)");
    press(button);
    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it("reaches the history from the canvas itself", () => {
    const { history, view } = editor();
    const canvas = view.container.querySelector("[data-node-id]");
    expect(canvas).not.toBeNull();
    press(canvas as Element);
    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it("steps back once per press, not once per listener", () => {
    // The canvas used to bind these itself. It no longer does, and this is
    // what would catch it if both bindings ever existed at once: a single
    // press undoing two edits is far worse than one that undoes none.
    const { history, view } = editor();
    press(view.container.querySelector("[data-node-id]") as Element);
    press(view.getByTitle("Undo (Ctrl+Z)"));
    expect(history.undo).toHaveBeenCalledTimes(2);
  });

  it("redoes on Ctrl+Shift+Z from anywhere", () => {
    const { history, view } = editor();
    press(view.getByTitle("Redo (Ctrl+Shift+Z)"), "z", true);
    expect(history.redo).toHaveBeenCalledTimes(1);
    expect(history.undo).not.toHaveBeenCalled();
  });

  it("leaves the block search field's own undo alone", () => {
    // The one field always on screen here, and the one an operator is most
    // likely to press Ctrl+Z in without meaning the graph.
    const { history, view } = editor();
    press(view.getByPlaceholderText(welcomeSpec.strings.search));
    expect(history.undo).not.toHaveBeenCalled();
  });
});

/**
 * The design editor slides in over the canvas and binds these chords on its own
 * panel, so while it is open there are two listeners for one keystroke.
 *
 * That is the arrangement the window binding has to survive, and it is the
 * reason it stands aside for a press something nearer has already taken.
 */
suite("undo while the design editor is open over the canvas", () => {
  const both = () => {
    const history = { undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: true };
    const view = render(
      <ThemeProvider theme={createNebulaTheme("dark")}>
        <NodeEditor
          spec={welcomeSpec}
          graph={seedGraph()}
          onChange={() => undefined}
          history={history}
          summary=""
        />
        <DesignEditor
          design={starterDesign()}
          name="Greeting #1"
          detail="matches nobody"
          onChange={() => undefined}
          onUndo={history.undo}
          onRedo={history.redo}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    return { history, view };
  };

  it("steps back once, not once per listener", () => {
    const { history, view } = both();
    press(view.getByRole("dialog", { name: "Design editor" }));
    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it("steps forward once on Ctrl+Shift+Z", () => {
    const { history, view } = both();
    press(view.getByRole("dialog", { name: "Design editor" }), "z", true);
    expect(history.redo).toHaveBeenCalledTimes(1);
    expect(history.undo).not.toHaveBeenCalled();
  });
});
