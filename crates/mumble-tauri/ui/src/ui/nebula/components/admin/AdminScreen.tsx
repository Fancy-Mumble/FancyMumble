import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { ADMIN_PAGES, type AdminCapabilities, type AdminPageId } from "./capabilities";

/**
 * One chunk per page.
 *
 * These are the heaviest screens in the client - the ACL editor, the audit
 * log with its query parser and chart, the marketplace - and an operator
 * opening one of them has no use for the other twelve. Imported together
 * they were a single 186 kB download that every visit to administration
 * paid in full, whichever page it was for.
 */
const AclAdmin = lazy(() => import("./AclAdmin").then((m) => ({ default: m.AclAdmin })));
const AuditAdmin = lazy(() => import("./AuditAdmin").then((m) => ({ default: m.AuditAdmin })));
const BansAdmin = lazy(() => import("./BansAdmin").then((m) => ({ default: m.BansAdmin })));
const EmotesAdmin = lazy(() => import("./EmotesAdmin").then((m) => ({ default: m.EmotesAdmin })));
const FileServerAdmin = lazy(() => import("./FileServerAdmin").then((m) => ({ default: m.FileServerAdmin })));
const LiveryAdmin = lazy(() => import("./LiveryAdmin").then((m) => ({ default: m.LiveryAdmin })));
const MarketplaceAdmin = lazy(() =>
  import("./MarketplaceAdmin").then((m) => ({ default: m.MarketplaceAdmin })),
);
const MarketplacePluginPage = lazy(() =>
  import("./MarketplacePluginPage").then((m) => ({ default: m.MarketplacePluginPage })),
);
const OnboardingAdmin = lazy(() => import("./OnboardingAdmin").then((m) => ({ default: m.OnboardingAdmin })));
const RolesAdmin = lazy(() => import("./RolesAdmin").then((m) => ({ default: m.RolesAdmin })));
const ServerPluginsAdmin = lazy(() =>
  import("./ServerPluginsAdmin").then((m) => ({ default: m.ServerPluginsAdmin })),
);
const ServerSettingsAdmin = lazy(() =>
  import("./ServerSettingsAdmin").then((m) => ({ default: m.ServerSettingsAdmin })),
);
const UsersAdmin = lazy(() => import("./UsersAdmin").then((m) => ({ default: m.UsersAdmin })));
const WelcomeAdmin = lazy(() => import("./WelcomeAdmin").then((m) => ({ default: m.WelcomeAdmin })));

/**
 * Pages whose own surface reaches the edges of the pane.
 *
 * Both draw a node canvas, which is a room rather than a card in one. The
 * onboarding page has a second, prose-shaped view as well, so it pads that one
 * itself - the pane cannot know which of the two is showing.
 */
const FULL_BLEED: readonly AdminPageId[] = ["welcome", "onboarding"];

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
      case "welcome":
        content = <WelcomeAdmin />;
        break;
      case "auditLog":
        content = <AuditAdmin />;
        break;
    }
  }

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        // A column, so a page can opt into filling the pane (`AdminPage fill`)
        // and hand the leftover height to a table that scrolls under a pinned
        // header instead of scrolling the whole pane out from under it.
        display: "flex",
        flexDirection: "column",
        // A page that draws its own canvas gets the pane exactly, and pads
        // its own bars: a margin here would frame the canvas in a lighter
        // panel, which is the one thing a full-bleed surface must not do.
        // The reading pages keep the wide margin that makes prose legible.
        px: FULL_BLEED.includes(page) ? 0 : "52px",
        py: FULL_BLEED.includes(page) ? 0 : "38px",
      }}
    >
      <Suspense fallback={null}>{content}</Suspense>
    </Box>
  );
}
