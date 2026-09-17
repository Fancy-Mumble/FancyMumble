import { useAppStore } from "@core/store";
import { useHoverTarget, useProfileAnchor } from "../../clientState";
import { ProfileCard } from "./ProfileCard";

interface HoverProfileCardProps {
  /** Open the conversation with this person. */
  onMessage: (session: number) => void;
}

/**
 * The one profile card, and the decision about whose it is.
 *
 * Hovering and clicking do not open two cards: there is one, for the person
 * pinned by a click or - with nothing pinned - the one the pointer is resting
 * on, so what a hover shows is exactly what the click keeps. That much has
 * always been true; what moved is where the decision is made.
 *
 * It used to be three lines in the shell, which meant the shell subscribed to
 * the hovered row. A pointer sweeping down a roster then re-rendered the whole
 * client once per row that survived the dwell - the conversation, the channel
 * tree, every mounted message row - to show one card. Here, the card is the
 * only thing that renders.
 */
export function HoverProfileCard({ onMessage }: Readonly<HoverProfileCardProps>) {
  const hover = useHoverTarget();
  const pinnedAnchor = useProfileAnchor();
  const selectedUser = useAppStore((state) => state.selectedUser);
  const session = selectedUser ?? hover?.session ?? null;
  const user = useAppStore((state) => state.users.find((entry) => entry.session === session));
  if (!user) return null;

  const pinned = selectedUser !== null;
  return (
    <ProfileCard
      user={user}
      anchor={pinned ? pinnedAnchor : (hover?.anchor ?? null)}
      pinned={pinned}
      onClose={() => useAppStore.getState().selectUser(null)}
      onMessage={onMessage}
    />
  );
}
