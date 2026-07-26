import extensionStyles from "../../AuroraClientExtensions.module.css";
import styles from "../../AuroraClientSurfaces.module.css";
import { Button, IconButton, UserActions } from "../../components";
import { useMemo } from "react";
import { useUserAvatar, useUserComment } from "@core/lazyBlobs";
import { parseComment } from "@core/profileFormat";
import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { PERMISSIONS } from "@core/utils/permissions";
import { CloseIcon, UsersGroupIcon } from "@ui/icons";
import Fact from "../primitives/Fact";
import { plainText } from "../htmlText";

export function UserCard({ user, onClose }: { user: UserEntry; onClose: () => void }) {
  const avatar = useUserAvatar(user.session, user.texture_size);
  const liveComment = useUserComment(user.session, user.comment_size);
  const channel = useAppStore((state) => state.channels.find((item) => item.id === user.channel_id));
  const muted = user.mute || user.self_mute || user.suppress;
  // See UserHoverCard: the profile JSON lives in an HTML comment, so the raw
  // string has to be split before the bio is readable.
  const { profile, bio } = useMemo(() => {
    const comment = user.comment || liveComment;
    return comment ? parseComment(comment) : { profile: null, bio: "" };
  }, [user.comment, liveComment]);
  const effectivePermissions =
    channel?.permissions == null
      ? "Not reported"
      : PERMISSIONS.filter((permission) => (channel.permissions! & permission.bit) !== 0)
          .map((permission) => permission.label)
          .join(", ") || "None";
  const openDirectMessage = async () => {
    await useAppStore.getState().selectDmUser(user.session);
    onClose();
  };
  return (
    <aside
      className={`${styles.userCard} ${extensionStyles.userCardScrollable}`}
      aria-label={`${user.name} profile`}
    >
      <header>
        <IconButton icon={<CloseIcon />} label="Close profile" onClick={onClose} />
      </header>
      <div className={styles.profileBody}>
        {avatar ? (
          <img src={avatar} alt="" />
        ) : (
          <span className={styles.profileAvatar}>{user.name.slice(0, 2).toUpperCase()}</span>
        )}
        <i className={styles.online} />
        <h2 style={profile?.nameStyle?.color ? { color: profile.nameStyle.color } : undefined}>
          {user.name}
        </h2>
        <small>
          {profile?.status ? `${profile.status} · ` : ""}
          {muted ? "Muted" : "Online"} · #{channel?.name ?? "Unknown"}
        </small>
        <p>{plainText(bio) || "This user has not added a profile description yet."}</p>
        <div className={styles.profileFacts}>
          <Fact label="Account" value={user.user_id == null ? "Guest" : `Registered #${user.user_id}`} />
          <Fact label="Voice" value={muted ? "Muted" : "Available"} />
          <Fact label="Certificate" value={user.hash || "Not available"} />
          <Fact label="Your access here" value={effectivePermissions} />
        </div>
        <Button variant="primary" leadingIcon={<UsersGroupIcon />} onClick={() => void openDirectMessage()}>
          Open direct message
        </Button>
        <UserActions user={user} />
      </div>
    </aside>
  );
}
