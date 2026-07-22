import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { MicIcon, MicOffIcon } from "@ui/icons";
import styles from "../../NewClientApp.module.css";
import { Button } from "../primitives";

function initials(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase(); }

export type MemberRowProps = { user: UserEntry; own: boolean; talking: boolean; onHover: (session: number | null) => void };

export default function MemberRow({ user, own, talking, onHover }: MemberRowProps) {
  const muted = user.self_mute || user.mute || user.suppress;
  return <Button variant="bare" wrapLabel={false} className={styles.member} onClick={() => useAppStore.getState().selectUser(user.session)} onMouseEnter={() => onHover(user.session)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(user.session)} onBlur={() => onHover(null)}>
    <span className={`${styles.avatar} ${talking ? styles.avatarTalking : ""}`}>{initials(user.name)}</span>
    <span><strong>{user.name}{own ? " (you)" : ""}</strong><small>{talking ? "Speaking" : muted ? "Muted" : "Listening"}</small></span>
    {muted ? <MicOffIcon /> : <MicIcon />}
  </Button>;
}
