/**
 * Which design pack a profile opens in.
 *
 * Nebula is the default, and it is a default for *new* profiles. An install
 * whose stored record predates the setting has been running Standard all
 * along, and an update must not move a settled user to another interface, so
 * a record with no `uiDesign` keeps Standard rather than picking up today's
 * default. `getPreferences` caches its first read, so every case here loads
 * the module afresh.
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

describe("the design a profile opens in", () => {
  beforeEach(() => {
    storeData = {};
  });

  it("starts a profile with nothing stored in Nebula", async () => {
    expect((await freshlyReadPreferences()).uiDesign).toBe("nebula");
  });

  it("keeps Standard for a record written before the setting existed", async () => {
    // What an older install has on disk: a preferences record, no `uiDesign`.
    storeData.preferences = { userMode: "normal", hasCompletedSetup: true, defaultUsername: "ada" };
    expect((await freshlyReadPreferences()).uiDesign).toBe("standard");
  });

  it("honours a stored choice, including a deliberate Standard", async () => {
    storeData.preferences = { uiDesign: "aurora", hasCompletedSetup: true };
    expect((await freshlyReadPreferences()).uiDesign).toBe("aurora");
    storeData.preferences = { uiDesign: "standard", hasCompletedSetup: true };
    expect((await freshlyReadPreferences()).uiDesign).toBe("standard");
  });

  it("still fills in the other defaults around a partial record", async () => {
    storeData.preferences = { uiDesign: "nebula" };
    const prefs = await freshlyReadPreferences();
    expect(prefs.userMode).toBe("normal");
    expect(prefs.hasCompletedSetup).toBe(false);
  });
});
