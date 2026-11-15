import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { pickedFile, resolvePickedFile } from "./pickedFile";

describe("resolvePickedFile", () => {
  beforeEach(() => invokeMock.mockReset());

  it("names a desktop path by its last segment and asks the backend nothing", async () => {
    await expect(resolvePickedFile("C:\\pics\\cat.png")).resolves.toEqual({
      filePath: "C:\\pics\\cat.png",
      filename: "cat.png",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("has the backend make a content address into a named file", async () => {
    const copy = { filePath: "/data/cache/picked/1/12544025.png", filename: "12544025.png" };
    invokeMock.mockResolvedValueOnce(copy);
    const uri = "content://com.android.providers.media.documents/document/image%3A1000000020";
    await expect(resolvePickedFile(uri)).resolves.toEqual(copy);
    expect(invokeMock).toHaveBeenCalledWith("resolve_picked_file", { path: uri });
  });

  it("keeps naming a dropped path the way it always did", () => {
    expect(pickedFile("/home/a/dog.jpg")).toEqual({ filePath: "/home/a/dog.jpg", filename: "dog.jpg" });
  });
});
