import { describe, expect, it } from "vitest";
import { SETTINGS_NAV, visibleSettingsPages, type SettingsNavContext } from "./SettingsNav";

const NOTHING: SettingsNavContext = {
  accountSupported: false,
  onboardingSupported: false,
  hasPlugins: false,
};

const ids = (context: SettingsNavContext) => visibleSettingsPages(context).map((entry) => entry.id);

describe("visibleSettingsPages", () => {
  it("always offers the pages that need nothing from the server", () => {
    // These edit local state or this machine's audio, so they are meaningful
    // even disconnected - hiding them would leave the screen nearly empty.
    expect(ids(NOTHING)).toEqual([
      "profile",
      "voice",
      "personalize",
      "notifications",
      "privacy",
      "localization",
      "shortcuts",
      "identities",
      "advanced",
    ]);
  });

  it("hides Account until the session is registered on a server that supports it", () => {
    expect(ids(NOTHING)).not.toContain("account");
    expect(ids({ ...NOTHING, accountSupported: true })).toContain("account");
  });

  it("hides Channels & roles on a server too old to answer onboarding", () => {
    expect(ids(NOTHING)).not.toContain("channels-roles");
    expect(ids({ ...NOTHING, onboardingSupported: true })).toContain("channels-roles");
  });

  it("hides Plugins when the server advertises none", () => {
    expect(ids(NOTHING)).not.toContain("plugins");
    expect(ids({ ...NOTHING, hasPlugins: true })).toContain("plugins");
  });

  it("keeps Profile first and Advanced last however the gates fall", () => {
    // Order is Standard's: identity first, and the page that can break things
    // last. A gated page appearing must not disturb either end.
    for (const context of [
      NOTHING,
      { ...NOTHING, accountSupported: true },
      { accountSupported: true, onboardingSupported: true, hasPlugins: true },
    ]) {
      const visible = ids(context);
      expect(visible[0]).toBe("profile");
      expect(visible.at(-1)).toBe("advanced");
    }
  });

  it("gates every page through `available`, so none can be shown by accident", () => {
    const gated = SETTINGS_NAV.filter((entry) => entry.available !== undefined).map((e) => e.id);
    expect(gated).toEqual(["account", "channels-roles", "plugins"]);
  });
});
