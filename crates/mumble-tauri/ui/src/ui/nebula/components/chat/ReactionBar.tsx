import { Box, Tooltip } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ReactionSummary } from "@core/features/chat/reaction/reactionStore";
import { isMobile } from "@core/utils/platform";
import { Stack } from "../primitives";

interface ReactionBarProps {
  readonly reactions: readonly ReactionSummary[];
  /** Own cert hash, for marking which pills are ours. */
  readonly ownHash?: string;
  /** Whether this message is the local user's (controls alignment). */
  readonly isOwn?: boolean;
  readonly onToggle: (emoji: string) => void;
  readonly onAdd: (e: React.MouseEvent) => void;
}

/** Shape shared by the reaction pills and the "+" that adds one. */
const PILL = {
  all: "unset",
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  cursor: "pointer",
  px: "9px",
  py: "2px",
  borderRadius: "999px",
  lineHeight: 1.4,
  transition: "background 0.12s, border-color 0.12s",
} as const;

/** Who reacted, at the length a pill's tooltip can hold. */
function reactorLabel(reaction: ReactionSummary): string {
  const unique = [...new Set(reaction.reactorHashNames.values())];
  return unique.length <= 3 ? unique.join(", ") : `${unique.slice(0, 3).join(", ")} +${unique.length - 3}`;
}

/**
 * The reaction pills under a message.
 *
 * Standard hand-positions its own tooltip through a portal; MUI already owns
 * that problem, so the names ride on `Tooltip` and this component is left with
 * only the pills. Touch devices get no tooltip at all rather than one that
 * fights the tap that toggles the reaction.
 */
export default function ReactionBar({ reactions, ownHash, isOwn, onToggle, onAdd }: ReactionBarProps) {
  const { t } = useTranslation("chat");

  if (reactions.length === 0) return null;

  return (
    <Stack
      direction="row"
      gap={0.5}
      sx={{ flexWrap: "wrap", mt: "6px", justifyContent: isOwn ? "flex-end" : "flex-start" }}
    >
      {reactions.map((r) => {
        const totalCount = r.reactorHashes.size;
        const active = !!ownHash && r.reactorHashes.has(ownHash);
        const isImageEmoji = r.emoji.startsWith("data:image/");
        return (
          <Tooltip
            key={r.emoji}
            title={reactorLabel(r)}
            disableHoverListener={isMobile}
            disableTouchListener
            placement="top"
          >
            <Box
              component="button"
              type="button"
              onClick={() => onToggle(r.emoji)}
              aria-label={`${isImageEmoji ? ":custom:" : r.emoji} ${totalCount}`}
              sx={(theme) => {
                const { nebula } = theme.palette;
                return {
                  ...PILL,
                  color: active ? nebula.accent : nebula.text,
                  background: active ? nebula.accentSoft : nebula.card2,
                  border: `1px solid ${active ? nebula.accentLine : nebula.line}`,
                  "&:hover": { borderColor: active ? nebula.accentLine : nebula.line2 },
                };
              }}
            >
              {isImageEmoji ? (
                <Box
                  component="img"
                  src={r.emoji}
                  alt=""
                  sx={{ width: 16, height: 16, objectFit: "contain", flex: "none" }}
                />
              ) : (
                <Box component="span" sx={{ fontSize: 13, lineHeight: 1 }}>
                  {r.emoji}
                </Box>
              )}
              <Box component="span" sx={{ fontSize: 11, minWidth: 8, textAlign: "center" }}>
                {totalCount}
              </Box>
            </Box>
          </Tooltip>
        );
      })}
      <Box
        component="button"
        type="button"
        onClick={onAdd}
        aria-label={t("reactions.add")}
        sx={(theme) => ({
          ...PILL,
          px: "8px",
          color: theme.palette.nebula.muted,
          background: "transparent",
          border: `1px dashed ${theme.palette.nebula.line2}`,
          "&:hover": { color: theme.palette.nebula.text, borderColor: theme.palette.nebula.muted },
        })}
      >
        +
      </Box>
    </Stack>
  );
}
