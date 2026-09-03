import { TENURE_WINDOWS, type TenureWindow } from "./model";

/**
 * How long each tenure window is, in seconds.
 *
 * A window is a label on screen and seconds on the wire, and both the store
 * that sends it and the solver that reasons about it need the same number - so
 * it lives here rather than in either of them. A second copy would be a table
 * that could disagree with itself about what "1 month" means.
 */
export const WINDOW_SECONDS: Record<TenureWindow, number> = {
  "1 day": 86_400,
  "1 week": 604_800,
  "1 month": 2_592_000,
  "6 months": 15_552_000,
  "1 year": 31_536_000,
};

/** The nearest window to `seconds`, so a hand-written value still reads. */
export function windowFor(seconds: number): TenureWindow {
  // Widened deliberately: `TENURE_WINDOWS[0]` narrows to its own literal, and
  // the loop below has to be able to move off it.
  let nearest: TenureWindow = TENURE_WINDOWS[0];
  for (const label of TENURE_WINDOWS) {
    if (Math.abs(WINDOW_SECONDS[label] - seconds) < Math.abs(WINDOW_SECONDS[nearest] - seconds)) {
      nearest = label;
    }
  }
  return nearest;
}
