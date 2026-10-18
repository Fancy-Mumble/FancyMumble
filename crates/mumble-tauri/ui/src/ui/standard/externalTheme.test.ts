import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: { payload: string | null }) => void;

const invokeMock = vi.fn();
let listener: Listener | null = null;

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: Listener) => {
    listener = handler;
    return Promise.resolve(() => undefined);
  },
}));

const STYLE_ID = "user-theme-override";
const LIGHT = ':root:root[data-theme="omarchy"] { --omarchy-mode: light; }';
const DARK = ':root:root[data-theme="omarchy"] { --omarchy-mode: dark; }';

function styleText(): string | null {
  return document.getElementById(STYLE_ID)?.textContent ?? null;
}

describe("external theme", () => {
  beforeEach(() => {
    vi.resetModules();
    listener = null;
    invokeMock.mockReset();
    document.documentElement.setAttribute("data-theme", "omarchy");
  });

  afterEach(() => {
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-omarchy-mode");
  });

  it("injects the CSS read at start-up", async () => {
    invokeMock.mockResolvedValue(DARK);
    const { bootstrapExternalTheme } = await import("./externalTheme");
    await bootstrapExternalTheme();
    expect(invokeMock).toHaveBeenCalledWith("get_user_theme_css");
    expect(styleText()).toBe(DARK);
  });

  it("injects nothing when no file exists", async () => {
    invokeMock.mockResolvedValue(null);
    const { bootstrapExternalTheme } = await import("./externalTheme");
    await bootstrapExternalTheme();
    expect(styleText()).toBeNull();
  });

  it("follows changes, reuses one style tag, and removes it on null", async () => {
    invokeMock.mockResolvedValue(DARK);
    const { bootstrapExternalTheme } = await import("./externalTheme");
    await bootstrapExternalTheme();

    listener?.({ payload: LIGHT });
    expect(styleText()).toBe(LIGHT);
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);

    listener?.({ payload: null });
    expect(styleText()).toBeNull();
  });

  it("mirrors --omarchy-mode to data-omarchy-mode", async () => {
    invokeMock.mockResolvedValue(LIGHT);
    const { bootstrapExternalTheme } = await import("./externalTheme");
    await bootstrapExternalTheme();
    expect(document.documentElement.getAttribute("data-omarchy-mode")).toBe("light");

    listener?.({ payload: DARK });
    expect(document.documentElement.hasAttribute("data-omarchy-mode")).toBe(false);
  });
});
