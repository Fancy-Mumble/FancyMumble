/**
 * The height of the share stage while it sits above the conversation.
 *
 * The stage and the conversation split one column, so the height is really
 * the ratio the user wants between picture and chat. It is remembered per
 * device in `localStorage` rather than in the user's preferences: the right
 * split on a 4K monitor is the wrong one on a laptop, and this is layout, not
 * a setting anyone should sync.
 *
 * Storage is best-effort: private mode or a disabled store falls back to the
 * default and silently drops writes.
 */

const KEY = "fancy.nebula.stageHeight";

export const STAGE_HEIGHT_DEFAULT = 324;
/** Below this the picture is a filmstrip tile with controls on top of it. */
export const STAGE_HEIGHT_MIN = 160;
/** How much of the column the conversation keeps however far the stage is
 *  dragged: enough for the composer and a couple of lines. */
export const CONVERSATION_MIN = 168;
/** One keyboard step on the handle. */
export const STAGE_HEIGHT_STEP = 16;

export function clampStageHeight(height: number, max: number): number {
  const ceiling = Math.max(STAGE_HEIGHT_MIN, Math.floor(max));
  return Math.min(ceiling, Math.max(STAGE_HEIGHT_MIN, Math.round(height)));
}

export function readStageHeight(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw == null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed)
      ? clampStageHeight(parsed, Number.POSITIVE_INFINITY)
      : STAGE_HEIGHT_DEFAULT;
  } catch {
    return STAGE_HEIGHT_DEFAULT;
  }
}

export function writeStageHeight(height: number): void {
  try {
    if (height === STAGE_HEIGHT_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(height));
  } catch {
    /* storage unavailable - keep the in-memory value */
  }
}
