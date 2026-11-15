import { describe, expect, it } from "vitest";
import {
  arrangeBadges,
  badgeFromGroup,
  badgesFromState,
  formatCount,
  formatSpan,
  showsSection,
  type ProfileBadge,
} from "./model";

const TONE = { warn: "#ecba55", bad: "#f57e7e" };

function badge(id: string, source: ProfileBadge["source"], shelf?: string): ProfileBadge {
  return { id, label: id, glyph: { kind: "text", text: "x" }, source, shelf };
}

describe("badgeFromGroup", () => {
  it("makes a chip out of a plain group, which is all a server sends today", () => {
    const made = badgeFromGroup({ name: "admin", color: "#41b4f9" });
    expect(made).toMatchObject({
      id: "group:admin",
      label: "admin",
      tone: "#41b4f9",
      source: "group",
      glyph: { kind: "text", text: "A" },
    });
  });

  it("takes the glyph, label, shelf and shape a server names in metadata", () => {
    const made = badgeFromGroup({
      name: "founders",
      metadata: {
        badge_icon: "crown",
        badge_label: "Founder",
        badge_shelf: "special",
        badge_shape: "diamond",
        badge_color: "#d9a441",
      },
    });
    expect(made).toMatchObject({
      label: "Founder",
      glyph: { kind: "icon", name: "crown" },
      shelf: "special",
      shape: "diamond",
      tone: "#d9a441",
    });
  });

  it("ignores a glyph name it cannot draw rather than rendering nothing", () => {
    const made = badgeFromGroup({ name: "mods", metadata: { badge_icon: "not-a-glyph" } });
    expect(made?.glyph).toEqual({ kind: "text", text: "M" });
  });

  it("drops a group the server marks as not a badge", () => {
    expect(badgeFromGroup({ name: "internal", metadata: { badge_hidden: "1" } })).toBeNull();
  });
});

describe("badgesFromState", () => {
  it("mints a badge only for a flag that is actually set", () => {
    const badges = badgesFromState({ prioritySpeaker: true, muted: false }, TONE);
    expect(badges.map((entry) => entry.label)).toEqual(["Priority speaker"]);
  });

  it("marks them as state, so they can be told from a granted badge", () => {
    const [only] = badgesFromState({ deafened: true }, TONE);
    expect(only.source).toBe("state");
    expect(only.tone).toBe(TONE.bad);
  });
});

describe("arrangeBadges", () => {
  it("leads with granted badges so a passing mute cannot push a role off the strip", () => {
    const arranged = arrangeBadges([
      badge("muted", "state"),
      badge("admin", "group"),
      badge("vip", "group"),
      badge("dev", "group"),
      badge("founder", "server"),
    ]);
    expect(arranged.strip.map((entry) => entry.id)).toEqual(["admin", "vip", "dev", "founder"]);
    expect(arranged.stripOverflow).toBe(1);
  });

  it("counts what did not fit rather than dropping it", () => {
    const many = Array.from({ length: 12 }, (_, index) => badge(`b${index}`, "group"));
    expect(arrangeBadges(many).stripOverflow).toBe(8);
  });

  it("splits shelved badges onto their own rails, labelled and counted", () => {
    const arranged = arrangeBadges(
      [
        badge("a", "group", "common"),
        badge("b", "group", "common"),
        badge("c", "group", "special"),
        badge("d", "group", "special"),
        badge("e", "group", "special"),
        badge("f", "group", "special"),
      ],
      { special: "Special" },
    );
    const [common, special] = arranged.shelves;
    expect(common.badges).toHaveLength(2);
    expect(common.overflow).toBe(0);
    expect(special.label).toBe("Special");
    expect(special.badges).toHaveLength(3);
    expect(special.overflow).toBe(1);
  });

  it("leaves unshelved badges off the rails entirely", () => {
    expect(arrangeBadges([badge("a", "group")]).shelves).toEqual([]);
  });
});

describe("showsSection", () => {
  it("treats a row nobody has decided about as shown", () => {
    expect(showsSection(undefined, "stats")).toBe(true);
    expect(showsSection({}, "stats")).toBe(true);
  });

  it("hides only what was switched off", () => {
    expect(showsSection({ stats: false }, "stats")).toBe(false);
    expect(showsSection({ stats: false }, "badges")).toBe(true);
  });
});

describe("formatting", () => {
  it("stops counting precisely past a thousand, as the mock does", () => {
    expect(formatCount(940)).toBe("940");
    expect(formatCount(1240)).toBe("1.2k");
    expect(formatCount(2_000)).toBe("2k");
    expect(formatCount(3_400_000)).toBe("3.4M");
  });

  it("picks the unit a span reads best in", () => {
    expect(formatSpan(45)).toBe("45 s");
    expect(formatSpan(2880)).toBe("48 min");
    expect(formatSpan(763_200)).toBe("212 h");
  });
});
