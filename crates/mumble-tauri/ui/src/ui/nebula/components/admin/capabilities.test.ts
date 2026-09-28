import { describe, expect, it } from "vitest";
import { fancyVersionEncode } from "@core/utils/version";
import {
  ADMIN_PAGES,
  FANCY_PROTOCOL_EPOCH,
  isAuditLogSupported,
  isPluginAdminSupported,
  type AdminCapabilities,
} from "./capabilities";

const NOTHING: AdminCapabilities = {
  canAdminister: false,
  canManageEmotes: false,
  canManageFileServer: false,
  canViewAudit: false,
  onboardingSupported: false,
};

const ADMIN: AdminCapabilities = { ...NOTHING, canAdminister: true };

const visible = (capabilities: AdminCapabilities) =>
  ADMIN_PAGES.filter((page) => page.available(capabilities)).map((page) => page.id);

describe("admin page gating", () => {
  it("offers nothing at all without Write on the root channel", () => {
    expect(visible(NOTHING)).toEqual([]);
  });

  it("offers the core pages to an administrator", () => {
    expect(visible(ADMIN)).toEqual([
      "users",
      "roles",
      "bans",
      "acl",
      "serverPlugins",
      "marketplace",
      "serverSettings",
      "livery",
      "welcome",
    ]);
  });

  it("gates emotes on the file server's feature flag, not on being an admin", () => {
    expect(visible(ADMIN)).not.toContain("emotes");
    expect(visible({ ...ADMIN, canManageEmotes: true })).toContain("emotes");
    // The capability hook already folds the permission in, so the flag alone
    // is what this entry asks about.
    expect(visible({ ...NOTHING, canManageEmotes: true })).toContain("emotes");
  });

  it("needs both onboarding support and admin rights for the onboarding editor", () => {
    expect(visible({ ...ADMIN, onboardingSupported: true })).toContain("onboarding");
    expect(visible({ ...NOTHING, onboardingSupported: true })).not.toContain("onboarding");
  });

  it("shows the file server and audit pages only once their own gate opens", () => {
    expect(visible({ ...ADMIN, canManageFileServer: true })).toContain("fileServer");
    expect(visible({ ...ADMIN, canViewAudit: true })).toContain("auditLog");
  });
});

describe("isPluginAdminSupported", () => {
  it("needs a server version of at least 0.4.0", () => {
    expect(isPluginAdminSupported(fancyVersionEncode(0, 3, 9))).toBe(false);
    expect(isPluginAdminSupported(fancyVersionEncode(0, 4, 0))).toBe(true);
  });

  it("treats an unknown version as unsupported", () => {
    expect(isPluginAdminSupported(null)).toBe(false);
    expect(isPluginAdminSupported(undefined)).toBe(false);
  });
});

describe("isAuditLogSupported", () => {
  it("accepts an epoch-1 server that announces no version at all", () => {
    // Starling deliberately announces the epoch and no version; gating on the
    // version alone hid this page from it for ever.
    expect(isAuditLogSupported(null, FANCY_PROTOCOL_EPOCH)).toBe(true);
  });

  it("falls back to the product version for an epoch-0 server", () => {
    expect(isAuditLogSupported(fancyVersionEncode(0, 4, 1), 0)).toBe(false);
    expect(isAuditLogSupported(fancyVersionEncode(0, 4, 2), 0)).toBe(true);
  });

  it("refuses when neither the epoch nor a new enough version is known", () => {
    expect(isAuditLogSupported(null, null)).toBe(false);
    expect(isAuditLogSupported(undefined)).toBe(false);
  });
});
