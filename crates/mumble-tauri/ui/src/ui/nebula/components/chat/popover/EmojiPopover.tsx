import { useMemo, useState } from "react";
import { Box, InputBase, Typography } from "@mui/material";
import { CATEGORIES } from "@standard/components/elements/EmojiPicker";
import { getServerCustomReactions } from "@core/features/chat/reaction/reactionStore";
import { SearchIcon } from "@ui/icons";
import { Stack } from "../../primitives";
import { PopoverPanel } from "./PopoverPanel";

/** The canvas's width for this panel. */
export const EMOJI_POPOVER_WIDTH = 340;

/**
 * The emoji panel.
 *
 * Search is a *row*, not a boxed field with a glowing ring: a full-bleed 44px
 * header sitting on the hairline, which is what makes the panel read as one
 * object rather than a field inside a box. The category strip is bare for the
 * same reason - only the active one takes a soft accent pill.
 *
 * The set is Standard's, shared rather than copied: two emoji lists would
 * drift, and a reaction sent from one surface has to exist in the other.
 */
export function EmojiPopover({
  left,
  onSelect,
  onClose,
}: Readonly<{ left: number; onSelect: (emoji: string) => void; onClose: () => void }>) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(CATEGORIES[0]?.id ?? "");

  // What the server adds is offered first: a custom reaction is the one thing
  // here the user cannot find anywhere else.
  const custom = useMemo(() => getServerCustomReactions().map((entry) => entry.display), []);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle) {
      // The set carries no per-emoji names, so a query matches a category by
      // its label or an emoji by its own character - the same two things
      // Standard matches on, so a search finds the same emoji in either pack.
      return CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        emojis: category.label.toLowerCase().includes(needle)
          ? category.emojis
          : category.emojis.filter((emoji) => emoji.includes(needle)),
      })).filter((section) => section.emojis.length > 0);
    }
    const chosen = CATEGORIES.find((category) => category.id === active);
    return chosen ? [chosen] : [];
  }, [active, query]);

  return (
    <PopoverPanel
      width={EMOJI_POPOVER_WIDTH}
      left={left}
      title="Emoji"
      onClose={onClose}
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
            placeholder="Search emoji"
            inputProps={{ "aria-label": "Search emoji" }}
            onKeyDown={(event) => event.key === "Escape" && onClose()}
            sx={{ flex: 1, fontSize: 14, "& .MuiInputBase-input": { padding: 0 } }}
          />
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>esc</Typography>
        </Stack>
      }
    >
      {!query && (
        <Stack
          direction="row"
          alignItems="center"
          gap="6px"
          sx={(theme) => ({
            px: "12px",
            py: "8px",
            flex: "none",
            borderBottom: `1px solid ${theme.palette.nebula.washLine}`,
          })}
        >
          {CATEGORIES.map((category) => (
            <Box
              key={category.id}
              component="button"
              type="button"
              aria-label={category.label}
              aria-pressed={category.id === active}
              onClick={() => setActive(category.id)}
              sx={(theme) => ({
                all: "unset",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                width: 28,
                height: 28,
                fontSize: 15,
                borderRadius: "999px",
                // Only the active one is lit; the rest are bare.
                background: category.id === active ? theme.palette.nebula.accentSoft : "transparent",
                opacity: category.id === active ? 1 : 0.55,
              })}
            >
              {category.icon}
            </Box>
          ))}
        </Stack>
      )}

      <Stack gap="8px" sx={{ px: "14px", py: "12px", maxHeight: 260, overflowY: "auto" }}>
        {custom.length > 0 && !query && (
          <>
            <SectionLabel>This server</SectionLabel>
            <Grid emojis={custom} onSelect={onSelect} />
          </>
        )}
        {sections.map((section) => (
          <Box key={section.id}>
            <SectionLabel>{section.label}</SectionLabel>
            <Grid emojis={section.emojis} onSelect={onSelect} />
          </Box>
        ))}
      </Stack>
    </PopoverPanel>
  );
}

function SectionLabel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Typography
      sx={(theme) => ({
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: theme.palette.nebula.muted,
        mb: "8px",
      })}
    >
      {children}
    </Typography>
  );
}

/** Eight to a row, as the canvas lays them out at this width. */
function Grid({
  emojis,
  onSelect,
}: Readonly<{ emojis: readonly string[]; onSelect: (emoji: string) => void }>) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: "4px", justifyItems: "center" }}>
      {emojis.map((emoji) => (
        <Box
          key={emoji}
          component="button"
          type="button"
          aria-label={emoji}
          onClick={() => onSelect(emoji)}
          sx={(theme) => ({
            all: "unset",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            width: 30,
            height: 30,
            fontSize: 19,
            borderRadius: "8px",
            "&:hover": { background: theme.palette.nebula.hover },
          })}
        >
          {emoji}
        </Box>
      ))}
    </Box>
  );
}
