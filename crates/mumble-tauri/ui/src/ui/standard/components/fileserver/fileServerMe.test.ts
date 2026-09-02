import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@core/store";
import type { FileServerConfig } from "@core/types";
import { myFileLinkSupported, myFilesAvailable } from "./fileServerMe";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

/** The plugin's config: a real HTTP endpoint and a JWT to scope it with. */
function pluginConfig(overrides: Partial<FileServerConfig> = {}): FileServerConfig {
  return {
    baseUrl: "https://files.example.org",
    sessionJwt: "jwt-token",
    ...overrides,
  } as FileServerConfig;
}

/**
 * The canon's config, as `canonFileServerConfig` builds it: sharing is on and
 * both HTTP credentials are blank, because the handshake is the backend's.
 */
function canonConfig(): FileServerConfig {
  return { baseUrl: "", sessionJwt: "", canShareFiles: true } as FileServerConfig;
}

describe("whether my shared files can work here", () => {
  beforeEach(() => useAppStore.setState({ fileServerKind: null } as never));

  it("is available on a canon server despite it carrying no credentials", () => {
    // The bug this pins: gating on baseUrl/sessionJwt read a working canon
    // file server as an absent one, and the panel said sharing was disabled.
    expect(myFilesAvailable("canon", canonConfig())).toBe(true);
  });

  it("is available on a plugin server that handed over both credentials", () => {
    expect(myFilesAvailable("plugin", pluginConfig())).toBe(true);
  });

  it("is unavailable on a plugin server still missing its session JWT", () => {
    expect(myFilesAvailable("plugin", pluginConfig({ sessionJwt: "" }))).toBe(false);
  });

  it("is unavailable with no file server at all", () => {
    expect(myFilesAvailable("plugin", null)).toBe(false);
    expect(myFilesAvailable(null, null)).toBe(false);
  });

  it("offers a browser-openable link only where one exists", () => {
    // A canon share is served over the control connection, so there is no
    // signed URL a browser could open on its own.
    expect(myFileLinkSupported("canon")).toBe(false);
    expect(myFileLinkSupported("plugin")).toBe(true);
  });
});
