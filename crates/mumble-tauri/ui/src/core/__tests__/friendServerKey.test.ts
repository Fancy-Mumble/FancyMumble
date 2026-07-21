import { describe, it, expect } from "vitest";
import { friendServerKey, type Friend } from "../friendsStorage";

function friend(partial: Partial<Friend>): Friend {
  return { id: "x", userName: "u", addedAt: 0, ...partial };
}

describe("friendServerKey", () => {
  it("gives the same key to friends on one server added across different sessions", () => {
    // serverId is a volatile per-connection UUID; the label is stable.
    const a = friend({ serverId: "uuid-session-1", serverLabel: "Zewi@magical.rocks:64738" });
    const b = friend({ serverId: "uuid-session-2", serverLabel: "Zewi@magical.rocks:64738" });
    const c = friend({ serverId: "uuid-session-3", serverLabel: "Zewi@magical.rocks:64738" });
    expect(friendServerKey(a)).toBe(friendServerKey(b));
    expect(friendServerKey(b)).toBe(friendServerKey(c));
  });

  it("keys different servers (different labels) separately", () => {
    const a = friend({ serverLabel: "Server A" });
    const b = friend({ serverLabel: "Server B" });
    expect(friendServerKey(a)).not.toBe(friendServerKey(b));
  });

  it("falls back to the connection target when there is no label", () => {
    const a = friend({ serverHost: "magical.rocks", serverPort: 64738, serverUsername: "Zewi" });
    const b = friend({ serverHost: "magical.rocks", serverPort: 64738, serverUsername: "Zewi", serverId: "other" });
    expect(friendServerKey(a)).toBe("addr:magical.rocks:64738:Zewi");
    expect(friendServerKey(a)).toBe(friendServerKey(b));
  });

  it("falls back to the volatile id only as a last resort", () => {
    expect(friendServerKey(friend({ serverId: "only-id" }))).toBe("only-id");
    expect(friendServerKey(friend({}))).toBe("");
  });
});
