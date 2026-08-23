import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Dialog, InputBase, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import type { ChannelEntry, SearchResult, UserEntry } from "@core/types";
import { CloseIcon, SearchIcon, ServerIcon } from "@ui/icons";
import {
  globalSearchRows,
  type GlobalSearchKind,
  type GlobalSearchRow,
  type GroupableSession,
} from "../../selectors";
import { radius } from "../../tokens";
import { SectionLabel, StatusDot, UserAvatar } from "../primitives";

const HEADINGS: Readonly<Record<GlobalSearchKind, string>> = {
  channel: "Channels",
  person: "People",
  message: "Messages",
  server: "Servers",
};

/** Long enough to swallow a burst of typing, short enough to feel answered. */
const DEBOUNCE_MS = 120;

interface GlobalSearchProps {
  open: boolean;
  channels: readonly ChannelEntry[];
  users: readonly UserEntry[];
  sessions: readonly (GroupableSession & { label?: string })[];
  ownSession: number | null;
  /** How the connected server is named under a channel row. */
  serverLabel: string;
  onClose: () => void;
  onSelect: (row: GlobalSearchRow) => void;
}

/**
 * One field that reaches everything the client is holding.
 *
 * The sidebar filter narrows the list already showing; this reaches past it -
 * a channel elsewhere on the server, a person to write to, another open
 * server, and the thing nothing else here can find, a message somebody sent an
 * hour ago. Which is why it is driven from the keyboard: it is opened on the
 * way somewhere, and lifting a hand to the pointer would cost more than the
 * trip it saves.
 *
 * Channels, people and servers are matched in this window; messages are
 * matched by the backend, which is the only place the history lives. Both
 * arrive as one ranked list rather than as two panels, because the person
 * typing is looking for a conversation and does not yet care which kind.
 */
export function GlobalSearch({
  open,
  channels,
  users,
  sessions,
  ownSession,
  serverLabel,
  onClose,
  onSelect,
}: Readonly<GlobalSearchProps>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Answers can land out of order, and the last one to arrive is not
  // necessarily the one for what is now in the field.
  const issuedRef = useRef(0);
  const settledRef = useRef(0);

  const rows = useMemo(
    () => globalSearchRows({ results, channels, users, sessions, ownSession, serverLabel, query }),
    [channels, ownSession, query, results, serverLabel, sessions, users],
  );

  const search = useCallback((text: string) => {
    const issue = ++issuedRef.current;
    if (!text.trim()) {
      settledRef.current = issue;
      setResults([]);
      return;
    }
    void invoke<SearchResult[]>("super_search", { query: text })
      .then((found) => {
        if (issue < settledRef.current) return;
        settledRef.current = issue;
        setResults(found);
      })
      // A failed search leaves the locally-matched rows standing rather than
      // emptying the panel under someone mid-keystroke.
      .catch(() => undefined);
  }, []);

  const onQueryChange = (text: string) => {
    setQuery(text);
    setActive(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(text), DEBOUNCE_MS);
  };

  // Every opening starts on an empty query and the first row, so the panel
  // never reopens holding a search for a channel that has since gone.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setActive(0);
    issuedRef.current += 1;
    settledRef.current = issuedRef.current;
  }, [open]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Arrowing past the end of the visible list is the one way the highlight can
  // leave the viewport; nothing else scrolls here. Optional because scrolling
  // is a real browser's to do - a DOM without layout has no such method.
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-index="${active}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const run = (row: GlobalSearchRow) => {
    onSelect(row);
    onClose();
  };

  // Escape is deliberately absent: the dialog already closes on it, and
  // answering it here as well would run the close twice.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      if (row) run(row);
    }
  };

  let previousKind: GlobalSearchKind | null = null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: (theme) => ({
            // Anchored high rather than centred: the list grows downwards as
            // the query narrows it, and a centred panel would walk up the
            // window while it is being typed into.
            alignSelf: "flex-start",
            mt: "64px",
            width: 560,
            maxWidth: "calc(100vw - 32px)",
            borderRadius: radius("xl"),
            border: `1px solid ${theme.palette.nebula.line2}`,
            background: `${theme.palette.nebula.tint},${theme.palette.nebula.bg0}`,
            color: theme.palette.nebula.text,
            overflow: "hidden",
          }),
        },
        backdrop: { sx: { backdropFilter: "blur(3px)" } },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: "10px", p: "14px 16px" }}>
        <SearchIcon width={14} height={14} />
        <InputBase
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search channels, people and messages"
          inputProps={{ "aria-label": "Search channels, people and messages" }}
          sx={{ flex: 1, fontSize: 13.5 }}
        />
        <Box
          component="button"
          type="button"
          aria-label="Close search"
          onClick={onClose}
          sx={(theme) => ({
            all: "unset",
            cursor: "pointer",
            display: "flex",
            color: theme.palette.nebula.dim,
            "&:hover": { color: theme.palette.nebula.text },
          })}
        >
          <CloseIcon width={12} height={12} />
        </Box>
      </Box>

      <Box sx={(theme) => ({ height: "1px", background: theme.palette.nebula.line })} />

      <Box ref={listRef} sx={{ p: "8px", maxHeight: 420, overflowY: "auto" }}>
        {rows.length === 0 && (
          <Typography sx={(theme) => ({ p: "14px", fontSize: 12.5, color: theme.palette.nebula.muted })}>
            {query.trim() ? `Nothing matches "${query.trim()}".` : "Nothing to jump to yet."}
          </Typography>
        )}
        {rows.map((row, index) => {
          const heading = row.kind === previousKind ? null : HEADINGS[row.kind];
          previousKind = row.kind;
          return (
            <Box key={row.key}>
              {heading && (
                <SectionLabel
                  sx={(theme) => ({ p: "6px 10px 4px", color: theme.palette.nebula.dim })}
                >
                  {heading}
                </SectionLabel>
              )}
              <SearchRow
                row={row}
                query={query}
                active={index === active}
                index={index}
                onActivate={() => setActive(index)}
                onRun={() => run(row)}
              />
            </Box>
          );
        })}
      </Box>

      <Footer count={rows.length} />
    </Dialog>
  );
}

interface SearchRowProps {
  row: GlobalSearchRow;
  query: string;
  active: boolean;
  index: number;
  onActivate: () => void;
  onRun: () => void;
}

function SearchRow({ row, query, active, index, onActivate, onRun }: Readonly<SearchRowProps>) {
  // On a message row the excerpt is what matched; everywhere else it is the name.
  const matchesInSubtitle = row.kind === "message";
  return (
    <Box
      component="button"
      type="button"
      data-index={index}
      onClick={onRun}
      // Pointer and keyboard drive one highlight rather than two, so Enter
      // always opens the row under the eye.
      onMouseEnter={onActivate}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        p: "8px 10px",
        borderRadius: radius("md"),
        // Transparent rather than absent, so gaining the accent outline does
        // not shift the row by a pixel.
        border: `1px solid ${active ? theme.palette.nebula.accentLine : "transparent"}`,
        background: active ? theme.palette.nebula.accentSoft : "transparent",
        "&:hover": { background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover },
      })}
    >
      {row.avatar ? (
        <UserAvatar
          name={row.avatar.name}
          session={row.avatar.session}
          textureSize={row.avatar.textureSize}
          size={26}
        />
      ) : (
        <GlyphTile kind={row.kind} active={active} />
      )}

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: 12.5,
            fontWeight: active ? 600 : 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <Highlighted text={row.title} query={matchesInSubtitle ? "" : query} />
          {row.context && (
            <Box
              component="span"
              sx={(theme) => ({ fontWeight: 400, color: theme.palette.nebula.dim })}
            >
              {" "}
              {row.context}
            </Box>
          )}
        </Typography>
        <Typography
          sx={(theme) => ({
            fontSize: matchesInSubtitle ? 11 : 10.5,
            color: active ? theme.palette.nebula.muted : theme.palette.nebula.dim,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          })}
        >
          <Highlighted text={row.subtitle} query={matchesInSubtitle ? query : ""} />
        </Typography>
      </Box>

      {row.kind === "person" ? (
        <StatusDot status={row.online ? "online" : "offline"} size={7} />
      ) : (
        row.meta && (
          <Typography
            sx={(theme) => ({
              flex: "none",
              fontSize: row.kind === "message" ? 10.5 : 11,
              // The positive tone reports people, not selection: an empty
              // channel and a timestamp stay dim however the row is lit.
              color: active && row.occupied ? theme.palette.nebula.ok : theme.palette.nebula.dim,
            })}
          >
            {row.meta}
          </Typography>
        )
      )}
    </Box>
  );
}

/** The mock's rounded tile for the rows that stand for a place, not a person. */
function GlyphTile({ kind, active }: Readonly<{ kind: GlobalSearchKind; active: boolean }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        width: 26,
        height: 26,
        flex: "none",
        borderRadius: radius("sm"),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        background: theme.palette.nebula.card2,
        color: active ? theme.palette.nebula.accent : theme.palette.nebula.dim,
      })}
    >
      {kind === "server" ? <ServerIcon width={13} height={13} /> : "#"}
    </Box>
  );
}

/**
 * The matched run of the query, picked out of the text it was found in.
 *
 * The backend matches fuzzily, so the query is not always a run of the text at
 * all; when it is not, the text is simply left alone rather than marked up
 * character by character, which reads as damage rather than as a match.
 */
function Highlighted({ text, query }: Readonly<{ text: string; query: string }>) {
  const needle = query.trim();
  const at = needle ? text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.accent })}>
        {text.slice(at, at + needle.length)}
      </Box>
      {text.slice(at + needle.length)}
    </>
  );
}

function Footer({ count }: Readonly<{ count: number }>) {
  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: "14px",
        p: "9px 16px",
        borderTop: `1px solid ${theme.palette.nebula.line}`,
        fontSize: 10.5,
        color: theme.palette.nebula.dim,
      })}
    >
      <Typography component="span" sx={{ fontSize: "inherit" }}>
        <KeyChip>↑↓</KeyChip> navigate
      </Typography>
      <Typography component="span" sx={{ fontSize: "inherit" }}>
        <KeyChip>↵</KeyChip> select
      </Typography>
      <Typography component="span" sx={{ fontSize: "inherit" }}>
        <KeyChip>esc</KeyChip> close
      </Typography>
      <Typography component="span" sx={{ ml: "auto", fontSize: "inherit" }}>
        {count === 1 ? "1 result" : `${count} results`}
      </Typography>
    </Box>
  );
}

function KeyChip({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        fontSize: 9.5,
        p: "1px 5px",
        mr: "4px",
        borderRadius: radius("sm"),
        background: theme.palette.nebula.card2,
      })}
    >
      {children}
    </Box>
  );
}
