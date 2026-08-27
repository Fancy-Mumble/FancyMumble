import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { TitleBar } from "@nebula/components/chrome/TitleBar";
import type { ServerRailEntry, ServerRailStatus } from "@nebula/selectors";

const entry = (host: string, status: ServerRailStatus, unread = 0): ServerRailEntry => ({
  group: { key: host + ":64738", label: host, host, port: 64738, identities: [], favorite: false, sessionId: "s" },
  session: status === "saved" ? null : ({ id: "s", host, port: 64738, username: "Zewi" } as never),
  status,
  unread,
});

const entries = [
  entry("magical.rocks", "connected"),
  entry("kumo.jp", "connected", 12),
  entry("localhost", "connecting"),
];

const icons = new Map<string, string>([
  ["magical.rocks:64738", "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%23b4553f%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E"],
  ["kumo.jp:64738", "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%235a5f8f%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E"],
  ["localhost:64738", "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%238f5a7d%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E"],
]);

const tabs = new URLSearchParams(location.search).has("tabs");

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ height: "100vh", background: "#141d33" }}>
      <TitleBar
        serverLabel="magical.rocks"
        friendsActive={false}
        onOpenFriends={() => {}}
        onOpenChat={() => {}}
        onQuickConnect={() => {}}
        quickConnectOpen={false}
        onDisconnect={() => {}}
        entries={entries}
        icons={icons}
        activeKey="magical.rocks:64738"
        onSelectServer={() => {}}
        tabs={tabs}
      />
    </Box>
  </ThemeProvider>,
);
