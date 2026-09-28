import { describe, expect, it } from "vitest";
import { DAY_S, HOUR_S, lifetimeChoices, useLimitChoices } from "./inviteOptions";

describe("invite dialog choices", () => {
  it("offers everything, forever included, when the server sets no ceiling", () => {
    const { choices, initial } = lifetimeChoices({ maxAgeS: 0 });
    expect(choices).toEqual([HOUR_S, DAY_S, 7 * DAY_S, 30 * DAY_S, 0]);
    expect(initial).toBe(7 * DAY_S);
  });

  it("cuts lifetimes at the ceiling and drops forever", () => {
    const { choices, initial } = lifetimeChoices({ maxAgeS: 7 * DAY_S });
    expect(choices).toEqual([HOUR_S, DAY_S, 7 * DAY_S]);
    expect(initial).toBe(7 * DAY_S);
  });

  it("offers an odd ceiling itself rather than nothing", () => {
    expect(lifetimeChoices({ maxAgeS: 1800 })).toEqual({ choices: [1800], initial: 1800 });
    expect(lifetimeChoices({ maxAgeS: 2 * DAY_S }).choices).toEqual([HOUR_S, DAY_S, 2 * DAY_S]);
  });

  it("starts on no limit when allowed, and on the ceiling when not", () => {
    expect(useLimitChoices({ maxUses: 0 })).toEqual({ choices: [0, 1, 5, 10, 25, 100], initial: 0 });
    expect(useLimitChoices({ maxUses: 10 })).toEqual({ choices: [1, 5, 10], initial: 10 });
    expect(useLimitChoices({ maxUses: 3 })).toEqual({ choices: [1, 3], initial: 3 });
  });
});
