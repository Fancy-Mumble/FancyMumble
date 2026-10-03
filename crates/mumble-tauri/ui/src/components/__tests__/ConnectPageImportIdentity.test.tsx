/**
 * Connect wizard: the client-certificate dropdown offers "Import identity..."
 * so a fresh install (e.g. Android) can connect with an identity exported
 * from another device instead of a newly generated one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
const importIdentityMock = vi.fn<() => Promise<string | null>>();
const connectMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

vi.mock("../../utils/importIdentity", () => ({
  importIdentity: () => importIdentityMock(),
}));

vi.mock("../../store", () => ({
  useAppStore: () => ({
    connect: connectMock,
    disconnect: vi.fn(),
    status: "disconnected",
    error: null,
    passwordRequired: false,
    pendingConnect: null,
    retryWithPassword: vi.fn(),
    dismissPasswordPrompt: vi.fn(),
    bootstrapStage: null,
  }),
}));

vi.mock("../../serverStorage", () => ({
  getSavedServers: vi.fn().mockResolvedValue([]),
  addServer: vi.fn(async (s: object) => ({ id: "new", ...s })),
  removeServer: vi.fn(),
  updateServer: vi.fn(),
  getServerPassword: vi.fn().mockResolvedValue(null),
  setServerPassword: vi.fn(),
}));

vi.mock("../../preferencesStorage", () => ({
  getPreferences: vi.fn().mockResolvedValue({ userMode: "expert", defaultUsername: "me" }),
}));

import ConnectPage from "../../pages/ConnectPage";

let certs: string[];

async function certificateSelect(): Promise<HTMLSelectElement> {
  const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
  await waitFor(() =>
    expect([...select.options].map((o) => o.value)).toEqual(expect.arrayContaining(certs)),
  );
  return select;
}

describe("ConnectPage identity import", () => {
  beforeEach(() => {
    certs = ["default"];
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd) => (cmd === "list_certificates" ? certs : undefined));
    importIdentityMock.mockReset();
    connectMock.mockReset();
  });

  it("offers an import option", async () => {
    render(<ConnectPage />);
    const select = await certificateSelect();

    expect([...select.options].map((o) => o.text)).toContain("+ Import identity…");
  });

  it("selects the imported identity", async () => {
    importIdentityMock.mockImplementation(async () => {
      certs = ["default", "desktop"];
      return "desktop";
    });
    render(<ConnectPage />);
    const select = await certificateSelect();

    fireEvent.change(select, { target: { value: "__import__" } });

    await waitFor(() => expect(select.value).toBe("desktop"));
  });

  it("shows the error and keeps the current identity when the import fails", async () => {
    importIdentityMock.mockRejectedValue("Invalid identity file: expected value");
    render(<ConnectPage />);
    const select = await certificateSelect();

    fireEvent.change(select, { target: { value: "__import__" } });

    expect(await screen.findByText("Invalid identity file: expected value")).toBeTruthy();
    expect(select.value).toBe("default");
  });
});
