/**
 * What a whisper key reaches, what it sends when pressed, and what is kept
 * registered ahead of the press.
 *
 * The failures worth guarding are silent: a binding resolving to the wrong
 * session, or falling back to the channel, or a slot left registered to
 * someone who left, all look like a working whisper to the person pressing it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(args[0] as string, args[1]),
}));

type Handler = (event: { state: "Pressed" | "Released" }) => void;
const handlers = new Map<string, Handler>();
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(async (hotkey: string, handler: Handler) => {
    handlers.set(hotkey, handler);
  }),
  unregister: vi.fn(async (hotkey: string) => {
    handlers.delete(hotkey);
  }),
  isRegistered: vi.fn(async (hotkey: string) => handlers.has(hotkey)),
}));

import { useAppStore } from "@core/store";
import {
  WHISPER_UNRESOLVED_EVENT,
  applyAllWhisperTargets,
  newWhisperTarget,
  resetWhisperRegistrations,
  resolveWhisperTarget,
  syncWhisperRegistrations,
  whisperTargetChannels,
  type WhisperRoster,
  type WhisperTarget,
} from "./whisperTargets";

const ROSTER: WhisperRoster = {
  users: [
    { session: 11, name: "alice", hash: "aa", channel_id: 0 },
    { session: 12, name: "bob", channel_id: 5 },
    { session: 13, name: "carol", hash: "cc", channel_id: 4 },
  ],
  channels: [{ id: 0 }, { id: 4 }, { id: 5 }],
  currentChannel: 4,
};

function target(changes: Partial<WhisperTarget>): WhisperTarget {
  return { ...newWhisperTarget("t1", "test"), ...changes };
}

describe("resolveWhisperTarget", () => {
  it("finds users by certificate hash, and by name only when there is no hash", () => {
    const entry = resolveWhisperTarget(
      target({ users: [{ name: "renamed", hash: "aa" }, { name: "bob" }] }),
      ROSTER,
    );
    expect(entry).toEqual({ sessions: [11, 12], channelId: null, group: null, links: false, children: false });
  });

  it("does not hand a hashed binding to someone else who took the name", () => {
    expect(resolveWhisperTarget(target({ users: [{ name: "carol", hash: "gone" }] }), ROSTER)).toBeNull();
  });

  it("keeps the users who are online when some are not", () => {
    const entry = resolveWhisperTarget(
      target({ users: [{ name: "x", hash: "offline" }, { name: "carol", hash: "cc" }] }),
      ROSTER,
    );
    expect(entry?.sessions).toEqual([13]);
  });

  it("shouts to a fixed channel with its links, sub-channels and group", () => {
    const entry = resolveWhisperTarget(
      target({ kind: "channel", channelId: 0, links: true, children: true, group: " admin " }),
      ROSTER,
    );
    expect(entry).toEqual({ sessions: [], channelId: 0, group: "admin", links: true, children: true });
  });

  it("follows the current channel, and reaches nobody while only browsing", () => {
    const current = target({ kind: "channel", channelMode: "current" });
    expect(resolveWhisperTarget(current, ROSTER)?.channelId).toBe(4);
    expect(resolveWhisperTarget(current, { ...ROSTER, currentChannel: null })).toBeNull();
  });

  it("reaches nobody when the fixed channel was deleted", () => {
    expect(resolveWhisperTarget(target({ kind: "channel", channelId: 99 }), ROSTER)).toBeNull();
  });
});

describe("whisperTargetChannels", () => {
  it("names the rooms the server checks Whisper in", () => {
    const whisper = target({ users: [{ name: "bob" }, { name: "carol", hash: "cc" }] });
    expect(whisperTargetChannels(whisper, ROSTER).sort()).toEqual([4, 5]);
    expect(whisperTargetChannels(target({ kind: "channel", channelId: 0 }), ROSTER)).toEqual([0]);
  });
});

describe("syncWhisperRegistrations", () => {
  beforeEach(() => {
    invoke.mockClear();
    resetWhisperRegistrations();
  });

  it("registers each target in its own slot, then only what changed", async () => {
    const squad = target({ id: "a", users: [{ name: "alice", hash: "aa" }] });
    const shout = target({ id: "b", kind: "channel", channelMode: "current" });
    await syncWhisperRegistrations([squad, shout], ROSTER);
    expect(invoke.mock.calls.map(([cmd, args]) => [cmd, (args as { slot: number }).slot])).toEqual([
      ["whisper_register", 1],
      ["whisper_register", 2],
    ]);

    invoke.mockClear();
    await syncWhisperRegistrations([squad, shout], ROSTER);
    expect(invoke).not.toHaveBeenCalled();

    await syncWhisperRegistrations([squad, shout], { ...ROSTER, currentChannel: 0 });
    expect(invoke.mock.calls).toEqual([
      ["whisper_register", { slot: 2, targets: [{ sessions: [], channelId: 0, group: null, links: false, children: false }] }],
    ]);
  });

  it("clears the slot of a target that was removed", async () => {
    const squad = target({ id: "a", users: [{ name: "alice", hash: "aa" }] });
    await syncWhisperRegistrations([squad, target({ id: "b", users: [{ name: "bob" }] })], ROSTER);
    invoke.mockClear();
    await syncWhisperRegistrations([squad], ROSTER);
    expect(invoke.mock.calls).toEqual([["whisper_register", { slot: 2, targets: [] }]]);
  });

  it("clears the slot of a target whose people all left", async () => {
    const squad = target({ id: "a", users: [{ name: "bob" }] });
    await syncWhisperRegistrations([squad], ROSTER);
    invoke.mockClear();
    await syncWhisperRegistrations([squad], { ...ROSTER, users: [] });
    expect(invoke.mock.calls).toEqual([["whisper_register", { slot: 1, targets: [] }]]);
  });
});

describe("the whisper key", () => {
  beforeEach(() => {
    invoke.mockClear();
    handlers.clear();
    useAppStore.setState({
      users: ROSTER.users as never,
      channels: ROSTER.channels as never,
      currentChannel: 4,
    });
  });

  it("whispers at its slot while held and stops on release", async () => {
    await applyAllWhisperTargets([
      target({ id: "x", hotkey: "Ctrl+9" }),
      target({ id: "y", hotkey: "Ctrl+1", users: [{ name: "alice", hash: "aa" }] }),
    ]);
    handlers.get("Ctrl+1")?.({ state: "Pressed" });
    handlers.get("Ctrl+1")?.({ state: "Released" });
    expect(invoke.mock.calls).toEqual([
      ["whisper_start", { slot: 2, targets: [{ sessions: [11], channelId: null, group: null, links: false, children: false }] }],
      ["whisper_end", undefined],
    ]);
  });

  it("sends nothing on a press that reaches nobody, and says so", async () => {
    const heard = vi.fn();
    globalThis.addEventListener(WHISPER_UNRESOLVED_EVENT, heard);
    await applyAllWhisperTargets([
      target({ hotkey: "Ctrl+2", name: "Squad", users: [{ name: "x", hash: "gone" }] }),
    ]);
    handlers.get("Ctrl+2")?.({ state: "Pressed" });
    globalThis.removeEventListener(WHISPER_UNRESOLVED_EVENT, heard);
    expect(invoke).not.toHaveBeenCalledWith("whisper_start", expect.anything());
    expect((heard.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ name: "Squad" });
  });
});
