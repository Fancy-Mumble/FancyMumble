import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { UserInfoSheet } from "@nebula/components/user/UserInfoSheet";
import { sampleOf, type StatsSample } from "@nebula/components/user/userInfoModel";
import type { UserMenuActions } from "@nebula/selectors";
import type { UserEntry, UserStats } from "@core/types";
import "@standard/theme.css";

/** The User Information sheet as an admin sees it, with 45 s of readings. */
const user: UserEntry = {
  session: 26,
  name: "Sebi",
  channel_id: 1,
  user_id: 6,
  texture_size: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: true,
  hash: "abc",
};

const stats: UserStats = {
  session: 26,
  tcp_packets: 191,
  udp_packets: 346,
  tcp_ping_avg: 23.5,
  tcp_ping_var: 5.1,
  udp_ping_avg: 19.2,
  udp_ping_var: 3.2,
  bandwidth: 6625,
  onlinesecs: 2719,
  idlesecs: 1,
  strong_certificate: false,
  opus: true,
  version: "Fancy Mumble 0.4.0",
  os: "Linux",
  os_version: "6.9",
  address: "2a00:e180:16a8:c200:7706:3a5d:a015:1d18",
  from_client: { good: 346, late: 0, lost: 2, resync: 0 },
  from_server: { good: 8006, late: 1, lost: 0, resync: 0 },
};

const samples: StatsSample[] = Array.from({ length: 45 }, (_, index) => {
  const wobble = Math.sin(index / 4) * 4 + Math.sin(index / 1.7) * 1.5;
  return sampleOf(
    {
      ...stats,
      udp_ping_avg: 19 + wobble,
      tcp_ping_avg: 24 + wobble * 1.3,
      bandwidth: 5200 + Math.round(Math.abs(Math.sin(index / 3)) * 2200),
      from_client: { good: 340, late: index % 7 === 0 ? 2 : 0, lost: index > 30 ? 1 : 0, resync: 0 },
    },
    index,
  );
});

const actions: UserMenuActions = {
  isSelf: false,
  userChannel: null,
  canJoinChannel: true,
  canMuteDeafen: true,
  canMove: true,
  canKick: true,
  canBan: true,
  canRegister: false,
  canUnregister: true,
  canResetContent: true,
  hasModeration: true,
};

const noop = () => undefined;
const theme = createNebulaTheme("dark");

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <Box
      sx={{
        p: "24px",
        background: "#0a0e1a",
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
      }}
    >
      <Box
        sx={(t) => ({
          borderRadius: "20px",
          overflow: "hidden",
          background: `${t.palette.nebula.tint},${t.palette.nebula.bg0}`,
          border: `1px solid ${t.palette.nebula.line2}`,
          boxShadow: t.palette.nebula.shadow,
        })}
      >
        <UserInfoSheet
          user={user}
          avatar={null}
          profile={{ banner: { color: "#3b4a7a" } }}
          bio="<p>Mid-lane or feed, no in between. Ping me for scrims — usually around after 20:00 CET.</p>"
          channelName="Gaming"
          talking={false}
          stats={stats}
          samples={samples}
          location={{
            state: "located",
            lat: 51.9066,
            lng: 8.3785,
            place: "Gütersloh, North Rhine-Westphalia, DE",
          }}
          reverseDns="dyn-c200.hsi.magenta.de"
          groups={["admin", "mods", "scrim-crew"]}
          bans={{ count: 1, note: "expired 12 Jun" }}
          admin
          streamerMode={false}
          actions={actions}
          maxHeight="none"
          onClose={noop}
          onModerate={noop}
          onMove={noop}
        />
      </Box>
    </Box>
  </ThemeProvider>,
);
