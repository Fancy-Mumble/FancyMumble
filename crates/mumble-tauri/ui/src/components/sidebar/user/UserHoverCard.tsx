/**
 * UserHoverCard - a reusable hover trigger that shows the shared profile card
 * (`ProfilePreviewCard`) for a connected user.
 *
 * It wraps the exact hover-card wiring used by `UserListItem` (positioning,
 * lazy stats / avatar / comment parsing, stream thumbnail) so other surfaces
 * - the admin file-server dashboard, the registered-users panel - show the
 * same card on hover without duplicating that logic.
 *
 * Requires a live [`UserEntry`] (a currently-connected user); callers resolve
 * one from the store (by session, cert hash, or user id) before rendering.
 */

import { useContext, useMemo, type ReactNode } from "react";
import { useAppStore } from "../../../store";
import type { UserEntry } from "../../../types";
import { parseComment } from "../../../profileFormat";
import { useUserAvatar, useUserComment } from "../../../lazyBlobs";
import { useUserStats } from "../../../hooks/useUserStats";
import { colorFor } from "../../../utils/format";
import { useStreamThumbnail } from "../../chat/stream/useStreamPreview";
import { useHoverCardPosition, UserHoverCardPortal, RoleGroupsContext } from "./UserListItem";
import styles from "./UserHoverCard.module.css";

interface UserHoverCardProps {
  /** The connected user whose card to show. */
  readonly user: UserEntry;
  /** Trigger content; defaults to an avatar dot + the user's name. */
  readonly children?: ReactNode;
  readonly className?: string;
}

export default function UserHoverCard({ user, children, className }: UserHoverCardProps) {
  const isBroadcasting = useAppStore((s) => s.broadcastingSessions.has(user.session));
  const roleGroups = useContext(RoleGroupsContext);
  const userGroups = user.user_id != null ? (roleGroups.get(user.user_id) ?? []) : [];
  const { showCard, cardPos, itemRef, handleEnter, handleLeave } = useHoverCardPosition(isBroadcasting);
  const stats = useUserStats(user.session, showCard);
  const streamThumbnail = useStreamThumbnail(user.session, showCard && isBroadcasting);
  const url = useUserAvatar(user.session, user.texture_size);
  const liveComment = useUserComment(user.session, user.comment_size, showCard);
  const parsed = useMemo(
    () => {
      if (!showCard) return null;
      const c = user.comment ?? liveComment;
      return c ? parseComment(c) : null;
    },
    [showCard, user.comment, liveComment],
  );
  const isRegistered = user.user_id != null && user.user_id > 0;

  return (
    <>
      <button
        ref={itemRef}
        type="button"
        className={`${styles.trigger} ${className ?? ""}`}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
      >
        {children ?? (
          <span className={styles.default}>
            {url
              ? <img src={url} alt="" className={styles.avatar} />
              : <span className={styles.avatarFallback} style={{ background: colorFor(user.name) }}>{user.name.charAt(0).toUpperCase()}</span>}
            <span className={styles.name}>{user.name}</span>
          </span>
        )}
      </button>
      {showCard && cardPos && (
        <UserHoverCardPortal
          displayName={user.name}
          cardPos={cardPos}
          avatar={url}
          profile={parsed?.profile ?? {}}
          bio={parsed?.bio ?? ""}
          onlinesecs={stats?.onlinesecs}
          idlesecs={stats?.idlesecs}
          isRegistered={isRegistered}
          isBroadcasting={isBroadcasting}
          thumbnail={streamThumbnail}
          groups={userGroups.length > 0 ? userGroups : undefined}
        />
      )}
    </>
  );
}
