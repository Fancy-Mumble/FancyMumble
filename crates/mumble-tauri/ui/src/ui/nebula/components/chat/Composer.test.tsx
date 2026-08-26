import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/**
 * Type into the editor.
 *
 * The caret is placed before the change is dispatched because the editor
 * reports the selection from that event - it does not watch key-up.
 */
function type(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
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

  it("draws the reply inside the panel, not above it", () => {
    const onRemoveQuote = vi.fn();
    draw({
      quotes: [
        {
          sender_session: 7,
          sender_name: "Zewi",
          body: "<p>sunset shot from tonight</p>",
          channel_id: 1,
          is_own: false,
          message_id: "m1",
        },
      ],
      onRemoveQuote,
    });
    expect(screen.getByText("Zewi")).toBeTruthy();
    // The body is shown as text, not as the markup it arrived as.
    expect(screen.getByText("sunset shot from tonight")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Stop replying to Zewi"));
    expect(onRemoveQuote).toHaveBeenCalledWith("m1");
  });

  it("shows an upload as a tile with its progress", () => {
    const onCancelUpload = vi.fn();
    draw({
      uploads: [{ id: "u1", filename: "server-notes.pdf", state: "uploading", progress: 40 }],
      onCancelUpload,
    });
    expect(screen.getByText("server-notes.pdf")).toBeTruthy();
    expect(screen.getByText("40% · sending")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Cancel upload of server-notes.pdf"));
    expect(onCancelUpload).toHaveBeenCalledWith("u1");
  });

  it("says why an upload failed rather than showing a stalled bar", () => {
    draw({
      uploads: [{ id: "u1", filename: "big.mov", state: "error", errorMessage: "too large" }],
    });
    expect(screen.getByText("too large")).toBeTruthy();
  });

  it("offers the drop target only while files are over the window", () => {
    draw();
    expect(screen.queryByText("Drop files to send")).toBeNull();

    cleanup();
    draw({ dropActive: true });
    expect(screen.getByText("Drop files to send")).toBeTruthy();
  });

  it("holds send until an upload has actually landed", () => {
    // The message carries the file's marker, and there is no marker until the
    // server has answered - so sending early would send a reference to nothing.
    draw({ uploads: [{ id: "u1", filename: "clip.mov", state: "uploading", progress: 40 }] });
    expect((screen.getByLabelText("Send message") as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    draw({ uploads: [{ id: "u1", filename: "clip.mov", state: "error", errorMessage: "too large" }] });
    // A failed upload is not going to land, so it must not block the composer.
    const { field } = { field: screen.getByLabelText("Message #Gaming") as HTMLTextAreaElement };
    type(field, "never mind");
    expect((screen.getByLabelText("Send message") as HTMLButtonElement).disabled).toBe(false);
  });

  it("gives each reply its own row rather than a cluster of chips", () => {
    const quote = (id: string, name: string) => ({
      sender_session: 7,
      sender_name: name,
      body: `body of ${id}`,
      channel_id: 1,
      is_own: false,
      message_id: id,
    });
    draw({ quotes: [quote("m1", "Zewi"), quote("m2", "Lorelando")] });
    expect(screen.getByLabelText("Stop replying to Zewi")).toBeTruthy();
    expect(screen.getByLabelText("Stop replying to Lorelando")).toBeTruthy();
  });

  it("can send a reply that carries no text of its own", () => {
    const { onSend } = draw({
      quotes: [
        {
          sender_session: 7,
          sender_name: "Zewi",
          body: "look",
          channel_id: 1,
          is_own: false,
          message_id: "m1",
        },
      ],
    });
    // A quote is content, so the one filled action is live without typing -
    // and pressing it has to actually send, not just look pressable.
    expect((screen.getByLabelText("Send message") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(onSend).toHaveBeenCalledWith("");
  });

  it("caps its width so an ultrawide window does not stretch it", () => {
    const { container } = render(withNebulaTheme(<Composer target="#Gaming" onSend={vi.fn()} />));
    const shell = container.firstElementChild as HTMLElement;
    // Grows to about a 16:9 pane, then centres; below the cap nothing changes.
    expect(getComputedStyle(shell).maxWidth).toBe("1360px");
    expect(getComputedStyle(shell).marginLeft).toBe("auto");
  });

  it("opens the GIF browser as a popover rather than a modal", () => {
    draw();
    fireEvent.click(screen.getByLabelText("Insert a GIF"));
    // No dialog role: the canvas asks for a panel on the composer's own inset,
    // not a centred modal with a scrim over the conversation.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
