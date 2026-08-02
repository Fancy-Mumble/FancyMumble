/**
 * When the onboarding modal is allowed to open by itself.
 *
 * The rule the whole flow hangs on: a missing response means "we have not
 * been told yet", not "never answered".  Conflating the two re-asked every
 * onboarded user on every connect, because the backend snapshot starts
 * empty on each new connection and only a delivery from the server ever
 * fills it in.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

import {
  dismissOnboardingForServer,
  useOnboardingStore,
  ONBOARDING_MIN_FANCY_VERSION,
} from "../onboarding/onboardingStore";
import type { OnboardingConfig, OnboardingResponse } from "../../types";

const SERVER_ID = "server-1";

function config(over: Partial<OnboardingConfig> = {}): OnboardingConfig {
  return {
    version: 1,
    enabled: true,
    default_channel_ids: [0],
    revision: 3,
    questions: [
      {
        id: "q1",
        text: "What brings you here?",
        multi_select: false,
        required: true,
        ask_before_join: true,
        answers: [{ id: "a1", label: "Gaming", channel_ids: [5], group_names: ["gamers"] }],
      },
    ],
    ...over,
  };
}

function answered(revision: number): OnboardingResponse {
  return { config_revision: revision, selections: [{ question_id: "q1", answer_ids: ["a1"] }] };
}

/** Backend snapshot replies for `hydrate`. */
function snapshot(cfg: OnboardingConfig | null, response: OnboardingResponse | null) {
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "get_onboarding_config") return cfg;
    if (cmd === "get_onboarding_response") return response;
    return undefined;
  });
}

/** Commands the store sent, in order. */
function sentCommands(): string[] {
  return invokeMock.mock.calls.map(([cmd]) => cmd);
}

async function hydrate(): Promise<void> {
  await useOnboardingStore.getState().hydrate(SERVER_ID, ONBOARDING_MIN_FANCY_VERSION);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  sessionStorage.clear();
  useOnboardingStore.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auto-open on connect", () => {
  it("asks the server instead of prompting while the answer state is unknown", async () => {
    snapshot(config(), null);
    await hydrate();

    expect(useOnboardingStore.getState().modalOpen).toBe(false);
    expect(sentCommands()).toContain("request_onboarding_response");
  });

  it("stays shut once the server delivers an answer for the current revision", async () => {
    snapshot(config(), null);
    await hydrate();

    useOnboardingStore.getState().setResponse(answered(3));

    expect(useOnboardingStore.getState().modalOpen).toBe(false);
  });

  it("opens once the server confirms nothing is stored", async () => {
    snapshot(config(), null);
    await hydrate();

    useOnboardingStore.getState().setResponse(null);

    expect(useOnboardingStore.getState().modalOpen).toBe(true);
  });

  it("opens when the stored answer predates the current config revision", async () => {
    snapshot(config({ revision: 4 }), null);
    await hydrate();

    useOnboardingStore.getState().setResponse(answered(3));

    expect(useOnboardingStore.getState().modalOpen).toBe(true);
  });

  it("does not re-ask when the response was already delivered before hydrate", async () => {
    // The server pushes the response right after ServerSync, so it can
    // already be in the backend snapshot by the time hydrate runs.
    snapshot(config(), answered(3));
    await hydrate();

    expect(useOnboardingStore.getState().modalOpen).toBe(false);
    expect(sentCommands()).not.toContain("request_onboarding_response");
  });

  it("respects a dismissal for this server", async () => {
    dismissOnboardingForServer(SERVER_ID);
    snapshot(config(), null);
    await hydrate();

    useOnboardingStore.getState().setResponse(null);

    expect(useOnboardingStore.getState().modalOpen).toBe(false);
  });

  it("prompts anyway when no delivery arrives in time", async () => {
    vi.useFakeTimers();
    snapshot(config(), null);
    await hydrate();
    expect(useOnboardingStore.getState().modalOpen).toBe(false);

    // A server that never answers must not leave a genuinely new user
    // without the flow.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(useOnboardingStore.getState().modalOpen).toBe(true);
  });

  it("never prompts while onboarding is disabled server-side", async () => {
    snapshot(config({ enabled: false }), null);
    await hydrate();

    useOnboardingStore.getState().setResponse(null);

    expect(useOnboardingStore.getState().modalOpen).toBe(false);
  });

  it("clears the answer state on disconnect so the next connect re-checks", async () => {
    snapshot(config(), null);
    await hydrate();
    useOnboardingStore.getState().setResponse(answered(3));

    useOnboardingStore.getState().clear();

    expect(useOnboardingStore.getState().responseKnown).toBe(false);
    expect(useOnboardingStore.getState().response).toBeNull();
  });
});
