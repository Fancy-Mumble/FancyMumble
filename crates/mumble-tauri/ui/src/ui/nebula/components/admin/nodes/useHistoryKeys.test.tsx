import { describe as suite, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useHistoryKeys } from "./useHistoryKeys";

/**
 * The undo chords, which are bound to the window rather than to the canvas.
 *
 * What these are really about is *where* the keystroke is allowed to come
 * from. The chord itself is two lines; the rules about which presses are not
 * the graph's to take are the part that goes wrong.
 */
function Harness({ undo, redo }: Readonly<{ undo?: () => void; redo?: () => void }>) {
  useHistoryKeys(undo, redo);
  return (
    <div>
      <button type="button">a button, outside any canvas</button>
      <input aria-label="a field" defaultValue="typed" />
      <div contentEditable aria-label="rich text" suppressContentEditableWarning />
    </div>
  );
}

/** A real press, as a browser sends one: it bubbles, and it can be cancelled. */
function press(from: Element | Window, key: string, held: { shift?: boolean; meta?: boolean } = {}) {
  from.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: !held.meta,
      metaKey: held.meta ?? false,
      shiftKey: held.shift ?? false,
    }),
  );
}

function mount() {
  const undo = vi.fn();
  const redo = vi.fn();
  const view = render(<Harness undo={undo} redo={redo} />);
  return { undo, redo, view };
}

suite("undo and redo from the keyboard", () => {
  it("undoes from anywhere on the page, not only from the canvas", () => {
    // The bug this exists for: pressing the Undo button moves focus onto the
    // button, and the next Ctrl+Z used to go nowhere at all.
    const { undo, view } = mount();
    press(view.getByRole("button"), "z");
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("redoes on Ctrl+Shift+Z", () => {
    const { undo, redo, view } = mount();
    press(view.getByRole("button"), "z", { shift: true });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it("redoes on Ctrl+Y as well, which is the same gesture on Windows", () => {
    const { redo, view } = mount();
    press(view.getByRole("button"), "y");
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("takes Cmd+Z, so the chord is not broken on a Mac", () => {
    const { undo, view } = mount();
    press(view.getByRole("button"), "z", { meta: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("answers an upper-case Z, which is what Shift reports", () => {
    const { redo, view } = mount();
    press(view.getByRole("button"), "Z", { shift: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("leaves a field's own undo alone", () => {
    // Inside an input, Ctrl+Z is the word just typed - not the node deleted
    // before it. Whatever the field gives back reaches the graph as an edit.
    const { undo, view } = mount();
    press(view.getByLabelText("a field"), "z");
    expect(undo).not.toHaveBeenCalled();
  });

  it("leaves the rich-text editor's own undo alone", () => {
    const { undo, view } = mount();
    press(view.getByLabelText("rich text"), "z");
    expect(undo).not.toHaveBeenCalled();
  });

  it("defers to anything nearer the press that already took it", () => {
    // The design editor binds these on its own panel. Without this, a press
    // inside it would step the history back twice for one keystroke.
    const { undo, view } = mount();
    const button = view.getByRole("button");
    button.addEventListener("keydown", (event) => event.preventDefault());
    press(button, "z");
    expect(undo).not.toHaveBeenCalled();
  });

  it("ignores a bare Z, which is somebody typing", () => {
    const { undo, view } = mount();
    view.getByRole("button").dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", bubbles: true, cancelable: true }),
    );
    expect(undo).not.toHaveBeenCalled();
  });

  it("stops listening once the editor is gone", () => {
    // The page mounts this; another admin page must not still be answering.
    const { undo, view } = mount();
    view.unmount();
    press(document.body, "z");
    expect(undo).not.toHaveBeenCalled();
  });

  it("does not fall over on a page that keeps no history", () => {
    const view = render(<Harness />);
    expect(() => press(view.getByRole("button"), "z")).not.toThrow();
  });
});
