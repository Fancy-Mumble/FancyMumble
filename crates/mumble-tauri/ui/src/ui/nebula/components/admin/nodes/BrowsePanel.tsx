import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Typography, alpha } from "@mui/material";
import { radius } from "../../../tokens";
import { Stack } from "../../primitives";
import { PaletteChip, StarGlyph, Star } from "./controls";
import type { GraphNode } from "./graph";
import type { BlockDef, EditorStrings, PortSummary } from "./spec";

/**
 * The block browser.
 *
 * The palette used to be a single row of chips that ran off the end of the bar
 * and scrolled sideways: with ten kinds it was already unreadable, and the
 * seven logic gates would have made it hopeless. So the row is now the blocks
 * an operator *starred*, and everything else lives in a panel they open - filed
 * under what it is about, each with a sentence saying what it does and what it
 * can be wired to.
 *
 * The sentence is the point. A canvas is only usable if somebody can tell what
 * a node does before they add it, and "XNOR" alone does not tell them.
 */

interface BrowsePanelProps<N extends GraphNode> {
  readonly blocks: readonly BlockDef<N>[];
  readonly strings: EditorStrings;
  readonly favorites: ReadonlySet<string>;
  /** What the operator typed into the bar above. Owned there, not here. */
  readonly query: string;
  readonly starredOnly: boolean;
  readonly onStarredOnly: (only: boolean) => void;
  readonly onToggleFavorite: (id: string) => void;
  readonly onAdd: (block: BlockDef<N>) => void;
  /** A press on a block, which becomes a drag onto the canvas if it travels. */
  readonly onCarry: (block: BlockDef<N>, event: ReactPointerEvent) => void;
}

export function BrowsePanel<N extends GraphNode>({
  blocks,
  strings,
  favorites,
  query,
  starredOnly,
  onStarredOnly,
  onToggleFavorite,
  onAdd,
  onCarry,
}: BrowsePanelProps<N>) {
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return blocks.filter((block) => {
      if (starredOnly && !favorites.has(block.id)) return false;
      if (needle === "") return true;
      // The description is searched too: an operator looking for "unknown"
      // wants the filter, and nothing in its name says so.
      return `${block.label} ${block.description} ${block.category}`.toLowerCase().includes(needle);
    });
  }, [blocks, query, starredOnly, favorites]);

  // Sections in the order the dialect lists its blocks, not alphabetically:
  // the order is the order somebody builds a graph in.
  const sections = useMemo(() => {
    const grouped = new Map<string, BlockDef<N>[]>();
    for (const block of matches) {
      const bucket = grouped.get(block.category);
      if (bucket) bucket.push(block);
      else grouped.set(block.category, [block]);
    }
    return [...grouped];
  }, [matches]);

  const starred = blocks.filter((block) => favorites.has(block.id));

  return (
    <Box
      sx={(theme) => ({
        flex: "none",
        maxHeight: "46vh",
        overflowY: "auto",
        // Every card is a drag handle, so a press that travels must not sweep
        // up the descriptions it passes over. The canvas says the same thing
        // for the same reason; here there is nothing to except, because the
        // one field on this bar - the search - lives above the panel.
        userSelect: "none",
        px: "14px",
        pb: "14px",
        pt: "2px",
        background: theme.palette.nebula.panel,
        borderTop: `1px solid ${theme.palette.nebula.line}`,
        borderBottom: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      {query.trim() === "" && starred.length > 0 && (
        <>
          <SectionRule
            label={strings.favorites}
            star
            action={
              <Star
                on={starredOnly}
                label={strings.favorites}
                bare
                onClick={() => onStarredOnly(!starredOnly)}
              />
            }
          />
          <Stack direction="row" gap={0.75} sx={{ flexWrap: "wrap", mb: "6px" }}>
            {starred.map((block) => (
              <PaletteChip
                key={block.id}
                label={block.label}
                tone={block.tone}
                onAdd={() => onAdd(block)}
                onCarry={(event) => onCarry(block, event)}
              />
            ))}
          </Stack>
        </>
      )}

      {sections.length === 0 && (
        <Typography sx={(theme) => ({ py: "18px", fontSize: 12, color: theme.palette.nebula.dim })}>
          {strings.noMatches}
        </Typography>
      )}

      {sections.map(([category, entries]) => (
        <Box key={category}>
          <SectionRule label={category} />
          <Box
            sx={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              mb: "4px",
            }}
          >
            {entries.map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                addLabel={strings.add}
                starred={favorites.has(block.id)}
                onAdd={() => onAdd(block)}
                onToggleFavorite={() => onToggleFavorite(block.id)}
                onCarry={(event) => onCarry(block, event)}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** A section caption, with the rule that carries it to the far edge. */
function SectionRule({
  label,
  star,
  action,
}: Readonly<{ label: string; star?: boolean; action?: React.ReactNode }>) {
  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "14px", mb: "9px" }}>
      {star && <StarGlyph filled size={11} />}
      <Typography
        sx={(theme) => ({
          flex: "none",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: star ? theme.palette.nebula.warn : theme.palette.nebula.dim,
        })}
      >
        {label}
      </Typography>
      <Box sx={(theme) => ({ flex: 1, height: "1px", background: theme.palette.nebula.line })} />
      {action}
    </Stack>
  );
}

/**
 * One block, as the browser describes it.
 *
 * The ports are on the card because "what can I wire this to" is the question
 * that decides whether a block is the one you want, and it is the one thing the
 * node itself only answers after you have already added it.
 */
function BlockCard<N extends GraphNode>({
  block,
  addLabel,
  starred,
  onAdd,
  onToggleFavorite,
  onCarry,
}: Readonly<{
  block: BlockDef<N>;
  addLabel: string;
  starred: boolean;
  onAdd: () => void;
  onToggleFavorite: () => void;
  onCarry: (event: ReactPointerEvent) => void;
}>) {
  return (
    <Box
      onPointerDown={onCarry}
      sx={(theme) => ({
        display: "flex",
        flexDirection: "column",
        // The whole card is the handle: `+ add` drops one wherever there is
        // room, and dragging the card puts it exactly where you let go.
        cursor: "grab",
        "&:active": { cursor: "grabbing" },
        // Otherwise a drag off a card scrolls the panel on a touchscreen
        // instead of carrying the block.
        touchAction: "none",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        "&:hover": { borderColor: theme.palette.nebula.accentLine },
      })}
    >
      <Stack direction="row" alignItems="center" gap={1} sx={{ px: "14px", pt: "12px" }}>
        <Box
          sx={(theme) => ({
            width: 8,
            height: 8,
            flex: "none",
            borderRadius: "2px",
            background: theme.palette.nebula[block.tone === "muted" ? "dim" : block.tone],
          })}
        />
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }} noWrap>
          {block.label}
        </Typography>
        <Box
          component="button"
          type="button"
          onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
          onClick={onAdd}
          sx={(theme) => ({
            all: "unset",
            flex: "none",
            cursor: "pointer",
            fontSize: 11.5,
            color: theme.palette.nebula.dim,
            "&:hover": { color: theme.palette.nebula.accent },
          })}
        >
          {addLabel}
        </Box>
        <Star on={starred} label={block.label} onClick={onToggleFavorite} bare />
      </Stack>

      <Typography
        sx={(theme) => ({
          px: "14px",
          py: "9px",
          flex: 1,
          fontSize: 12,
          lineHeight: 1.45,
          color: theme.palette.nebula.muted,
        })}
      >
        {block.description}
      </Typography>

      <Stack
        direction="row"
        alignItems="center"
        gap={1}
        sx={(theme) => ({
          px: "14px",
          py: "10px",
          borderTop: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <Stack gap={0.5} sx={{ flex: 1, minWidth: 0, alignItems: "flex-start" }}>
          {block.inputs.length === 0 ? (
            <PortPill port={{ type: "—" }} side="in" empty />
          ) : (
            block.inputs.map((port) => <PortPill key={`${port.name}${port.type}`} port={port} side="in" />)
          )}
        </Stack>
        <Box
          sx={(theme) => ({ flex: "none", width: 22, height: "1px", background: theme.palette.nebula.line2 })}
        />
        <Stack gap={0.5} sx={{ flex: "none", alignItems: "flex-end" }}>
          {block.outputs.length === 0 ? (
            <PortPill port={{ type: "—" }} side="out" empty />
          ) : (
            block.outputs.map((port) => <PortPill key={`${port.name}${port.type}`} port={port} side="out" />)
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

/** One end of a wire: its dot, its name where it has one, and what it carries. */
function PortPill({
  port,
  side,
  empty,
}: Readonly<{ port: PortSummary; side: "in" | "out"; empty?: boolean }>) {
  const dot = (
    <Box
      sx={(theme) => ({
        width: 7,
        height: 7,
        flex: "none",
        borderRadius: "50%",
        border: `1.5px solid ${empty ? theme.palette.nebula.line2 : theme.palette.nebula.accent}`,
        background: side === "out" && !empty ? theme.palette.nebula.accent : "transparent",
      })}
    />
  );
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={0.75}
      sx={(theme) => ({
        px: "8px",
        py: "3px",
        borderRadius: "999px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10.5,
        color: empty ? theme.palette.nebula.dim : theme.palette.nebula.text,
        background: empty ? "transparent" : alpha(theme.palette.nebula.accent, side === "out" ? 0.14 : 0.06),
        border: `1px solid ${empty ? "transparent" : theme.palette.nebula[side === "out" ? "accentLine" : "line2"]}`,
      })}
    >
      {side === "in" && dot}
      <Box component="span">{port.name ? `${port.name} · ${port.type}` : port.type}</Box>
      {side === "out" && dot}
    </Stack>
  );
}
