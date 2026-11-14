/**
 * Where the plugin-store files go for a client started with
 * `FANCY_E2E_DATA_DIR`.
 *
 * The bug: only a harness that had already written a localStorage key could
 * move the stores, so a test instance read the user's saved servers on its
 * first page (and pinged them).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let backendDir: string | null = null;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => Promise.resolve(cmd === "isolated_store_dir" ? backendDir : undefined),
}));

const loaded: string[] = [];
vi.mock("@tauri-apps/plugin-store", () => ({
  load: (path: string) => {
    loaded.push(path);
    return Promise.resolve({});
  },
}));

import { E2E_DATA_DIR_KEY, _resetIsolatedStoreDirForTests, load, storePath } from "../store";
import { E2E_FLAG_KEY } from "../e2e";

beforeEach(() => {
  loaded.length = 0;
  backendDir = null;
  _resetIsolatedStoreDirForTests();
  localStorage.clear();
});

describe("store isolation", () => {
  it("puts every store under the directory the backend names, from the first read", async () => {
    backendDir = "C:\\e2e\\one\\store\\";
    await load("servers.json");
    await load("preferences.json");
    expect(loaded).toEqual(["C:\\e2e\\one\\store/servers.json", "C:\\e2e\\one\\store/preferences.json"]);
  });

  it("leaves the stores where they were when nothing isolates the client", async () => {
    await load("servers.json");
    expect(loaded).toEqual(["servers.json"]);
  });

  it("still honours the harness's key when the backend names nothing", () => {
    localStorage.setItem(E2E_FLAG_KEY, "1");
    localStorage.setItem(E2E_DATA_DIR_KEY, "/tmp/e2e/store");
    expect(storePath(null, "servers.json")).toBe("/tmp/e2e/store/servers.json");
    expect(storePath("/isolated", "servers.json")).toBe("/isolated/servers.json");
  });
});
