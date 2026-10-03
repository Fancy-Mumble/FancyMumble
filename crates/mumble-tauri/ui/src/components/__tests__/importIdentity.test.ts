/**
 * importIdentity: picks an exported `.fmid` file and hands whatever the
 * picker returned (a path on desktop, a `content://` URI on Android)
 * straight to the backend.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
const openMock = vi.fn<(opts: unknown) => Promise<string | null>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (opts: unknown) => openMock(opts),
}));

import { importIdentity } from "../../utils/importIdentity";

describe("importIdentity", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
  });

  it("returns null without importing when the picker is cancelled", async () => {
    openMock.mockResolvedValue(null);

    await expect(importIdentity()).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("passes an Android content URI to the backend unchanged", async () => {
    const uri = "content://com.android.providers.downloads.documents/document/42";
    openMock.mockResolvedValue(uri);
    invokeMock.mockResolvedValue("me");

    await expect(importIdentity()).resolves.toBe("me");
    expect(invokeMock).toHaveBeenCalledWith("import_certificate", { srcPath: uri });
  });

  it("propagates backend errors", async () => {
    openMock.mockResolvedValue("C:/me.fmid");
    invokeMock.mockRejectedValue("Invalid identity file: expected value");

    await expect(importIdentity()).rejects.toBe("Invalid identity file: expected value");
  });
});
