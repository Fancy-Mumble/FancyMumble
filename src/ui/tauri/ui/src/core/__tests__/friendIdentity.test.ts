/**
 * What may rewrite a saved friend's identity, and what may not.
 *
 * The bug this guards against is silent and permanent: a background resolver
 * finds a live user it believes to be the friend, writes that user's registered
 * id and connection target into the record, and from then on the row named
 * after one person opens somebody else's chat - with nothing on screen saying
 * the record ever changed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@core/utils/store", () => {
  const mem: Record<string, unknown> = {};
  return {
    load: async () => ({
      get: async (key: string) => mem[key],
      set: async (key: string, value: unknown) => {
        mem[key] = value;
      },
    }),
  };
});

const { addFriend, getFriends, hasFriend, saveFriends, updateFriendIdentity } = await import(
  "../friendsStorage"
);

beforeEach(async () => {
  await saveFriends([]);
});

describe("updateFriendIdentity", () => {
  it("fills in what is unknown", async () => {
    const friend = await addFriend({ userName: "Jonas", userHash: "cert-b" });
    await updateFriendIdentity(friend.id, {
      userId: 4,
      serverHost: "magical.rocks",
      serverPort: 64738,
      serverUsername: "Zewi",
    });

    const [saved] = await getFriends();
    expect(saved.userId).toBe(4);
    expect(saved.serverHost).toBe("magical.rocks");
  });

  it("never overwrites an identity it already has", async () => {
    const friend = await addFriend({
      userName: "Sebi",
      userHash: "cert-a",
      userId: 5,
      serverHost: "magical.rocks",
      serverPort: 64738,
      serverUsername: "Zewi",
    });

    // The same certificate resolved to a different account, on a login of ours
    // that is not the one they were saved on.
    await updateFriendIdentity(friend.id, { userId: 2, serverUsername: "Sebi" });

    const [saved] = await getFriends();
    expect(saved.userId).toBe(5);
    expect(saved.serverUsername).toBe("Zewi");
  });
});

describe("addFriend", () => {
  it("keeps two accounts sharing one certificate apart", async () => {
    const sebi = await addFriend({ userName: "Sebi", userHash: "cert-a", userId: 5 });
    const testUser = await addFriend({ userName: "TestUser", userHash: "cert-a", userId: 2 });

    expect(testUser.id).not.toBe(sebi.id);
    expect(await getFriends()).toHaveLength(2);
    expect(await hasFriend({ userName: "TestUser", userHash: "cert-a", userId: 2 })).toBe(true);
    expect(await hasFriend({ userName: "Nobody", userHash: "cert-a", userId: 9 })).toBe(false);
  });

  it("still updates the friend the user is actually pointing at", async () => {
    const friend = await addFriend({ userName: "Sebi", userHash: "cert-a", userId: 5 });
    await updateFriendIdentity(friend.id, { serverHost: "magical.rocks", serverPort: 64738 });

    // Re-adding from the user menu is the user naming this person, so it wins.
    await addFriend({
      userName: "Sebi",
      userHash: "cert-a",
      userId: 5,
      serverHost: "magical.rocks",
      serverPort: 64739,
    });

    const [saved] = await getFriends();
    expect(await getFriends()).toHaveLength(1);
    expect(saved.serverPort).toBe(64739);
  });
});
