import { useMemo } from "react";
import { useUserAvatar, useUserComment } from "@core/lazyBlobs";
import { parseComment } from "@core/profileFormat";
import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { plainText } from "../htmlText";
import styles from "../../AuroraClientSurfaces.module.css";

export function UserHoverCard({ user }: { user: UserEntry }) {
  const avatar = useUserAvatar(user.session, user.texture_size);
  const liveComment = useUserComment(user.session, user.comment_size);
  const channel = useAppStore((state) => state.channels.find((item) => item.id === user.channel_id));
  const muted = user.mute || user.self_mute || user.suppress;

  // A FancyMumble comment is `<!--FANCY:{json}-->\n<bio>`. Rendering it raw
  // showed nothing: the profile JSON is inside an HTML comment, which strips to
  // an empty string, taking the bio's leading newline with it. `||` rather than
  // `??` because an empty comment string is "no comment", not "comment of ''",
  // and must still fall through to the lazily fetched one.
  const { profile, bio } = useMemo(() => {
    const comment = user.comment || liveComment;
    return comment ? parseComment(comment) : { profile: null, bio: "" };
  }, [user.comment, liveComment]);

  const description = plainText(bio);
  const banner = profile?.banner;
  const accent = profile?.themeColors?.[0] ?? profile?.nameStyle?.color;

  return (
    <aside className={`${styles.userHoverCard} ${styles.userHoverReadable}`} role="tooltip">
      <div
        className={styles.hoverBanner}
        style={
          banner?.image
            ? { backgroundImage: `url(${banner.image})`, backgroundSize: "cover" }
            : banner?.color
              ? { background: banner.color }
              : undefined
        }
      />
      <div className={styles.hoverProfile}>
        {avatar ? <img src={avatar} alt="" /> : <span>{user.name.slice(0, 2).toUpperCase()}</span>}
        <i />
        <h3 style={accent ? { color: accent } : undefined}>{user.name}</h3>
        <small>
          {profile?.status ? `${profile.status} · ` : ""}
          {muted ? "Muted" : "Online"} · #{channel?.name ?? "Unknown"}
        </small>
        <p>{description || "No profile description."}</p>
        <footer>Click the member to open their full profile</footer>
      </div>
    </aside>
  );
}
