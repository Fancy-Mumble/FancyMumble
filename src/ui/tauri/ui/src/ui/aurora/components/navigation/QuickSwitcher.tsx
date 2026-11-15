import { useMemo, useState } from "react";
import type { ChannelEntry, SessionMeta, UserEntry } from "@core/types";
import { Button, ModalSurface, SearchField } from "../primitives";
import styles from "./QuickSwitcher.module.css";

type Result = { id: string; category: string; title: string; detail: string; action: () => void };

export default function QuickSwitcher({
  sessions,
  channels,
  users,
  onSwitchServer,
  onSelectChannel,
  onSelectUser,
  onOpenSettings,
  onOpenWorkspace,
  onClose,
}: {
  sessions: SessionMeta[];
  channels: ChannelEntry[];
  users: UserEntry[];
  onSwitchServer: (id: string) => void;
  onSelectChannel: (id: number) => void;
  onSelectUser: (session: number) => void;
  onOpenSettings: () => void;
  onOpenWorkspace: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo<Result[]>(() => {
    const all: Result[] = [
      {
        id: "settings",
        category: "Action",
        title: "Open settings",
        detail: "Client preferences",
        action: onOpenSettings,
      },
      {
        id: "workspace",
        category: "Action",
        title: "Open workspace",
        detail: "Documents, downloads, and calendar",
        action: onOpenWorkspace,
      },
      ...sessions.map((session) => ({
        id: `server-${session.id}`,
        category: "Server",
        title: session.label || session.host,
        detail: `${session.host}:${session.port}`,
        action: () => onSwitchServer(session.id),
      })),
      ...channels.map((channel) => ({
        id: `channel-${channel.id}`,
        category: "Channel",
        title: `# ${channel.name}`,
        detail: `${channel.user_count} members`,
        action: () => onSelectChannel(channel.id),
      })),
      ...users.map((user) => ({
        id: `user-${user.session}`,
        category: "Member",
        title: user.name,
        detail: "Open direct message",
        action: () => onSelectUser(user.session),
      })),
    ];
    const needle = query.trim().toLocaleLowerCase();
    return (
      needle
        ? all.filter((item) =>
            `${item.title} ${item.detail} ${item.category}`.toLocaleLowerCase().includes(needle),
          )
        : all
    ).slice(0, 30);
  }, [
    channels,
    onOpenSettings,
    onOpenWorkspace,
    onSelectChannel,
    onSelectUser,
    onSwitchServer,
    query,
    sessions,
    users,
  ]);
  const run = (result: Result) => {
    result.action();
    onClose();
  };
  return (
    <ModalSurface
      title="Quick switcher"
      eyebrow="NAVIGATE ANYWHERE"
      onClose={onClose}
      className={styles.surface}
    >
      <div className={styles.body}>
        <SearchField
          autoFocus
          aria-label="Search servers, channels, members, and actions"
          placeholder="Search servers, channels, members, and actions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) run(results[0]);
          }}
        />
        <div>
          {results.map((result) => (
            <Button variant="bare" key={result.id} onClick={() => run(result)}>
              <small>{result.category}</small>
              <span>
                <strong>{result.title}</strong>
                <b>{result.detail}</b>
              </span>
            </Button>
          ))}
          {results.length === 0 && <p>No matching destinations.</p>}
        </div>
      </div>
    </ModalSurface>
  );
}
