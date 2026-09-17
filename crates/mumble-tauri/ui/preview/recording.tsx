/**
 * The audio recorder, idle or `?live=1` part-way through a recording, and
 * `?view=menu` for the channel menu opened on a meeting room.
 * `?frame=412` draws either at a phone width.
 */
import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@core/i18n/nebula";
import "@standard/theme.css";
import "@standard/global.css";
import type { ChannelEntry } from "@core/types";
import { PERM_WRITE } from "@core/utils/permissions";
import { createNebulaTheme } from "@nebula/theme";
import { RecordingDialog } from "@nebula/components/recording/RecordingDialog";
import { ChannelMenu } from "@nebula/components/sidebar/ChannelMenu";

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => 0,
};

const params = new URLSearchParams(location.search);
const frame = params.get("frame");
if (frame) {
  const inner = new URLSearchParams(params);
  inner.delete("frame");
  const iframe = document.createElement("iframe");
  iframe.src = `${location.pathname}?${inner.toString()}`;
  iframe.width = frame;
  iframe.height = params.get("frameHeight") ?? "915";
  iframe.style.border = "0";
  document.body.replaceChildren(iframe);
}

try {
  localStorage.setItem("nebula.recording.target", JSON.stringify({ directory: "/home/me/Recordings", filename: "recording_{datetime}_{channel}" }));
} catch {
  // Preview only.
}

const live = params.has("live");
const recording = {
  state: live
    ? { is_recording: true, file_path: "/home/me/Recordings/recording_2026-09-13_01-12-40_Gaming.wav", elapsed_secs: 83 }
    : { is_recording: false, file_path: null, elapsed_secs: 0 },
  start: async () => undefined,
  stop: async () => undefined,
};
const room = { id: 41, name: "Sprint planning", parent_id: 0, detached: true, permissions: PERM_WRITE, attributes: 0, user_count: 3 } as unknown as ChannelEntry;
const noop = () => {};

if (!frame)
  createRoot(document.getElementById("root")!).render(
    <ThemeProvider theme={createNebulaTheme(params.get("scheme") === "light" ? "light" : "dark")}>
      <CssBaseline />
      <Box sx={{ height: 760 }}>
        {params.get("view") === "menu" ? (
          <ChannelMenu
            target={{ channel: room, x: 40, y: 40 }}
            listening={false}
            notificationsMuted={false}
            occupantCount={3}
            hideEmpty={false}
            onToggleHideEmpty={noop}
            onJoin={noop}
            onShowInfo={noop}
            onEdit={noop}
            onCreate={noop}
            onMoveAllUsers={noop}
            onPurgeHistory={noop}
            onDelete={noop}
            onEditPermissions={noop}
            arranging={false}
            onToggleArrange={noop}
            onClose={noop}
          />
        ) : (
          <RecordingDialog recording={recording} fullScreen={params.has("full")} onClose={noop} />
        )}
      </Box>
    </ThemeProvider>,
  );
