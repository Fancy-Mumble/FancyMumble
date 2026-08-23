/**
 * What Nebula knows about a person, in the shape the shared card draws.
 *
 * Every surface that shows a user - the floating card, the pointer preview, the
 * settings live preview - builds its model here. That is the whole point: the
 * card cannot drift between views because there is one component, and the
 * content cannot drift because there is one hook filling it.
 */
import { useMemo } from "react";
import { useUserAvatar, useUserComment } from "@core/lazyBlobs";
import { parseComment } from "@core/profileFormat";
import { useAppStore } from "@core/store";
import type { AclGroup, UserEntry } from "@core/types";
import {
  badgeFromGroup,
  badgesFromState,
  formatCount,
  formatSpan,
  type CardActivity,
  type CardStat,
  type ProfileBadge,
  type ProfileCardModel,
  type ProfileCardTokens,
  type ProfileRole,
} from "@shared/profilecard";
import { useAclGroups } from "@ui/standard/hooks/useAclGroups";
import { useUserStats } from "@ui/standard/hooks/useUserStats";

/** The groups a registered user is in, from the root channel's ACL. */
export function groupsOf(groups: readonly AclGroup[], userId: number | null | undefined): AclGroup[] {
  if (userId == null) return [];
  return groups.filter((group) => {
    if (group.remove.includes(userId)) return false;
    return group.add.includes(userId) || group.inherited_members.includes(userId);
  });
}

/**
 * The label under the presence dot in the banner.
 *
 * Names the channel when there is one, because "In Gaming" is the fact anyone
 * opening a card in a voice app is looking for; anything else is a fallback for
 * a user the session knows about but cannot place.
 */
function presenceOf(
  user: UserEntry,
  channelName: string | undefined,
  muted: boolean,
  deafened: boolean,
  talking: boolean,
): ProfileCardModel["presence"] {
  if (user.session < 0) return { tone: "offline", label: "Offline" };
  const label = channelName ? `In ${channelName}` : "Connected";
  if (deafened) return { tone: "deafened", label };
  if (muted) return { tone: "muted", label };
  return { tone: talking ? "talking" : "online", label };
}

export function useUserCardModel(user: UserEntry, tokens: ProfileCardTokens): ProfileCardModel {
  const avatar = useUserAvatar(user.session, user.texture_size);
  const liveComment = useUserComment(user.session, user.comment_size);
  const stats = useUserStats(user.session, user.session >= 0);
  const aclGroups = useAclGroups();
  const channel = useAppStore((state) => state.channels.find((entry) => entry.id === user.channel_id));
  const talking = useAppStore((state) => state.talkingSessions.has(user.session));
  const own = useAppStore((state) => state.ownSession === user.session);
  const messages = useAppStore((state) => state.messages);
  // Only the local machine's presence exists client-side - Mumble carries no
  // activity field - so a game only ever shows on your own card. Everyone
  // else's activity row is the one thing the server does say: where they are.
  const presence = useAppStore((state) => (own ? state.richPresence[0] : undefined));

  // The profile JSON rides inside an HTML comment on the user's bio, so the
  // raw string has to be split before either half is usable.
  const { profile, bio } = useMemo(() => {
    const comment = user.comment || liveComment;
    return comment ? parseComment(comment) : { profile: null, bio: "" };
  }, [user.comment, liveComment]);

  const muted = user.mute || user.self_mute || user.suppress;
  const deafened = user.deaf || user.self_deaf;

  const roleGroups = useMemo(() => groupsOf(aclGroups, user.user_id), [aclGroups, user.user_id]);
  const roles = useMemo<ProfileRole[]>(
    () => roleGroups.map((group) => ({ id: group.name, name: group.name, color: group.color })),
    [roleGroups],
  );

  const badges = useMemo<ProfileBadge[]>(() => {
    const granted = roleGroups
      .map((group) => badgeFromGroup(group))
      .filter((badge): badge is ProfileBadge => badge !== null);
    return [
      ...granted,
      ...badgesFromState(
        { prioritySpeaker: user.priority_speaker, muted, deafened },
        { warn: tokens.warn, bad: tokens.bad },
      ),
    ];
  }, [roleGroups, user.priority_speaker, muted, deafened, tokens.warn, tokens.bad]);

  const activity = useMemo<CardActivity | null>(() => {
    if (presence) {
      const detail = [presence.activity.details, presence.activity.state]
        .filter(Boolean)
        .join(" · ");
      const started = presence.activity.timestamps?.start;
      const elapsed = started ? formatSpan((Date.now() - started) / 1000) : null;
      return {
        title: presence.displayName,
        detail: [detail, elapsed].filter(Boolean).join(" · "),
        image: presence.largeImageUrl,
      };
    }
    if (!channel) return null;
    return {
      title: `In voice — ${channel.name}`,
      detail: [
        stats?.onlinesecs != null ? formatSpan(stats.onlinesecs) : null,
        deafened ? "deafened" : muted ? "muted" : talking ? "talking" : "listening",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }, [presence, channel, stats?.onlinesecs, muted, deafened, talking]);

  const stats3 = useMemo<CardStat[]>(() => {
    const sent = messages.filter((message) =>
      user.hash ? message.sender_hash === user.hash : message.sender_session === user.session,
    ).length;
    const rows: CardStat[] = [{ id: "messages", value: formatCount(sent), label: "Messages" }];
    if (stats?.onlinesecs != null)
      rows.push({ id: "voice", value: formatSpan(stats.onlinesecs), label: "In voice" });
    rows.push({
      id: "account",
      value: user.user_id == null ? "Guest" : `#${user.user_id}`,
      label: user.user_id == null ? "Account" : "Registered",
    });
    return rows;
  }, [messages, user.hash, user.session, user.user_id, stats?.onlinesecs]);

  return {
    name: user.name,
    // Keyed on the certificate hash where there is one: a user keeps their
    // colour across a rename, and two people sharing a nickname do not share a
    // card.
    tintKey: user.hash || user.name,
    avatar,
    profile,
    bio,
    presence: presenceOf(user, channel?.name, muted, deafened, talking),
    verified: user.user_id != null,
    badges,
    shelves: [],
    roles,
    // The store holds users for the active server only, so how many servers two
    // people share is not a question this client can answer yet. Left null so
    // the row hides rather than claiming a number nothing backs.
    mutualServers: null,
    activity,
    stats: stats3,
  };
}
