import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Button, Typography, alpha } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { PollPayload } from "@core/features/chat/poll/model";
import { getLocalVote, getVotes, pollsRevision, subscribeToPolls } from "@core/features/chat/poll/model";
import { CheckboxIcon, CircleDotIcon, CircleIcon, PollIcon, SquareIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { Stack } from "../primitives";

interface PollCardProps {
  readonly poll: PollPayload;
  /** The local user's session id. */
  readonly ownSession: number | null;
  /** Whether this poll sits inside the local user's own bubble. */
  readonly isOwn?: boolean;
  readonly onVote: (pollId: string, selected: number[]) => void;
}

/**
 * A poll inside the conversation.
 *
 * Standard carries a second palette for polls inside one's own (blue) bubble;
 * Nebula's own messages are not a coloured slab, so there is one card here and
 * `isOwn` only decides how hard it has to work to stay legible over the tint.
 *
 * The fill behind a voted option is a bar, not a background: it is the result,
 * and it has to be readable behind the option's own text, which is why it sits
 * under an explicitly stacked label rather than being the row's `background`.
 */
export default function PollCard({ poll, ownSession, isOwn, onVote }: Readonly<PollCardProps>) {
  const { t } = useTranslation("chat");

  // The poll store is plain Maps, so a write to it is invisible to React. This
  // subscribes to it, which is what makes a *remote* vote appear.
  useSyncExternalStore(subscribeToPolls, pollsRevision, pollsRevision);

  const votes = getVotes(poll.id);
  const myVote = ownSession != null ? votes.find((v) => v.voter === ownSession) : undefined;
  const localVote = getLocalVote(poll.id);
  const hasVoted = !!myVote || !!localVote;
  const mySelected = myVote?.selected ?? localVote ?? [];

  const voteCounts = useMemo(() => {
    const counts: number[] = new Array(poll.options.length).fill(0);
    for (const v of votes) {
      for (const idx of v.selected) {
        if (idx >= 0 && idx < counts.length) counts[idx]++;
      }
    }
    return counts;
  }, [votes, poll.options.length]);

  const totalVoters = votes.length;
  const totalVotes = voteCounts.reduce((a, b) => a + b, 0);

  const [pendingSelection, setPendingSelection] = useState<number[]>([]);

  const handleOptionClick = useCallback(
    (idx: number) => {
      if (hasVoted) return;
      if (poll.multiple) {
        setPendingSelection((prev) => (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]));
      } else {
        onVote(poll.id, [idx]);
      }
    },
    [hasVoted, poll.multiple, poll.id, onVote],
  );

  const handleSubmitMultiple = useCallback(() => {
    if (pendingSelection.length === 0) return;
    onVote(poll.id, pendingSelection);
    setPendingSelection([]);
  }, [pendingSelection, poll.id, onVote]);

  return (
    <Box
      sx={(theme) => ({
        minWidth: 240,
        maxWidth: 340,
        px: "14px",
        py: "12px",
        borderRadius: radius("md"),
        background: isOwn ? theme.palette.nebula.bg0 : theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: "8px" }}>
        <Box sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.accent })}>
          <PollIcon width={16} height={16} />
        </Box>
        <Typography
          sx={(theme) => ({
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: theme.palette.nebula.accent,
          })}
        >
          {t("poll.header")}
        </Typography>
        <Typography noWrap sx={(theme) => ({ ml: "auto", fontSize: 11, color: theme.palette.nebula.muted })}>
          {t("poll.by", { name: poll.creatorName })}
        </Typography>
      </Stack>

      <Typography component="h4" sx={{ m: 0, mb: "10px", fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>
        {poll.question}
      </Typography>

      <Stack gap={0.5}>
        {poll.options.map((option, i) => {
          const count = voteCounts[i];
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isSelected = hasVoted ? mySelected.includes(i) : pendingSelection.includes(i);
          const voterNames = hasVoted
            ? votes.filter((v) => v.selected.includes(i) && v.voterName).map((v) => v.voterName)
            : [];
          const Marker = poll.multiple
            ? isSelected
              ? CheckboxIcon
              : SquareIcon
            : isSelected
              ? CircleDotIcon
              : CircleIcon;

          return (
            <Box
              key={`${i}:${option}`}
              component="button"
              type="button"
              onClick={() => handleOptionClick(i)}
              disabled={hasVoted}
              sx={(theme) => {
                const { nebula } = theme.palette;
                return {
                  all: "unset",
                  boxSizing: "border-box",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  overflow: "hidden",
                  px: "12px",
                  py: "8px",
                  borderRadius: radius("md"),
                  fontSize: 13,
                  cursor: hasVoted ? "default" : "pointer",
                  color: nebula.text,
                  border: `1px solid ${isSelected ? nebula.accentLine : nebula.line}`,
                  background: isSelected && !hasVoted ? nebula.accentSoft : "transparent",
                  transition: "border-color 0.15s, background 0.15s",
                  "&:hover": hasVoted ? undefined : { borderColor: nebula.accentLine },
                };
              }}
            >
              {hasVoted && (
                <Box
                  aria-hidden
                  sx={(theme) => ({
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${pct}%`,
                    pointerEvents: "none",
                    borderRadius: radius("md"),
                    background: alpha(theme.palette.nebula.accent, 0.16),
                    transition: "width 0.4s ease-out",
                  })}
                />
              )}
              <Stack
                direction="row"
                alignItems="center"
                gap={0.75}
                sx={{ position: "relative", zIndex: 1, minWidth: 0 }}
              >
                {!hasVoted && (
                  <Box sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.muted })}>
                    <Marker width={14} height={14} />
                  </Box>
                )}
                <Box component="span" sx={{ minWidth: 0 }}>
                  {option}
                </Box>
              </Stack>
              {hasVoted && (
                <Typography
                  sx={(theme) => ({
                    position: "relative",
                    zIndex: 1,
                    flex: "none",
                    ml: "auto",
                    fontSize: 12,
                    fontWeight: 600,
                    color: theme.palette.nebula.muted,
                  })}
                >
                  {pct}%
                </Typography>
              )}
              {hasVoted && voterNames.length > 0 && (
                <Typography
                  noWrap
                  title={voterNames.join(", ")}
                  sx={(theme) => ({
                    position: "relative",
                    zIndex: 1,
                    flex: "none",
                    maxWidth: 120,
                    fontSize: 10,
                    color: theme.palette.nebula.dim,
                  })}
                >
                  {voterNames.join(", ")}
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>

      {poll.multiple && !hasVoted && pendingSelection.length > 0 && (
        <Button variant="contained" fullWidth size="small" onClick={handleSubmitMultiple} sx={{ mt: "8px" }}>
          {t("poll.voteButton", { count: pendingSelection.length })}
        </Button>
      )}

      <Typography sx={(theme) => ({ mt: "8px", fontSize: 11, color: theme.palette.nebula.muted })}>
        {t("poll.totalVotes", { count: totalVoters })}
        {poll.multiple && ` · ${t("poll.multipleChoice")}`}
      </Typography>
    </Box>
  );
}
