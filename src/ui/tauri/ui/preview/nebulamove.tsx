import { createRoot } from "react-dom/client";
import { CssBaseline, Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { ChannelList } from "@nebula/components/sidebar/ChannelList";
import { PERM_MOVE } from "@core/utils/permissions";
import type { ChannelEntry, UserEntry } from "@core/types";

const channel = (id: number, name: string, permissions: number | null = null): ChannelEntry =>
  ({
    id,
    name,
    parent_id: id === 0 ? null : 0,
    position: id,
    user_count: 0,
    permissions,
    attributes: 0,
    is_enter_restricted: false,
  }) as unknown as ChannelEntry;

const member = (session: number, name: string, channel_id: number): UserEntry =>
  ({ session, name, channel_id, texture_size: null }) as unknown as UserEntry;

const users = [
  member(1, "Zewi", 2),
  member(2, "Sebi", 3),
  member(3, "Jonas", 3),
  member(4, "Mira", 3),
];

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={{ width: 300, height: "100vh", display: "flex", background: "#141d33" }}>
      <ChannelList
        channels={[
          { channel: channel(2, "Lobby", PERM_MOVE), depth: 0 },
          { channel: channel(3, "Music", PERM_MOVE), depth: 0 },
        ]}
        users={users}
        selectedChannel={2}
        currentChannel={2}
        talkingSessions={new Set()}
        unreadCounts={{}}
        ownSession={9}
        onSelect={() => {}}
        onJoin={() => {}}
        onContextMenu={() => {}}
        onSelectUser={() => {}}
        onHoverUser={() => {}}
        onLeaveUser={() => {}}
      />
    </Box>
  </ThemeProvider>,
);

// ?drag=1 carries Zewi out of Lobby and over Music, so a screenshot can show
// the seat that opens for them and the ring on the room that would take them.
function simulateDrag() {
  const row = document.querySelector('[data-user-name="Zewi"]') as HTMLElement | null;
  const seat = document.querySelector('[data-user-name="Mira"]') as HTMLElement | null;
  if (!row || !seat) return;
  const from = row.getBoundingClientRect();
  const to = seat.getBoundingClientRect();
  const at = (type: string, y: number) =>
    row.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: from.left + 20, clientY: y }),
    );
  at("pointerdown", from.top + 10);
  at("pointermove", to.top + 10);
}

if (new URLSearchParams(location.search).has("drag")) setTimeout(simulateDrag, 400);
