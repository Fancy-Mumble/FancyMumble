import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { RichTextField } from "./RichTextField";

function field(props: Partial<React.ComponentProps<typeof RichTextField>> = {}) {
  const onChange = vi.fn();
  const view = render(
    withNebulaTheme(
      <RichTextField ariaLabel="About you" value="" onChange={onChange} {...props} />,
    ),
  );
  return { onChange, view, box: screen.getByLabelText(props.ariaLabel ?? "About you") };
}

describe("RichTextField", () => {
  it("edits in place rather than in markup - the text is the document", () => {
    const { box } = field({ value: "<p>Drum &amp; <strong>bass</strong></p>" });
    // What the user sees is the rendered mark, not the tag that made it.
    expect(box.textContent).toBe("Drum & bass");
    expect(box.querySelector("strong")?.textContent).toBe("bass");
  });

  it("hands the caller markup, which is what the comment carries", async () => {
    const { onChange, box } = field({ value: "<p>bass</p>", tools: ["bold"] });
    // Select the line the way a keyboard does, then use the tool on it - the
    // whole path a mark actually takes, rather than poking at the document.
    fireEvent.keyDown(box, { key: "a", ctrlKey: true });
    fireEvent.click(screen.getByLabelText("Bold"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("<p><strong>bass</strong></p>");
  });


  it("carries only the tools it was given", () => {
    field({ tools: ["bold", "image"] });
    expect(screen.getByLabelText("Bold")).toBeTruthy();
    expect(screen.getByLabelText("Insert image")).toBeTruthy();
    expect(screen.queryByLabelText("Italic")).toBeNull();
    expect(screen.queryByLabelText("Text colour")).toBeNull();
  });

  it("opens the swatches on the colour tool and puts one on the text", () => {
    field({ value: "<p>oi</p>", tools: ["colour"] });
    fireEvent.click(screen.getByLabelText("Text colour"));
    expect(screen.getByLabelText("Colour #ff4d4d")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Colour #ff4d4d"));
    // Picking closes the grid again rather than leaving it over the field.
    expect(screen.queryByLabelText("Colour #ff4d4d")).toBeNull();
  });

  it("keeps the selection when a toolbar button is pressed", () => {
    field({ tools: ["bold"] });
    // Taking focus on mousedown would collapse the selection the mark is for,
    // so the button must refuse it - `defaultPrevented` is that refusal.
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByLabelText("Bold").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("saves when focus leaves the field, and not while it is being used", () => {
    const onCommit = vi.fn();
    const { box } = field({ onCommit, tools: ["bold"] });
    // Moving from the text to the toolbar is still using the field.
    fireEvent.blur(box, { relatedTarget: screen.getByLabelText("Bold") });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(box, { relatedTarget: document.body });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("refuses a paragraph in a one-line field", () => {
    const { box } = field({ ariaLabel: "Status", singleLine: true, value: "<p>hi</p>" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.querySelectorAll("p")).toHaveLength(1);
  });
});
