import type { UserEntry } from "@core/types";
import { UsersGroupIcon } from "@ui/icons";
import { Button, MemberRow, SearchField } from "../index";
import styles from "../../AuroraClientApp.module.css";
import extensionStyles from "../../AuroraClientExtensions.module.css";

export interface MemberSidebarProps {
  members: readonly UserEntry[];
  scope: "channel" | "server";
  onScopeChange: (scope: "channel" | "server") => void;
  query: string;
  onQueryChange: (query: string) => void;
  ownSession: number | null;
  talkingSessions: ReadonlySet<number>;
  onHoverMember: (session: number | null) => void;
}

/** Roster for the current channel, or the whole server. */
export default function MemberSidebar({
  members,
  scope,
  onScopeChange,
  query,
  onQueryChange,
  ownSession,
  talkingSessions,
  onHoverMember,
}: MemberSidebarProps) {
  return (
    <aside className={styles.members}>
      <div className={styles.panelHeader}>
        <div>
          <small>{scope === "channel" ? "IN THIS CHANNEL" : "SERVER MEMBERS"}</small>
          <strong>
            {members.length} {scope === "channel" ? "online" : "members"}
          </strong>
        </div>
        <UsersGroupIcon />
      </div>
      <div className={extensionStyles.memberTools}>
        <SearchField
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Find members"
          aria-label="Search members"
        />
        <div>
          <Button
            variant={scope === "channel" ? "secondary" : "bare"}
            onClick={() => onScopeChange("channel")}
          >
            Channel
          </Button>
          <Button variant={scope === "server" ? "secondary" : "bare"} onClick={() => onScopeChange("server")}>
            Server
          </Button>
        </div>
      </div>
      <div className={styles.memberList}>
        {members.map((user) => (
          <MemberRow
            key={user.session}
            user={user}
            own={user.session === ownSession}
            talking={talkingSessions.has(user.session)}
            onHover={onHoverMember}
          />
        ))}
      </div>
    </aside>
  );
}
