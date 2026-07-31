import type { MentionCandidate } from "@standard/components/chat/mention/MentionAutocomplete";
import { Button } from "../../primitives";
import styles from "../../../AuroraClientExtensions.module.css";

/** What a candidate is called in the list. */
function candidateLabel(candidate: MentionCandidate): string {
  switch (candidate.kind) {
    case "user":
      return candidate.name;
    case "role":
      return `@${candidate.name}`;
    case "everyone":
      return "@everyone";
    case "here":
      return "@here";
  }
}

/** The muted right-hand hint explaining what the row mentions. */
function candidateHint(candidate: MentionCandidate): string {
  switch (candidate.kind) {
    case "user":
      return "Member";
    case "role":
      return "Role";
    case "everyone":
      return "Everyone in the channel";
    case "here":
      return "Everyone online";
  }
}

function MentionRow({
  candidate,
  active,
  onPick,
}: {
  candidate: MentionCandidate;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <Button
      variant="bare"
      role="option"
      aria-selected={active}
      className={`${styles.suggestionRow} ${active ? styles.suggestionRowActive : ""}`}
      // Picking must not steal focus from the editor before the range edit runs.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
    >
      <strong>{candidateLabel(candidate)}</strong>
      <small>{candidateHint(candidate)}</small>
    </Button>
  );
}

export interface MentionSuggestionsProps {
  candidates: readonly MentionCandidate[];
  activeIndex: number;
  onPick: (candidate: MentionCandidate) => void;
}

/** Candidates for the `@` being typed, above the composer. Renders nothing
 *  when there is no active trigger, so the caller can mount it flatly. */
export default function MentionSuggestions({ candidates, activeIndex, onPick }: MentionSuggestionsProps) {
  if (candidates.length === 0) return null;
  return (
    <div className={styles.suggestions} role="listbox" aria-label="Mention suggestions">
      {candidates.map((candidate, index) => (
        <MentionRow
          key={
            candidate.kind === "user"
              ? `user-${candidate.session}`
              : candidate.kind === "role"
                ? `role-${candidate.name}`
                : candidate.kind
          }
          candidate={candidate}
          active={index === activeIndex}
          onPick={() => onPick(candidate)}
        />
      ))}
    </div>
  );
}
