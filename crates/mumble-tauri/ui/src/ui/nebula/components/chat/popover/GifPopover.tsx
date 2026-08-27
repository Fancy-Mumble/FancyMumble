import { useEffect, useState } from "react";
import { Box, InputBase, Typography } from "@mui/material";
import { fetchTrending, searchGifs, type KlipyGif } from "@standard/pages/settings/KlipyGifBrowser";
import { SearchIcon } from "@ui/icons";
import { Stack } from "../../primitives";
import { PopoverPanel } from "./PopoverPanel";

/** The canvas's width for this panel. */
export const GIF_POPOVER_WIDTH = 400;

/** The tabs the canvas draws. Trending is the source's own; the rest are queries. */
const TABS = ["Trending", "Reactions", "Anime"] as const;
type Tab = (typeof TABS)[number];

/**
 * The GIF panel.
 *
 * Search is a row, not a boxed field with a glowing ring - the same header the
 * emoji panel uses, because they are the same object at two widths. Tabs are
 * bare pills with only the active one lit.
 *
 * The grid is two columns: at 400px a third column makes each tile too small
 * to tell two reaction GIFs apart, which is the whole task here.
 */
export function GifPopover({
  left,
  onSelect,
  onClose,
}: Readonly<{ left: number; onSelect: (url: string) => void; onClose: () => void }>) {
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

  return (
    <PopoverPanel
      width={GIF_POPOVER_WIDTH}
      left={left}
      title="GIF"
      onClose={onClose}
      footer={
        <>
          <Box component="span" sx={{ flex: 1 }}>
            ↵ to send · ⇧↵ to preview
          </Box>
          <Box component="span">Klipy</Box>
        </>
      }
      header={
        <Stack
          direction="row"
          alignItems="center"
          gap="10px"
          sx={(theme) => ({
            height: 44,
            flex: "none",
            px: "14px",
            borderBottom: `1px solid ${theme.palette.nebula.washLine}`,
          })}
        >
          <Box aria-hidden sx={(theme) => ({ display: "flex", color: theme.palette.nebula.dim })}>
            <SearchIcon width={15} height={15} />
          </Box>
          <InputBase
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search GIFs"
            inputProps={{ "aria-label": "Search GIFs" }}
            onKeyDown={(event) => event.key === "Escape" && onClose()}
            sx={{ flex: 1, fontSize: 14, "& .MuiInputBase-input": { padding: 0 } }}
          />
        </Stack>
      }
    >
      {!query && (
        <Stack
          direction="row"
          alignItems="center"
          gap="8px"
          sx={(theme) => ({
            px: "12px",
            py: "8px",
            flex: "none",
            borderBottom: `1px solid ${theme.palette.nebula.washLine}`,
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
                borderRadius: "999px",
                fontSize: 13,
                fontWeight: tab === name ? 600 : 400,
                color: tab === name ? theme.palette.nebula.text : theme.palette.nebula.muted,
                background: tab === name ? theme.palette.nebula.accentSoft : "transparent",
              })}
            >
              {name}
            </Box>
          ))}
        </Stack>
      )}

      <Box sx={{ px: "12px", py: "12px", maxHeight: 300, overflowY: "auto" }}>
        {state === "failed" ? (
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.nebula.muted, py: "20px" })}>
            GIFs could not be loaded.
          </Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "8px" }}>
            {gifs.map((gif) => (
              <Box
                key={gif.id}
                component="button"
                type="button"
                aria-label={gif.title || "GIF"}
                onClick={() => onSelect(gif.url)}
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
    </PopoverPanel>
  );
}
