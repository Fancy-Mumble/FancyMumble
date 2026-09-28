/**
 * A channel's member list, which opens a slot for a user being carried to it.
 *
 * The arithmetic and the measuring are `@ui/userCarry`'s, shared with Nebula;
 * what this adds is Standard's own row wrapper, and the class that eases the
 * step aside.
 */

import type { ReactNode } from "react";
import { useCarryRoom } from "@ui/userCarry";
import type { UserEntry } from "@core/types";
import styles from "./userMoveRoom.module.css";

export function MemberSlots({
  channelId,
  members,
  order,
  className,
  rowClassName,
  children,
}: Readonly<{
  channelId: number;
  /** The channel's members, in the order they are drawn. */
  members: readonly UserEntry[];
  /** Every user the list knows, which is what fixes the arriving row's seat. */
  order: readonly UserEntry[];
  className?: string;
  rowClassName?: (user: UserEntry) => string | undefined;
  children: (user: UserEntry) => ReactNode;
}>) {
  const { room, carrying, registerRow } = useCarryRoom(channelId, members, order);
  const moving = carrying ? styles.moving : undefined;

  return (
    <div
      className={[className, moving].filter(Boolean).join(" ")}
      // A press on a member is theirs to carry, never the channel's.
      data-no-channel-drag="true"
      // The rows that stepped down would otherwise hang out of the bottom of
      // the channel card; this is the only thing the gap actually lays out.
      style={room ? { marginBottom: room.step } : undefined}
    >
      {members.map((user) => {
        const offset = room?.offsets.get(user.session);
        return (
          <div
            key={user.session}
            ref={(element) => registerRow(user.session, element)}
            className={[rowClassName?.(user), moving].filter(Boolean).join(" ") || undefined}
            style={offset ? { transform: `translateY(${offset}px)` } : undefined}
          >
            {children(user)}
          </div>
        );
      })}
    </div>
  );
}
