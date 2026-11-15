/**
 * The scheduled-messages dialog over an empty shell, with three pending
 * messages: one due today, one next week and one into a channel that has gone.
 *
 * `?scheme=light`, `?encrypted=1` for the plain-text warning, `?full=1` for the
 * phone's full-screen dialog, `?frame=412` to draw it in a phone-width iframe,
 * `?empty=1` for the empty list, `?error=1` for a rejection from the server.
 */
import { createRoot } from "react-dom/client";
import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@core/i18n/nebula";
import "@standard/theme.css";
import "@standard/global.css";
import { useAppStore } from "@core/store";
import { ScheduleStatus } from "@core/store/slices/scheduled";
import type { ChannelEntry } from "@core/types";
import { createNebulaTheme } from "@nebula/theme";
import { DEFAULT_TIME_DISPLAY } from "@nebula/selectors";
import { ScheduledMessagesDialog } from "@nebula/components/chat/scheduled/ScheduledMessagesDialog";

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

const scheme = params.get("scheme") === "light" ? "light" : "dark";
const hour = 3_600_000;
const today = new Date();
today.setHours(21, 30, 0, 0);

useAppStore.setState({
  channels: [
    { id: 4, name: "Raids" },
    { id: 7, name: "Announcements" },
  ] as ChannelEntry[],
  scheduledLoading: false,
  scheduledLastAck: params.has("error")
    ? { status: ScheduleStatus.Rejected, reason: "You may only schedule 20 messages at a time." }
    : null,
  scheduledMessages: params.has("empty")
    ? []
    : [
        {
          scheduleId: "a",
          channelIds: [4],
          treeIds: [],
          message: "Raid starts in 15 minutes - bring flasks, repair before you log in.",
          deliverAt: Math.max(today.getTime(), Date.now() + hour),
          status: ScheduleStatus.Pending,
        },
        {
          scheduleId: "b",
          channelIds: [7],
          treeIds: [],
          message:
            "Server maintenance on Sunday from 09:00 to 11:00.\nVoice will drop twice while the gateway restarts; chat history is kept.",
          deliverAt: Date.now() + 6 * 24 * hour,
          status: ScheduleStatus.Pending,
        },
        {
          scheduleId: "c",
          channelIds: [12],
          treeIds: [],
          message: "Happy birthday!",
          deliverAt: Date.now() + 40 * 24 * hour,
          status: ScheduleStatus.Pending,
        },
        {
          scheduleId: "d",
          channelIds: [4],
          treeIds: [],
          message: "Already delivered, so not listed",
          deliverAt: Date.now() - hour,
          status: ScheduleStatus.Delivered,
        },
      ],
  listScheduledMessages: async () => undefined,
  scheduleMessage: async () => undefined,
  cancelScheduledMessage: async () => undefined,
});

if (!frame)
  createRoot(document.getElementById("root")!).render(
    <ThemeProvider theme={createNebulaTheme(scheme)}>
      <CssBaseline />
      <div style={{ height: 900 }}>
        <ScheduledMessagesDialog
          channelId={4}
          channelName="Raids"
          encrypted={params.has("encrypted")}
          time={DEFAULT_TIME_DISPLAY}
          fullScreen={params.has("full")}
          onClose={() => {}}
        />
      </div>
    </ThemeProvider>,
  );
