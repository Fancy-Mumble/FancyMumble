import { useState } from "react";
import type { UserEntry } from "@core/types";
import { MemberSidebar } from "../index";
import styles from "./ServerRailSpecimen.module.css";

/**
 * The real client member sidebar, driven by fixtures.
 *
 * Same reasoning as ServerRailSpecimen: the connected client needs a live
 * server, so this is the only automated regression surface for the roster's
 * layout, scope toggle, and talking/own-user states.
 */
const member = (session: number, name: string, extra: Partial<UserEntry> = {}) =>
  ({ session, name, channel_id: 1, user_id: session, ...extra }) as UserEntry;

const members = [
  member(1, "Morgan Oakes"),
  member(2, "Alex Kim"),
  member(3, "Sam Rivera", { self_mute: true }),
  member(4, "Jo Lee", { self_deaf: true }),
];

export default function MemberSidebarSpecimen() {
  const [scope, setScope] = useState<"channel" | "server">("channel");
  const [query, setQuery] = useState("");
  return (
    <div className={styles.stage}>
      <div className={`${styles.pane} ${styles.tallPane}`}>
        <small>ROSTER</small>
        <MemberSidebar
          members={members}
          scope={scope}
          onScopeChange={setScope}
          query={query}
          onQueryChange={setQuery}
          ownSession={1}
          talkingSessions={new Set([2])}
          onHoverMember={() => undefined}
        />
      </div>
    </div>
  );
}
