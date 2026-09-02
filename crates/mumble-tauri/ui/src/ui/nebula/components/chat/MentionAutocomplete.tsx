import { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { colorFor } from "@core/utils/format";
import type { MentionCandidate } from "@standard/components/chat/mention/MentionAutocomplete";
import { radius } from "../../tokens";
import { PopupSurface, PopupEmpty, POPUP_ROW } from "./popupSurface";

export interface MentionAutocompleteProps {
  readonly candidates: readonly MentionCandidate[];
  readonly activeIndex: number;
  readonly onPick: (candidate: MentionCandidate) => void;
  readonly onActiveIndexChange: (index: number) => void;
}

/** How a candidate reads in the list. */
function candidateLabel(c: MentionCandidate): string {
  switch (c.kind) {
    case "user":
      return c.name;
    case "role":
      return `@${c.name}`;
    case "everyone":
      return "@everyone";
    case "here":
      return "@here";
  }
}

function candidateHintKey(c: MentionCandidate): string {
  switch (c.kind) {
    case "user":
      return "mention.hintUser";
    case "role":
      return "mention.hintRole";
    case "everyone":
      return "mention.hintEveryone";
    case "here":
      return "mention.hintHere";
  }
}

function candidateKey(c: MentionCandidate, idx: number): string {
  switch (c.kind) {
    case "user":
      return `u-${c.session}`;
    case "role":
      return `r-${c.name}`;
    case "everyone":
      return "everyone";
    case "here":
      return "here";
    default:
      return `i-${idx}`;
  }
}

/**
 * The list `@` opens over the composer.
 *
 * Presentation only, as Standard's is: the trigger, the candidate set and the
 * keys all stay in the composer, and `handleMentionKey` / `candidateInsertText`
 * stay shared, because what a mention *means* on the wire is not a design
 * decision this pack gets to make.
 */
export default function MentionAutocomplete({
  candidates,
  activeIndex,
  onPick,
  onActiveIndexChange,
}: MentionAutocompleteProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const { t } = useTranslation("chat");
  const tStr = t as (k: string) => string;

  // Keep the active row scrolled into view as the keys move it.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLLIElement>(`li[data-idx="${activeIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (candidates.length === 0) {
    return (
      <PopupSurface ariaLabel={t("mention.popupAriaLabel")}>
        <PopupEmpty>{t("mention.noMatches")}</PopupEmpty>
      </PopupSurface>
    );
  }

  return (
    <PopupSurface ariaLabel={t("mention.popupAriaLabel")}>
      <Box component="ul" ref={listRef} sx={{ listStyle: "none", m: 0, p: "4px", overflowY: "auto" }}>
        {candidates.map((c, idx) => {
          const active = idx === activeIndex;
          return (
            <Box
              component="li"
              key={candidateKey(c, idx)}
              data-idx={idx}
              role="option"
              aria-selected={active}
              onMouseEnter={() => onActiveIndexChange(idx)}
              onMouseDown={(e) => {
                // Keep the textarea focused - a blur would dismiss the list.
                e.preventDefault();
                onPick(c);
              }}
              sx={(theme) => ({
                ...POPUP_ROW,
                background: active ? theme.palette.nebula.accentSoft : "transparent",
              })}
            >
              <CandidateIcon candidate={c} />
              <Box
                component="span"
                sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {candidateLabel(c)}
              </Box>
              <Typography sx={(theme) => ({ flex: "none", fontSize: 11, color: theme.palette.nebula.muted })}>
                {tStr(candidateHintKey(c))}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </PopupSurface>
  );
}

/** An avatar for a person, the accent badge for the three broadcast forms. */
function CandidateIcon({ candidate }: { readonly candidate: MentionCandidate }) {
  const shape = { width: 20, height: 20, borderRadius: "50%", flex: "none" } as const;

  if (candidate.kind === "user") {
    if (candidate.avatarUrl) {
      return <Box component="img" src={candidate.avatarUrl} alt="" sx={{ ...shape, objectFit: "cover" }} />;
    }
    return (
      <Box
        aria-hidden
        sx={{
          ...shape,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 600,
          color: "#fff",
          background: colorFor(candidate.name),
        }}
      >
        {candidate.name.charAt(0).toUpperCase()}
      </Box>
    );
  }
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        ...shape,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        borderRadius: radius("sm"),
        color: theme.palette.nebula.onAccent,
        background: theme.palette.nebula.accent,
      })}
    >
      @
    </Box>
  );
}
