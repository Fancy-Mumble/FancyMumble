import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MentionSuggestions from "./MentionSuggestions";
import SlashSuggestions from "./SlashSuggestions";

describe("composer suggestion popups", () => {
  it("stays out of the way until there is something to suggest", () => {
    const { container } = render(<MentionSuggestions candidates={[]} activeIndex={0} onPick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    const slash = render(<SlashSuggestions entries={[]} activeIndex={0} onPick={vi.fn()} />);
    expect(slash.container.firstChild).toBeNull();
  });

  it("labels every mention kind and marks the active row", () => {
    render(
      <MentionSuggestions
        candidates={[
          { kind: "user", session: 7, name: "Morgan" },
          { kind: "role", name: "moderators" },
          { kind: "everyone" },
          { kind: "here" },
        ]}
        activeIndex={2}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByText("Morgan")).toBeTruthy();
    expect(screen.getByText("@moderators")).toBeTruthy();
    expect(screen.getByText("@here")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
  });

  it("picks a mention without stealing focus from the editor", () => {
    const onPick = vi.fn();
    const candidate = { kind: "user", session: 7, name: "Morgan" } as const;
    render(<MentionSuggestions candidates={[candidate]} activeIndex={0} onPick={onPick} />);
    const row = screen.getByRole("option");
    // A mousedown default would blur the editor before the range edit runs.
    expect(fireEvent.mouseDown(row)).toBe(false);
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(candidate);
  });

  it("shows a command's argument shape and owning plugin", () => {
    render(
      <SlashSuggestions
        entries={
          [
            {
              pluginName: "fancy-poll",
              command: {
                name: "poll",
                description: "Start a poll",
                options: [
                  { name: "question", required: true },
                  { name: "duration", required: false },
                ],
              },
            },
          ] as never
        }
        activeIndex={0}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByText("/poll <question> [duration]")).toBeTruthy();
    expect(screen.getByText("Start a poll")).toBeTruthy();
    expect(screen.getByText("fancy-poll")).toBeTruthy();
  });
});
