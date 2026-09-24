/**
 * Voice messages, from the marker to the microphone button: what a sender's
 * marker may claim, which server's answer a composer listens to, and when the
 * button shows at all.
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn((command: string) =>
    command === "starling_media_url" ? Promise.resolve("http://127.0.0.1:1/media/k") : Promise.resolve(),
  ),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { useAppStore } from "@core/store";
import { PERM_SEND_VOICE_MESSAGE, PERM_TEXT_MESSAGE } from "@core/utils/permissions";
import FileAttachmentCard from "@standard/components/chat/file/FileAttachmentCard";
import {
  decodeFileAttachmentPayload,
  encodeFileAttachmentMarker,
  FANCY_FILE_MARKER_RE,
} from "../fileAttachments";
import type { FileAttachmentInfo } from "../fileAttachments";
import { formatClipTime, useVoiceRecorder } from "./useVoiceRecorder";
import {
  askServerVoiceSupport,
  forgetServerVoiceSupport,
  resetVoiceSupportForTests,
  voiceSupportFor,
} from "./voiceSupport";

/** The payload inside a marker, as a card receives it. */
function payloadOf(info: unknown): string {
  const marker = encodeFileAttachmentMarker(info as FileAttachmentInfo);
  return FANCY_FILE_MARKER_RE.exec(marker)![1];
}

const CLIP: FileAttachmentInfo = {
  url: "",
  key: "3/0190/voice-message.ogg",
  filename: "voice-message.ogg",
  sizeBytes: 40_000,
  mode: "session",
  voice: { durationMs: 7_400, waveform: [10, 50, 100, 30] },
};

async function announce(serverId: string, available: boolean, maxSeconds = 120): Promise<void> {
  await askServerVoiceSupport();
  act(() => {
    listeners.get("voice-support")?.({
      payload: { requestId: "", available, maxSeconds, maxBytes: 2_097_152, serverId },
    });
  });
}

beforeEach(() => {
  resetVoiceSupportForTests();
  listeners.clear();
});

describe("a voice marker", () => {
  it("survives the round trip with its length and shape", () => {
    const back = decodeFileAttachmentPayload(payloadOf(CLIP));
    expect(back?.voice).toEqual({ durationMs: 7_400, waveform: [10, 50, 100, 30] });
  });

  it("clamps bars a sender got wrong rather than drawing them off the card", () => {
    const back = decodeFileAttachmentPayload(
      payloadOf({ ...CLIP, voice: { durationMs: 1_000, waveform: [-5, 250, "x", 42.4] } }),
    );
    expect(back?.voice?.waveform).toEqual([0, 100, 0, 42]);
  });

  it("drops a voice note whose length is nonsense and keeps the file", () => {
    const back = decodeFileAttachmentPayload(payloadOf({ ...CLIP, voice: { durationMs: -1, waveform: [] } }));
    expect(back).not.toBeNull();
    expect(back?.voice).toBeUndefined();
  });

  it("is drawn as a voice note and not as a file to save", async () => {
    render(<FileAttachmentCard info={CLIP} />);
    expect(await screen.findByTestId("voice-message")).toBeTruthy();
    expect(screen.getByText("0:07")).toBeTruthy();
    expect(screen.queryByText("voice-message.ogg")).toBeNull();
  });
});

describe("voice support", () => {
  it("keeps each server's answer to itself", async () => {
    await announce("a", true, 30);
    await announce("b", false);
    expect(voiceSupportFor("a")).toEqual({ available: true, maxSeconds: 30, maxBytes: 2_097_152 });
    expect(voiceSupportFor("b")?.available).toBe(false);

    forgetServerVoiceSupport("a");
    expect(voiceSupportFor("a")).toBeNull();
    expect(voiceSupportFor("b")).not.toBeNull();
  });

  it("reads silence as off", () => {
    expect(voiceSupportFor("never-answered")).toBeNull();
  });
});

describe("the microphone button", () => {
  function withChannel(permissions: number | null): void {
    useAppStore.setState({
      activeServerId: "s1",
      channels: [{ id: 3, parent_id: 0, name: "Lobby", permissions } as never],
    });
  }

  it("shows where the server takes voice messages and the channel allows them", async () => {
    withChannel(PERM_TEXT_MESSAGE | PERM_SEND_VOICE_MESSAGE);
    await announce("s1", true, 60);
    const { result } = renderHook(() => useVoiceRecorder(3, null));
    expect(result.current.available).toBe(true);
    expect(result.current.limitMs).toBe(60_000);
  });

  it("stays away where the channel denies the bit", async () => {
    withChannel(PERM_TEXT_MESSAGE);
    await announce("s1", true);
    const { result } = renderHook(() => useVoiceRecorder(3, null));
    expect(result.current.available).toBe(false);
  });

  it("shows while the channel's permissions are still unknown", async () => {
    withChannel(null);
    await announce("s1", true);
    const { result } = renderHook(() => useVoiceRecorder(3, null));
    expect(result.current.available).toBe(true);
  });

  it("stays away on a server that turned voice messages off", async () => {
    withChannel(PERM_SEND_VOICE_MESSAGE);
    await announce("s1", false);
    const { result } = renderHook(() => useVoiceRecorder(3, null));
    expect(result.current.available).toBe(false);
  });
});

describe("clip time", () => {
  it("reads as minutes and padded seconds", () => {
    expect(formatClipTime(0)).toBe("0:00");
    expect(formatClipTime(7_999)).toBe("0:07");
    expect(formatClipTime(125_000)).toBe("2:05");
  });
});
