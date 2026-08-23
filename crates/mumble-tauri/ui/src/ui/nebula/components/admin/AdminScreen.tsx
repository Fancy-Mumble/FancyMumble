import { useEffect, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { AclAdmin } from "./AclAdmin";
import { AuditAdmin } from "./AuditAdmin";
import { BansAdmin } from "./BansAdmin";
import { EmotesAdmin } from "./EmotesAdmin";
import { FileServerAdmin } from "./FileServerAdmin";
import { LiveryAdmin } from "./LiveryAdmin";
import { MarketplaceAdmin } from "./MarketplaceAdmin";
import { MarketplacePluginPage } from "./MarketplacePluginPage";
import { OnboardingAdmin } from "./OnboardingAdmin";
import { RolesAdmin } from "./RolesAdmin";
import { ServerPluginsAdmin } from "./ServerPluginsAdmin";
import { ServerSettingsAdmin } from "./ServerSettingsAdmin";
import { UsersAdmin } from "./UsersAdmin";
import { ADMIN_PAGES, type AdminCapabilities, type AdminPageId } from "./capabilities";

/**
 * The administration content area.
 *
 * A page whose gate closes underneath it - the file-server plugin disabled at
 * runtime, a demotion - redirects to Users rather than rendering a surface the
 * server will refuse every call from.
 */
export function AdminScreen({
  page,
  capabilities,
  onNavigate,
  /** A listing to open straight away, from a `fancy://marketplace/plugin/…` link. */
  marketplacePluginId,
  aclChannelId,
}: Readonly<{
  page: AdminPageId;
  capabilities: AdminCapabilities;
  onNavigate: (page: AdminPageId) => void;
  marketplacePluginId?: string;
  /** A channel to open the permissions page on, from its context menu. */
  aclChannelId?: number | null;
}>) {
  const entry = ADMIN_PAGES.find((candidate) => candidate.id === page);
  const allowed = entry?.available(capabilities) ?? false;
  // The role a user's chip was clicked from, so Users can hand off to Roles
  // with that role already open rather than dropping the reader at the list.
  const [initialRole, setInitialRole] = useState<string | null>(null);
  // Which listing the Marketplace page is showing, if any. A deep link seeds
  // it; clicking a card sets it; Back clears it.
  const [openPlugin, setOpenPlugin] = useState<string | null>(marketplacePluginId ?? null);
  useEffect(() => {
    if (marketplacePluginId) setOpenPlugin(marketplacePluginId);
  }, [marketplacePluginId]);

  useEffect(() => {
    if (!allowed) onNavigate("users");
  }, [allowed, onNavigate]);

  let content: ReactNode = null;
  if (allowed) {
    switch (page) {
      case "users":
        content = (
          <UsersAdmin
            onOpenRole={(role) => {
              setInitialRole(role);
              onNavigate("roles");
            }}
          />
        );
        break;
      case "roles":
        content = <RolesAdmin initialRole={initialRole} />;
        break;
      case "bans":
        content = <BansAdmin />;
        break;
      case "acl":
        content = <AclAdmin initialChannel={aclChannelId} />;
        break;
      case "emotes":
        content = <EmotesAdmin />;
        break;
      case "onboarding":
        content = <OnboardingAdmin />;
        break;
      case "serverPlugins":
        content = <ServerPluginsAdmin />;
        break;
      case "marketplace":
        content =
          openPlugin !== null ? (
            <MarketplacePluginPage pluginId={openPlugin} onBack={() => setOpenPlugin(null)} />
          ) : (
            <MarketplaceAdmin onOpenPlugin={setOpenPlugin} />
          );
        break;
      case "fileServer":
        content = <FileServerAdmin />;
        break;
      case "serverSettings":
        content = <ServerSettingsAdmin />;
        break;
      case "livery":
        content = <LiveryAdmin />;
        break;
      case "auditLog":
        content = <AuditAdmin />;
        break;
    }
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: "52px", py: "38px" }}>{content}</Box>
  );
}
