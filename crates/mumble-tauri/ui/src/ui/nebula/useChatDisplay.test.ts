/**
 * The four personalization fields the conversation obeys.
 *
 * Worth a test because the failure is silent in both directions: a wrong
 * mapping draws the wrong size with nothing to compare it against, and a
 * missing subscription leaves the setting looking like it did nothing until
 * the next launch - which is exactly the bug these settings were added to
 * avoid.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@core/utils/store", () => {
  const mem: Record<string, unknown> = {};
  return {
    load: async () => ({
      get: async (key: string) => mem[key],
      set: async (key: string, value: unknown) => {
        mem[key] = value;
      },
    }),
  };
});

const { chatFontSizePx, DEFAULT_CHAT_DISPLAY, useChatDisplay } = await import("./useChatDisplay");
const { PERSONALIZATION_DEFAULTS, savePersonalization } = await import("@standard/personalizationStorage");

describe("chatFontSizePx", () => {
  it("maps the presets the way Standard's chat does", () => {
    expect(chatFontSizePx({ ...PERSONALIZATION_DEFAULTS, fontSize: "small" })).toBe(12);
    expect(chatFontSizePx({ ...PERSONALIZATION_DEFAULTS, fontSize: "medium" })).toBe(14);
  });

  it("reads 'large' as the custom pixel size, which is what the record means", () => {
    expect(chatFontSizePx({ ...PERSONALIZATION_DEFAULTS, fontSize: "large", fontSizeCustomPx: 21 })).toBe(21);
  });
});

describe("useChatDisplay", () => {
  it("starts on the defaults rather than on nothing", () => {
    expect(DEFAULT_CHAT_DISPLAY).toEqual({
      fontSizePx: 14,
      compact: false,
      alwaysShowActions: false,
      bubbleStyle: "bubbles",
    });
  });

  it("follows a setting changed while the conversation is on screen", async () => {
    await savePersonalization({ ...PERSONALIZATION_DEFAULTS });
    const { result } = renderHook(() => useChatDisplay());
    await waitFor(() => expect(result.current.compact).toBe(false));

    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      compactMode: true,
      alwaysShowMessageActions: true,
      fontSize: "large",
      fontSizeCustomPx: 18,
      bubbleStyle: "flat",
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        fontSizePx: 18,
        compact: true,
        alwaysShowActions: true,
        bubbleStyle: "flat",
      });
    });
  });
});
