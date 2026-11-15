import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../types";
import type { Friend } from "../friendsStorage";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const { friendLoginSession, friendServerSession, isFriendsOwnServer, matchFitsFriend, resolveFriendMatch } =
  await import("../friendsPresence");

function friend(partial: Partial<Friend>): Friend {
  return { id: "f1", userName: "Sebi", addedAt: 0, ...partial };
}

function session(partial: Partial<SessionMeta>): SessionMeta {
  return {
    id: "s1",
    label: "l",
    host: "magical.rocks",
    port: 64738,
    username: "Zewi",
    certLabel: null,
    status: "connected",
    ...partial,
  };
}

/** The friend from the bug: saved on the Zewi login, a registered account. */
const saved = friend({
  userHash: "cert-a",
  userId: 5,
  serverHost: "magical.rocks",
  serverPort: 64738,
  serverUsername: "Zewi",
});

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

describe("resolveFriendMatch", () => {
  it("names the account and the server, so a look-alike certificate cannot answer", async () => {
    await resolveFriendMatch(saved, [session({ id: "s-zewi" })]);
    expect(invokeMock).toHaveBeenCalledWith("find_user_by_hash", {
      userHash: "cert-a",
      userId: 5,
      serverId: "s-zewi",
    });
  });

  it("scopes to the friend's server even when we are logged in as somebody else", async () => {
    // Two of our own identities on one server: whichever is open, the friend
    // still belongs to that server, so the lookup is still scoped to it.
    await resolveFriendMatch(saved, [session({ id: "s-sebi", username: "Sebi" })]);
    expect(invokeMock).toHaveBeenCalledWith(
      "find_user_by_hash",
      expect.objectContaining({ serverId: "s-sebi", userId: 5 }),
    );
  });

  it("asks unscoped when the friend's server is not open", async () => {
    await resolveFriendMatch(saved, [session({ id: "s-other", host: "elsewhere" })]);
    expect(invokeMock).toHaveBeenCalledWith(
      "find_user_by_hash",
      expect.objectContaining({ serverId: null, userId: 5 }),
    );
  });

  it("does not ask about a friend with no certificate", async () => {
    expect(await resolveFriendMatch(friend({}), [session({})])).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("friendLoginSession / friendServerSession", () => {
  const zewi = session({ id: "s-zewi", username: "Zewi" });
  const sebi = session({ id: "s-sebi", username: "Sebi" });

  it("opens the chat on the login the friend was saved on", () => {
    expect(friendLoginSession(saved, [sebi, zewi])?.id).toBe("s-zewi");
    // That login is not open: there is nowhere to open the chat.
    expect(friendLoginSession(saved, [sebi])).toBeNull();
  });

  it("scopes presence to the server, preferring that login", () => {
    expect(friendServerSession(saved, [sebi, zewi])?.id).toBe("s-zewi");
    expect(friendServerSession(saved, [sebi])?.id).toBe("s-sebi");
  });

  it("ignores connections that are not up", () => {
    expect(friendServerSession(saved, [session({ status: "connecting" })])).toBeNull();
  });
});

describe("isFriendsOwnServer", () => {
  it("is the server, not the login", () => {
    expect(isFriendsOwnServer(saved, session({ username: "Sebi" }))).toBe(true);
    expect(isFriendsOwnServer(saved, session({ host: "elsewhere" }))).toBe(false);
    expect(isFriendsOwnServer(saved, null)).toBe(false);
  });

  it("lets a record that knows no server learn one", () => {
    expect(isFriendsOwnServer(friend({ userHash: "cert-a" }), session({}))).toBe(true);
  });
});

describe("matchFitsFriend", () => {
  it("refuses another account on the same certificate", () => {
    expect(matchFitsFriend(saved, { user_id: 2 })).toBe(false);
    expect(matchFitsFriend(saved, { user_id: 5 })).toBe(true);
  });

  it("has nothing to say when either side is unregistered", () => {
    expect(matchFitsFriend(saved, { user_id: null })).toBe(true);
    expect(matchFitsFriend(friend({ userHash: "cert-a" }), { user_id: 2 })).toBe(true);
    expect(matchFitsFriend(saved, null)).toBe(false);
  });
});
