import { useEffect } from "react";
import {
  isStoreRef,
  processBackgroundImage,
  pruneChatBackgrounds,
  storeRefName,
  toStoreRef,
} from "@core/features/settings/chatBackground";
import {
  activeBackground,
  referencedFiles,
  updateBackground,
} from "@core/features/settings/chatBackgroundRecents";
import {
  loadPersonalization,
  savePersonalization,
  type PersonalizationData,
} from "@standard/personalizationStorage";

/**
 * Whether the still on screen is being blurred or dimmed live, frame after
 * frame, when the backend could bake that look into the pixels once.
 *
 * Only a stored still qualifies: a data-URL record is Standard's, and Standard
 * bakes those itself. A clip's poster is baked alongside the clip.
 */
export function stillNeedsBake(data: PersonalizationData | null): boolean {
  return (
    data !== null &&
    !data.chatBgVideo &&
    isStoreRef(data.chatBgOriginal) &&
    data.chatBgBlurred === null &&
    (data.chatBgBlurSigma > 0 || data.chatBgDim > 0)
  );
}

/** Bakes underway, keyed by what they are computed for. */
const inFlight = new Set<string>();
/** Bakes that failed this session; the live filter keeps the look for those. */
const failed = new Set<string>();

/**
 * Bake the blur and dim into a stored still, the way the clip path bakes them
 * into a clip.
 *
 * A `filter: blur()` on a full-column picture is re-rendered by the compositor
 * on every paint, and it is rendered at the window's size - on a large, high
 * density display that is tens of megabytes of GPU surfaces for as long as
 * the conversation is on screen. The processed still is at most 960x540 and
 * carries the look in its pixels, so it draws like any other picture.
 *
 * Standard's editor bakes when the sliders move; Nebula's writes the record and
 * leaves the bake to whoever shows the picture, which is here. That also
 * repairs a still set before this existed, which would otherwise stay on the
 * live path for good. The record is re-read before it is written: a picture or
 * a slider changed while the bake ran makes the result yesterday's, and it is
 * dropped rather than shown.
 */
export function useBakedStill(data: PersonalizationData | null): void {
  const wanted = stillNeedsBake(data);
  const original = data?.chatBgOriginal ?? null;
  const sigma = data?.chatBgBlurSigma ?? 0;
  const dim = data?.chatBgDim ?? 0;

  useEffect(() => {
    if (!wanted || !isStoreRef(original)) return;
    const key = `${original}|${sigma}|${dim}`;
    if (inFlight.has(key) || failed.has(key)) return;
    inFlight.add(key);

    void (async () => {
      try {
        const processed = await processBackgroundImage(storeRefName(original), sigma, dim);
        const current = await loadPersonalization();
        const stale =
          current.chatBgOriginal !== original ||
          current.chatBgBlurSigma !== sigma ||
          current.chatBgDim !== dim ||
          Boolean(current.chatBgVideo) ||
          current.chatBgBlurred !== null;
        if (stale) {
          // The file just written is referenced by nothing; the prune takes it.
          await pruneChatBackgrounds(referencedFiles(current)).catch(() => undefined);
          return;
        }
        const shown: PersonalizationData = { ...current, chatBgBlurred: toStoreRef(processed) };
        // The shelf's copy learns the new name too, so the wallpaper comes back
        // off the shelf already baked, and the prune keeps the file alive.
        const next: PersonalizationData = {
          ...shown,
          chatBgRecents: updateBackground(current.chatBgRecents, activeBackground(shown)),
        };
        await savePersonalization(next);
        await pruneChatBackgrounds(referencedFiles(next)).catch(() => undefined);
      } catch {
        // A file the backend cannot open, or a store it cannot write: the live
        // filter goes on rendering the look, exactly as before.
        failed.add(key);
      } finally {
        inFlight.delete(key);
      }
    })();
  }, [wanted, original, sigma, dim]);
}
