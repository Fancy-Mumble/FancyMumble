/**
 * Edit Server: the identity dropdown offers "Import identity..." so a user
 * can bring an exported identity onto a device (e.g. Android) and use it
 * for this server without going through Settings first.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SavedServer } from "../../types";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
const importIdentityMock = vi.fn<() => Promise<string | null>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

vi.mock("../../utils/importIdentity", () => ({
  importIdentity: () => importIdentityMock(),
}));

vi.mock("../../serverStorage", () => ({
  getServerPassword: vi.fn().mockResolvedValue(null),
  setServerPassword: vi.fn().mockResolvedValue(undefined),
}));

import ServerEditSheet from "../server/ServerEditSheet";

const server: SavedServer = {
  id: "s1",
  label: "Home",
  host: "voice.example.com",
  port: 64738,
  username: "me",
  cert_label: "default",
};

let certs: string[];

function renderSheet() {
  const onSave = vi.fn();
  render(<ServerEditSheet server={server} onSave={onSave} onClose={vi.fn()} />);
  return { onSave };
}

async function identitySelect(): Promise<HTMLSelectElement> {
  const select = screen.getByLabelText("Identity") as HTMLSelectElement;
  await waitFor(() =>
    expect([...select.options].map((o) => o.value)).toEqual(expect.arrayContaining(certs)),
  );
  return select;
}

describe("ServerEditSheet identity import", () => {
  beforeEach(() => {
    certs = ["default"];
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd) => (cmd === "list_certificates" ? certs : undefined));
    importIdentityMock.mockReset();
  });

  it("offers an import option", async () => {
    renderSheet();
    const select = await identitySelect();

    expect([...select.options].map((o) => o.text)).toContain("+ Import identity…");
  });

  it("selects the imported identity and saves it for the server", async () => {
    importIdentityMock.mockImplementation(async () => {
      certs = ["default", "desktop"];
      return "desktop";
    });
    const { onSave } = renderSheet();
    const select = await identitySelect();

    fireEvent.change(select, { target: { value: "__import__" } });

    await waitFor(() => expect(select.value).toBe("desktop"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("s1", expect.objectContaining({ cert_label: "desktop" })),
    );
  });

  it("keeps the current identity when the picker is cancelled", async () => {
    importIdentityMock.mockResolvedValue(null);
    renderSheet();
    const select = await identitySelect();

    fireEvent.change(select, { target: { value: "__import__" } });

    await waitFor(() => expect(importIdentityMock).toHaveBeenCalled());
    expect(select.value).toBe("default");
  });

  it("shows the error when the import fails", async () => {
    importIdentityMock.mockRejectedValue("Invalid identity file: expected value");
    renderSheet();
    const select = await identitySelect();

    fireEvent.change(select, { target: { value: "__import__" } });

    expect(await screen.findByText("Invalid identity file: expected value")).toBeTruthy();
    expect(select.value).toBe("default");
  });
});
