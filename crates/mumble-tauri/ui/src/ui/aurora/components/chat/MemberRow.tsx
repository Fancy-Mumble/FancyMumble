import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { HeadphonesOffIcon, MicIcon, MicOffIcon } from "@ui/icons";
import styles from "../../AuroraClientApp.module.css";
import { Button } from "../primitives";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export type MemberRowProps = {
  user: UserEntry;
  own: boolean;
  talking: boolean;
  onHover: (session: number | null) => void;
};

export default function MemberRow({ user, own, talking, onHover }: MemberRowProps) {
  // Server flag and self flag read the same from the outside, so both fold into
  // one indicator - the distinction belongs in the profile card. Deafening
  // implies muting on the wire, so deafened supersedes muted and shows the one
  // icon that says the most.
  const deafened = user.deaf || user.self_deaf;
  const muted = user.self_mute || user.mute || user.suppress;
  const offline = user.session < 0;
  return (
    <Button
      variant="bare"
      wrapLabel={false}
      className={styles.member}
      onClick={() => {
        if (!offline) useAppStore.getState().selectUser(user.session);
      }}
      onMouseEnter={() => onHover(offline ? null : user.session)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(offline ? null : user.session)}
      onBlur={() => onHover(null)}
    >
      <span className={`${styles.avatar} ${talking ? styles.avatarTalking : ""}`}>{initials(user.name)}</span>
      <span>
        <strong>
          {user.name}
          {own ? " (you)" : ""}
        </strong>
        <small>
          {offline
            ? "Offline · registered"
            : deafened
              ? "Muted and deafened"
              : muted
                ? "Muted"
                : talking
                  ? "Speaking"
                  : "Listening"}
        </small>
      </span>
      {!offline && (deafened ? <HeadphonesOffIcon /> : muted ? <MicOffIcon /> : <MicIcon />)}
    </Button>
  );
}
