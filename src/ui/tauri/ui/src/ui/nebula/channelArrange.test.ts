import { describe, expect, it } from "vitest";
import type { ChannelEntry } from "@core/types";
import { PERM_ENTER, PERM_WRITE } from "@core/utils/permissions";
import { arrangeState, canArrange, planChannelMove, siblingBlocks } from "./channelArrange";
import type { OrderedChannel } from "./selectors";

const channel = (id: number, name: string, position: number, parent_id: number | null = 0) =>
  ({ id, name, position, parent_id, permissions: null, detached: false }) as unknown as ChannelEntry;

const root = channel(0, "Root", 0, null);

describe("planChannelMove", () => {
  const spaced = [root, channel(1, "A", 0), channel(2, "B", 100), channel(3, "C", 200)];

  it("writes only the moved channel when its neighbours leave a gap", () => {
    expect(planChannelMove(spaced, 3, 2)).toEqual([{ channelId: 3, position: 50 }]);
  });

  it("goes a step past the last sibling when dropped at the end", () => {
    expect(planChannelMove(spaced, 1, null)).toEqual([{ channelId: 1, position: 300 }]);
  });

  it("goes a step before the first sibling when dropped at the top", () => {
    expect(planChannelMove(spaced, 3, 1)).toEqual([{ channelId: 3, position: -100 }]);
  });

  it("renumbers the group when the neighbours have no room between them", () => {
    // Stock Mumble trees are often all position 0 and ordered by name alone.
    const flat = [root, channel(1, "A", 0), channel(2, "B", 0), channel(3, "C", 0)];
    expect(planChannelMove(flat, 3, 2)).toEqual([
      { channelId: 3, position: 100 },
      { channelId: 2, position: 200 },
    ]);
  });

  it("does nothing when the drop leaves the order as it was", () => {
    expect(planChannelMove(spaced, 2, 3)).toEqual([]);
    expect(planChannelMove(spaced, 3, null)).toEqual([]);
  });

  it("refuses a target that is not a sibling", () => {
    const tree = [...spaced, channel(4, "Nested", 0, 1)];
    expect(planChannelMove(tree, 4, 2)).toEqual([]);
  });

  it("only counts siblings, not the whole server", () => {
    const tree = [...spaced, channel(4, "X", 0, 1), channel(5, "Y", 10, 1)];
    expect(planChannelMove(tree, 5, 4)).toEqual([{ channelId: 5, position: -100 }]);
  });
});

describe("siblingBlocks", () => {
  const ordered: OrderedChannel[] = [
    { channel: root, depth: 0 },
    { channel: channel(1, "A", 0), depth: 1 },
    { channel: channel(4, "A1", 0, 1), depth: 2 },
    { channel: channel(5, "A2", 1, 1), depth: 2 },
    { channel: channel(2, "B", 100), depth: 1 },
  ];

  it("spans each sibling's subtree", () => {
    expect(siblingBlocks(ordered, 2)).toEqual([
      { channelId: 1, first: 1, last: 3 },
      { channelId: 2, first: 4, last: 4 },
    ]);
  });

  it("gives a lone child nothing to trade places with", () => {
    expect(canArrange(ordered, root)).toBe(false);
    expect(canArrange(ordered, ordered[1].channel)).toBe(true);
  });

  it("needs write on the channel once permissions are known", () => {
    const denied = { ...channel(1, "A", 0), permissions: PERM_ENTER } as ChannelEntry;
    const granted = { ...channel(1, "A", 0), permissions: PERM_WRITE } as ChannelEntry;
    expect(canArrange(ordered, denied)).toBe(false);
    expect(canArrange(ordered, granted)).toBe(true);
  });
});

describe("arrangeState", () => {
  const ordered: OrderedChannel[] = [
    { channel: root, depth: 0 },
    { channel: { ...channel(1, "A", 0), permissions: PERM_ENTER } as ChannelEntry, depth: 1 },
    { channel: channel(2, "B", 100), depth: 1 },
  ];

  it("says why a row has no handle", () => {
    expect(arrangeState(ordered, root)).toBe("alone");
    expect(arrangeState(ordered, ordered[1].channel)).toBe("denied");
    expect(arrangeState(ordered, ordered[2].channel)).toBe("movable");
  });
});
