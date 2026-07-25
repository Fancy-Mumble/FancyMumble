import type { ChannelEntry, UserEntry } from "@core/types";
import { InfoIcon, PlusIcon } from "@ui/icons";
import { ChannelList, IconButton, SearchField, SelfVoiceControls } from "../index";
import styles from "../../AuroraClientApp.module.css";

export interface ChannelSidebarProps {
  serverLabel: string;
  channels: ChannelEntry[];
  users: UserEntry[];
  selectedChannel: number | null;
  currentChannel: number | null;
  listenedChannels: ReadonlySet<number>;
  unreadCounts: Record<number, number>;
  talkingSessions: ReadonlySet<number>;
  query: string;
  onQueryChange: (query: string) => void;
  ownName: string;
  ownSession?: number | null;
  inCall: boolean;
  onOpenServerInfo: () => void;
  onCreateChannel: () => void;
  onSelectChannel: (channel: ChannelEntry) => void;
  onJoinChannel: (channel: ChannelEntry) => void;
  onChannelContextMenu: (channel: ChannelEntry, event: { clientX: number; clientY: number }) => void;
  onSidebarContextMenu: (position: { x: number; y: number }) => void;
}

/** Initials from a display name, for the voice dock avatar. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

/** Server header, channel tree, and the user's own voice dock. */
export default function ChannelSidebar({
  serverLabel,
  channels,
  users,
  selectedChannel,
  currentChannel,
  listenedChannels,
  unreadCounts,
  talkingSessions,
  query,
  onQueryChange,
  ownName, ownSession,
  inCall,
  onOpenServerInfo,
  onCreateChannel,
  onSelectChannel,
  onJoinChannel,
  onChannelContextMenu,
  onSidebarContextMenu,
}: ChannelSidebarProps) {
  return (
    <aside className={styles.channels}>
      <div className={styles.panelHeader}>
        <div>
          <small>SERVER</small>
          <strong>{serverLabel}</strong>
        </div>
        <IconButton icon={<InfoIcon />} label="Server information" onClick={onOpenServerInfo} />
      </div>
      <SearchField
        placeholder="Search channels"
        aria-label="Search channels"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div className={styles.sectionLabel}>
        <span>CHANNELS</span>
        <IconButton icon={<PlusIcon />} label="Create channel" onClick={onCreateChannel} />
      </div>
      <nav
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSidebarContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <ChannelList
          channels={channels}
          users={users}
          selectedChannel={selectedChannel}
          currentChannel={currentChannel}
          listenedChannels={listenedChannels}
          unreadCounts={unreadCounts}
          talkingSessions={talkingSessions}
          ownSession={ownSession}
          onSelect={onSelectChannel}
          onJoin={onJoinChannel}
          onContextMenu={onChannelContextMenu}
        />
        {channels.length === 0 && <div className={styles.noChannels}>No active channels</div>}
      </nav>
      <div className={styles.voiceDock}>
        <div>
          <span className={styles.avatar}>{initials(ownName)}</span>
          <span>
            <strong>{ownName}</strong>
            <small>{inCall ? "Voice connected" : "Voice available"}</small>
          </span>
        </div>
        <SelfVoiceControls />
      </div>
    </aside>
  );
}
