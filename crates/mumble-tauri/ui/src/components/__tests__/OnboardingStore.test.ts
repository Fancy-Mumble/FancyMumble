/**
 * Unit tests for onboarding-store helper functions.
 *
 * The store itself relies on Tauri invoke; these tests stay focused on
 * the pure helpers: visible-channel + role-label aggregation from a
 * config + response.
 */

import { describe, expect, it } from "vitest";

import {
  ONBOARDING_MIN_FANCY_VERSION,
  computeRoleLabels,
  computeVisibleChannels,
  isOnboardingSupported,
} from "../onboarding/onboardingStore";
import type { OnboardingConfig, OnboardingResponse } from "../../types";

/**
 * `(major << 48) | (minor << 32) | (patch << 16)` encoded inline so we
 * don't accidentally test against the same bit-math the implementation
 * uses.
 */
function encodeFancyVersion(major: number, minor: number, patch: number): number {
  return major * 2 ** 48 + minor * 2 ** 32 + patch * 2 ** 16;
}

function makeConfig(): OnboardingConfig {
  return {
    version: 1,
    enabled: true,
    default_channel_ids: [0, 1],
    revision: 5,
    questions: [
      {
        id: "q1",
        text: "What brings you here?",
        multi_select: false,
        required: true,
        ask_before_join: true,
        answers: [
          {
            id: "a1",
            label: "Gaming",
            channel_ids: [5, 6],
            group_names: ["gamers"],
          },
          {
            id: "a2",
            label: "Music",
            channel_ids: [7],
            group_names: ["music", "listeners"],
          },
        ],
      },
      {
        id: "q2",
        text: "Pick all interests",
        multi_select: true,
        required: false,
        ask_before_join: false,
        answers: [
          {
            id: "b1",
            label: "Lobby",
            channel_ids: [9],
            group_names: ["lobby"],
          },
          {
            id: "b2",
            label: "Movies",
            channel_ids: [10],
            group_names: ["cinema"],
          },
        ],
      },
    ],
  };
}

function makeResponse(
  selections: { question_id: string; answer_ids: string[] }[],
  revision = 5,
): OnboardingResponse {
  return { config_revision: revision, selections };
}

describe("computeVisibleChannels", () => {
  it("returns just the default channels when no answers are selected", () => {
    const cfg = makeConfig();
    const visible = [...computeVisibleChannels(cfg, null)].sort((a, b) => a - b);
    expect(visible).toEqual([0, 1]);
  });

  it("unions defaults with channels mapped from selected answers", () => {
    const cfg = makeConfig();
    const resp = makeResponse([
      { question_id: "q1", answer_ids: ["a1"] },
      { question_id: "q2", answer_ids: ["b1", "b2"] },
    ]);
    const visible = [...computeVisibleChannels(cfg, resp)].sort((a, b) => a - b);
    expect(visible).toEqual([0, 1, 5, 6, 9, 10]);
  });

  it("returns empty when config is null", () => {
    expect([...computeVisibleChannels(null, null)]).toEqual([]);
  });

  it("ignores selections that reference unknown answer ids", () => {
    const cfg = makeConfig();
    const resp = makeResponse([
      { question_id: "q1", answer_ids: ["nope"] },
    ]);
    const visible = [...computeVisibleChannels(cfg, resp)].sort((a, b) => a - b);
    expect(visible).toEqual([0, 1]);
  });
});

describe("computeRoleLabels", () => {
  it("collects unique group names across all selected answers", () => {
    const cfg = makeConfig();
    const resp = makeResponse([
      { question_id: "q1", answer_ids: ["a2"] },
      { question_id: "q2", answer_ids: ["b1"] },
    ]);
    const labels = computeRoleLabels(cfg, resp).sort();
    expect(labels).toEqual(["listeners", "lobby", "music"]);
  });

  it("returns no labels without a response", () => {
    expect(computeRoleLabels(makeConfig(), null)).toEqual([]);
  });
});

describe("isOnboardingSupported (server version gate)", () => {
  it("returns false on legacy / non-Fancy servers (null version)", () => {
    expect(isOnboardingSupported(null)).toBe(false);
    expect(isOnboardingSupported(undefined)).toBe(false);
  });

  it("returns false for Fancy servers below 0.3.1", () => {
    expect(isOnboardingSupported(encodeFancyVersion(0, 2, 17))).toBe(false);
    expect(isOnboardingSupported(encodeFancyVersion(0, 3, 0))).toBe(false);
  });

  it("returns true for exactly 0.3.1", () => {
    expect(isOnboardingSupported(encodeFancyVersion(0, 3, 1))).toBe(true);
  });

  it("returns true for any newer version", () => {
    expect(isOnboardingSupported(encodeFancyVersion(0, 3, 2))).toBe(true);
    expect(isOnboardingSupported(encodeFancyVersion(0, 4, 0))).toBe(true);
    expect(isOnboardingSupported(encodeFancyVersion(1, 0, 0))).toBe(true);
  });

  it("ONBOARDING_MIN_FANCY_VERSION matches the encoded 0.3.1 form", () => {
    expect(ONBOARDING_MIN_FANCY_VERSION).toBe(encodeFancyVersion(0, 3, 1));
  });
});
