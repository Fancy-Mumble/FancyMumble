import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { withNebulaTheme } from "@nebula/testTheme";

const writes: unknown[] = [];
vi.mock("@core/utils/store", () => {
  const mem: Record<string, unknown> = {};
  return { load: async () => ({
    get: async (k: string) => mem[k],
    set: async (k: string, v: unknown) => { writes.push(v); mem[k] = v; },
  }) };
});

// The dialog and the byte store live in the backend; the probe checks the
// page-to-backdrop flow, not the transfer.
vi.mock("@core/features/settings/chatBackground", () => ({
  isStoreRef: (v: unknown) => typeof v === "string" && v.startsWith("bgstore:"),
  toStoreRef: (name: string) => `bgstore:${name}`,
  storeRefName: (ref: string) => ref.slice("bgstore:".length),
  useResolvedBackgroundSource: (value: string | null) =>
    value?.startsWith("bgstore:") ? "blob:stored" : value,
  useStoredBackgroundUrl: (name: string | null) => (name ? "blob:stored" : null),
  pickChatBackground: async () => ({ kind: "image", fileName: "image-a.jpg" }),
  extractBackgroundPoster: async () => null,
  captureAndStorePoster: async () => "image-poster.jpg",
  storedBackgroundUrl: async () => "blob:stored",
  probeVideoPlayback: async () => ({ playable: true, reason: null }),
  bakeBackgroundVideo: async () => "video-baked.mp4",
  processBackgroundImage: async () => "processed.jpg",
  clearChatBackgroundStore: async () => undefined,
  onBakeProgress: () => () => undefined,
}));

import { PersonalizeSettings } from "@nebula/components/settings/PersonalizeSettings";
import { ChatBackdrop } from "@nebula/components/chat/ChatBackdrop";

describe("real flow: settings -> back to chat", () => {
  it("backdrop shows the picture after leaving settings", async () => {
    // 1. user is on the settings screen (ChatBackdrop NOT mounted)
    render(withNebulaTheme(<PersonalizeSettings />));
    await screen.findByText(/Chat background/i);
    fireEvent.click(screen.getByText(/Choose an image or video/i));
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));

    // 2. user navigates back to chat: settings unmounts, backdrop mounts
    cleanup();
    render(withNebulaTheme(<ChatBackdrop />));
    await waitFor(() => {
      const img = document.querySelector("img");
      expect(img?.getAttribute("src")).toBe("blob:stored");
    }, { timeout: 2000 });
  });
});
