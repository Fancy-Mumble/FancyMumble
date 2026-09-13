import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, InputBase, Typography } from "@mui/material";
import { fetchTrending, searchGifs, type KlipyGif } from "@standard/pages/settings/KlipyGifBrowser";
import { SearchIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { radius } from "../../tokens";

/** The tabs the canvas draws. Trending is the source's own; the rest are
 *  queries - which is why the ids stay English however the label is written. */
const TABS = ["Trending", "Reactions", "Anime"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL_KEYS = {
  Trending: "gif.trending",
  Reactions: "gif.reactions",
  Anime: "gif.anime",
} as const satisfies Record<Tab, string>;

/**
 * The GIF search, tabs and grid, without a shell.
 *
 * The composer draws it in a popover and the profile page in a dialog; both
 * are the same browser over the same source, so the shell is the caller's and
 * nothing else is. The search row is returned apart from the body because the
 * composer's popover takes its header as a slot.
 */
export function useGifBrowser({
  onSelect,
  onEscape,
  gridHeight = 300,
}: Readonly<{ onSelect: (gif: KlipyGif) => void; onEscape: () => void; gridHeight?: number }>) {
  const { t } = useTranslation("nebulaChat");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("Trending");
  const [gifs, setGifs] = useState<readonly KlipyGif[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let live = true;
    setState("loading");
    // A typed query outranks the tab: the tabs are shortcuts to a query, and
    // the one the user typed is the one they meant.
    const wanted = query.trim() || (tab === "Trending" ? "" : tab);
    const request = wanted ? searchGifs(wanted) : fetchTrending();
    request
      .then((page) => {
        if (!live) return;
        setGifs(page.items);
        setState("ready");
      })
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, [query, tab]);

  const searchRow = (
    <Stack
      direction="row"
      alignItems="center"
      gap="10px"
      sx={(theme) => ({
        height: 44,
        flex: "none",
        px: "14px",
        borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.washLine}`,
      })}
    >
      <Box aria-hidden sx={(theme) => ({ display: "flex", color: theme.palette.nebula.dim })}>
        <SearchIcon width={15} height={15} />
      </Box>
      <InputBase
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("gif.search")}
        inputProps={{ "aria-label": t("gif.search") }}
        onKeyDown={(event) => event.key === "Escape" && onEscape()}
        sx={{ flex: 1, fontSize: 14, "& .MuiInputBase-input": { padding: 0 } }}
      />
    </Stack>
  );

  const body = (
    <>
      {!query && (
        <Stack
          direction="row"
          alignItems="center"
          gap="8px"
          sx={(theme) => ({
            px: "12px",
            py: "8px",
            flex: "none",
            borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.washLine}`,
          })}
        >
          {TABS.map((name) => (
            <Box
              key={name}
              component="button"
              type="button"
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
              sx={(theme) => ({
                all: "unset",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                height: 28,
                px: "14px",
                borderRadius: radius("pill"),
                fontSize: 13,
                fontWeight: tab === name ? 600 : 400,
                color: tab === name ? theme.palette.nebula.text : theme.palette.nebula.muted,
                background: tab === name ? theme.palette.nebula.accentSoft : "transparent",
              })}
            >
              {t(TAB_LABEL_KEYS[name])}
            </Box>
          ))}
        </Stack>
      )}

      <Box sx={{ px: "12px", py: "12px", maxHeight: gridHeight, overflowY: "auto" }}>
        {state === "failed" ? (
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.nebula.muted, py: "20px" })}>
            {t("gif.loadFailed")}
          </Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "8px" }}>
            {gifs.map((gif) => (
              <Box
                key={gif.id}
                component="button"
                type="button"
                aria-label={gif.title || "GIF"}
                onClick={() => onSelect(gif)}
                sx={(theme) => ({
                  all: "unset",
                  cursor: "pointer",
                  height: 104,
                  borderRadius: "14px",
                  overflow: "hidden",
                  background: theme.palette.nebula.card2,
                  "&:hover": { outline: `2px solid ${theme.palette.nebula.accentLine}` },
                })}
              >
                <Box
                  component="img"
                  src={gif.preview}
                  alt=""
                  loading="lazy"
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </>
  );

  return { searchRow, body };
}
