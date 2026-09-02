import { describe, expect, it } from "vitest";
import { welcomeDigest } from "@core/preferencesStorage";

/**
 * The digest is what turns "show once" into "show once per *message*".
 *
 * Before it, the record was a bare list of servers, so an operator who rewrote
 * their welcome never showed it again to anyone who had seen the old one. Now
 * that the welcome can be a greeting chosen per visitor, that would have meant
 * a new greeting silently never appearing.
 */
describe("welcome digest", () => {
  it("is the same every time for the same text", () => {
    // Stored on disk and compared on a later launch, so it has to survive one.
    const text = "<p>Willkommen!</p>";
    expect(welcomeDigest(text)).toBe(welcomeDigest(text));
  });

  it("changes when the message does", () => {
    expect(welcomeDigest("Welcome.")).not.toBe(welcomeDigest("Welcome!"));
  });

  it("notices a change late in a long message", () => {
    // A rolling hash that stopped early would miss an operator fixing a typo
    // in the last sentence, which is exactly the edit people make.
    const long = "House rules are pinned in #Lounge. ".repeat(40);
    expect(welcomeDigest(`${long}Rotation nights: Tue.`)).not.toBe(
      welcomeDigest(`${long}Rotation nights: Fri.`),
    );
  });

  it("tells apart texts that differ only in order", () => {
    // Two greetings assembled from the same snippets in a different order are
    // different messages, and the reader is owed the new one.
    expect(welcomeDigest("A B")).not.toBe(welcomeDigest("B A"));
  });

  it("answers something for an empty message", () => {
    expect(typeof welcomeDigest("")).toBe("string");
    expect(welcomeDigest("")).not.toBe("");
  });

  it("is short enough to keep for every server the user has joined", () => {
    expect(welcomeDigest("x".repeat(10_000)).length).toBeLessThanOrEqual(8);
  });
});
