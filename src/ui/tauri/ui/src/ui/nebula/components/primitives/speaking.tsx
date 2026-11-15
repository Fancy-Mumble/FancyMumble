import { useAppStore } from "@core/store";
import { TalkingBars } from "./TalkingBars";
import { UserAvatar } from "./UserAvatar";

/**
 * Whether this one person currently has the floor.
 *
 * Asked per person, deliberately. The talking set is replaced on every edge of
 * every utterance - several times a second in a busy channel - so anything
 * holding the set itself re-renders at that rate and drags its whole subtree
 * with it. The shell used to hold it, which is how a push-to-talk tap came to
 * re-render the conversation and every message in it.
 *
 * A boolean compares equal to itself, so a row asking this way renders again
 * only when the answer about *that person* changes, and the rows either side
 * of them do nothing at all.
 */
export function useIsTalking(session: number | null | undefined): boolean {
  return useAppStore((state) => (session == null ? false : state.talkingSessions.has(session)));
}

/** `UserAvatar` that asks for itself whether its person is speaking. */
export function SpeakingAvatar({
  session,
  ...rest
}: Readonly<Omit<React.ComponentProps<typeof UserAvatar>, "talking">>) {
  return <UserAvatar session={session} talking={useIsTalking(session)} {...rest} />;
}

/** `TalkingBars` that asks for itself whether its person is speaking. */
export function SpeakingBars({ session }: Readonly<{ session: number | null | undefined }>) {
  return <TalkingBars talking={useIsTalking(session)} />;
}
