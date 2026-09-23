import { describe, expect, it } from "vitest";
import { parseComment, serializeProfile } from "./profileFormat";

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
