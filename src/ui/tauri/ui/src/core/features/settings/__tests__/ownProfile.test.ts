import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileData } from "../profileData";

/** What the server holds as the own session's comment. */
let serverComment: string | null = null;
const invoked: { cmd: string; args: Record<string, unknown> | undefined }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    return Promise.resolve(cmd === "get_user_comment" ? serverComment : undefined);
  },
}));

/** The local store, keyed as profileData keys it. */
let local: ProfileData;
const saved: ProfileData[] = [];
vi.mock("../profileData", () => ({
  loadProfileData: () => Promise.resolve(local),
  loadServerProfileData: () => Promise.resolve({ data: local, isOverride: false }),
  saveProfileData: (data: ProfileData) => {
    saved.push(data);
    local = data;
    return Promise.resolve();
  },
  saveServerProfileData: () => Promise.reject(new Error("no override here")),
}));

import { applySavedProfileOnConnect } from "../ownProfile";

const ABOUT = { v: 1, blocks: [{ t: "p", r: [{ x: "Hello World!" }] }] };
const ABOUT_HTML = "<p>Hello World!</p>";

function sent(): string[] {
  return invoked.filter((call) => call.cmd === "set_user_comment").map((call) => String(call.args?.comment));
}

beforeEach(() => {
  invoked.length = 0;
  saved.length = 0;
  serverComment = null;
  // The web client's copy from before the profile was converted elsewhere.
  local = { profile: { status: "hi" }, bio: "<p>my old bio</p>", avatarDataUrl: null };
});

describe("applying the saved profile on connect (unregistered user)", () => {
  it("does not rewrite a comment whose only difference would be dropped fields", async () => {
    serverComment = `<!--FANCY:${JSON.stringify({ v: 1, status: "hi", about: ABOUT })}-->\n${ABOUT_HTML}`;

    await applySavedProfileOnConnect(7, null, "server-1");

    expect(invoked.find((call) => call.cmd === "get_user_comment")?.args).toEqual({ session: 7 });
    expect(sent()).toEqual([]);
  });

  it("keeps what it learned, so a later empty session gets the other client's fields back", async () => {
    serverComment = `<!--FANCY:${JSON.stringify({ v: 1, status: "hi", about: ABOUT })}-->\n${ABOUT_HTML}`;
    await applySavedProfileOnConnect(7, null, "server-1");
    expect(local.profile.opaque).toEqual({ about: ABOUT });
    expect(local.bio).toBe(ABOUT_HTML);

    // A fresh session: the server holds nothing for an unregistered user.
    serverComment = null;
    invoked.length = 0;
    await applySavedProfileOnConnect(8, null, "server-1");

    const [comment] = sent();
    expect(comment).toContain('"about"');
    expect(comment.endsWith(`-->\n${ABOUT_HTML}`)).toBe(true);
    expect(comment).not.toContain("my old bio");
  });

  it("still writes a profile that differs in what this client knows", async () => {
    serverComment = `<!--FANCY:${JSON.stringify({ v: 1, status: "elsewhere", about: ABOUT })}-->\n${ABOUT_HTML}`;
    await applySavedProfileOnConnect(7, null, "server-1");

    const [comment] = sent();
    expect(comment).toContain('"status":"hi"');
    expect(comment).toContain('"about"');
  });

  it("writes the local profile as before when there is nothing to keep", async () => {
    await applySavedProfileOnConnect(7, null, null);
    expect(sent()).toEqual([`<!--FANCY:${JSON.stringify({ status: "hi", v: 1 })}-->\n<p>my old bio</p>`]);
    expect(saved).toEqual([]);
  });
});
