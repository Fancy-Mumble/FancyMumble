import { describe as suite, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import { createNebulaTheme } from "@nebula/theme";
import { NodeEditor } from "@nebula/components/admin/nodes";
import { welcomeSpec } from "@nebula/components/admin/welcome/spec";
import { makeNode, type WelcomeGraph } from "@nebula/components/admin/welcome/model";

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

function graph(): WelcomeGraph {
  const text = { ...makeNode("text", 40, 40), id: "t", body: "Be kind" };
  return { nodes: [text], edges: [] } as unknown as WelcomeGraph;
}

function mount() {
  return render(
    <ThemeProvider theme={createNebulaTheme("dark")}>
      <NodeEditor spec={welcomeSpec} graph={graph()} onChange={() => undefined} summary="" />
    </ThemeProvider>,
  );
}

/** A frame, for the focus the add menu takes once it is open. */
const settle = () => new Promise((done) => setTimeout(done, 40));

const canvasOf = (view: ReturnType<typeof mount>) =>
  view.container.querySelector('div[tabindex="0"]') as HTMLElement;

const addSearch = () =>
  screen
    .getAllByLabelText("Search blocks")
    .find((field) => field.closest(".MuiMenu-root") !== null) as HTMLElement | undefined;

/**
 * Reaching a block by typing.
 *
 * The bug behind all three: the shortcuts live on the canvas, and the canvas
 * only hears them while it holds focus - which selecting a node takes away,
 * because starting a drag calls `preventDefault` and a defaulted-away press
 * never moves focus. So `A` was dead for anyone who had clicked anything.
 */
suite("reaching a block from the keyboard", () => {
  it("opens the add menu on A pressed anywhere in the editor", async () => {
    mount();
    // From the toolbar, which is where the pointer has been if the operator
    // just closed a drawer - nowhere near the canvas.
    fireEvent.keyDown(screen.getByText("Browse blocks"), { key: "a" });
    await settle();
    expect(addSearch()).toBe(document.activeElement);
  });

  it("puts the caret in the add menu's search, so the name can just be typed", async () => {
    const view = mount();
    fireEvent.keyDown(canvasOf(view), { key: "a" });
    await settle();
    expect(addSearch()).toBe(document.activeElement);
  });

  it("keeps focus on the canvas when a node is pressed", () => {
    const view = mount();
    // A socket, which stops the press propagating - so this only holds with
    // the focus taken on the way down.
    fireEvent.pointerDown(view.container.querySelector("[data-port]") as Element, { button: 0 });
    expect(document.activeElement).toBe(canvasOf(view));
  });

  it("leaves A alone inside a field", async () => {
    mount();
    const search = screen.getByLabelText("Search blocks");
    fireEvent.keyDown(search, { key: "a" });
    await settle();
    expect(document.querySelector(".MuiMenu-root")).toBeNull();
  });
});

suite("opening the block browser", () => {
  it("focuses the search, which is the next thing anyone does", async () => {
    mount();
    fireEvent.click(screen.getByText("Browse blocks"));
    await settle();
    expect(screen.getByLabelText("Search blocks")).toBe(document.activeElement);
  });

  it("does not focus it when the drawer is being closed again", async () => {
    mount();
    const button = screen.getByText("Browse blocks");
    fireEvent.click(button);
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(button);
    await settle();
    expect(document.activeElement).not.toBe(screen.getByLabelText("Search blocks"));
  });
});
