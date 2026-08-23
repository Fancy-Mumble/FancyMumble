/**
 * The onboarding editor, as a flow rather than a form.
 *
 * The page draws one question at a time on a rail and shows the rest collapsed,
 * so "which question am I editing" is now state the page owns - and the config
 * it publishes is still a single document. What is checked here is the seam
 * between those two: opening a step edits that step, the free-text side of the
 * mapping picker becomes a group rather than a channel, and what reaches
 * `saveConfig` is the whole draft with the half-written rows dropped.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));

import { useAppStore } from "@core/store";
import { useOnboardingStore } from "@core/features/onboarding/onboardingStore";
import { fancyVersionEncode } from "@core/utils/version";
import type { ChannelEntry, OnboardingConfig } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { OnboardingAdmin } from "./OnboardingAdmin";

const channel = (id: number, name: string, parent: number | null): ChannelEntry =>
  ({ id, name, parent_id: parent, position: 0, user_count: 0, permissions: 0, attributes: 0 }) as unknown as ChannelEntry;

const CONFIG: OnboardingConfig = {
  version: 1,
  enabled: true,
  default_channel_ids: [0],
  revision: 3,
  questions: [
    {
      id: "q1",
      text: "What brings you here?",
      multi_select: false,
      required: false,
      ask_before_join: true,
      answers: [
        { id: "a1", label: "Gaming", emoji: "🎮", channel_ids: [4], group_names: ["gamers"] },
        { id: "a2", label: "Movie nights", emoji: "🎬", channel_ids: [2], group_names: [] },
      ],
    },
    {
      id: "q2",
      text: "Where are you from?",
      multi_select: true,
      required: false,
      ask_before_join: false,
      answers: [{ id: "a3", label: "Europe", channel_ids: [], group_names: [] }],
    },
  ],
};

const saveConfig = vi.fn<(config: OnboardingConfig) => Promise<void>>();

function open(config: OnboardingConfig = CONFIG) {
  useAppStore.setState({
    serverFancyVersion: fancyVersionEncode(0, 3, 1),
    channels: [channel(0, "Root", null), channel(2, "Lounge", 0), channel(4, "Gaming", 0)],
  } as never);
  useOnboardingStore.setState({ config, busy: false, error: null, saveConfig } as never);
  return render(withNebulaTheme(<OnboardingAdmin />));
}

/** The config handed to the store by the last Save. */
function saved(): OnboardingConfig {
  return saveConfig.mock.calls.at(-1)?.[0] as OnboardingConfig;
}

describe("OnboardingAdmin", () => {
  beforeEach(() => {
    saveConfig.mockReset();
    saveConfig.mockResolvedValue(undefined);
  });

  it("opens the first question and leaves the rest on the rail", () => {
    open();
    // The open one is editable; the collapsed one is a row that says what it is.
    expect((screen.getByLabelText("Prompt") as HTMLInputElement).value).toBe("What brings you here?");
    expect(screen.getByText("Where are you from?")).toBeTruthy();
    expect(screen.getByText(/multi-select/)).toBeTruthy();
  });

  it("moves the editor to the question whose step is clicked", () => {
    open();
    fireEvent.click(screen.getByText("Where are you from?"));
    expect((screen.getByLabelText("Prompt") as HTMLInputElement).value).toBe("Where are you from?");
  });

  it("keeps a question's behaviour out of the way until Advanced is opened", () => {
    open();
    expect(screen.queryByLabelText("Ask before join")).toBeNull();
    fireEvent.click(screen.getByText("Advanced"));
    expect((screen.getByLabelText("Ask before join") as HTMLInputElement).checked).toBe(true);
  });

  it("shows the member's own view of the open question", () => {
    open();
    const preview = screen.getByText("NEW MEMBER PREVIEW").parentElement as HTMLElement;
    expect(within(preview).getByText(/1 of 2/)).toBeTruthy();
    expect(within(preview).getByText(/joins # Gaming, gamers/)).toBeTruthy();
  });

  it("seeds a question from a template rather than an empty one", async () => {
    open();
    fireEvent.click(screen.getByText(/Language rooms/));
    await waitFor(() =>
      expect((screen.getByLabelText("Prompt") as HTMLInputElement).value).toBe(
        "Which language do you speak?",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save & broadcast" }));
    const question = saved().questions.at(-1);
    expect(question?.answers.map((answer) => answer.label)).toEqual([
      "English",
      "Deutsch",
      "Français",
      "Español",
    ]);
    // A template cannot know this server's channels, so it maps to nothing.
    expect(question?.answers.every((answer) => answer.channel_ids.length === 0)).toBe(true);
  });

  it("publishes the whole draft, without the rows still being written", () => {
    open();
    fireEvent.click(screen.getByText("+ Add question"));
    fireEvent.click(screen.getByRole("button", { name: "Save & broadcast" }));

    expect(saved().questions.map((question) => question.id)).toEqual(["q1", "q2"]);
    expect(saved().revision).toBe(3);
  });

  it("turns a typed name into a group, not a channel", async () => {
    open();
    const picker = screen.getByLabelText("Channels and groups for Movie nights");
    fireEvent.change(picker, { target: { value: "cinephiles" } });
    fireEvent.keyDown(picker, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Save & broadcast" }));
    const answer = saved().questions[0].answers[1];
    expect(answer.group_names).toEqual(["cinephiles"]);
    expect(answer.channel_ids).toEqual([2]);
  });

  it("refuses nothing to an unsupported server, but explains why", () => {
    useAppStore.setState({ serverFancyVersion: null, channels: [] } as never);
    useOnboardingStore.setState({ config: null, busy: false, error: null, saveConfig } as never);
    render(withNebulaTheme(<OnboardingAdmin />));
    expect(screen.getByText(/does not support the onboarding workflow/)).toBeTruthy();
  });
});
