import { describe, expect, it } from "vitest";
import type { UserEntry } from "../types";
import { selectMicLive, selectOwnUser, selectSelfDeafened } from "./voiceSelectors";
import type { AppState } from ".";

const user = (session: number, overrides: Partial<UserEntry> = {}): UserEntry => ({
  session,
  name: `user-${session}`,
  channel_id: 0,
  user_id: null,
  texture_size: null,
  comment: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: false,
  ...overrides,
});

const state = (partial: Partial<AppState>) => partial as AppState;

describe("selectSelfDeafened", () => {
  it("reads self_deaf from our own user", () => {
    expect(
      selectSelfDeafened(
        state({ ownSession: 2, users: [user(1, { self_deaf: true }), user(2, { self_deaf: true })] }),
      ),
    ).toBe(true);
    expect(selectSelfDeafened(state({ ownSession: 2, users: [user(2, { self_deaf: false })] }))).toBe(false);
  });

  it("does not report someone else's deafen as our own", () => {
    expect(selectSelfDeafened(state({ ownSession: 2, users: [user(1, { self_deaf: true }), user(2)] }))).toBe(
      false,
    );
  });

  it("is false before the server assigns a session", () => {
    expect(selectSelfDeafened(state({ ownSession: null, users: [user(1, { self_deaf: true })] }))).toBe(
      false,
    );
    expect(selectOwnUser(state({ ownSession: null, users: [] }))).toBeUndefined();
  });

  it("is independent of the voice state, which cannot express deafen", () => {
    // Regression: deafen used to be inferred from `voiceState === "inactive"`,
    // so merely turning voice off showed up as deafened.
    expect(selectSelfDeafened(state({ ownSession: 1, voiceState: "inactive", users: [user(1)] }))).toBe(
      false,
    );
    expect(
      selectSelfDeafened(
        state({ ownSession: 1, voiceState: "active", users: [user(1, { self_deaf: true })] }),
      ),
    ).toBe(true);
  });
});

describe("selectMicLive", () => {
  it("is true only while voice is active", () => {
    expect(selectMicLive(state({ voiceState: "active" }))).toBe(true);
    expect(selectMicLive(state({ voiceState: "muted" }))).toBe(false);
    // Regression: an indicator keyed on `voiceState === "muted"` showed a live
    // mic while voice was off entirely.
    expect(selectMicLive(state({ voiceState: "inactive" }))).toBe(false);
  });
});
