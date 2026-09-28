import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withNebulaTheme } from "../../testTheme";
import { FirstRunSetup } from "./FirstRunSetup";

const invoke = vi.fn().mockResolvedValue({ total_memory_mb: 32_768, cpu_cores: 16 });
const completeSetup = vi.fn().mockResolvedValue(undefined);
const savePersonalization = vi.fn().mockResolvedValue(undefined);
const applyTheme = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@core/preferencesStorage", () => ({
  completeSetup: (...args: unknown[]) => completeSetup(...args),
}));
vi.mock("@standard/personalizationStorage", () => ({
  loadPersonalization: () => Promise.resolve({ theme: "dark" }),
  savePersonalization: (...args: unknown[]) => savePersonalization(...args),
}));
vi.mock("@standard/themes", () => ({
  applyTheme: (...args: unknown[]) => applyTheme(...args),
  THEMES: [
    { id: "dark", label: "Dark", swatches: ["#000", "#111"] },
    { id: "rose", label: "Rose", swatches: ["#1a0f14", "#f472b6"] },
  ],
}));

function draw(onComplete = vi.fn()) {
  render(withNebulaTheme(<FirstRunSetup onComplete={onComplete} />));
  return onComplete;
}

/** Walk the wizard to its last step with a name filled in. */
function fillToReady(name = "Sebastian") {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
}

describe("FirstRunSetup", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    invoke.mockResolvedValue({ total_memory_mb: 32_768, cpu_cores: 16 });
  });

  afterEach(() => cleanup());

  it("will not leave the identity step without a name", () => {
    draw();
    const next = screen.getByRole("button", { name: /next/i }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Sebastian" } });
    expect((screen.getByRole("button", { name: /next/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("previews a theme as it is picked rather than only on finish", async () => {
    draw();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Sebastian" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    fireEvent.click(screen.getByRole("radio", { name: "Rose" }));
    expect(applyTheme).toHaveBeenCalledWith("rose");
  });

  it("writes the name, the mode and the theme, then hands back", async () => {
    const onComplete = draw();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Sebastian  " } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("radio", { name: /advanced|expert/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Rose" }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // Trimmed: the name is what a server will be asked for.
    expect(completeSetup).toHaveBeenCalledWith("expert", "Sebastian");
    expect(savePersonalization).toHaveBeenCalledWith({ theme: "rose" });
    expect(invoke).toHaveBeenCalledWith("generate_certificate", { label: "default" });
  });

  it("still completes when the certificate cannot be generated", async () => {
    invoke.mockImplementation((command: string) =>
      command === "generate_certificate"
        ? Promise.reject(new Error("no keystore"))
        : Promise.resolve({ total_memory_mb: 32_768, cpu_cores: 16 }),
    );
    const onComplete = draw();
    fillToReady();
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(completeSetup).toHaveBeenCalled();
  });

  it("leaves capable hardware alone rather than offering minimal mode", async () => {
    draw();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_system_specs"));
    expect(invoke).not.toHaveBeenCalledWith("relaunch_in_minimal_mode");
  });
});
