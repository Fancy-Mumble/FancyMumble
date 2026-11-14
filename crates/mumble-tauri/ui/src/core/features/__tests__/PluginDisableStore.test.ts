/**
 * Regression tests for `recordPluginDisabled` - the store action that reacts to
 * a host `PluginDeactivated` broadcast by dropping the plugin from the registry,
 * clearing its feature state, logging an activity entry, and (when a view is
 * open) raising the plugin-disabled dialog notice.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../../store";
import { PLUGIN_NAME_FILE_SERVER, PLUGIN_NAME_LIVE_DOC } from "../../constants/pluginData";
import type { FileServerConfig, PluginInfoRecord } from "../../types";

function pluginInfo(name: string): PluginInfoRecord {
  return { name, version: "1.0.0", info: { author: "test" } };
}

const fileServerConfig = {
  baseUrl: "http://fs",
  internalBaseUrl: "http://fs",
  sessionId: 1,
  uploadToken: "tok",
  sessionJwt: "jwt",
  maxFileSizeBytes: 1024,
  deleteOnTtl: false,
  ttlSeconds: 0,
  deleteOnDownload: false,
  deleteOnDisconnect: false,
  canManageEmotes: true,
  canShareFiles: true,
  canShareFilesPublic: true,
  registered: true,
} as FileServerConfig;

describe("recordPluginDisabled", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it("drops the file-server from the registry and clears its state + logs it", () => {
    useAppStore.setState({
      pluginInfos: new Map([[PLUGIN_NAME_FILE_SERVER, pluginInfo(PLUGIN_NAME_FILE_SERVER)]]),
      fileServerConfig,
      fileServerAdminOpen: false,
      serverLog: [],
    });

    useAppStore.getState().recordPluginDisabled(PLUGIN_NAME_FILE_SERVER);

    const s = useAppStore.getState();
    expect(s.pluginInfos.has(PLUGIN_NAME_FILE_SERVER)).toBe(false);
    expect(s.fileServerConfig).toBeNull();
    expect(s.fileServerCapabilities).toBeNull();
    expect(s.serverLog.length).toBe(1);
    // No open admin view -> no dialog notice.
    expect(s.pluginDisabledNotice).toBeNull();
  });

  it("raises the dialog notice when the admin file-server view is open", () => {
    useAppStore.setState({
      pluginInfos: new Map([[PLUGIN_NAME_FILE_SERVER, pluginInfo(PLUGIN_NAME_FILE_SERVER)]]),
      fileServerConfig,
      fileServerAdminOpen: true,
    });

    useAppStore.getState().recordPluginDisabled(PLUGIN_NAME_FILE_SERVER);

    expect(useAppStore.getState().pluginDisabledNotice).toEqual({ name: PLUGIN_NAME_FILE_SERVER });
  });

  it("raises the notice for live-doc only when a document is open", () => {
    useAppStore.setState({
      pluginInfos: new Map([[PLUGIN_NAME_LIVE_DOC, pluginInfo(PLUGIN_NAME_LIVE_DOC)]]),
    });
    useAppStore.getState().recordPluginDisabled(PLUGIN_NAME_LIVE_DOC);
    expect(useAppStore.getState().pluginInfos.has(PLUGIN_NAME_LIVE_DOC)).toBe(false);
    expect(useAppStore.getState().pluginDisabledNotice).toBeNull();
  });

  it("dismissing the notice closes any open live docs", () => {
    useAppStore.setState({
      activeLiveDocs: new Map([["k", { channelId: 1 } as never]]),
      pluginDisabledNotice: { name: PLUGIN_NAME_LIVE_DOC },
    });
    useAppStore.getState().dismissPluginDisabledNotice();
    const s = useAppStore.getState();
    expect(s.pluginDisabledNotice).toBeNull();
    expect(s.activeLiveDocs.size).toBe(0);
  });
});
