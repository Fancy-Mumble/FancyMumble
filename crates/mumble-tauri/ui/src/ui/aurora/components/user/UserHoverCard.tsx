import styles from "../../AuroraClientSurfaces.module.css";
import { useUserAvatar, useUserComment } from "@core/lazyBlobs";
import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { plainText } from "../htmlText";

export function UserHoverCard({ user }: { user: UserEntry }) {
  const avatar = useUserAvatar(user.session, user.texture_size);
  const comment = useUserComment(user.session, user.comment_size);
  const channel = useAppStore((state) => state.channels.find((item) => item.id === user.channel_id));
  const muted = user.mute || user.self_mute || user.suppress;
  return <aside className={`${styles.userHoverCard} ${styles.userHoverReadable}`} role="tooltip">
    <div className={styles.hoverBanner} />
    <div className={styles.hoverProfile}>
      {avatar ? <img src={avatar} alt="" /> : <span>{user.name.slice(0, 2).toUpperCase()}</span>}
      <i />
      <h3>{user.name}</h3>
      <small>{muted ? "Muted" : "Online"} · #{channel?.name ?? "Unknown"}</small>
      <p>{plainText(user.comment ?? comment) || "No profile description."}</p>
      <footer>Click the member to open their full profile</footer>
    </div>
  </aside>;
}
