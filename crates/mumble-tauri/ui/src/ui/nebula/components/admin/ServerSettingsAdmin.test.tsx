import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerSetting, ServerSettingsSnapshot } from "@core/types";
import { useServerSettingsStore } from "@core/features/admin/serverSettingsStore";
import { withNebulaTheme } from "../../testTheme";
import { ServerSettingsAdmin } from "./ServerSettingsAdmin";

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

// Tiptap has its own tests, and it does not run in jsdom for free. What this
// file is about is *which* control each setting gets, so the editor stands in
// as a plainly identifiable field that reports the same value and label.
vi.mock("../primitives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../primitives")>()),
  RichTextField: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (html: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      data-testid="rich-text"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function setting(over: Partial<ServerSetting> = {}): ServerSetting {
  return {
    key: "welcome_text",
    type: "html",
    group: "General",
    label: "Welcome text",
    value: "<p>cozy corner</p>",
    options: [],
    secret: false,
    ...over,
  };
}

const snapshot = (settings: ServerSetting[]): ServerSettingsSnapshot => ({ revision: 1, settings });

async function show(settings: ServerSetting[]) {
  // Through the cache the backend already holds, which is the path a screen
  // opened on an epoch-0 server takes; the query path has its own tests.
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === "get_server_settings" ? snapshot(settings) : null),
  );
  render(withNebulaTheme(<ServerSettingsAdmin />));
  await waitFor(() => expect(screen.getByText("Welcome text")).toBeTruthy());
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
  useServerSettingsStore.getState().clear();
});

afterEach(cleanup);

describe("ServerSettingsAdmin", () => {
  it("edits a setting the server calls markup as formatted text", async () => {
    await show([setting()]);

    const field = screen.getByTestId("rich-text");
    expect(field.getAttribute("aria-label")).toBe("Welcome text");
    expect((field as HTMLTextAreaElement).value).toBe("<p>cozy corner</p>");
  });

  it("uses the same editor on a server that only says 'text'", async () => {
    // The epoch-0 fork has one type string for "several lines" and no way to
    // say "and it is markup", so an operator there would otherwise be writing
    // tags by hand in a monospace box.
    await show([setting({ type: "text" })]);

    expect(screen.getByTestId("rich-text").getAttribute("aria-label")).toBe("Welcome text");
  });

  it("leaves a multi-line setting that is not markup as source", async () => {
    // Wrapping a regex in `<p>` on first edit corrupts it, and nothing on the
    // screen would say that it had.
    await show([
      setting(),
      setting({ key: "channel_name_regex", label: "Channel pattern", type: "text", value: "[a-z]+" }),
    ]);

    const pattern = screen.getByLabelText("Channel pattern");
    expect(pattern.getAttribute("data-testid")).toBeNull();
    expect((pattern as HTMLTextAreaElement).value).toBe("[a-z]+");
  });

  it("edits a welcome text the editor would rewrite as HTML instead", async () => {
    // The real one: a table-laid-out welcome screen with a styled button. The
    // WYSIWYG cannot hold either - opening it there rewrote the tables into
    // Tiptap's own model and flattened the button into a bare link - so the
    // source view is where it opens, and the rich button is refused rather
    // than merely unselected.
    const layout =
      '<table><tbody><tr><td style="text-align: center">' +
      '<a href="https://example.test" style="background: #2aabee; padding: 8px">Register</a>' +
      "</td></tr></tbody></table>";
    await show([setting({ value: layout })]);

    const source = screen.getByLabelText("Welcome text");
    expect(source.tagName).toBe("TEXTAREA");
    expect((source as HTMLTextAreaElement).value).toBe(layout);
    expect(screen.queryByTestId("rich-text")).toBeNull();

    const rich = screen.getByRole("button", { name: "Rich text" });
    expect((rich as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(rich);
    expect(screen.queryByTestId("rich-text")).toBeNull();
  });

  it("offers both ways round when the editor can hold the document", async () => {
    await show([setting({ value: "<p>cozy corner</p>" })]);

    expect(screen.getByTestId("rich-text")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));

    const source = screen.getByLabelText("Welcome text");
    expect(source.tagName).toBe("TEXTAREA");
    expect((source as HTMLTextAreaElement).value).toBe("<p>cozy corner</p>");
  });

  it("shows a preview of a document it will not let the editor near", async () => {
    // The point of the tab: the source view is the only safe way to *edit* a
    // table-laid-out welcome screen, and angle brackets are no way to tell
    // whether a change landed where it was meant to.
    const layout =
      '<table><tbody><tr><td style="text-align: center"><h1>Welcome</h1></td></tr></tbody></table>';
    await show([setting({ value: layout })]);

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const preview = screen.getByLabelText("Preview of Welcome text");
    // Rendered, not printed: the heading is an element, and the tags are gone.
    expect(preview.querySelector("h1")?.textContent).toBe("Welcome");
    expect(preview.textContent).not.toContain("<h1>");
    // And still editable afterwards - a preview is a view, not a mode change.
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    expect((screen.getByLabelText("Welcome text") as HTMLTextAreaElement).value).toBe(layout);
  });

  it("previews through the same filter every client renders with", async () => {
    // Not an approximation of the welcome screen: what the sanitiser strips is
    // missing here too, which is worth learning before saving rather than from
    // a user afterwards.
    await show([setting({ value: '<p onclick="steal()">safe<script>bad()</script></p>' })]);

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const preview = screen.getByLabelText("Preview of Welcome text");
    expect(preview.textContent).toContain("safe");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("p")?.getAttribute("onclick")).toBeNull();
  });

  it("sends what was written, and nothing that was not touched", async () => {
    // Only the edited key goes up: the schema is the server's, and an untouched
    // field re-sent is a value racing whatever another admin just changed.
    await show([setting(), setting({ key: "max_users", label: "Maximum users", type: "int", value: "10" })]);

    fireEvent.change(screen.getByTestId("rich-text"), {
      target: { value: "<p>house rules</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      const save = invoke.mock.calls.find(([command]) => command === "save_server_settings");
      expect(save).toBeTruthy();
      const changed = (save?.[1] as { changed: ServerSetting[] }).changed;
      expect(changed).toHaveLength(1);
      expect(changed[0]?.key).toBe("welcome_text");
      expect(changed[0]?.value).toBe("<p>house rules</p>");
    });
  });
});
