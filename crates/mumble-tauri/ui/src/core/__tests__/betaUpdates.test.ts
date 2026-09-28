/**
 * The release channel a profile follows.
 *
 * Beta is strictly opt-in: an install that has never seen the setting must
 * stay on stable, including one whose stored record predates it. The flag is
 * also what the Rust updater reads straight off disk before the webview
 * boots, so what `getPreferences` resolves here is exactly what decides
 * whether the beta manifest is fetched at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory store backing for the mock, same shape as the real store file.
let storeData: Record<string, unknown> = {};

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockImplementation(() =>
    Promise.resolve({
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(storeData[key] ?? null)),
      set: vi.fn().mockImplementation((key: string, value: unknown) => {
        storeData[key] = value;
        return Promise.resolve();
      }),
    }),
  ),
}));

async function freshlyReadPreferences() {
  vi.resetModules();
  const storage = await import("../preferencesStorage");
  return storage.getPreferences();
}

describe("the release channel a profile follows", () => {
  beforeEach(() => {
    storeData = {};
  });

  it("starts a profile on stable", async () => {
    expect((await freshlyReadPreferences()).betaUpdates).toBe(false);
  });

  it("keeps stable for a record written before the setting existed", async () => {
    storeData.preferences = { autoUpdateOnStartup: true, hasCompletedSetup: true };
    expect((await freshlyReadPreferences()).betaUpdates).toBe(false);
  });

  it("honours an explicit opt-in and opt-out", async () => {
    storeData.preferences = { betaUpdates: true, hasCompletedSetup: true };
    expect((await freshlyReadPreferences()).betaUpdates).toBe(true);
    storeData.preferences = { betaUpdates: false, hasCompletedSetup: true };
    expect((await freshlyReadPreferences()).betaUpdates).toBe(false);
  });

  it("leaves the other updater preferences alone", async () => {
    storeData.preferences = { betaUpdates: true };
    const prefs = await freshlyReadPreferences();
    expect(prefs.autoUpdateOnStartup).toBe(false);
    expect(prefs.skippedUpdateVersion).toBeNull();
  });
});
