/**
 * Regression test for the Live Doc sidebar drag ghost.
 *
 * Dragging a document/folder row must render a cursor-following ghost
 * clone (a portal child) showing the dragged item's label.  This guards
 * against the ghost being dropped from the pointer-based DnD controller.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LiveDocSidebarTree from "../chat/livedoc/LiveDocSidebarTree";
import type { LiveDocFolder } from "../../types";

const SECTIONS: LiveDocFolder[] = [
  {
    id: "sec-1",
    name: "Work",
    folders: [],
    docs: [{ slug: "plan", title: "My Plan", channel: 7, owned: true }],
  },
];

function renderTree() {
  return render(
    <LiveDocSidebarTree
      sections={SECTIONS}
      currentSlug=""
      onOpenDoc={() => {}}
    />,
  );
}

describe("LiveDocSidebarTree drag ghost", () => {
  beforeEach(() => {
    cleanup();
    // jsdom does not implement elementFromPoint; the DnD controller uses
    // it to resolve the drop target.  Returning null keeps drops inert.
    document.elementFromPoint = () => null;
  });

  it("shows no ghost before a drag begins", () => {
    renderTree();
    expect(screen.getAllByText("My Plan")).toHaveLength(1);
  });

  it("renders a label ghost once the pointer moves past the drag threshold", () => {
    renderTree();
    const row = screen.getByText("My Plan").closest("[role='button']");
    expect(row).not.toBeNull();

    fireEvent.pointerDown(row!, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    // A move within the threshold must not spawn a ghost yet.
    fireEvent.pointerMove(row!, { pointerId: 1, clientX: 12, clientY: 11 });
    expect(screen.getAllByText("My Plan")).toHaveLength(1);

    // Crossing the threshold spawns the cursor-following ghost clone,
    // so the label is now present twice (row + ghost).
    fireEvent.pointerMove(row!, { pointerId: 1, clientX: 60, clientY: 60 });
    expect(screen.getAllByText("My Plan")).toHaveLength(2);
  });

  it("removes the ghost when the drag is cancelled", () => {
    renderTree();
    const row = screen.getByText("My Plan").closest("[role='button']");

    fireEvent.pointerDown(row!, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row!, { pointerId: 1, clientX: 60, clientY: 60 });
    expect(screen.getAllByText("My Plan")).toHaveLength(2);

    fireEvent.pointerCancel(row!, { pointerId: 1 });
    expect(screen.getAllByText("My Plan")).toHaveLength(1);
  });
});
