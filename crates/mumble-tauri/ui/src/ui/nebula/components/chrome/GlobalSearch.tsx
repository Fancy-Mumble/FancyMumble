import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Dialog, InputBase, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import type { ChannelEntry, PhotoEntry, SearchResult, UserEntry } from "@core/types";
import { CloseIcon, SearchIcon, ServerIcon } from "@ui/icons";
import {
  globalSearchRows,
  type GlobalSearchFilter,
  type GlobalSearchKind,
  type GlobalSearchRow,
  type GroupableSession,
} from "../../selectors";
import { DEFAULT_TIME_DISPLAY, type TimeDisplay } from "../../selectors";
import { radius } from "../../tokens";
import { SectionLabel, StatusDot, UserAvatar } from "../primitives";
import { PHOTO_COLUMNS, SearchPhotoGrid, useSearchPhotos } from "./SearchPhotoGrid";

/** The group heading each kind of row sits under, as a `nebulaChrome` key.
 *  `as const` keeps the values literal so `t()` still type-checks them. */
const HEADING_KEYS = {
  channel: "search.headingChannel",
  person: "search.headingPerson",
  message: "search.headingMessage",
  server: "search.headingServer",
} as const satisfies Record<GlobalSearchKind, string>;

/** Long enough to swallow a burst of typing, short enough to feel answered. */
const DEBOUNCE_MS = 120;

/** The chips under the field, in the order they sit. */
const FILTER_KEYS = {
  all: "search.filterAll",
  photos: "search.filterPhotos",
  links: "search.filterLinks",
} as const satisfies Record<GlobalSearchFilter, string>;
const FILTERS = Object.keys(FILTER_KEYS) as GlobalSearchFilter[];

/** How far each arrow moves the highlight across the photo grid. */
const GRID_STEPS: Readonly<Partial<Record<string, number>>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -PHOTO_COLUMNS,
  ArrowDown: PHOTO_COLUMNS,
};

interface GlobalSearchProps {
  open: boolean;
  channels: readonly ChannelEntry[];
  users: readonly UserEntry[];
  sessions: readonly (GroupableSession & { label?: string })[];
  ownSession: number | null;
  /** How the connected server is named under a channel row. */
  serverLabel: string;
  /**
   * The clock a matched message's time is read under.
   *
   * The client's one copy, handed down: a message found through search has to
   * read the same time as the same message read in the river, and the palette
   * is not the place to go and ask the platform for the OS clock format again.
   */
  time?: TimeDisplay;
  onClose: () => void;
  onSelect: (row: GlobalSearchRow) => void;
  /** A tile from the Photos grid: lands where the picture was sent. */
  onOpenPhoto: (photo: PhotoEntry) => void;
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
 *
 * The Photos and Links chips narrow it to messages carrying one. The store
 * holds neither, so a narrowed list is the backend's alone; Photos with nothing
 * typed is the pictures themselves, a grid paged out of `get_photos`.
 */
export function GlobalSearch({
  open,
  channels,
  users,
  sessions,
  ownSession,
  serverLabel,
  time = DEFAULT_TIME_DISPLAY,
  onClose,
  onSelect,
  onOpenPhoto,
}: Readonly<GlobalSearchProps>) {
  const { t } = useTranslation("nebulaChrome");
  // A second handle on the catalogue, for the selectors that name the rows:
  // they say what they find in `nebulaCommon`, and their `t` is typed to it.
  const { t: label } = useTranslation("nebulaCommon");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState<GlobalSearchFilter>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Answers can land out of order, and the last one to arrive is not
  // necessarily the one for what is now in the field.
  const issuedRef = useRef(0);
  const settledRef = useRef(0);

  const rows = useMemo(
    () =>
      globalSearchRows({
        t: label,
        results,
        channels,
        users,
        sessions,
        ownSession,
        serverLabel,
        query,
        time,
        filter,
      }),
    [channels, filter, ownSession, query, results, serverLabel, sessions, time, users],
  );

  // The grid stands in for the list only while nothing is typed: a query under
  // Photos searches what was said with the pictures, and reads as messages.
  const photoGrid = filter === "photos" && !query.trim();
  const { photos, loading: photosLoading, loadMore: loadMorePhotos } = useSearchPhotos(open && photoGrid);

  const search = useCallback((text: string, narrowed: GlobalSearchFilter) => {
    const issue = ++issuedRef.current;
    if (!text.trim()) {
      settledRef.current = issue;
      setResults([]);
      return;
    }
    const args = narrowed === "all" ? { query: text } : { query: text, filter: narrowed };
    void invoke<SearchResult[]>("super_search", args)
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
    debounceRef.current = setTimeout(() => search(text, filter), DEBOUNCE_MS);
  };

  // A chip answers at once - there is no burst of typing to wait out - and
  // hands the caret back to the field, where the next keystroke is headed.
  const onFilterChange = (next: GlobalSearchFilter) => {
    fieldRef.current?.focus();
    if (next === filter) return;
    setFilter(next);
    setActive(0);
    setResults([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Anything still in flight was asked under the old chip.
    settledRef.current = ++issuedRef.current;
    search(query, next);
  };

  // Every opening starts on an empty query and the first row, so the panel
  // never reopens holding a search for a channel that has since gone.
  //
  // The field is focused here rather than left to `autoFocus`, which only
  // speaks for the frame the input is created in: the dialog draws into a
  // portal the modal fills in on its own schedule, and whatever the keystroke
  // was typed into is still holding focus when it does. Losing that race is
  // what leaves the panel standing open with the next word going into the
  // composer behind it. Asking again on the frame after the commit costs a
  // frame and is not a race at all.
  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setResults([]);
    setActive(0);
    setFilter("all");
    issuedRef.current += 1;
    settledRef.current = issuedRef.current;
    const frame = requestAnimationFrame(() => fieldRef.current?.focus());
    return () => cancelAnimationFrame(frame);
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

  const openPhoto = (photo: PhotoEntry) => {
    onOpenPhoto(photo);
    onClose();
  };

  // The grid is walked in two dimensions. Left and right are free to take: the
  // grid only shows while the field is empty, so there is no caret to move. The
  // edges stop the highlight rather than wrap it - past the last tile is the
  // next page, not the first photo.
  const onGridKeyDown = (event: React.KeyboardEvent) => {
    if (photos.length === 0) return;
    const step = GRID_STEPS[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setActive((index) => Math.min(Math.max(index + step, 0), photos.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const photo = photos[active];
      if (photo) openPhoto(photo);
    }
  };

  // Escape is deliberately absent: the dialog already closes on it, and
  // answering it here as well would run the close twice.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (photoGrid) {
      onGridKeyDown(event);
      return;
    }
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

  let emptyText: string = t("search.empty");
  if (query.trim()) emptyText = t("search.noMatch", { query: query.trim() });
  else if (filter === "links") emptyText = t("search.linksEmpty");

  const summary = photoGrid
    ? t("search.photos", { count: photos.length })
    : t("search.results", { count: rows.length });

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
            border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line2}`,
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
          inputRef={fieldRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("search.placeholder")}
          inputProps={{ "aria-label": t("search.placeholder") }}
          sx={{ flex: 1, fontSize: 13.5 }}
        />
        <Box
          component="button"
          type="button"
          aria-label={t("search.close")}
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

      <FilterChips value={filter} onChange={onFilterChange} />

      <Box sx={(theme) => ({ height: "1px", background: theme.palette.nebula.line })} />

      <Box ref={listRef} sx={{ p: "8px", maxHeight: 420, overflowY: "auto" }}>
        {photoGrid && (
          <SearchPhotoGrid
            photos={photos}
            loading={photosLoading}
            active={active}
            onActivate={setActive}
            onOpen={openPhoto}
            onNearEnd={loadMorePhotos}
          />
        )}
        {!photoGrid && rows.length === 0 && (
          <Typography sx={(theme) => ({ p: "14px", fontSize: 12.5, color: theme.palette.nebula.muted })}>
            {emptyText}
          </Typography>
        )}
        {rows.map((row, index) => {
          const heading = row.kind === previousKind ? null : t(HEADING_KEYS[row.kind]);
          previousKind = row.kind;
          return (
            <Box key={row.key}>
              {heading && (
                <SectionLabel sx={(theme) => ({ p: "6px 10px 4px", color: theme.palette.nebula.dim })}>
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

      <Footer summary={summary} />
    </Dialog>
  );
}

interface FilterChipsProps {
  value: GlobalSearchFilter;
  onChange: (next: GlobalSearchFilter) => void;
}

/** All, Photos, Links: what the list is narrowed to. */
function FilterChips({ value, onChange }: Readonly<FilterChipsProps>) {
  const { t } = useTranslation("nebulaChrome");
  return (
    <Box role="group" aria-label={t("search.filters")} sx={{ display: "flex", gap: "6px", p: "0 16px 10px" }}>
      {FILTERS.map((key) => {
        const selected = key === value;
        return (
          <Box
            key={key}
            component="button"
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(key)}
            // A press that took the caret out of the field first would leave
            // the next keystroke with nowhere to go.
            onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
            sx={(theme) => ({
              all: "unset",
              boxSizing: "border-box",
              cursor: "pointer",
              p: "3px 10px",
              fontSize: 11.5,
              fontWeight: selected ? 600 : 500,
              borderRadius: radius("pill"),
              border: `var(--nebula-line-width, 1px) solid ${selected ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
              background: selected ? theme.palette.nebula.accentSoft : "transparent",
              color: selected ? theme.palette.nebula.accent : theme.palette.nebula.muted,
              "&:hover": { color: selected ? theme.palette.nebula.accent : theme.palette.nebula.text },
              "&:focus-visible": { outline: `2px solid ${theme.palette.nebula.accent}`, outlineOffset: "2px" },
            })}
          >
            {t(FILTER_KEYS[key])}
          </Box>
        );
      })}
    </Box>
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
        border: `var(--nebula-line-width, 1px) solid ${active ? theme.palette.nebula.accentLine : "transparent"}`,
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
            <Box component="span" sx={(theme) => ({ fontWeight: 400, color: theme.palette.nebula.dim })}>
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

function Footer({ summary }: Readonly<{ summary: string }>) {
  const { t } = useTranslation(["nebulaChrome", "sidebar"]);
  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: "14px",
        p: "9px 16px",
        borderTop: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
        fontSize: 10.5,
        color: theme.palette.nebula.dim,
      })}
    >
      <Typography component="span" sx={{ fontSize: "inherit" }}>
        <KeyChip>↑↓</KeyChip> {t("sidebar:superSearch.hintNavigate")}
      </Typography>
      <Typography component="span" sx={{ fontSize: "inherit" }}>
        <KeyChip>↵</KeyChip> {t("sidebar:superSearch.hintSelect")}
      </Typography>
      <Typography component="span" sx={{ fontSize: "inherit" }}>
        <KeyChip>{t("search.keyEsc")}</KeyChip> {t("sidebar:superSearch.hintClose")}
      </Typography>
      <Typography component="span" sx={{ ml: "auto", fontSize: "inherit" }}>
        {summary}
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
