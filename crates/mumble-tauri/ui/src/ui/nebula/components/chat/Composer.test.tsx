import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import type { StagedAttachment } from "@core/features/chat/useFileUpload";
import { withNebulaTheme } from "../../testTheme";
import { Composer } from "./Composer";

function user(partial: Partial<UserEntry> & { session: number; name: string }): UserEntry {
  return { channel_id: 1, texture_size: null, ...partial } as UserEntry;
}

/** A staged file. The share answer travels with it but is the shell's to use. */
function staged(
  partial: Omit<StagedAttachment, "choice" | "filePath"> & { filePath?: string },
): StagedAttachment {
  return { filePath: `/tmp/${partial.filename}`, choice: { mode: "session" }, ...partial };
}

function draw(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = vi.fn();
  const { container } = render(withNebulaTheme(<Composer target="#Gaming" onSend={onSend} {...props} />));
  return { onSend, container, field: screen.getByLabelText("Message #Gaming") as HTMLTextAreaElement };
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

/**
 * Select a run of the draft.
 *
 * The editor reads the selection off the element during its own `select`
 * event rather than tracking key-up, so the range is set first and the event
 * dispatched after.
 */
function select(field: HTMLTextAreaElement, start: number, end: number) {
  field.selectionStart = start;
  field.selectionEnd = end;
  fireEvent.select(field);
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

  it("sends what was typed as markdown, not as asterisks", () => {
    // The editable surface draws **bold** bold while it is being typed. Before
    // this the wire format was escaped text, so everyone else got the word
    // with four asterisks around it.
    const { onSend, field } = draw();
    type(field, "the sky **was unreal** tonight");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("the sky <b>was unreal</b> tonight");
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

  it("always draws the attach button, and says why when it is blocked", () => {
    // Hiding it left no way to tell a server that refuses attachments from a
    // client that has lost track of whether it can send them.
    draw({ attachBlocked: "This server has no file sharing" });
    // Still pressable, because it has something to say: a disabled control
    // that cannot even explain itself is just a gap with an icon in it.
    fireEvent.click(screen.getByLabelText("This server has no file sharing"));
    expect(screen.getByRole("dialog", { name: "Files" })).toBeTruthy();
    expect(screen.getByText(/no file sharing/)).toBeTruthy();

    cleanup();
    const onAttach = vi.fn();
    render(withNebulaTheme(<Composer target="#Gaming" onSend={vi.fn()} onAttach={onAttach} />));
    fireEvent.click(screen.getByLabelText("Attach a file"));
    expect(screen.getByRole("dialog", { name: "Share files" })).toBeTruthy();
    fireEvent.click(screen.getByText("Browse files…"));
    expect(onAttach).toHaveBeenCalled();
  });

  it("puts everything that gets attached behind the one paperclip", () => {
    draw({ onCreatePoll: vi.fn(), onAttach: vi.fn() });
    // A channel can be polled, so there are two destinations and the button
    // asks which.
    fireEvent.click(screen.getByLabelText("Attach a file"));
    expect(screen.getByText("Upload a file")).toBeTruthy();
    expect(screen.getByText("Create a poll")).toBeTruthy();

    fireEvent.click(screen.getByText("Upload a file"));
    expect(screen.getByRole("dialog", { name: "Share files" })).toBeTruthy();
  });

  it("offers an emoji picker, on the bar rather than in the row", () => {
    // The row below is for what you attach; everything that decorates the
    // words is on the bar that is about the words.
    const { field } = draw();
    expect(screen.queryByLabelText("Insert emoji")).toBeNull();

    type(field, "the sky was unreal tonight");
    select(field, 8, 18);
    fireEvent.click(screen.getByLabelText("Insert emoji"));
    expect(screen.getByRole("dialog", { name: "Emoji" })).toBeTruthy();
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
    // With nothing but a percentage known, a percentage is all it claims.
    expect(screen.getByText("40%")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Cancel upload of server-notes.pdf"));
    expect(onCancelUpload).toHaveBeenCalledWith("u1");
  });

  it("says how big, how far and how long as each becomes knowable", () => {
    draw({
      uploads: [
        {
          id: "u1",
          filename: "dusk-ridge.png",
          state: "uploading",
          progress: 68,
          totalBytes: 2_202_010,
          etaSeconds: 2,
        },
      ],
    });
    expect(screen.getByText("2.1 MiB · 68% · 2s left")).toBeTruthy();
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

  it("stages picked files as tiles, and takes one back off again", () => {
    const onRemoveAttachment = vi.fn();
    draw({
      attachments: [
        staged({ id: "a1", filename: "dusk.png", previewUrl: "asset://dusk" }),
        staged({ id: "a2", filename: "notes.pdf", sizeBytes: 860_160 }),
      ],
      onRemoveAttachment,
    });
    // A picture is its own label, so only the file without one is named.
    expect(screen.queryByText("dusk.png")).toBeNull();
    expect((screen.getByAltText("dusk.png") as HTMLImageElement).src).toContain("asset://dusk");
    expect(screen.getByText("notes.pdf")).toBeTruthy();
    expect(screen.getByText("840 KiB")).toBeTruthy();
    expect(screen.getByText("PDF")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Remove notes.pdf"));
    expect(onRemoveAttachment).toHaveBeenCalledWith("a2");
  });

  it("sends a message that is only its attachments", () => {
    // The files are the content, the same way a quote is: there is nothing
    // left to type, so the one filled action must already be live.
    const { onSend } = draw({
      attachments: [staged({ id: "a1", filename: "dusk.png" })],
    });
    expect((screen.getByLabelText("Send message") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(onSend).toHaveBeenCalledWith("");
  });

  it("offers one more file from the tray rather than sending you back up", () => {
    draw({
      onAttach: vi.fn(),
      attachments: [staged({ id: "a1", filename: "dusk.png" })],
    });
    fireEvent.click(screen.getByLabelText("Add another file"));
    expect(screen.getByRole("dialog", { name: "Share files" })).toBeTruthy();
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
    const { container } = draw({ quotes: [quote("m1", "Zewi"), quote("m2", "Lorelando")] });
    expect(screen.getByLabelText("Stop replying to Zewi")).toBeTruthy();
    expect(screen.getByLabelText("Stop replying to Lorelando")).toBeTruthy();
    // And both rows share one tray: a second reply grows the panel by a line,
    // not by a band with its own edge.
    const trays = container.querySelectorAll("[data-nebula-tray]");
    expect(trays.length).toBe(1);
    expect(trays[0].querySelectorAll("[data-nebula-tray-rule]").length).toBe(1);
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
    const { container } = draw();
    fireEvent.click(screen.getByLabelText("Insert a GIF"));

    const panel = screen.getByRole("dialog", { name: "GIF" });
    // A panel on the composer's own inset, not a centred modal: it lives
    // inside the composer and never traps focus behind a scrim.
    expect(container.contains(panel)).toBe(true);
    expect(panel.getAttribute("aria-modal")).toBeNull();
    expect(document.querySelector(".MuiBackdrop-root")).toBeNull();
  });

  describe("the formatting bar", () => {
    it("stays away until there is something to format", () => {
      const { field } = draw();
      type(field, "the sky was unreal tonight");
      expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();

      select(field, 8, 18);
      expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();

      fireEvent.blur(field);
      expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
    });

    it("wraps the selection in the marks the buttons stand for", () => {
      const { field } = draw();
      type(field, "the sky was unreal tonight");
      select(field, 8, 18);
      fireEvent.click(screen.getByLabelText("Bold"));
      expect(field.value).toBe("the sky **was unreal** tonight");

      select(field, 10, 20);
      fireEvent.click(screen.getByLabelText("Code"));
      expect(field.value).toBe("the sky **`was unreal`** tonight");
    });

    it("lists the lines the selection touches, and unlists them again", () => {
      const { field } = draw();
      type(field, "milk\neggs");
      // Half of one word and half of the next: a bullet belongs to the line.
      select(field, 2, 6);
      fireEvent.click(screen.getByLabelText("Bulleted list"));
      expect(field.value).toBe("- milk\n- eggs");

      select(field, 0, field.value.length);
      fireEvent.click(screen.getByLabelText("Bulleted list"));
      expect(field.value).toBe("milk\neggs");
    });

    it("numbers a list itself rather than leaving it to be typed", () => {
      const { field } = draw();
      type(field, "one\ntwo\nthree");
      select(field, 0, field.value.length);
      fireEvent.click(screen.getByLabelText("Numbered list"));
      expect(field.value).toBe("1. one\n2. two\n3. three");
    });

    it("sends a list as a list", () => {
      const { onSend, field } = draw();
      type(field, "milk\neggs");
      select(field, 0, field.value.length);
      fireEvent.click(screen.getByLabelText("Bulleted list"));
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onSend).toHaveBeenCalledWith("<ul><li>milk</li><li>eggs</li></ul>");
    });

    it("gives the spot to the slash menu, which Enter is about to act on", () => {
      useAppStore.setState({
        pluginManifests: new Map([
          ["p1", { name: "p1", slash_commands: [{ name: "roll", description: "roll dice" }] }],
        ]) as never,
      });
      const { field } = draw();
      type(field, "/ro");
      select(field, 1, 3);
      expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
    });
  });

  describe("focus", () => {
    /** The accent the theme resolves for the scheme the tests draw in. */
    const panel = (container: HTMLElement) =>
      getComputedStyle(container.querySelector("[data-nebula-composer]") as Element);

    it("lights the panel while the editor holds the caret", () => {
      const { container, field } = draw();
      const resting = panel(container).borderColor;

      fireEvent.focus(field);
      const lit = panel(container);
      // The panel is the field, so focus is said on its own edge rather than
      // by a second ring drawn around the words inside it.
      expect(lit.borderColor).not.toBe(resting);
      expect(lit.boxShadow).toContain("0 0 0 1px");

      fireEvent.blur(field);
      expect(panel(container).borderColor).toBe(resting);
    });

    it("draws a caret in an empty composer that has been clicked into", () => {
      // The bug this covers: focusing put the placeholder away and drew
      // nothing in its place, so a composer waiting for a keystroke looked
      // exactly like one that was not.
      const { container, field } = draw();
      expect(container.querySelector("[class*='caret']")).toBeNull();

      fireEvent.focus(field);
      expect(container.querySelector("[class*='caret']")).not.toBeNull();
      // And the target stays on screen, which is worth most right as the
      // message to it is about to be typed.
      expect(screen.getAllByText("Message #Gaming").length).toBeGreaterThan(0);
    });

    it("stays unlit when it cannot be typed in", () => {
      const { container, field } = draw({ disabled: true });
      const resting = panel(container).borderColor;
      fireEvent.focus(field);
      // An accent edge on a disabled composer promises a keystroke it will
      // not take.
      expect(panel(container).borderColor).toBe(resting);
    });
  });

  it("gives each popover the width the canvas fixes it at", () => {
    draw({ onCreatePoll: vi.fn() });
    fireEvent.click(screen.getByLabelText("Attach a file"));
    fireEvent.click(screen.getByText("Create a poll"));
    // Fixed, never stretched to the pane - a poll editor spanning an
    // ultrawide footer is unusable.
    expect(getComputedStyle(screen.getByRole("dialog", { name: "New poll" })).width).toBe("400px");
  });
});
