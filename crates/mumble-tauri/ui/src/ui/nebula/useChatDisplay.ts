/**
 * The personalization the message river obeys.
 *
 * Message style, text size, compact mode and always-visible message actions
 * are app-wide records rather than Nebula's own - Standard's chat reads the
 * same four - so this pack reads them rather than inventing a second set.
 * Everything else on the record is either the backdrop's business
 * (`ChatBackdrop` loads it itself) or Standard's alone.
 *
 * Read once at the top of the client and passed down as props: the alternative
 * is every message row subscribing to the same window event, which is fifty
 * listeners for one value that changes when somebody visits a settings page.
 */
import { useEffect, useState } from "react";
import {
  loadPersonalization,
  PERSONALIZATION_CHANGED_EVENT,
  PERSONALIZATION_DEFAULTS,
  type BubbleStyle,
  type PersonalizationData,
} from "@standard/personalizationStorage";

export interface ChatDisplay {
  /** Message body size, in px. */
  fontSizePx: number;
  /** Drop the avatars and tighten the river. */
  compact: boolean;
  /** Keep the row's action strip up instead of showing it on hover. */
  alwaysShowActions: boolean;
  /**
   * The shape a message is drawn in: a rounded card each ("bubbles"), one
   * continuous river ("flat"), or dense IRC-style lines ("compact").
   */
  bubbleStyle: BubbleStyle;
}

/**
 * What "small", "medium" and "large" mean in pixels.
 *
 * The same mapping Standard's `ChatView` applies, including the part that
 * looks odd: "large" is whatever `fontSizeCustomPx` holds, because the custom
 * size *is* the third preset rather than a fourth option beside it. Two
 * designs disagreeing about what a stored preset means would be worse than the
 * oddity.
 */
export function chatFontSizePx(data: PersonalizationData): number {
  if (data.fontSize === "small") return 12;
  if (data.fontSize === "large") return data.fontSizeCustomPx;
  return 14;
}

function displayOf(data: PersonalizationData): ChatDisplay {
  return {
    fontSizePx: chatFontSizePx(data),
    compact: data.compactMode,
    alwaysShowActions: data.alwaysShowMessageActions,
    bubbleStyle: data.bubbleStyle,
  };
}

/** The defaults, for the frame before the record has loaded. */
export const DEFAULT_CHAT_DISPLAY: ChatDisplay = displayOf(PERSONALIZATION_DEFAULTS);

/**
 * The live chat display record.
 *
 * Re-read on `PERSONALIZATION_CHANGED_EVENT` rather than only at mount, so a
 * setting changed on the Personalize page shows in the conversation behind it
 * without a reload - the same event `ChatBackdrop` listens on.
 */
export function useChatDisplay(): ChatDisplay {
  const [display, setDisplay] = useState<ChatDisplay>(DEFAULT_CHAT_DISPLAY);

  useEffect(() => {
    let active = true;
    const read = () => {
      void loadPersonalization()
        .then((data) => {
          if (active) setDisplay(displayOf(data));
        })
        .catch(() => undefined);
    };
    read();
    globalThis.addEventListener(PERSONALIZATION_CHANGED_EVENT, read);
    return () => {
      active = false;
      globalThis.removeEventListener(PERSONALIZATION_CHANGED_EVENT, read);
    };
  }, []);

  return display;
}
