import { describe, expect, it } from "vitest";
import {
  hasAppearance,
  parseChannelDescription,
  serializeChannelDescription,
  type ChannelProfile,
} from "@core/channelProfile";

const ICON = "data:image/png;base64,ICON";
const BANNER = "data:image/png;base64,BANNER";

describe("channelProfile", () => {
  it("leaves a description nobody marked exactly as it was", () => {
    // Every description written before this format existed, and every one
    // written by any other client, lands here.
    const plain = "<p>Where the raids happen</p>";
    expect(parseChannelDescription(plain)).toEqual({ profile: null, body: plain });
  });

  it("splits a marked description into its look and its text", () => {
    const { profile, body } = parseChannelDescription(
      `<!--FANCYCHAN:{"v":1,"icon":"${ICON}","banner":{"image":"${BANNER}"}}-->\n<p>Hi</p>`,
    );
    expect(profile?.icon).toBe(ICON);
    expect(profile?.banner?.image).toBe(BANNER);
    expect(body).toBe("<p>Hi</p>");
  });

  it("round-trips", () => {
    const profile: ChannelProfile = { v: 1, icon: ICON, banner: { color: "#2a3350" } };
    const { profile: back, body } = parseChannelDescription(
      serializeChannelDescription(profile, "<p>Hi</p>"),
    );
    expect(back).toEqual(profile);
    expect(body).toBe("<p>Hi</p>");
  });

  it("writes no marker for a channel that has set nothing", () => {
    // Otherwise every channel ever edited would start carrying an empty
    // payload, and clearing the last picture would never fully clear it.
    expect(serializeChannelDescription(null, "<p>Hi</p>")).toBe("<p>Hi</p>");
    expect(serializeChannelDescription({ v: 1 }, "<p>Hi</p>")).toBe("<p>Hi</p>");
    expect(serializeChannelDescription({ v: 1, banner: {} }, "<p>Hi</p>")).toBe("<p>Hi</p>");
  });

  it("keeps a marker with no text at all", () => {
    const only = serializeChannelDescription({ v: 1, icon: ICON }, "");
    expect(only.endsWith("-->")).toBe(true);
    expect(parseChannelDescription(only).body).toBe("");
  });

  it("treats a marker it cannot read as somebody else's text", () => {
    // Eating it would silently delete a description this client cannot parse.
    const broken = '<!--FANCYCHAN:{"v":1,-->still text';
    expect(parseChannelDescription(broken)).toEqual({ profile: null, body: broken });
    const unterminated = '<!--FANCYCHAN:{"v":1}';
    expect(parseChannelDescription(unterminated)).toEqual({ profile: null, body: unterminated });
  });

  it("knows an appearance that draws nothing from one that does", () => {
    expect(hasAppearance(null)).toBe(false);
    expect(hasAppearance({ v: 1 })).toBe(false);
    expect(hasAppearance({ v: 1, banner: { color: "#000" } })).toBe(true);
    expect(hasAppearance({ v: 1, icon: ICON })).toBe(true);
  });
});
