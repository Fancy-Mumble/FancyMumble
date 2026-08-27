import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { ServerRail } from "@nebula/components/sidebar/ServerRail";
import { ServerRailCard } from "@nebula/components/sidebar/ServerRailCard";
import type { ServerRailEntry, ServerRailStatus } from "@nebula/selectors";

const entry = (host: string, status: ServerRailStatus, unread = 0): ServerRailEntry => ({
  group: {
    key: host + ":64738",
    label: host,
    host,
    port: 64738,
    identities: [],
    favorite: false,
    sessionId: status === "saved" ? null : "s-" + host,
  },
  session: status === "saved" ? null : { id: "s-" + host, host, port: 64738, username: "Zewi" },
  status,
  unread,
});

const card = new URLSearchParams(location.search).get("card");
const expanded = new URLSearchParams(location.search).has("expanded");

const pings = new Map<string, any>([
  ["magical.rocks:64738", { online: true, user_count: 3, max_user_count: 101, latency_ms: 18, server_version: "1.6.0" }],
  ["kumo.jp:64738", { online: true, user_count: 0, max_user_count: 101, latency_ms: 62, server_version: "1.5.7" }],
]);

// Real bitmaps, because a tile with an img in it drags differently from one
// showing initials - which is exactly what the first attempt missed.
const icons = new Map<string, string>([
  ["magical.rocks:64738", "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%23b4553f%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E"],
  ["kumo.jp:64738", "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%235a5f8f%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E"],
  ["localhost:64738", "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%238f5a7d%22%2F%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2226%22%20r%3D%2214%22%20fill%3D%22%23fff%22%20opacity%3D%22.55%22%2F%3E%3C%2Fsvg%3E"],
]);
const entries = [
  entry("magical.rocks", "connected"),
  entry("kumo.jp", "saved", 12),
  entry("localhost", "connecting"),
];

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ height: "100vh", display: "flex", background: "#141d33" }}>
      <ServerRail
        entries={entries}
        activeKey="magical.rocks:64738"
        expanded={expanded}
        onToggleExpanded={() => {}}
        icons={icons}
        pings={pings}
        activeChannelName="Gaming"
        onSelect={() => {}}
        onAddServer={() => {}}
        onDisconnect={() => {}}
      />
      <Box sx={{ width: 360, position: "relative", borderRight: "1px solid rgba(135,180,255,.11)" }}>
        {card && (
          <ServerRailCard
            entry={
              card === "connecting"
                ? entry("localhost", "connecting", 0)
                : card === "idle"
                  ? { ...entry("kumo.jp", "saved", 12), group: { ...entry("kumo.jp", "saved", 12).group, identities: [{}, {}] as never } }
                  : entry("magical.rocks", "connected")
            }
            ping={pings.get(card === "idle" ? "kumo.jp:64738" : "magical.rocks:64738")}
            channelName={card === "connected" ? "Gaming" : null}
            ownName="Zewi"
            occupants={
              card === "connected"
                ? [
                    { session: 1, name: "Sebi", talking: true, muted: false },
                    { session: 2, name: "Jonas", talking: false, muted: true },
                  ]
                : []
            }
            top={8}
            onOpen={() => {}}
            onCancel={() => {}}
            onPointerEnter={() => {}}
            onPointerLeave={() => {}}
          />
        )}
      </Box>
    </Box>
  </ThemeProvider>,
);

// ?drag=1 drives a real pointer drag after mount, so a screenshot can show the
// ghost and the drop line that only exist mid-gesture.
function simulateDrag() {
  const tile = [...document.querySelectorAll("button")].find(
    (candidate) =>
      (candidate.getAttribute("aria-label") ?? "").startsWith("magical.rocks") ||
      (candidate.textContent ?? "").includes("magical.rocks"),
  ) as HTMLElement | undefined;
  if (!tile) return;
  const box = tile.getBoundingClientRect();
  const at = (type: string, y: number, target: EventTarget) =>
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: box.left + 20, clientY: y }),
    );
  at("pointerdown", box.top + 20, tile);
  at("pointermove", box.top + 120, window);
}

if (new URLSearchParams(location.search).has("drag")) setTimeout(simulateDrag, 400);
