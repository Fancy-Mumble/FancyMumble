import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { Composer } from "./Composer";

function user(partial: Partial<UserEntry> & { session: number; name: string }): UserEntry {
  return { channel_id: 1, texture_size: null, ...partial } as UserEntry;
}

function draw(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = vi.fn();
  render(withNebulaTheme(<Composer target="#Gaming" onSend={onSend} {...props} />));
  return { onSend, field: screen.getByLabelText("Message #Gaming") as HTMLTextAreaElement };
}

/** Type into the field and move the caret to the end, as a keystroke would. */
function type(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value } });
  field.setSelectionRange(value.length, value.length);
  fireEvent.keyUp(field);
}

describe("Composer", () => {
  beforeEach(() => {
    useAppStore.setState({
      ownSession: 1,
      selectedChannel: 1,
      users: [user({ session: 1, name: "Me" }), user({ session: 2, name: "Lorelando" })],
      pluginManifests: new Map(),
    });
  });

  it("sends escaped text", () => {
    const { onSend, field } = draw();
    type(field, "a < b");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("a &lt; b");
  });

  it("offers people once an @ is being typed", () => {
    const { field } = draw();
    type(field, "@Lor");
    expect(screen.getByText("Lorelando")).toBeTruthy();
  });

  it("gives Enter to the mention list rather than sending", () => {
    const { onSend, field } = draw();
    type(field, "@Lor");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(field.value).toContain("<@2>");
  });

  it("closes the list when the @ it started at is deleted", () => {
    const { field } = draw();
    type(field, "@Lor");
    expect(screen.getByText("Lorelando")).toBeTruthy();
    type(field, "Lor");
    expect(screen.queryByText("Lorelando")).toBeNull();
  });

  it("hides the attach button until something can be attached", () => {
    draw();
    expect(screen.queryByLabelText("Attach a file")).toBeNull();

    const onAttach = vi.fn();
    render(withNebulaTheme(<Composer target="#Other" onSend={vi.fn()} onAttach={onAttach} />));
    fireEvent.click(screen.getByLabelText("Attach a file"));
    expect(onAttach).toHaveBeenCalled();
  });

  it("offers an emoji picker", () => {
    draw();
    expect(screen.getByLabelText("Insert emoji")).toBeTruthy();
  });
});
