import { describe, expect, it } from "vitest";
import type { SessionMeta, UserEntry } from "../types";
import { selfFriendInput } from "../selfFriend";

const SESSION: SessionMeta = {
  id: "s1",
  label: "Magical",
  host: "magical.rocks",
  port: 64738,
  username: "Sebi",
  certLabel: "main",
  status: "connected",
};

function own(partial: Partial<UserEntry>): UserEntry {
  return { session: 3, name: "Sebi", channel_id: 0, texture_size: null, ...partial } as UserEntry;
}

describe("selfFriendInput", () => {
  it("records a registered login under its server", () => {
    expect(selfFriendInput(SESSION, own({ user_id: 4, hash: "abc" }))).toEqual({
      userName: "Sebi",
      userId: 4,
      userHash: "abc",
      serverId: "s1",
      serverLabel: "Magical",
      serverHost: "magical.rocks",
      serverPort: 64738,
      serverUsername: "Sebi",
      serverCertLabel: "main",
    });
  });

  it("records nothing for a guest, who has no registered id to name a notepad after", () => {
    expect(selfFriendInput(SESSION, own({ user_id: null }))).toBeNull();
    expect(selfFriendInput(SESSION, own({ user_id: -1 }))).toBeNull();
    expect(selfFriendInput(SESSION, null)).toBeNull();
  });
});
