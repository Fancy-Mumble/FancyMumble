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

export function registerVote(vote: PollVotePayload): void {
  const previous = votes.get(vote.pollId) ?? [];
  votes.set(vote.pollId, [
    ...previous.filter((candidate) => candidate.voter !== vote.voter),
    vote,
  ]);
}

export function getVotes(pollId: string): PollVotePayload[] {
  return votes.get(pollId) ?? [];
}

export function registerPoll(poll: PollPayload): void {
  polls.set(poll.id, poll);
}

export function getPoll(pollId: string): PollPayload | undefined {
  return polls.get(pollId);
}

export function registerLocalVote(pollId: string, selected: number[]): void {
  localVotes.set(pollId, selected);
}

export function getLocalVote(pollId: string): number[] | undefined {
  return localVotes.get(pollId);
}
