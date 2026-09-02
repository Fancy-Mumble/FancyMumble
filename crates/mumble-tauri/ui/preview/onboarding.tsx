import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import { useAppStore } from "@core/store";
import { useOnboardingStore } from "@core/features/onboarding/onboardingStore";
import type { ChannelEntry, OnboardingConfig } from "@core/types";
import { fancyVersionEncode } from "@core/utils/version";
import { createNebulaTheme } from "@nebula/theme";
import { AdminScreen } from "@nebula/components/admin/AdminScreen";
import type { AdminCapabilities } from "@nebula/components/admin/capabilities";

/**
 * The Onboarding page, in the shell it actually lives in.
 *
 * `AdminScreen` is mounted rather than the page, because half of what is being
 * checked here is the *pane*: the node canvas has to reach the sidebar and the
 * window edge, and the rail has to keep its reading margin, which is a property
 * of the padding the pane applies and not of the page at all.
 *
 * `?canvas` opens on the drawing; without it the page opens on the rail, which
 * is what an admin sees first.
 */

// Enough of Tauri to let the admin hooks make their calls and get nothing back:
// the page has to render without a server, and `useChannelAcl` would otherwise
// reject before the first paint.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => 0,
};

const CAPABILITIES: AdminCapabilities = {
  canAdminister: true,
  canManageEmotes: true,
  canManageFileServer: true,
  canViewAudit: true,
  onboardingSupported: true,
};

const channel = (id: number, name: string, parent: number | null): ChannelEntry =>
  ({
    id,
    name,
    parent_id: parent,
    position: 0,
    user_count: 0,
    permissions: 0,
    attributes: 0,
  }) as unknown as ChannelEntry;

const CONFIG: OnboardingConfig = {
  version: 1,
  enabled: true,
  revision: 12,
  default_channel_ids: [0],
  questions: [
    {
      id: "q1",
      text: "What brings you here?",
      multi_select: false,
      required: true,
      ask_before_join: true,
      answers: [
        {
          id: "a1",
          label: "Gaming",
          emoji: "🎮",
          description: "Rotation nights are Tue & Fri.",
          channel_ids: [4],
          group_names: ["gamers"],
        },
        { id: "a2", label: "Movie nights", emoji: "🎬", channel_ids: [2], group_names: [] },
        { id: "a3", label: "Just listening", emoji: "🎧", channel_ids: [2], group_names: [] },
      ],
    },
    {
      id: "q2",
      text: "Which language do you speak?",
      multi_select: true,
      required: false,
      ask_before_join: false,
      answers: [
        { id: "a4", label: "English", emoji: "🇬🇧", channel_ids: [2], group_names: [] },
        { id: "a5", label: "Deutsch", emoji: "🇩🇪", channel_ids: [5], group_names: ["de"] },
      ],
    },
  ],
};

useAppStore.setState({
  serverFancyVersion: fancyVersionEncode(0, 3, 1),
  channels: [
    channel(0, "Root", null),
    channel(2, "Lounge", 0),
    channel(4, "Gaming", 0),
    channel(5, "Deutsch", 0),
  ],
} as never);
useOnboardingStore.setState({ config: CONFIG, busy: false, error: null } as never);

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box
      sx={(theme) => ({
        display: "flex",
        height: "100vh",
        background: theme.palette.nebula.bg0,
      })}
    >
      {/* Stands in for the settings sidebar, so the seam the canvas has to
          meet is visible in the screenshot. */}
      <Box
        sx={(theme) => ({
          width: 240,
          flex: "none",
          background: theme.palette.nebula.panel,
          borderRight: `1px solid ${theme.palette.nebula.line}`,
        })}
      />
      <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
        <AdminScreen page="onboarding" capabilities={CAPABILITIES} onNavigate={() => undefined} />
      </Box>
    </Box>
  </ThemeProvider>,
);

if (window.location.search.includes("canvas")) {
  const click = (label: string, next?: () => void) => {
    const step = () => {
      const button = [...document.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.trim().startsWith(label),
      );
      if (!button) {
        window.setTimeout(step, 50);
        return;
      }
      button.click();
      if (next) window.setTimeout(next, 120);
    };
    window.setTimeout(step, 80);
  };
  // `?canvas&browse` goes one further and opens the block browser over it.
  click("Node canvas", window.location.search.includes("browse") ? () => click("Browse blocks") : undefined);
}
