import { describe, it, expect } from "vitest";
import { isRichTextSetting } from "../serverSettingKinds";
import type { ServerSetting } from "../../../types";

function setting(over: Partial<ServerSetting> = {}): ServerSetting {
  return {
    key: "welcome_text",
    type: "text",
    group: "General",
    label: "Welcome text",
    value: "",
    options: [],
    secret: false,
    ...over,
  };
}

describe("isRichTextSetting", () => {
  it("takes the server at its word when it declares markup", () => {
    // Starling says `html`, so nothing has to be inferred from the name - which
    // matters most for the settings nobody thought to write a pattern for.
    expect(isRichTextSetting(setting({ key: "rules_html", label: "Rules", type: "html" }))).toBe(true);
  });

  it("still recognises the welcome text on a server that only says 'text'", () => {
    // The epoch-0 fork has one type string for "several lines" and no way to
    // say "and it is markup", so the fallback is the only thing standing
    // between an operator and a box full of tags.
    expect(isRichTextSetting(setting())).toBe(true);
    expect(isRichTextSetting(setting({ key: "server_motd", label: "Message of the day" }))).toBe(true);
  });

  it("leaves a multi-line setting that is not markup alone", () => {
    // A regex, a template, a block of keys: wrapping any of them in `<p>` on
    // first edit corrupts the value, and the operator cannot see that it has.
    expect(isRichTextSetting(setting({ key: "channel_name_regex", label: "Channel pattern" }))).toBe(false);
  });

  it("does not turn a single-line field into an editor because of its name", () => {
    // "Welcome channel" is a channel id. The name is not the type, and the
    // declared type is what limits how far the guess can reach.
    expect(
      isRichTextSetting(setting({ key: "welcome_channel", label: "Welcome channel", type: "int" })),
    ).toBe(false);
  });
});
