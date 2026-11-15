import { createRoot } from "react-dom/client";
import ModernChannelList from "@standard/components/sidebar/flat/ModernChannelList";
import { useAppStore } from "@core/store";
import type { ChannelEntry, UserEntry } from "@core/types";
import "@standard/theme.css";
import { initializeStandardAppearance } from "@standard/appearance";

initializeStandardAppearance();

const channel = (id: number, name: string): ChannelEntry =>
  ({ id, name, parent_id: id === 0 ? null : 0, position: id, permissions: null }) as unknown as ChannelEntry;

const user = (session: number, name: string, channel_id: number): UserEntry =>
  ({ session, name, channel_id }) as unknown as UserEntry;

const channels = [channel(0, "Root"), channel(1, "Lobby"), channel(2, "Music")];
const users = [
  user(1, "Zewi", 1),
  user(2, "Sebi", 2),
  user(3, "Jonas", 2),
  user(4, "Mira", 2),
];

useAppStore.setState({ ownSession: 1, users, channels });

createRoot(document.getElementById("root")!).render(
  <div style={{ width: 300, background: "var(--bg-secondary, #1e2128)", height: "100vh", padding: 8 }}>
    <ModernChannelList
      channels={channels}
      users={users}
      selectedChannel={1}
      currentChannel={1}
      listenedChannels={new Set()}
      unreadCounts={{}}
      talkingSessions={new Set()}
      broadcastingSessions={new Set()}
      onSelectChannel={() => {}}
      onJoinChannel={() => {}}
      onContextMenu={() => {}}
    />
  </div>,
);

// ?drag=1 carries Zewi from Lobby down over Music, so a screenshot can show
// the seat that opens for them between Sebi and Jonas.
function simulateDrag() {
  const row = document.querySelector('[data-user-name="Zewi"]') as HTMLElement | null;
  const seat = document.querySelector('[data-user-name="Mira"]') as HTMLElement | null;
  if (!row || !seat) return;
  const from = row.getBoundingClientRect();
  const to = seat.getBoundingClientRect();
  const at = (type: string, y: number) =>
    row.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: from.left + 20,
        clientY: y,
      }),
    );
  at("pointerdown", from.top + 10);
  at("pointermove", to.top + 14);
}

if (new URLSearchParams(location.search).has("drag")) setTimeout(simulateDrag, 400);
