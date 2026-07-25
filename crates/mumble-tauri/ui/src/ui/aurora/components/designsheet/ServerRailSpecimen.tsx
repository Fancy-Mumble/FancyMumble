import ServerRail, { type RailGroup } from "../navigation/ServerRail";
import styles from "./ServerRailSpecimen.module.css";

/**
 * The real client ServerRail, both collapsed and expanded.
 *
 * The connected client cannot be screenshotted without a live server, so the
 * rail is exercised here instead - this is the only automated regression
 * surface for its collapsed/expanded styling.
 */
const groups: RailGroup[] = [
  {
    key: "voice.example.com:64738",
    label: "Fancy studio",
    host: "voice.example.com",
    port: 64738,
    favorite: true,
    identities: [
      { id: "a", label: "Fancy studio", host: "voice.example.com", port: 64738, username: "morgan", favorite: true, sessionId: "s1" },
      { id: "b", label: "Fancy studio", host: "voice.example.com", port: 64738, username: "morgan.alt" },
    ],
  },
  {
    key: "chat.example.org:64738",
    label: "Design guild",
    host: "chat.example.org",
    port: 64738,
    favorite: false,
    identities: [
      { id: "c", label: "Design guild", host: "chat.example.org", port: 64738, username: "alex" },
    ],
  },
];

const noop = () => undefined;

export default function ServerRailSpecimen() {
  return (
    <div className={styles.stage}>
      <div className={styles.pane}>
        <small>COLLAPSED</small>
        <ServerRail groups={groups} expanded={false} activeSessionId="s1" label="Servers" onToggle={noop} onSelect={noop} onAdd={noop} />
      </div>
      <div className={styles.pane}>
        <small>EXPANDED</small>
        <ServerRail groups={groups} expanded activeSessionId="s1" label="Servers" onToggle={noop} onSelect={noop} onAdd={noop} />
      </div>
    </div>
  );
}
