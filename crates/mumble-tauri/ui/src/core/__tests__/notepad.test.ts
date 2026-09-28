import { describe, expect, it } from "vitest";
import type { Friend } from "../friendsStorage";
import { notepadRoomName, resolveNotepad, sameNotepad } from "../notepad";

function login(id: string, host: string, addedAt: number): Friend {
  return {
    id,
    userName: "Sebi",
    self: true,
    userId: 4,
    serverHost: host,
    serverPort: 64738,
    serverUsername: "Sebi",
    addedAt,
  };
}

describe("notepadRoomName", () => {
  it("keeps the bare name for Signal, so notepads made before the choice are still found", () => {
    expect(notepadRoomName(4, "signal_v1")).toBe("__dm:4");
  });

  it("gives every other protocol a room of its own, after the id", () => {
    expect(notepadRoomName(4, "fancy_v1_full_archive")).toBe("__dm:4+fancy");
    expect(notepadRoomName(4, "server_managed")).toBe("__dm:4+server");
  });
});

describe("resolveNotepad", () => {
  const home = login("home", "magical.rocks", 1);
  const work = login("work", "voice.kumo.gg", 2);

  it("defaults to the first login you were saved on, with Signal", () => {
    const notepad = resolveNotepad(undefined, [work, home]);
    expect(notepad.friend?.id).toBe("home");
    expect(notepad.protocol).toBe("signal_v1");
  });

  it("falls back to this device when there is no login to keep notes on", () => {
    expect(resolveNotepad(undefined, []).location).toEqual({ kind: "local" });
  });

  it("honours a saved server while its login is known, and falls back once it is not", () => {
    const saved = {
      location: { kind: "server" as const, host: "voice.kumo.gg", port: 64738, username: "Sebi" },
      protocol: "fancy_v1_full_archive" as const,
    };
    expect(resolveNotepad(saved, [home, work]).friend?.id).toBe("work");
    expect(resolveNotepad(saved, [home]).friend?.id).toBe("home");
  });
});

describe("sameNotepad", () => {
  const server = { kind: "server" as const, host: "magical.rocks", port: 64738, username: "Sebi" };

  it("treats a new protocol on the same login as a different notepad", () => {
    expect(
      sameNotepad(
        { location: server, protocol: "signal_v1" },
        { location: server, protocol: "server_managed" },
      ),
    ).toBe(false);
  });

  it("ignores the protocol on this device", () => {
    expect(
      sameNotepad(
        { location: { kind: "local" }, protocol: "signal_v1" },
        { location: { kind: "local" }, protocol: "server_managed" },
      ),
    ).toBe(true);
  });
});
