/**
 * The audit search combobox: the dropdown appears on focus, tracks the caret
 * context, accepts by keyboard (↓ + Enter / Tab) and mouse, splices the token
 * under the caret, and only runs the search when Enter fires with nothing
 * highlighted.
 */

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryAutocomplete } from "../QueryAutocomplete";
import type { AuditSuggestContext } from "@core/features/admin/auditSuggest";
import { TID } from "@core/testids";

const context: AuditSuggestContext = {
  categories: ["ban", "kick"],
  userNames: ["mod3"],
  channels: [{ id: 4, name: "Lobby" }],
};

/** Controlled harness (the real parent owns `value`). */
function Harness({
  onRun = vi.fn(),
  onCommit = vi.fn(),
  initial = "",
}: {
  onRun?: () => void;
  onCommit?: (t: string) => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QueryAutocomplete
      value={value}
      onChange={setValue}
      onCommit={onCommit}
      onRun={onRun}
      context={context}
      placeholder="search"
    />
  );
}

const input = () => screen.getByTestId(TID.auditQueryInput) as HTMLInputElement;
const listbox = () => screen.queryByTestId(TID.auditQuerySuggestions);

describe("QueryAutocomplete", () => {
  it("hides the dropdown until focused, then lists fields", () => {
    render(<Harness />);
    expect(listbox()).toBeNull();
    fireEvent.focus(input());
    const items = within(screen.getByTestId(TID.auditQuerySuggestions)).getAllByTestId(
      TID.auditQuerySuggestionItem,
    );
    expect(items[0].textContent).toContain("category");
  });

  it("filters to the matching field as you type", () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "sev" } });
    const items = within(screen.getByTestId(TID.auditQuerySuggestions)).getAllByTestId(
      TID.auditQuerySuggestionItem,
    );
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("severity");
  });

  it("accepts the highlighted suggestion with ↓ then Enter (does not run)", () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "cat" } });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input().value).toBe("category ");
    expect(onRun).not.toHaveBeenCalled();
  });

  it("chains field → operator → value by keyboard", () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "source" } });
    fireEvent.keyDown(input(), { key: "ArrowDown" }); // source
    fireEvent.keyDown(input(), { key: "Tab" }); // -> "source "
    expect(input().value).toBe("source ");
    // operator context now offered
    fireEvent.keyDown(input(), { key: "ArrowDown" }); // =
    fireEvent.keyDown(input(), { key: "Tab" }); // -> "source = "
    expect(input().value).toBe("source = ");
    // value context: first value is "server"
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(input().value).toBe("source = server ");
  });

  it("accepts on mouse click, splicing the token", () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "sev" } });
    const item = within(screen.getByTestId(TID.auditQuerySuggestions)).getAllByTestId(
      TID.auditQuerySuggestionItem,
    )[0];
    fireEvent.mouseDown(item);
    expect(input().value).toBe("severity ");
  });

  it("runs the search on Enter when nothing is highlighted", () => {
    const onRun = vi.fn();
    const onCommit = vi.fn();
    render(<Harness onRun={onRun} onCommit={onCommit} initial="source = client " />);
    fireEvent.focus(input());
    // `and` is offered but not highlighted (active = -1) -> Enter runs.
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("source = client ");
  });

  it("dismisses the dropdown on Escape", () => {
    render(<Harness />);
    fireEvent.focus(input());
    expect(listbox()).not.toBeNull();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(listbox()).toBeNull();
  });
});
