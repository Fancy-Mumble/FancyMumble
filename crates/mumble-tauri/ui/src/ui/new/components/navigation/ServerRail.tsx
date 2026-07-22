import type { SavedServer, SessionMeta } from "@core/types";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@ui/icons";
import { Button, IconButton } from "../primitives";
import styles from "../../NewClientApp.module.css";

type ServerRailItem = SavedServer | SessionMeta;

export interface ServerRailProps<T extends ServerRailItem = ServerRailItem> {
  items: readonly T[];
  expanded: boolean;
  activeId?: string | null;
  connecting?: boolean;
  label: string;
  onToggle: () => void;
  onSelect: (item: T) => void;
  onAdd: () => void;
}

function initials(label: string): string {
  return label.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function ServerRailEntry({ item, active, disabled, onSelect }: { item: ServerRailItem; active: boolean; disabled: boolean; onSelect: () => void }) {
  return <Button variant="bare" className={active ? styles.serverActive : styles.savedServer} disabled={disabled} onClick={onSelect} title={`Open ${item.label}`} leadingIcon={<span className={styles.serverMark}>{initials(item.label)}</span>} trailingIcon={<i className={styles.serverPresence} />}>
    <span className={styles.serverDetails}><strong>{item.label}</strong><small>{item.host}:{item.port}</small><em>{item.username}</em></span>
  </Button>;
}

export default function ServerRail<T extends ServerRailItem>({ items, expanded, activeId, connecting = false, label, onToggle, onSelect, onAdd }: ServerRailProps<T>) {
  return <aside className={styles.servers} aria-label={label} data-expanded={expanded}>
    <div className={styles.railHeader}><span>{activeId ? "CONNECTED" : "YOUR SERVERS"}</span><IconButton icon={expanded ? <ChevronLeftIcon /> : <ChevronRightIcon />} label={expanded ? "Collapse server sidebar" : "Expand server sidebar"} aria-expanded={expanded} onClick={onToggle} /></div>
    <div className={styles.serverLibrary}>{items.map((item) => <ServerRailEntry key={item.id} item={item} active={item.id === activeId} disabled={connecting} onSelect={() => onSelect(item)} />)}</div>
    <Button variant="ghost" className={styles.addServer} onClick={onAdd} leadingIcon={<PlusIcon />}>Add server</Button>
  </aside>;
}
