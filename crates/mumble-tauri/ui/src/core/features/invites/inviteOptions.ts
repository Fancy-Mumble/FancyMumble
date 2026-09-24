/**
 * The choices an invite dialog offers, cut to what the server allows.
 *
 * The server clamps anything longer or larger than its ceilings anyway, so
 * offering "30 days" on a server that allows a week would only produce an
 * invite that says something different from what was picked.
 */

import type { InviteSupport } from "./invitesApi";

export const HOUR_S = 3600;
export const DAY_S = 24 * HOUR_S;

/** Every lifetime a dialog may offer, in seconds; 0 is "never". */
export const LIFETIMES_S = [HOUR_S, DAY_S, 7 * DAY_S, 30 * DAY_S, 0] as const;

/** Every use limit a dialog may offer; 0 is "no limit". */
export const USE_LIMITS = [0, 1, 5, 10, 25, 100] as const;

/** The lifetimes allowed under `support`, and which one to start on. */
export function lifetimeChoices(support: Pick<InviteSupport, "maxAgeS">): {
  choices: number[];
  initial: number;
} {
  const ceiling = support.maxAgeS;
  let choices: number[] = LIFETIMES_S.filter((s) => (ceiling === 0 ? true : s !== 0 && s <= ceiling));
  // A ceiling shorter than an hour, or between two steps, is still a choice.
  if (ceiling !== 0 && !choices.includes(ceiling)) choices = [...choices, ceiling].sort((a, b) => a - b);
  const initial = choices.includes(7 * DAY_S) ? 7 * DAY_S : Math.max(...choices);
  return { choices, initial };
}

/** The use limits allowed under `support`, and which one to start on. */
export function useLimitChoices(support: Pick<InviteSupport, "maxUses">): {
  choices: number[];
  initial: number;
} {
  const ceiling = support.maxUses;
  let choices: number[] = USE_LIMITS.filter((n) => (ceiling === 0 ? true : n !== 0 && n <= ceiling));
  if (ceiling !== 0 && !choices.includes(ceiling)) choices = [...choices, ceiling].sort((a, b) => a - b);
  const initial = choices.includes(0) ? 0 : Math.max(...choices);
  return { choices, initial };
}

/** The locale key naming a lifetime, or null for one that is not a fixed step. */
export function lifetimeKey(seconds: number): string | null {
  switch (seconds) {
    case 0:
      return "server:invites.never";
    case HOUR_S:
      return "server:invites.lifetime1h";
    case DAY_S:
      return "server:invites.lifetime1d";
    case 7 * DAY_S:
      return "server:invites.lifetime7d";
    case 30 * DAY_S:
      return "server:invites.lifetime30d";
    default:
      return null;
  }
}
