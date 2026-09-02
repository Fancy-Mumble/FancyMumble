import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@core/i18n/nebula";
import { createNebulaTheme } from "@nebula/theme";
import { useAppStore } from "@core/store";
import { WatchDock } from "@nebula/components/chat/watch/WatchDock";

/**
 * The dock over a stand-in conversation, hosting a real local file so the
 * position and length are the adapter's own rather than invented.
 */
const SESSION = {
  sessionId: "s1",
  channelId: 1,
  hostSession: 1,
  sourceUrl: "/dist/probe.mp4",
  sourceKind: "directMedia" as const,
  title: "Entity - Stargazer (ft. Amy)",
  participants: new Set([1, 2]),
  state: "paused" as const,
  currentTime: 1,
  updatedAtMs: Date.now(),
};

useAppStore.setState({
  ownSession: 1,
  currentChannel: 1,
  selectedChannel: 1,
  users: [{ session: 1, name: "Zewi", channel_id: 1, texture_size: null }] as never,
  watchSessions: new Map([["s1", SESSION]]) as never,
  watchSessionsVersion: 1,
});

function Pane({ mode }: Readonly<{ mode: "dark" | "light" }>) {
  return (
    <ThemeProvider theme={createNebulaTheme(mode)}>
      <CssBaseline />
      <Box
        sx={{
          position: "relative",
          flex: 1,
          minHeight: "100vh",
          p: "22px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          fontSize: 13,
          color: mode === "dark" ? "#cbd7f0" : "#3a4258",
          background:
            mode === "dark"
              ? "linear-gradient(140deg,#2b3a5c,#1a2440 60%,#101a30)"
              : "linear-gradient(140deg,#f4f6fb,#fdfbf6 60%,#f7f4ec)",
        }}
      >
        <div>Sebi &nbsp; 18:20</div>
        <div>nice, queue is up in 5 - check this while we wait</div>
        <div style={{ opacity: 0.6 }}>Zewi &nbsp; 18:21</div>
        <div style={{ opacity: 0.6 }}>on it, putting it on now</div>
        <WatchDock />
      </Box>
    </ThemeProvider>
  );
}

// One pane only: both would claim the same player mount, and the loser would
// correctly render "open elsewhere" instead of the dock. `?theme=light` for the
// other half.
const params = new URLSearchParams(location.search);
const mode = params.get("theme") === "light" ? "light" : "dark";

// `?mode=theater` opens the theater the way a person would, so a headless
// screenshot can see it.
if (params.get("mode") === "theater") {
  setTimeout(() => {
    const button = document.querySelector('[aria-label="Theater"]');
    if (button instanceof HTMLElement) button.click();
  }, 500);
}

createRoot(document.getElementById("root")!).render(
  <Box sx={{ display: "flex", minHeight: "100vh" }}>
    <Pane mode={mode} />
  </Box>,
);
