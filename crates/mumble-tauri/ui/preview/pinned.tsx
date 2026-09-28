import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import i18n from "@core/i18n";
import "@core/i18n/nebula";
import { createNebulaTheme } from "@nebula/theme";
import { ChatHeader } from "@nebula/components/chat/ChatHeader";
import { PinnedPanel } from "@nebula/components/chat/pinned/PinnedPanel";
import { DEFAULT_TIME_DISPLAY } from "@nebula/selectors";
import type { ChatMessage } from "@core/types";

void i18n.changeLanguage("en");

const DAY = 86_400_000;
const at = (days: number, hour: number, minute: number) => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.getTime() - days * DAY;
};

const THUMB =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="96">
       <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#2f6fb0"/><stop offset="1" stop-color="#123055"/>
       </linearGradient></defs>
       <rect width="168" height="96" fill="url(#g)"/>
       <path d="M0 70 L40 46 L74 66 L108 38 L168 74 L168 96 L0 96 Z" fill="#0d1c33" opacity=".85"/>
       <circle cx="132" cy="26" r="12" fill="#f0d68a" opacity=".9"/>
     </svg>`,
  );

const messages: ChatMessage[] = [
  {
    sender_session: 1,
    sender_name: "Sebi",
    body: "Rotation nights are Tuesday and Friday, 20:00 CET. Bring your own snacks.",
    channel_id: 1,
    is_own: false,
    message_id: "m1",
    timestamp: at(3, 20, 14),
    pinned: true,
  },
  {
    sender_session: 2,
    sender_name: "Jonas",
    body: "Server address for the modded save — <code>mumble.magical.rocks:64738</code>",
    channel_id: 1,
    is_own: false,
    message_id: "m2",
    timestamp: at(9, 18, 2),
    pinned: true,
  },
  {
    sender_session: 3,
    sender_name: "enot",
    body: `Ping map pack v4 is up. <img src="${THUMB}">`,
    channel_id: 1,
    is_own: false,
    message_id: "m3",
    timestamp: at(16, 11, 40),
    pinned: true,
  },
];

const noop = () => {};

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ padding: "22px", background: "#0a0e1a", display: "grid", gap: "18px" }}>
      <Box
        sx={{
          position: "relative",
          width: 900,
          height: 520,
          borderRadius: "14px",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,.08)",
          background:
            "radial-gradient(680px 420px at 12% 8%,rgba(65,180,249,.20),transparent 62%)," +
            "radial-gradient(520px 520px at 78% 18%,rgba(125,130,255,.18),transparent 60%)," +
            "radial-gradient(760px 460px at 62% 92%,rgba(80,120,220,.16),transparent 64%),#141d33",
        }}
      >
        <ChatHeader
          title="Gaming"
          subtitle="3 in voice · 5 members"
          memberCount={5}
          canJoinVoice={false}
          hasNewPins
          pinnedOpen
          onJoinVoice={noop}
          onToggleSearch={noop}
          onShowMembers={noop}
          onShareScreen={noop}
          onShowPinned={noop}
          onShowInfo={noop}
          onShowDownloads={noop}
        />
        <PinnedPanel
          messages={messages}
          unseenIds={new Set(["m1"])}
          time={DEFAULT_TIME_DISPLAY}
          onClose={noop}
          onJump={noop}
          onMarkRead={noop}
          onUnpin={noop}
        />
      </Box>

      {/* The resting header: the pin closed, with a pin waiting behind it. */}
      <Box
        sx={{
          width: 900,
          borderRadius: "14px",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,.08)",
          background:
            "radial-gradient(680px 420px at 12% 8%,rgba(65,180,249,.20),transparent 62%),#141d33",
        }}
      >
        <ChatHeader
          title="Gaming"
          subtitle="3 in voice · 5 members"
          memberCount={5}
          canJoinVoice={false}
          hasNewPins
          onJoinVoice={noop}
          onToggleSearch={noop}
          onShowMembers={noop}
          onShareScreen={noop}
          onShowPinned={noop}
          onShowInfo={noop}
          onShowDownloads={noop}
        />
      </Box>
    </Box>
  </ThemeProvider>,
);
