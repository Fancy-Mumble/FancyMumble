import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@core/types";
import { DEFAULT_TIME_DISPLAY } from "../../../selectors";
import { pinAge, pinnedMessages, pinPreview, type PinnedT, WELCOME_PIN_ID } from "./pinnedModel";

/** The panel's own `t`, stubbed: these functions decide, they do not translate. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join(",")})` : key) as unknown as PinnedT;

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_session: 1,
    sender_name: "Sebi",
    body: "hello",
    channel_id: 4,
    is_own: false,
    message_id: "m1",
    pinned: true,
    ...overrides,
  };
}

describe("pinPreview", () => {
  it("flattens a body into one line of prose", () => {
    const preview = pinPreview("<p>Rotation nights are   Tuesday</p><p>and Friday</p>");
    expect(preview.runs.map((run) => run.text).join("")).toBe("Rotation nights are Tuesday and Friday");
    expect(preview.runs.every((run) => !run.code)).toBe(true);
  });

  it("keeps a code span as its own run, so an address stays readable", () => {
    const preview = pinPreview("Server address — <code>mumble.magical.rocks:64738</code>");
    expect(preview.runs).toEqual([
      { text: "Server address — ", code: false },
      { text: "mumble.magical.rocks:64738", code: true },
    ]);
  });

  it("takes the first image as the row's thumbnail", () => {
    const preview = pinPreview('Ping map pack v4 is up. <img src="blob:pack.png"><img src="blob:two.png">');
    expect(preview.image).toBe("blob:pack.png");
    expect(preview.runs.map((run) => run.text).join("")).toBe("Ping map pack v4 is up.");
  });

  it("says what a bodyless message is rather than drawing an empty row", () => {
    const preview = pinPreview("<!-- FANCY_POLL:p1 -->");
    expect(preview.runs).toEqual([]);
    expect(preview.kind).toBe("poll");
  });

  it("ellipsises a long body at the end of a word", () => {
    const preview = pinPreview("word ".repeat(80));
    const text = preview.runs.map((run) => run.text).join("");
    expect(text.length).toBeLessThan(180);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toContain(" …");
  });

  it("drops a quote marker instead of printing it", () => {
    const preview = pinPreview("<!-- FANCY_QUOTE:m0 -->Agreed");
    expect(preview.runs.map((run) => run.text).join("")).toBe("Agreed");
  });
});

describe("pinnedMessages", () => {
  it("picks the pins out newest first, whatever order the channel is in", () => {
    const list = [
      message({ message_id: "old", timestamp: 1000 }),
      message({ message_id: "loose", pinned: false, timestamp: 5000 }),
      message({ message_id: "new", timestamp: 9000 }),
    ];
    expect(pinnedMessages(list).map((entry) => entry.message_id)).toEqual(["new", "old"]);
  });

  it("drops a pin with no id, there being nothing for its row to jump to", () => {
    expect(pinnedMessages([message({ message_id: null })])).toEqual([]);
  });

  it("falls back to the pin time for a message the server dated only then", () => {
    const list = [
      message({ message_id: "a", timestamp: null, pinned_at: 8000 }),
      message({ message_id: "b", timestamp: 3000 }),
    ];
    expect(pinnedMessages(list).map((entry) => entry.message_id)).toEqual(["a", "b"]);
  });
});

describe("pinAge", () => {
  const now = new Date("2026-08-31T12:00:00Z").getTime();
  const daysBefore = (days: number, hour = 10) => new Date(2026, 7, 31 - days, hour, 14).getTime();

  it("says nothing about a message the server never dated", () => {
    expect(pinAge(t, null, DEFAULT_TIME_DISPLAY, now)).toBe("");
  });

  it("gives today only a clock", () => {
    expect(pinAge(t, daysBefore(0), DEFAULT_TIME_DISPLAY, now)).not.toContain("pinned.age");
  });

  it("names the weekday inside the week and drops the clock past it", () => {
    expect(pinAge(t, daysBefore(1), DEFAULT_TIME_DISPLAY, now)).toContain("pinned.age.yesterday");
    expect(pinAge(t, daysBefore(3), DEFAULT_TIME_DISPLAY, now)).toContain("pinned.age.weekday");
    expect(pinAge(t, daysBefore(9), DEFAULT_TIME_DISPLAY, now)).toBe("pinned.age.lastWeek");
    expect(pinAge(t, daysBefore(16), DEFAULT_TIME_DISPLAY, now)).toBe("pinned.age.weeksAgo(2)");
  });

  it("gives up on intervals past a month and prints a date", () => {
    const old = pinAge(t, daysBefore(60), DEFAULT_TIME_DISPLAY, now);
    expect(old).not.toContain("pinned.age");
    expect(old).toMatch(/\d/);
  });
});

/**
 * The server's greeting, in the list people go back to.
 *
 * It was shown once in a modal and then gone - which is the wrong shape for
 * the one message on a server that carries the rules and the schedule.
 */
describe("the welcome message as a pin", () => {
  const said = (body: string) => ({ body, server: "magical.rocks" });
  const chat = (id: string, pinned: boolean): ChatMessage =>
    ({
      sender_session: 1,
      sender_name: "Lyn",
      body: "hello",
      channel_id: 1,
      is_own: false,
      message_id: id,
      timestamp: 1_700_000_000_000,
      pinned,
    }) as ChatMessage;

  it("puts the greeting at the top, above the newest pin", () => {
    const pins = pinnedMessages([chat("a", true)], said("<p>Welcome aboard</p>"));
    expect(pins).toHaveLength(2);
    expect(pins[0].message_id).toBe(WELCOME_PIN_ID);
    expect(pins[0].body).toContain("Welcome aboard");
  });

  it("names the server as the sender, because nobody wrote it", () => {
    const pins = pinnedMessages([], said("<p>Hi</p>"));
    expect(pins[0].sender_name).toBe("magical.rocks");
    expect(pins[0].is_own).toBe(false);
    expect(pins[0].sender_session).toBeNull();
  });

  it("adds nothing when the server has no welcome message", () => {
    expect(pinnedMessages([chat("a", true)])).toHaveLength(1);
    expect(pinnedMessages([chat("a", true)], said(""))).toHaveLength(1);
    expect(pinnedMessages([chat("a", true)], said("   "))).toHaveLength(1);
  });

  it("still leaves the real pins newest first, under the greeting", () => {
    const older = { ...chat("old", true), timestamp: 1_700_000_000_000 } as ChatMessage;
    const newer = { ...chat("new", true), timestamp: 1_700_000_900_000 } as ChatMessage;
    const pins = pinnedMessages([older, newer], said("<p>Hi</p>"));
    expect(pins.map((pin) => pin.message_id)).toEqual([WELCOME_PIN_ID, "new", "old"]);
  });
});
