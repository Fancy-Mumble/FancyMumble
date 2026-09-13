import { describe, expect, it } from "vitest";
import type { ServerId } from "@core/types";
import { broadcastOwner } from "./broadcastOwner";

const serverA = "a" as ServerId;
const serverB = "b" as ServerId;

describe("broadcastOwner", () => {
  it("says nobody shares when no capture runs", () => {
    expect(
      broadcastOwner({ broadcastingOwnSession: null, broadcastingServerId: null, ownSession: 4, activeServerId: serverA }),
    ).toBe("none");
  });

  it("tells two servers apart even when both gave us the same session number", () => {
    const base = { broadcastingOwnSession: 4, broadcastingServerId: serverA, ownSession: 4 };
    expect(broadcastOwner({ ...base, activeServerId: serverA })).toBe("here");
    expect(broadcastOwner({ ...base, activeServerId: serverB })).toBe("elsewhere");
  });

  it("falls back to the session number where no server was recorded", () => {
    const base = { broadcastingOwnSession: 4, broadcastingServerId: null, activeServerId: serverA };
    expect(broadcastOwner({ ...base, ownSession: 4 })).toBe("here");
    expect(broadcastOwner({ ...base, ownSession: 7 })).toBe("elsewhere");
    expect(broadcastOwner({ ...base, ownSession: null })).toBe("elsewhere");
  });
});
