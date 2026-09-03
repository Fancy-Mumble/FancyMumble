import { useRef, useState, type ReactNode } from "react";
import { Box, Button, Tooltip, Typography } from "@mui/material";
import { radius } from "../../../tokens";
import { Stack } from "../../primitives";
import { MiniSwitch, SearchField } from "./controls";
import { BrowsePanel } from "./BrowsePanel";
import { TemplatePanel } from "./TemplatePanel";
import { NodeCanvas } from "./NodeCanvas";
import { useFavorites } from "./useFavorites";
import { useBlockCarry, type CanvasDrop, type Carry } from "./useBlockCarry";
import { insertFragment, type CanvasInsert, type GraphTemplate } from "./templates";
import type { History } from "./useGraphHistory";
import type { GraphNode, NodeGraph } from "./graph";
import type { BlockDef, NodeSpec, Tone } from "./spec";

interface NodeEditorProps<N extends GraphNode> {
  readonly spec: NodeSpec<N>;
  readonly graph: NodeGraph<N>;
  readonly onChange: (next: NodeGraph<N>) => void;
  /** Toolbar content before the browser - the view switch, where a page has one. */
  readonly leading?: ReactNode;
  /** Rendered instead of the canvas: a page's second way of showing one graph. */
  readonly view?: ReactNode;
  /** The sentence under the canvas: what this graph will do, in words. */
  readonly summary: ReactNode;
  /** The buttons at the far end of the footer. */
  readonly actions?: ReactNode;
  readonly onReset?: () => void;
  /**
   * Where the page keeps its undo history, if it keeps one.
   *
   * Optional because the history has to live *above* the editor - it is the
   * page that owns the graph - and a page that has not adopted one should get
   * an editor that simply has no undo rather than a broken one.
   */
  readonly history?: Pick<History<unknown>, "undo" | "redo" | "canUndo" | "canRedo">;
  /** Blocks starred for an operator who has never starred anything. */
  readonly suggested?: readonly string[];
}

/**
 * The node editor: a block browser, a canvas, and a bar that reads it back.
 *
 * An operator draws the rule rather than writing one. That is the whole
 * decision behind the pages built on this: the things a rule turns on are
 * combined with wires, and a wire cannot be mistyped, while an expression typed
 * into a box is a thing people get wrong silently. The status bar reads the
 * drawing back as the sentence it means, so the operator can check the two
 * against each other.
 *
 * The chrome is here and the meaning is in the spec, which is what lets the
 * welcome-message editor and the onboarding editor be the same component with
 * different blocks and a different thing to save at the end.
 *
 * The page deliberately has no title of its own: the canvas wants the height,
 * and the sidebar already says which page this is.
 */
export function NodeEditor<N extends GraphNode>({
  spec,
  graph,
  onChange,
  leading,
  view,
  summary,
  actions,
  onReset,
  suggested,
  history,
}: NodeEditorProps<N>) {
  const status = spec.status(graph);
  /**
   * Which drawer is open, if either.
   *
   * One at a time rather than two toggles: both are tall, both push the canvas
   * down, and an operator who has opened the gallery is not simultaneously
   * hunting for an XNOR gate.
   */
  const [drawer, setDrawer] = useState<"blocks" | "templates" | null>(null);
  const browsing = drawer === "blocks";
  const [query, setQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const { favorites, toggle } = useFavorites(spec.id, suggested);
  // Filled in by whichever canvas is on screen, and null while the page is
  // showing its other view - so a block carried over prose lands nowhere.
  const dropRef = useRef<CanvasDrop<N> | null>(null);
  // Likewise null while the page is showing its other view, which is what
  // makes a template loaded from the prose view land without a view to fit.
  const insertRef = useRef<CanvasInsert<N> | null>(null);
  const { carry, start } = useBlockCarry(dropRef);
  // Enabled says what the operator asked for; liveness says whether the drawing
  // can do anything at all. Both have to hold before the badge claims LIVE.
  const live = (spec.liveness?.(graph) ?? "live") === "live" && graph.enabled;

  const addBlock = (block: BlockDef<N>) => {
    // Dropped clear of everything already drawn, so a new node is never hidden
    // under an old one on a busy canvas.
    const x = graph.nodes.reduce((max, node) => Math.max(max, node.x), 0) + 40;
    const y = 34 + (graph.nodes.length % 5) * 34;
    onChange({ ...graph, nodes: [...graph.nodes, block.create(x, y)] });
  };

  /**
   * Lay a template down, through the canvas where there is one.
   *
   * The canvas selects what arrived and refits the view; without one on screen
   * - the prose view - the graph is still changed, because the operator asked
   * for it and switching views to find nothing would be worse.
   */
  const useTemplate = (template: GraphTemplate<N>, replace: boolean) => {
    const fragment = template.build();
    const canvas = insertRef.current;
    if (canvas) canvas.insert(fragment, replace);
    else onChange(insertFragment(graph, fragment, { replace, width: spec.width }).graph);
    setDrawer(null);
  };

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ flex: "none", px: "14px", py: "11px" }}>
        {leading}
        {/* Searching is the way most operators reach a block, so the field is
            in the bar rather than inside the panel: typing opens the panel
            under it, and there is no "open the browser first" step. */}
        <SearchField
          value={query}
          placeholder={spec.strings.search}
          onChange={(next) => {
            setQuery(next);
            // Typing searches whichever drawer is open, and opens the blocks
            // one when neither is: that is what most searches are for.
            if (next.trim() !== "") setDrawer((open) => open ?? "blocks");
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }} />

        {/* Templates first: it is what an operator opening the page for the
            first time wants, and the blocks are what they reach for after. */}
        {spec.templates && (
          <DrawerButton
            label={spec.templates.strings.open}
            open={drawer === "templates"}
            onClick={() => setDrawer((open) => (open === "templates" ? null : "templates"))}
          />
        )}
        <DrawerButton
          label={spec.strings.browse}
          open={browsing}
          onClick={() => setDrawer((open) => (open === "blocks" ? null : "blocks"))}
        />

        <Tooltip
          title={status.complete ? "" : status.problems.join("\n")}
          slotProps={{ tooltip: { sx: { whiteSpace: "pre-line" } } }}
        >
          <Box
            sx={(theme) => {
              const tone = status.complete ? theme.palette.nebula.ok : theme.palette.nebula.warn;
              return {
                flex: "none",
                px: "11px",
                py: "5px",
                borderRadius: radius("md"),
                fontSize: 11.5,
                fontWeight: 500,
                color: tone,
                border: `1px solid ${tone}55`,
                background: `${tone}1f`,
              };
            }}
          >
            {status.complete ? spec.strings.complete : spec.strings.toFix(status.problems.length)}
          </Box>
        </Tooltip>
        {history && (
          <Stack direction="row" gap={0.25} sx={{ flex: "none" }}>
            {/* Buttons as well as the chords: an operator who has just watched
                a template replace their canvas is not in a mood to guess at a
                keyboard shortcut. */}
            <Button size="small" disabled={!history.canUndo} onClick={history.undo} title="Undo (Ctrl+Z)">
              Undo
            </Button>
            <Button
              size="small"
              disabled={!history.canRedo}
              onClick={history.redo}
              title="Redo (Ctrl+Shift+Z)"
            >
              Redo
            </Button>
          </Stack>
        )}
        {onReset && (
          <Button size="small" sx={{ flex: "none" }} onClick={onReset}>
            {spec.strings.reset}
          </Button>
        )}
      </Stack>

      {drawer === "templates" && spec.templates && (
        <TemplatePanel
          templates={spec.templates.items}
          strings={spec.templates.strings}
          query={query}
          occupied={graph.nodes.length > 0}
          onUse={useTemplate}
        />
      )}

      {browsing && (
        <BrowsePanel
          blocks={spec.blocks}
          strings={spec.strings}
          favorites={favorites}
          query={query}
          starredOnly={starredOnly}
          onStarredOnly={setStarredOnly}
          onToggleFavorite={toggle}
          onAdd={addBlock}
          onCarry={start}
        />
      )}

      {/* The canvas is the room, not a card in it: it runs from the sidebar
          to the window edge, which is what makes a graph this wide readable
          without scrolling. */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {view ?? (
          <NodeCanvas
            graph={graph}
            spec={spec}
            onChange={onChange}
            dropRef={dropRef}
            insertRef={insertRef}
            onUndo={history?.undo}
            onRedo={history?.redo}
          />
        )}
      </Box>

      <Stack direction="row" alignItems="center" gap={1.5} sx={{ flex: "none", px: "14px", py: "11px" }}>
        <Box
          sx={(theme) => ({
            flex: "none",
            px: "9px",
            py: "3px",
            borderRadius: radius("sm"),
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: live ? theme.palette.nebula.ok : theme.palette.nebula.dim,
            border: `1px solid ${live ? theme.palette.nebula.ok : theme.palette.nebula.line2}55`,
          })}
        >
          {live ? spec.strings.live : spec.strings.idle}
        </Box>
        <Typography
          sx={(theme) => ({ flex: 1, minWidth: 0, fontSize: 11.5, color: theme.palette.nebula.muted })}
        >
          {summary}
        </Typography>

        <Stack direction="row" alignItems="center" gap={1} sx={{ flex: "none" }}>
          <MiniSwitch
            checked={graph.enabled}
            label={spec.strings.enabled}
            size="md"
            onChange={() => onChange({ ...graph, enabled: !graph.enabled })}
          />
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {spec.strings.enabled}
          </Typography>
          {actions}
        </Stack>
      </Stack>

      {carry && <Ghost carry={carry} />}
    </Stack>
  );
}

/**
 * One of the two drawers, as its button in the bar.
 *
 * The same component twice rather than two buttons written out: they sit side
 * by side, so any drift between them - a different weight, a caret that turns
 * the other way - reads as one of them being the important one.
 */
function DrawerButton({
  label,
  open,
  onClick,
}: Readonly<{ label: string; open: boolean; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      aria-expanded={open}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        display: "inline-flex",
        alignItems: "center",
        gap: "7px",
        flex: "none",
        px: "13px",
        py: "6px",
        cursor: "pointer",
        borderRadius: radius("md"),
        fontSize: 12,
        fontWeight: 600,
        color: theme.palette.nebula.accent,
        background: open ? theme.palette.nebula.accentSoft : "transparent",
        border: `1px solid ${theme.palette.nebula.accentLine}`,
        "&:hover": { background: theme.palette.nebula.accentSoft },
      })}
    >
      {label}
      <Box
        component="svg"
        width={9}
        height={9}
        viewBox="0 0 10 10"
        sx={{
          fill: "none",
          transform: open ? "rotate(180deg)" : "none",
          transition: "transform 120ms",
        }}
      >
        <path d="M2 3.5L5 6.5 8 3.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      </Box>
    </Box>
  );
}

/**
 * The block under the pointer while it is being carried.
 *
 * Deliberately a chip and not a preview of the node: what is being answered
 * here is "where will this land", and a full-size card under the cursor covers
 * the very spot the operator is aiming at. It dims when it is over nowhere it
 * can be put down, which is the only feedback that a release will do nothing.
 */
function Ghost<N extends GraphNode>({ carry }: Readonly<{ carry: Carry<N> }>) {
  const tone: Tone = carry.block.tone;
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: "fixed",
        left: carry.x,
        top: carry.y,
        // Held where the hand is on it, matching where the node itself will
        // sit once it is put down.
        transform: "translate(-24px, -14px)",
        zIndex: (theme.zIndex as { tooltip: number }).tooltip + 1,
        pointerEvents: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        px: "10px",
        py: "5px",
        borderRadius: radius("md"),
        fontSize: 11.5,
        whiteSpace: "nowrap",
        opacity: carry.over ? 1 : 0.5,
        color: theme.palette.nebula.text,
        background: theme.palette.nebula.card,
        border: `1px solid ${carry.over ? theme.palette.nebula.accent : theme.palette.nebula.line2}`,
        boxShadow: carry.over ? theme.palette.nebula.shadow : "none",
      })}
    >
      <Box
        sx={(theme) => ({
          width: 6,
          height: 6,
          borderRadius: "2px",
          background: theme.palette.nebula[tone === "muted" ? "dim" : tone],
        })}
      />
      {carry.block.label}
    </Box>
  );
}
