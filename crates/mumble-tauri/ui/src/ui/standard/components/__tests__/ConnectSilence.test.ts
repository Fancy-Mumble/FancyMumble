/**
 * Regression test: connecting to a server must NOT play join sounds.
 *
 * Bug history: `ServerSync` emits `server-connected` and then
 * `current-channel-changed`.  The channel listener is synchronous while the
 * connected handler awaits its store reads, so `currentChannel` was applied
 * against an empty user list, the user list arrived next, and `ownSession`
 * only landed at the end of the post-connect chain.  With `ownSession` still
 * null the hook could not filter our own user out, so the arriving list read
 * as both a server-wide join and a channel join - two sounds on every
 * connect, and with the default settings (both events use "Pop") that is the
 * same sound twice, even when alone on the server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { UserEntry } from "@core/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  createChannel: vi.fn().mockResolvedValue(undefined),
  Importance: { Default: 3 },
  Visibility: { Public: 1 },
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { useAppStore } from "@core/store";
import { useNotificationSounds } from "@core/features/notifications/useNotificationSounds";
import { DEFAULT_NOTIFICATION_SOUNDS, NOTIFICATION_EVENT_KEYS } from "@core/features/notifications/sounds";

/** Every event shares one file, so the volume is what identifies the event. */
const played: string[] = [];
const eventByVolume = new Map<number, string>();

class FakeAudio {
  volume = 1;
  constructor(public url: string) {}
  play() {
    played.push(eventByVolume.get(this.volume) ?? `unknown(${this.volume})`);
    return Promise.resolve();
  }
}

function probeSettings() {
  const events: Record<string, { enabled: boolean; sound: string; volume: number }> = {
    ...DEFAULT_NOTIFICATION_SOUNDS.events,
  };
  eventByVolume.clear();
  NOTIFICATION_EVENT_KEYS.forEach((key, i) => {
    const volume = 0.01 * (i + 1);
    eventByVolume.set(volume, key);
    events[key] = { enabled: true, sound: "univ-036", volume };
  });
  return { masterEnabled: true, events } as never;
}

function makeUser(session: number, channelId: number, name: string): UserEntry {
  return {
    session,
    name,
    channel_id: channelId,
    user_id: null,
    texture: null,
    texture_size: 0,
    comment: null,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    suppress: false,
    priority_speaker: false,
    recording: false,
    hash: null,
  } as unknown as UserEntry;
}

beforeEach(() => {
  played.length = 0;
  (globalThis as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
  useAppStore.setState({
    activeServerId: null,
    ownSession: null,
    currentChannel: null,
    users: [],
    status: "disconnected",
    talkingSessions: new Set(),
    voiceState: "inactive",
  } as never);
});

describe("useNotificationSounds - connecting is silent", () => {
  const me = () => makeUser(5, 7, "me");
  const alice = () => makeUser(11, 7, "alice");
  const bob = () => makeUser(12, 7, "bob");

  /** The store writes a connect performs, in the order the backend drives them. */
  function replayConnect(users: UserEntry[]) {
    act(() => {
      useAppStore.setState({ status: "connecting" } as never);
    });
    act(() => {
      useAppStore.setState({ activeServerId: "srv1" } as never);
    });
    act(() => {
      useAppStore.setState({ status: "connected" } as never);
    });
    // "current-channel-changed": synchronous, so it beats the user list.
    act(() => {
      useAppStore.setState({ currentChannel: 7 } as never);
    });
    // refreshState(): the user list arrives, ownSession still unknown.
    act(() => {
      useAppStore.setState({ users } as never);
    });
    // End of the post-connect chain.
    act(() => {
      useAppStore.setState({ ownSession: 5 } as never);
    });
    // Debounced "state-changed" refresh: same users, fresh array identity.
    act(() => {
      useAppStore.setState({ users: users.map((u) => ({ ...u })) } as never);
    });
  }

  it("plays nothing when connecting to a populated server", () => {
    renderHook(() => useNotificationSounds(probeSettings()));
    replayConnect([me(), alice(), bob()]);
    expect(played).toEqual([]);
  });

  it("plays nothing when connecting alone", () => {
    renderHook(() => useNotificationSounds(probeSettings()));
    replayConnect([me()]);
    expect(played).toEqual([]);
  });

  it("plays nothing when the user list streams in before ownSession", () => {
    renderHook(() => useNotificationSounds(probeSettings()));
    act(() => {
      useAppStore.setState({ status: "connecting" } as never);
    });
    act(() => {
      useAppStore.setState({ activeServerId: "srv1", status: "connected" } as never);
    });
    act(() => {
      useAppStore.setState({ users: [me()] } as never);
    });
    act(() => {
      useAppStore.setState({ users: [me(), alice()] } as never);
    });
    act(() => {
      useAppStore.setState({ users: [me(), alice(), bob()] } as never);
    });
    act(() => {
      useAppStore.setState({ currentChannel: 7 } as never);
    });
    act(() => {
      useAppStore.setState({ ownSession: 5 } as never);
    });
    expect(played).toEqual([]);
  });

  it("still announces a real join once the connect has settled", () => {
    renderHook(() => useNotificationSounds(probeSettings()));
    replayConnect([me(), alice()]);
    act(() => {
      useAppStore.setState({ users: [me(), alice(), bob()] } as never);
    });
    expect(played).toEqual(["userJoin", "userJoinChannel"]);
  });
});
