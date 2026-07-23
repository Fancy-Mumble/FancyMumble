import { useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@ui/icons";
import { Button, IconButton } from "../primitives";
import styles from "../../AuroraClientApp.module.css";

/** One saved identity (username) on a server. */
export interface RailIdentity {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  favorite?: boolean;
  /** Session id while this identity is connected, otherwise null. */
  sessionId?: string | null;
}

/** All saved identities that share one host:port. */
export interface RailGroup {
  key: string;
  label: string;
  host: string;
  port: number;
  favorite: boolean;
  identities: readonly RailIdentity[];
}

export interface ServerRailProps {
  groups: readonly RailGroup[];
  expanded: boolean;
  activeSessionId?: string | null;
  connecting?: boolean;
  label: string;
  onToggle: () => void;
  onSelect: (identity: RailIdentity) => void;
  onAdd: () => void;
}

/** Initials from a name, ignoring the dots/dashes common in host names. */
export function initials(label: string): string {
  const parts = label.split(/[\s._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}

function RailEntry({ mark, title, primary, secondary, tertiary, active, offline, connected, disabled, nested, expanded, onSelect }: {
  mark: string;
  title: string;
  primary: string;
  secondary?: string;
  tertiary?: string;
  active: boolean;
  offline: boolean;
  connected?: boolean;
  disabled: boolean;
  nested?: boolean;
  expanded?: boolean;
  onSelect: () => void;
}) {
  const className = [
    active ? styles.serverActive : styles.savedServer,
    offline ? styles.offlineServer : "",
    connected && !active ? styles.connectedServer : "",
    nested ? styles.nestedServer : "",
  ].filter(Boolean).join(" ");
  return <Button variant="bare" className={className} disabled={disabled} onClick={onSelect} title={title} {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
    leadingIcon={<span className={styles.serverMark}>{mark}</span>}
    trailingIcon={<i className={styles.serverPresence} />}>
    <span className={styles.serverDetails}><strong>{primary}</strong>{secondary && <small>{secondary}</small>}{tertiary && <em>{tertiary}</em>}</span>
  </Button>;
}

export default function ServerRail({ groups, expanded, activeSessionId, connecting = false, label, onToggle, onSelect, onAdd }: ServerRailProps) {
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggleGroup = (key: string) => setOpenGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const renderGroup = (group: RailGroup): ReactNode => {
    const multi = group.identities.length > 1;
    const open = multi && openGroups.has(group.key);
    const online = group.identities.some((identity) => identity.sessionId);
    const activeHere = group.identities.some((identity) => identity.sessionId && identity.sessionId === activeSessionId);
    const single = group.identities[0];

    return <div className={styles.serverGroup} key={group.key}>
      <div className={styles.groupTile}>
      {multi && <i className={styles.groupCount} aria-hidden="true">{group.identities.length}</i>}
      <RailEntry
        mark={initials(group.label)}
        title={multi ? `${open ? "Collapse" : "Expand"} ${group.label} (${group.identities.length} identities)` : online ? `Open ${group.label}` : `Connect to ${group.label}`}
        primary={group.label}
        secondary={`${group.host}:${group.port}`}
        tertiary={multi ? `${group.identities.length} identities` : single.username}
        active={activeHere && !open}
        offline={!online}
        disabled={connecting}
        expanded={multi ? open : undefined}
        onSelect={() => (multi ? toggleGroup(group.key) : onSelect(single))}
      />
      </div>
      {open && <div className={styles.groupIdentities}>
        {/* The group header already carries the address, so an identity row is
            just the name; the presence dot and dimming convey its state. */}
        {group.identities.map((identity) => <RailEntry
          key={identity.id}
          nested
          mark={initials(identity.username)}
          title={identity.sessionId ? `Open ${identity.username}` : `Connect as ${identity.username}`}
          primary={identity.username}
          active={!!identity.sessionId && identity.sessionId === activeSessionId}
          offline={!identity.sessionId}
          connected={!!identity.sessionId}
          disabled={connecting}
          onSelect={() => onSelect(identity)}
        />)}
      </div>}
    </div>;
  };

  return <aside className={styles.servers} aria-label={label} data-expanded={expanded}>
    <div className={styles.railHeader}><span>{activeSessionId ? "CONNECTED" : "YOUR SERVERS"}</span><IconButton icon={expanded ? <ChevronLeftIcon /> : <ChevronRightIcon />} label={expanded ? "Collapse server sidebar" : "Expand server sidebar"} aria-expanded={expanded} onClick={onToggle} /></div>
    <div className={styles.serverLibrary}>{groups.map(renderGroup)}</div>
    <Button variant="ghost" className={styles.addServer} onClick={onAdd} leadingIcon={<PlusIcon />}>Add server</Button>
  </aside>;
}
