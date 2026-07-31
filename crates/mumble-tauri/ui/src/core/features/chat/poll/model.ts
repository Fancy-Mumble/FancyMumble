/** UI-independent poll payloads and in-memory session state. */
export interface PollPayload {
  type: "poll";
  id: string;
  question: string;
  options: string[];
  multiple: boolean;
  creator: number;
  creatorName: string;
  createdAt: string;
  channelId: number;
}

export interface PollVotePayload {
  type: "poll_vote";
  pollId: string;
  selected: number[];
  voter: number;
  voterName: string;
}

const votes = new Map<string, PollVotePayload[]>();
const polls = new Map<string, PollPayload>();
const localVotes = new Map<string, number[]>();

/**
 * Subscribers to notify when this store changes.
 *
 * These are plain `Map`s, so writing to one is invisible to React. A card that
 * only re-rendered when its own click handler called `forceUpdate` therefore
 * showed the local user's vote immediately and a remote one never — the vote
 * arrived and was recorded, and nothing redrew. Anything else that re-rendered
 * the message tree made it appear, which is what made it look intermittent.
 */
const listeners = new Set<() => void>();

/** Register `listener`, returning its unsubscribe. For `useSyncExternalStore`. */
export function subscribeToPolls(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A value that changes whenever the store does, for `useSyncExternalStore`. */
export function pollsRevision(): number {
  return revision;
}

let revision = 0;

function emit(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function registerVote(vote: PollVotePayload): void {
  const previous = votes.get(vote.pollId) ?? [];
  votes.set(vote.pollId, [...previous.filter((candidate) => candidate.voter !== vote.voter), vote]);
  emit();
}

export function getVotes(pollId: string): PollVotePayload[] {
  return votes.get(pollId) ?? [];
}

export function registerPoll(poll: PollPayload): void {
  polls.set(poll.id, poll);
  emit();
}

export function getPoll(pollId: string): PollPayload | undefined {
  return polls.get(pollId);
}

export function registerLocalVote(pollId: string, selected: number[]): void {
  localVotes.set(pollId, selected);
  emit();
}

export function getLocalVote(pollId: string): number[] | undefined {
  return localVotes.get(pollId);
}
