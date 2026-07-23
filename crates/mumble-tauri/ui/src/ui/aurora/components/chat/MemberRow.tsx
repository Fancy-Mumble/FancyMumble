import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { MicIcon, MicOffIcon } from "@ui/icons";
import styles from "../../AuroraClientApp.module.css";
import { Button } from "../primitives";

function initials(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase(); }

export type MemberRowProps = { user: UserEntry; own: boolean; talking: boolean; onHover: (session: number | null) => void };

export default function MemberRow({ user, own, talking, onHover }: MemberRowProps) {
  const muted = user.self_mute || user.mute || user.suppress;
  const offline = user.session < 0;
  return <Button variant="bare" wrapLabel={false} className={styles.member} onClick={() => { if (!offline) useAppStore.getState().selectUser(user.session); }} onMouseEnter={() => onHover(offline ? null : user.session)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(offline ? null : user.session)} onBlur={() => onHover(null)}>
    <span className={`${styles.avatar} ${talking ? styles.avatarTalking : ""}`}>{initials(user.name)}</span>
    <span><strong>{user.name}{own ? " (you)" : ""}</strong><small>{offline ? "Offline · registered" : talking ? "Speaking" : muted ? "Muted" : "Listening"}</small></span>
    {!offline && (muted ? <MicOffIcon /> : <MicIcon />)}
  </Button>;
}
