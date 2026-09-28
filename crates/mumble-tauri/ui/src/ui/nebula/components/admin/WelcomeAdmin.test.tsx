/**
 * What the Welcome page draws before this server has answered.
 *
 * The bug: the canvas opened on the seed - the two-node scaffold a server that
 * has drawn nothing starts from - and swapped the operator's own greeting in
 * when the read landed a moment later. Two layouts in a row, the first of them
 * about a server other than this one, which is indistinguishable from the page
 * having just replaced what was there.
 *
 * So what is checked here is the seam between the read and the canvas: nothing
 * is drawn while the read is in flight, what arrives is what gets drawn, the
 * scaffold appears only for a server that really has nothing, and a read that
 * fails says so where the canvas would have been rather than in a snackbar
 * that takes the explanation away after six seconds.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe as suite, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => undefined) }));

const read = vi.fn<() => Promise<WelcomeGraph>>();
vi.mock("./welcome/greetingStore", () => ({
  loadGreeting: () => read(),
  saveGreeting: () => Promise.resolve(),
}));

import { withNebulaTheme } from "../../testTheme";
import { WelcomeAdmin } from "./WelcomeAdmin";
import type { WelcomeGraph } from "./welcome/model";

// The canvas measures its ports with one, and captures the pointer to drag;
// jsdom has neither and a real webview has both.
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

/** A greeting nobody could mistake for the scaffold. */
function serverGraph(): WelcomeGraph {
  return {
    enabled: true,
    nodes: [
      { id: "where", kind: "country", x: 0, y: 0, codes: ["NZ"] },
      {
        id: "hello",
        kind: "greeting",
        x: 300,
        y: 0,
        once: false,
        body: "Kia ora",
        html: "<p>Kia ora</p>",
        view: "rich",
        sections: [],
      },
    ],
    edges: [{ id: "e1", from: "where", to: "hello", port: "when" }],
  } as unknown as WelcomeGraph;
}

/** A promise the test settles when it wants the read to land. */
function pending() {
  let settle!: (graph: WelcomeGraph) => void;
  let fail!: (why: unknown) => void;
  const promise = new Promise<WelcomeGraph>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  read.mockReturnValueOnce(promise);
  return { settle, fail };
}

const open = () => render(withNebulaTheme(<WelcomeAdmin />));

beforeEach(() => {
  read.mockReset();
});

suite("the welcome page, while its server is being asked", () => {
  it("draws no canvas at all until the answer arrives", async () => {
    const { settle } = pending();
    open();

    expect(screen.getByText(/Reading this server's greeting/)).toBeTruthy();
    // The scaffold is the thing that used to flash here.
    expect(screen.queryByText(/Glad you found us/)).toBeNull();
    expect(screen.queryByText("Save & broadcast")).toBeNull();

    settle(serverGraph());
    await screen.findByText("Save & broadcast");
    expect(screen.queryByText(/Reading this server's greeting/)).toBeNull();
  });

  it("draws the server's own greeting, and never the scaffold", async () => {
    const { settle } = pending();
    open();
    settle(serverGraph());

    await waitFor(() => expect(screen.getByText(/Shows when country in NZ/)).toBeTruthy());
    expect(screen.queryByText(/Glad you found us/)).toBeNull();
  });

  it("starts a server that has drawn nothing on the scaffold", async () => {
    const { settle } = pending();
    open();
    settle({ enabled: true, nodes: [], edges: [] } as unknown as WelcomeGraph);

    await waitFor(() => expect(screen.getByText(/Shows when everyone who arrives/)).toBeTruthy());
  });
});

suite("the welcome page, when its server cannot be asked", () => {
  it("says why where the canvas would be, and reads again on request", async () => {
    const first = pending();
    open();
    first.fail(new Error("no operator credential"));

    await screen.findByText(/no operator credential/);
    // Not on the scaffold with the failure hidden in a snackbar: an operator
    // must not be shown a greeting that is not theirs.
    expect(screen.queryByText(/Shows when/)).toBeNull();

    const again = pending();
    fireEvent.click(screen.getByText("Try again"));
    again.settle(serverGraph());

    await waitFor(() => expect(screen.getByText(/Shows when country in NZ/)).toBeTruthy());
  });
});
