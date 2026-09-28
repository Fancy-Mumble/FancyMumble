import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { ChatHeader } from "@nebula/components/chat/ChatHeader";

/** The header on the mock's own backdrop, since it is glass over a wallpaper. */
function Pane({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        width: 1040,
        borderRadius: "14px",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,.08)",
        background:
          "radial-gradient(680px 420px at 12% 8%,rgba(65,180,249,.20),transparent 62%)," +
          "radial-gradient(520px 520px at 78% 18%,rgba(125,130,255,.18),transparent 60%),#141d33",
      }}
    >
      {children}
    </Box>
  );
}

const noop = () => {};
const actions = {
  onJoinVoice: noop,
  onToggleSearch: noop,
  onShowMembers: noop,
  onShareScreen: noop,
  onShowPinned: noop,
  onShowInfo: noop,
  onShowDownloads: noop,
};

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ display: "grid", gap: "22px", padding: "22px", background: "#0a0e1a" }}>
      <Pane>
        <ChatHeader
          title="Gaming"
          subtitle="3 in voice · 5 members"
          memberCount={5}
          persisted
          encrypted
          trustLevel="Verified"
          onVerifyKey={noop}
          canJoinVoice
          {...actions}
        />
      </Pane>
      <Pane>
        <ChatHeader
          title="Lounge"
          subtitle="2 in voice"
          memberCount={2}
          canJoinVoice={false}
          {...actions}
        />
      </Pane>
      <Pane>
        <ChatHeader
          title="Archive"
          subtitle="0 in voice · 4 members"
          memberCount={4}
          persisted
          encrypted
          trustLevel="Disputed"
          onVerifyKey={noop}
          canJoinVoice
          {...actions}
        />
      </Pane>
      <Pane>
        <ChatHeader
          title="Backstage"
          subtitle="1 in voice · 6 members"
          memberCount={6}
          persisted
          encrypted
          canJoinVoice
          {...actions}
        />
      </Pane>
      <Pane>
        <ChatHeader
          title="Lorelando"
          subtitle="Direct message"
          partner={{ name: "Lorelando", session: 7, textureSize: null }}
          canJoinVoice={false}
          {...actions}
        />
      </Pane>
    </Box>
  </ThemeProvider>,
);
