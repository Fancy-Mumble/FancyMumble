import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@core/store";
import { ONBOARDING_MIN_FANCY_VERSION, useOnboardingStore } from "@core/features/onboarding/onboardingStore";
import type { OnboardingConfig } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import OnboardingModal from "./OnboardingModal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

/** The gate's own floor, rather than a second copy of the version arithmetic. */
const SUPPORTED_VERSION = ONBOARDING_MIN_FANCY_VERSION;

function config(overrides: Partial<OnboardingConfig> = {}): OnboardingConfig {
  return {
    version: 1,
    enabled: true,
    revision: 4,
    default_channel_ids: [7],
    questions: [
      {
        id: "q1",
        text: "What brings you here?",
        multi_select: false,
        required: true,
        ask_before_join: false,
        answers: [
          { id: "a1", label: "Gaming", channel_ids: [11], group_names: ["gamers"] },
          { id: "a2", label: "Music", channel_ids: [12], group_names: [] },
        ],
      },
    ],
    ...overrides,
  };
}

function draw() {
  render(withNebulaTheme(<OnboardingModal />));
}

describe("Nebula OnboardingModal", () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    useAppStore.setState({
      channels: [{ id: 7, name: "Lobby" }] as never,
      activeServerId: "server-1",
      serverFancyVersion: SUPPORTED_VERSION,
    } as never);
    useOnboardingStore.setState({
      config: config(),
      response: null,
      responseKnown: true,
      serverId: "server-1",
      modalOpen: true,
      busy: false,
      error: null,
    } as never);
  });

  afterEach(() => cleanup());

  it("opens on the default-channel preview rather than on the first question", () => {
    draw();
    expect(screen.getByText("#Lobby")).toBeTruthy();
    expect(screen.queryByText("What brings you here?")).toBeNull();
  });

  it("stays shut on a server too old for the flow", () => {
    useAppStore.setState({ serverFancyVersion: null } as never);
    draw();
    expect(screen.queryByText("#Lobby")).toBeNull();
  });

  it("submits the chosen answer against the config's revision", () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    useOnboardingStore.setState({ submit } as never);
    draw();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("radio", { name: /Gaming/ }));
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    expect(submit).toHaveBeenCalledWith([{ question_id: "q1", answer_ids: ["a1"] }], 4);
  });

  it("will not advance past a required question with nothing picked", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    const finish = screen.getByRole("button", { name: /finish/i }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Music/ }));
    expect((screen.getByRole("button", { name: /finish/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("replaces the pick on a single-select question instead of adding to it", () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    useOnboardingStore.setState({ submit } as never);
    draw();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("radio", { name: /Gaming/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Music/ }));
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    expect(submit).toHaveBeenCalledWith([{ question_id: "q1", answer_ids: ["a2"] }], 4);
  });

  it("keeps both picks on a multi-select question", () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    useOnboardingStore.setState({
      config: config({ questions: [{ ...config().questions[0], multi_select: true }] }),
      submit,
    } as never);
    draw();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Gaming/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Music/ }));
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    expect(submit).toHaveBeenCalledWith([{ question_id: "q1", answer_ids: ["a1", "a2"] }], 4);
  });

  it("seeds the ticks from an answer the user already gave", () => {
    useOnboardingStore.setState({
      response: { config_revision: 3, selections: [{ question_id: "q1", answer_ids: ["a2"] }] },
    } as never);
    draw();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("radio", { name: /Music/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /Gaming/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("records the dismissal on skip, so the flow does not reopen this session", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(useOnboardingStore.getState().modalOpen).toBe(false);
    expect(sessionStorage.getItem("onboarding-dismissed:server-1")).toBe("1");
  });
});
