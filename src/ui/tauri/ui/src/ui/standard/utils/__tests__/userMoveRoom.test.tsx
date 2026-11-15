import { describe, it, expect, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import type { UserEntry } from "@core/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

import { insertionIndex } from "@ui/userCarry";
import { useChannelDropTarget, useUserDrag } from "../userMoveDnd";
import { MemberSlots } from "../userMoveRoom";

function box(el: Element, top: number, height: number, width = 200) {
  el.getBoundingClientRect = () => ({
    left: 0,
    top,
    right: width,
    bottom: top + height,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

const user = (session: number, name: string, channel: number): UserEntry =>
  ({ session, name, channel_id: channel }) as UserEntry;

describe("insertionIndex", () => {
  const ranks = new Map([
    [1, 0],
    [2, 1],
    [3, 2],
  ]);

  it("seats an arriving user by their rank among the members present", () => {
    expect(insertionIndex([1, 3], ranks, 2)).toBe(1);
  });

  it("puts one that outranks nobody at the end", () => {
    expect(insertionIndex([1, 2], ranks, 3)).toBe(2);
  });

  it("puts one that outranks everybody at the front", () => {
    expect(insertionIndex([2, 3], ranks, 1)).toBe(0);
  });

  it("falls back to the end for a user the list has never heard of", () => {
    expect(insertionIndex([1, 2], ranks, 99)).toBe(2);
  });
});

const ANN = user(1, "ann", 2);
const BO = user(2, "bo", 1);
const CAI = user(3, "cai", 2);

/** A channel's members, beside the row of a user in another channel. */
function Fixture({ members }: Readonly<{ members: readonly UserEntry[] }>) {
  const drag = useUserDrag(BO.session, BO.name, null, false);
  const drop = useChannelDropTarget(2);
  return (
    <>
      {drag.overlay}
      <div data-testid="source" {...drag.handlers} />
      <div ref={drop.ref} data-testid="target">
        <MemberSlots channelId={2} members={members} order={[ANN, BO, CAI]} className="members">
          {(u) => <span>{u.name}</span>}
        </MemberSlots>
      </div>
    </>
  );
}

/**
 * Carries the source row over the channel, with the member rows measuring 20
 * tall on a 21px pitch and the channel covering the pointer.
 */
async function carryOver(view: ReturnType<typeof render>) {
  const list = view.container.querySelector(".members") as HTMLElement;
  const rows = [...list.children] as HTMLElement[];
  rows.forEach((row, index) => box(row, index * 21, 20));
  box(view.getByTestId("target"), 0, 100);
  const source = view.getByTestId("source");
  box(source, 300, 20);

  fireEvent.pointerDown(source, { clientX: 10, clientY: 310, pointerId: 1, button: 0 });
  fireEvent.pointerMove(source, { clientX: 10, clientY: 50, pointerId: 1 });
  // The hit-test that says which channel is under the pointer runs on the
  // next frame, so the gap only exists after one.
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
  return { list, rows, source };
}

// The carry is module state, and what clears it between these is the source
// row unmounting with the rest of the fixture.
describe("MemberSlots", () => {
  it("opens the seat the carried user will take, and grows to hold it", async () => {
    const view = render(<Fixture members={[ANN, CAI]} />);
    const { list, rows } = await carryOver(view);

    // bo ranks between ann and cai, so cai steps down one 21px slot and the
    // list takes on that much more height to hold what stepped out of it.
    expect(rows[0].style.transform).toBe("");
    expect(rows[1].style.transform).toBe("translateY(21px)");
    expect(list.style.marginBottom).toBe("21px");
  });

  it("leaves the channel the carried user is already in alone", async () => {
    const view = render(<Fixture members={[ANN, BO, CAI]} />);
    const { list, rows } = await carryOver(view);

    expect(rows.map((row) => row.style.transform)).toEqual(["", "", ""]);
    expect(list.style.marginBottom).toBe("");
  });

  it("puts nothing back when the drag ends", async () => {
    const view = render(<Fixture members={[ANN, CAI]} />);
    const { rows, source } = await carryOver(view);
    expect(rows[1].style.transform).toBe("translateY(21px)");

    await act(async () => {
      fireEvent.pointerUp(source, { clientX: 10, clientY: 50, pointerId: 1 });
    });
    expect(rows[1].style.transform).toBe("");
  });
});
