/**
 * The one spacing scale for the Aurora UI.
 *
 * The stylesheets currently mix 4, 5, 6, 8, 9, 10, 12 and 14px paddings, which
 * is why margins never quite line up. Layout primitives take a step on this
 * scale rather than a raw length, so spacing can only ever be one of these.
 *
 * Steps are 4px-based (not MUI's 8px) because this UI is denser than Material:
 * a 4px step is needed for control padding, and doubling from there covers the
 * rest without inventing in-between values.
 */
export const SPACE = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;

/** Index into {@link SPACE}. */
export type SpaceStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** A scale step as a CSS length, or undefined so the property stays unset. */
export function space(step?: SpaceStep): string | undefined {
  return step === undefined ? undefined : `${SPACE[step]}px`;
}
