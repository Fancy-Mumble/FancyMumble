import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS } from "@core/features/settings/shortcutHelpers";
import { shortcutLabel, useShortcutBindings } from "./shortcuts";

const { loadShortcutsMock } = vi.hoisted(() => ({ loadShortcutsMock: vi.fn() }));

vi.mock("@core/features/settings/shortcutHelpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/features/settings/shortcutHelpers")>()),
  loadShortcuts: loadShortcutsMock,
}));

afterEach(() => loadShortcutsMock.mockReset());

describe("shortcutLabel", () => {
  it("writes a binding the way the host platform does", () => {
    // jsdom reports a non-Apple user agent, so the modifiers stay spelled out.
    expect(shortcutLabel("Ctrl+Shift+F")).toBe("Ctrl+Shift+F");
  });

  it("has nothing to print for an unbound action", () => {
    expect(shortcutLabel("")).toBe("");
  });
});

describe("useShortcutBindings", () => {
  it("keeps the defaults when the store cannot be read", async () => {
    loadShortcutsMock.mockRejectedValue(new Error("no store"));
    const { result } = renderHook(() => useShortcutBindings());
    await waitFor(() => expect(loadShortcutsMock).toHaveBeenCalled());
    expect(result.current).toEqual(DEFAULT_SHORTCUTS);
  });

  it("re-reads the bindings when the Shortcuts page changes one", async () => {
    loadShortcutsMock.mockResolvedValue(DEFAULT_SHORTCUTS);
    const { result } = renderHook(() => useShortcutBindings());
    await waitFor(() => expect(result.current.openQuickSearch).toBe(DEFAULT_SHORTCUTS.openQuickSearch));

    loadShortcutsMock.mockResolvedValue({ ...DEFAULT_SHORTCUTS, openQuickSearch: "Ctrl+P" });
    act(() => {
      globalThis.dispatchEvent(new CustomEvent("shortcuts-changed"));
    });
    await waitFor(() => expect(result.current.openQuickSearch).toBe("Ctrl+P"));
  });
});
