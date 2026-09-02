import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Avatar, Box, Chip, TextField, Typography } from "@mui/material";
import { radius } from "../../tokens";
import { Stack } from "../primitives";

export interface MemberCandidate {
  readonly user_id: number;
  readonly name: string;
}

export interface MemberPickerProps {
  /** Currently selected user ids. */
  readonly value: readonly number[];
  /** Pool of users that may be picked. */
  readonly candidates: readonly MemberCandidate[];
  /** Names for ids that are not in `candidates`. */
  readonly resolveName?: (userId: number) => string;
  /** Avatar source for an id, when this client has one. */
  readonly getAvatar?: (userId: number) => string | null | undefined;
  readonly onChange: (next: number[]) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly emptyLabel?: string;
  /** `data-testid` for the text input (e2e hook). */
  readonly inputTestId?: string;
}

const MAX_SUGGESTIONS = 8;

/**
 * The members on a role: chips for who is on it, a box to add another.
 *
 * MUI's `Autocomplete` is the obvious fit and is deliberately not used. This
 * list accepts a *bare user id* that is in no candidate list - the way an
 * operator adds someone who is offline and unknown to this session - and
 * `freeSolo` would turn that id into a string option rather than a member.
 * The state machine is therefore Standard's, unchanged; only the drawing moved.
 */
export function MemberPicker({
  value,
  candidates,
  resolveName,
  getAvatar,
  onChange,
  placeholder = "Add user by name or ID",
  disabled,
  emptyLabel = "No members",
  inputTestId,
}: MemberPickerProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const suggestions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [] as MemberCandidate[];
    const result: MemberCandidate[] = [];
    for (const c of candidates) {
      if (selectedSet.has(c.user_id)) continue;
      if (c.name.toLowerCase().includes(trimmed) || String(c.user_id) === trimmed) {
        result.push(c);
        if (result.length >= MAX_SUGGESTIONS) break;
      }
    }
    return result;
  }, [query, candidates, selectedSet]);

  const addUser = useCallback(
    (userId: number) => {
      if (selectedSet.has(userId)) return;
      onChange([...value, userId]);
      setQuery("");
      setHighlight(0);
      inputRef.current?.focus();
    },
    [onChange, value, selectedSet],
  );

  const tryCommitFromInput = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (suggestions.length > 0) {
      addUser(suggestions[Math.min(highlight, suggestions.length - 1)].user_id);
      return;
    }
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum) && asNum >= 0 && Number.isInteger(asNum)) {
      addUser(asNum);
    }
  }, [query, suggestions, highlight, addUser]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      tryCommitFromInput();
    } else if (e.key === "Escape") {
      setQuery("");
    } else if (e.key === "Backspace" && query.length === 0 && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const labelFor = (userId: number): string => {
    const fromCandidates = candidates.find((c) => c.user_id === userId);
    if (fromCandidates) return fromCandidates.name;
    if (resolveName) return resolveName(userId);
    return `User #${userId}`;
  };

  return (
    <Stack gap={0.75}>
      <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap", minHeight: 24 }}>
        {value.length === 0 && (
          <Typography sx={(theme) => ({ py: "2px", fontSize: 12, color: theme.palette.nebula.dim })}>
            {emptyLabel}
          </Typography>
        )}
        {value.map((id) => {
          const label = labelFor(id);
          const avatarSrc = getAvatar?.(id) ?? undefined;
          return (
            <Chip
              key={id}
              size="small"
              label={label}
              avatar={<Avatar src={avatarSrc}>{label.charAt(0).toUpperCase()}</Avatar>}
              onDelete={disabled ? undefined : () => onChange(value.filter((other) => other !== id))}
            />
          );
        })}
      </Stack>

      {!disabled && (
        <Box sx={{ position: "relative" }}>
          <TextField
            fullWidth
            size="small"
            inputRef={inputRef}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={handleKeyDown}
            slotProps={{ htmlInput: { "aria-label": placeholder, "data-testid": inputTestId } }}
          />
          {suggestions.length > 0 && (
            <Box
              component="ul"
              role="listbox"
              sx={(theme) => ({
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 30,
                m: 0,
                p: "4px",
                listStyle: "none",
                maxHeight: 192,
                overflowY: "auto",
                borderRadius: radius("md"),
                background: theme.palette.nebula.card,
                border: `1px solid ${theme.palette.nebula.line2}`,
                boxShadow: theme.palette.nebula.shadow,
              })}
            >
              {suggestions.map((s, idx) => (
                <Box
                  component="li"
                  key={s.user_id}
                  role="option"
                  aria-selected={idx === highlight}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addUser(s.user_id);
                  }}
                  sx={(theme) => ({
                    display: "flex",
                    alignItems: "baseline",
                    gap: "6px",
                    px: "8px",
                    py: "5px",
                    borderRadius: radius("sm"),
                    cursor: "pointer",
                    fontSize: 12.5,
                    background: idx === highlight ? theme.palette.nebula.accentSoft : "transparent",
                  })}
                >
                  <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                    {s.name}
                  </Box>
                  <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
                    #{s.user_id}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Stack>
  );
}
