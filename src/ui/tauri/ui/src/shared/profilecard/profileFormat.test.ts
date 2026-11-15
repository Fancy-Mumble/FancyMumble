import { describe, expect, it } from "vitest";
import { mergeOwnProfile, ownCommentOver, parseComment, serializeProfile } from "./profileFormat";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** A comment carrying `profile`, as another client would have written it. */
function comment(profile: object): string {
  return `<!--FANCY:${JSON.stringify(profile)}-->`;
}

describe("parseComment and remote pictures", () => {
  // Somebody else's profile: drawing it must not tell a third party who
  // looked at it and when.
  it("drops a banner or sticker that is an address, as if it were absent", () => {
    const { profile } = parseComment(
      comment({
        v: 1,
        banner: { color: "#123456", image: "https://t.example/b.gif" },
        decorationImage: "https://t.example/s.png",
      }),
    );

    expect(profile?.banner).toEqual({ color: "#123456" });
    expect(profile?.decorationImage).toBeUndefined();
  });

  it("keeps pictures the profile carries inline", () => {
    const { profile } = parseComment(comment({ v: 1, banner: { image: PNG }, decorationImage: PNG }));

    expect(profile?.banner?.image).toBe(PNG);
    expect(profile?.decorationImage).toBe(PNG);
  });

  it("drops a style value that could load a picture of its own", () => {
    const { profile } = parseComment(
      comment({
        v: 1,
        cardBackgroundCustom: "url(https://t.example/bg.png)",
        avatarBorderCustom: "\\75rl(https://t.example/b.png)",
        themeColors: ["#111111", "image-set('https://t.example/c.png' 1x)"],
        nameStyle: { color: "#abcdef" },
      }),
    );

    expect(JSON.stringify(profile)).not.toContain("t.example");
    expect(profile?.themeColors).toEqual(["#111111"]);
    expect(profile?.nameStyle?.color).toBe("#abcdef");
  });

  it("leaves prose alone, backslashes and all", () => {
    const { profile } = parseComment(comment({ v: 1, status: "\\o/ url(yes)", pronouns: "they/them" }));

    expect(profile?.status).toBe("\\o/ url(yes)");
    expect(profile?.pronouns).toBe("they/them");
  });

  it("round-trips a profile that has nothing to drop", () => {
    const written = serializeProfile(
      { banner: { color: "#2a3350", image: PNG }, status: "hi" },
      "<p>bio</p>",
    );

    expect(parseComment(written)).toEqual({
      profile: { v: 1, banner: { color: "#2a3350", image: PNG }, status: "hi" },
      bio: "<p>bio</p>",
    });
  });
});

/** What the native client writes beside the fields this client knows. */
const ABOUT = {
  v: 1,
  blocks: [{ t: "p", r: [{ x: "C:\\path and url(here)", b: true }] }],
};
const PAGE = { k: "0/0193b7/profile.json", n: 5123, v: 1 };
const ABOUT_HTML = "<p><strong>C:\\path and url(here)</strong></p>";

describe("profile fields this client does not know", () => {
  it("survive parse, the local store and serialize, exactly as written", () => {
    const original = `${comment({ v: 1, status: "hi", about: ABOUT, page: PAGE })}\n${ABOUT_HTML}`;
    const { profile, bio } = parseComment(original);
    expect(profile?.opaque).toEqual({ about: ABOUT, page: PAGE });

    // The local store is JSON: what goes in is what comes out.
    const stored = JSON.parse(JSON.stringify({ profile, bio })) as { profile: object; bio: string };
    const written = serializeProfile(stored.profile, stored.bio);

    const again = parseComment(written);
    expect(again.profile?.opaque).toEqual({ about: ABOUT, page: PAGE });
    expect(again.profile?.status).toBe("hi");
    expect(again.bio).toBe(ABOUT_HTML);
    expect(written).not.toContain('"opaque"');
  });

  it("are kept when this client writes its own copy over the server's", () => {
    const current = `${comment({ v: 1, decoration: "old", about: ABOUT, page: PAGE })}\n${ABOUT_HTML}`;
    const merged = mergeOwnProfile(current, { decoration: "sparkle" }, "<p>an old bio</p>");

    expect(merged.profile).toEqual({ decoration: "sparkle", opaque: { about: ABOUT, page: PAGE } });
    // The text after the mark is generated from `about`; the old bio does not go back.
    expect(merged.bio).toBe(ABOUT_HTML);
  });

  it("keep a field this client removed removed, rather than reviving the server's", () => {
    const current = `${comment({ v: 1, banner: { color: "#123456" }, about: ABOUT })}\n${ABOUT_HTML}`;
    const merged = mergeOwnProfile(current, { status: "x" }, "");
    expect(merged.profile.banner).toBeUndefined();
  });

  it("leave a profile without them as it was", () => {
    const current = `${comment({ v: 1, status: "old" })}\n<p>old</p>`;
    expect(mergeOwnProfile(current, { status: "new" }, "<p>new</p>")).toEqual({
      profile: { status: "new" },
      bio: "<p>new</p>",
    });
    expect(mergeOwnProfile(null, { status: "new" }, "<p>new</p>").bio).toBe("<p>new</p>");
  });

  it("send nothing when the only difference would be dropped fields", () => {
    const current = `${comment({ v: 1, status: "hi", about: ABOUT, page: PAGE })}\n${ABOUT_HTML}`;
    expect(ownCommentOver(current, { status: "hi" }, "<p>stale bio</p>").comment).toBeNull();
    expect(ownCommentOver(current, { status: "changed" }, "<p>stale bio</p>").comment).toContain('"about"');
  });
});
