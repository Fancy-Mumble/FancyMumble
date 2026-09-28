import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { TitleBar } from "@nebula/components/chrome/TitleBar";
import type { ServerRailEntry, ServerRailStatus } from "@nebula/selectors";

const entry = (host: string, status: ServerRailStatus, unread = 0): ServerRailEntry => ({
  group: {
    key: host + ":64738",
    label: host,
    host,
    port: 64738,
    identities: [],
    favorite: false,
    sessionId: "s",
  },
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
  [
    "magical.rocks:64738",
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%23b4553f%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E",
  ],
  [
    "kumo.jp:64738",
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%235a5f8f%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E",
  ],
  [
    "localhost:64738",
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%238f5a7d%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E",
  ],
]);

const tabs = new URLSearchParams(location.search).has("tabs");
// ?hover=<host> mouses over that tab after mount, so a screenshot can catch
// the card that only exists while the pointer is on the strip.
const hover = new URLSearchParams(location.search).get("hover");

const pings = new Map<string, any>([
  [
    "magical.rocks:64738",
    { online: true, user_count: 3, max_user_count: 101, latency_ms: 18, server_version: "1.6.0" },
  ],
  [
    "kumo.jp:64738",
    { online: true, user_count: 0, max_user_count: 101, latency_ms: 62, server_version: "1.5.7" },
  ],
]);

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ height: "100vh", background: "#141d33" }}>
      <TitleBar
        serverLabel="magical.rocks"
        friendsActive={false}
        onOpenFriends={() => {}}
        onQuickConnect={() => {}}
        quickConnectOpen={false}
        onDisconnect={() => {}}
        entries={entries}
        icons={icons}
        pings={pings}
        activeChannelName="Gaming"
        ownName="Zewi"
        occupants={[
          { session: 1, name: "Sebi", talking: true, muted: false },
          { session: 2, name: "Jonas", talking: false, muted: true },
        ]}
        activeKey="magical.rocks:64738"
        onSelectServer={() => {}}
        tabs={tabs}
      />
    </Box>
  </ThemeProvider>,
);

// The headless capture resizes the viewport after scripts have run, so a card
// placed before that keeps a position measured against the old width. Hovering
// on the resize, not on a timer, is what makes the screenshot truthful.
if (hover) {
  const openCard = () => {
    const tab = [...document.querySelectorAll('[data-testid="nebula-server-tab"]')].find((candidate) =>
      (candidate.textContent ?? "").includes(hover),
    );
    // React hears mouseover and works out the enter from it.
    tab?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  };
  window.addEventListener("resize", () => {
    // Twice: the strip's own layout settles a frame after the window does, and
    // the card is placed from where the tab is at the moment it opens.
    requestAnimationFrame(openCard);
    setTimeout(openCard, 120);
  });
  setTimeout(openCard, 300);
}
