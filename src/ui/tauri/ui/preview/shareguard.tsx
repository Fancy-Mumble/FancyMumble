/**
 * The header's menu and the voice dock, with a share route and - under
 * `?blocked=1` - a capture already running for another server connection.
 * `?p2p=1` for a server without an SFU.
 */
import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@core/i18n/nebula";
import "@standard/theme.css";
import "@standard/global.css";
import i18n from "@core/i18n";
import { useAppStore } from "@core/store";
import { createNebulaTheme } from "@nebula/theme";
import { ChatHeader } from "@nebula/components/chat/ChatHeader";
import { VoiceDock } from "@nebula/components/sidebar/VoiceDock";

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => 0,
};

const params = new URLSearchParams(location.search);
const blocked = params.has("blocked");
const relayed = !params.has("p2p");
const base = useAppStore.getState();
useAppStore.setState({
  ownSession: 4,
  activeServerId: "b",
  broadcastingOwnSession: blocked ? 4 : null,
  broadcastingServerId: blocked ? "a" : null,
  voiceState: "active",
  serverConfig: { ...base.serverConfig, webrtc_sfu_available: relayed },
});
const noop = () => {};

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ display: "flex", gap: "24px", p: "16px", height: 560 }}>
      <Box sx={{ width: 300, alignSelf: "flex-end" }}>
        <VoiceDock
          name="Sebi"
          session={4}
          textureSize={null}
          channelName="Gaming"
          latencyMs={18}
          hideEmpty={false}
          onToggleHideEmpty={noop}
          onOpenSettings={noop}
          onOpenProfile={noop}
          onShareScreen={noop}
          onShareCamera={noop}
        />
      </Box>
      <Box sx={{ flex: 1, position: "relative" }}>
        <ChatHeader
          title="Gaming"
          subtitle="3 in voice"
          canJoinVoice={false}
          onJoinVoice={noop}
          onToggleSearch={noop}
          onShowMembers={noop}
          onShareScreen={noop}
          shareBlockedReason={blocked ? i18n.t("chat:screenShare.alreadySharingOtherServer") : null}
          shareRoute={i18n.t(relayed ? "nebulaChat:share.routeRelayed" : "nebulaChat:share.routeP2P")}
          onShowPinned={noop}
          onShowInfo={noop}
          onShowDownloads={noop}
        />
      </Box>
    </Box>
  </ThemeProvider>,
);

setTimeout(() => {
  (document.querySelector('[data-testid="chat-header-kebab"]') as HTMLElement | null)?.click();
}, 1200);
