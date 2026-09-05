import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Box, Typography, alpha } from "@mui/material";
import { CloseIcon } from "@ui/icons";
import { opaque, radius } from "../../../tokens";
import { Stack } from "../../primitives";
import { fromPortOf, type GraphNode, type NodeGraph, type NodeId, type PortId } from "./graph";
import type { NodeSpec, PortSide, Tone } from "./spec";

/**
 * The palette entry a tone reads in.
 *
 * `muted` has no colour of its own - it is the absence of one - so it borrows
 * the line colour, which is what "drawn, but not saying anything" looks like
 * everywhere else on this canvas.
 */
const dye = (tone: Tone) => (tone === "muted" ? "line2" : tone);

/** Hands the canvas the DOM node of a port so it can draw wires to it. */
export type RegisterPort = (node: NodeId, side: PortSide, port: PortId, el: HTMLElement | null) => void;

export type PortDown = (node: NodeId, side: PortSide, port: PortId, event: ReactPointerEvent) => void;

interface NodeCardProps<N extends GraphNode> {
  readonly node: N;
  readonly graph: NodeGraph<N>;
  /**
   * The nodes upstream of this one, as they stand.
   *
   * What the card is allowed to have read from the rest of the graph, and so
   * what decides whether it has to be drawn again - see `sameCard` below.
   * `null` means the canvas could not settle the question and the card must
   * redraw unconditionally.
   */
  readonly reads: readonly N[] | null;
  readonly spec: NodeSpec<N>;
  readonly selected: boolean;
  readonly onPatch: (patch: Partial<N>) => void;
  readonly onRemove: () => void;
  readonly onDragStart: (event: ReactPointerEvent) => void;
  /** Present only where the dialect says this node may be dragged bigger. */
  readonly onResizeStart?: (event: ReactPointerEvent) => void;
  readonly registerPort: RegisterPort;
  readonly onPortDown: PortDown;
}

/**
 * Whether this card can be left exactly as it is.
 *
 * A canvas hands every card the whole graph, and after any edit that graph is
 * a new object - so without this, one keystroke in one node redrew every node
 * on the canvas, with all the style serialising and port measuring that
 * implies. On a full canvas that was most of what made typing feel heavy.
 *
 * What a card draws is settled by four things, and this compares all four:
 * its own node, whether it is selected, the wiring, and the nodes upstream of
 * it. Nothing else on the canvas can reach it - that is the contract a node
 * editor rests on, and `NodeSpec` states it - so nothing else can change what
 * it looks like.
 *
 * The two that are not obvious:
 *
 * * **The whole wiring, not just this node's.** A badge counts the wires
 *   leaving a node, so a wire drawn anywhere is a wire this card may be
 *   counting. Edges are replaced wholesale on any change, so one comparison
 *   settles it.
 * * **How many nodes there are.** A card may number itself against its
 *   siblings - "greeting #2" - and the numbering only moves when the set of
 *   them does, which is to say when one is added or removed.
 */
function sameCard<N extends GraphNode>(prev: NodeCardProps<N>, next: NodeCardProps<N>): boolean {
  if (
    prev.node !== next.node ||
    prev.selected !== next.selected ||
    prev.spec !== next.spec ||
    prev.onPatch !== next.onPatch ||
    prev.onRemove !== next.onRemove ||
    prev.onDragStart !== next.onDragStart ||
    prev.onResizeStart !== next.onResizeStart ||
    prev.registerPort !== next.registerPort ||
    prev.onPortDown !== next.onPortDown
  ) {
    return false;
  }
  if (prev.graph === next.graph) return true;
  if (
    prev.graph.edges !== next.graph.edges ||
    prev.graph.enabled !== next.graph.enabled ||
    prev.graph.nodes.length !== next.graph.nodes.length
  ) {
    return false;
  }
  // A graph the canvas could not settle: redraw, as this card always used to.
  if (prev.reads === null || next.reads === null) return false;
  if (prev.reads.length !== next.reads.length) return false;
  for (let at = 0; at < next.reads.length; at += 1) {
    if (prev.reads[at] !== next.reads[at]) return false;
  }
  return true;
}

/**
 * One node on the canvas: a caption, a body its dialect draws, and its ports.
 *
 * Everything specific to what the node *means* comes through the spec, so this
 * component is the same one whether the body asks where somebody is from or
 * which channels an answer puts them in.
 *
 * Memoised, which is what keeps a canvas of forty nodes typeable - see
 * `sameCard` above for what it takes for one to be left alone.
 */
function DrawnNodeCard<N extends GraphNode>({
  node,
  graph,
  spec,
  selected,
  onPatch,
  onRemove,
  onDragStart,
  onResizeStart,
  registerPort,
  onPortDown,
}: NodeCardProps<N>) {
  const tone = spec.tone(node);
  const emphasised = spec.emphasise?.(node) ?? false;
  const badge = spec.badge?.(graph, node) ?? null;
  const Body = spec.body;
  const Attachment = spec.attachment;

  return (
    <Box
      data-node-id={node.id}
      sx={{ position: "absolute", left: node.x, top: node.y, width: spec.width(node) }}
    >
      <Box
        sx={(theme) => {
          const { nebula } = theme.palette;
          return {
            position: "relative",
            borderRadius: radius("md"),
            // Opaque, not the bare `card` alpha: nodes overlap constantly on a
            // canvas, and a 10% surface over another node showed that node
            // straight through - the greeting's text read through whatever was
            // dragged across it.
            background: emphasised ? nebula.bg0 : opaque(nebula.card, nebula.bg0),
            border: `1px solid ${emphasised ? nebula.accentLine : nebula.line2}`,
            // A ring, not a border swap. The greeting node carries the accent
            // border permanently, so tinting the border made selecting *that*
            // node change nothing at all on screen; on the others it was one
            // hairline shifting hue, which nobody spots across a full canvas.
            //
            // `outline` rather than a thicker border because it is drawn
            // outside the box and takes no space: nothing reflows, and no wire
            // moves, when a node is picked up.
            outline: selected ? `2px solid ${nebula.accent}` : "none",
            outlineOffset: 1,
            // Every node gets a little lift, not just the greeting: once the
            // surfaces are opaque, two overlapping nodes are otherwise a flat
            // collage with no way to tell which one is on top.
            boxShadow: [
              emphasised
                ? `0 10px 34px ${alpha("#000", 0.34)}`
                : `0 2px 10px ${alpha("#000", theme.palette.mode === "dark" ? 0.26 : 0.1)}`,
              selected ? `0 0 0 6px ${alpha(nebula.accent, 0.16)}` : null,
            ]
              .filter(Boolean)
              .join(", "),
            // A node is dragged by its header only: dragging it by the body
            // would move it out from under whichever field was being edited.
            cursor: "default",
          };
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          gap={0.75}
          onPointerDown={onDragStart}
          sx={(theme) => ({
            px: "10px",
            py: "7px",
            cursor: "grab",
            "&:active": { cursor: "grabbing" },
            borderBottom: `1px solid ${theme.palette.nebula.line}`,
          })}
        >
          <Box
            sx={(theme) => ({
              width: 7,
              height: 7,
              flex: "none",
              borderRadius: "2px",
              background: theme.palette.nebula[tone === "muted" ? "dim" : tone],
            })}
          />
          <Typography sx={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em" }}>
            {spec.label(node)}
          </Typography>
          {badge && (
            <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
              {badge}
            </Typography>
          )}
          <Box
            component="button"
            type="button"
            aria-label="Remove node"
            onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
            onClick={onRemove}
            sx={(theme) => ({
              all: "unset",
              display: "flex",
              cursor: "pointer",
              color: theme.palette.nebula.dim,
              "&:hover": { color: theme.palette.nebula.text },
            })}
          >
            <CloseIcon width={11} height={11} />
          </Box>
        </Stack>

        <PortRows node={node} spec={spec} />

        <Box sx={{ px: "10px", py: "9px" }}>
          <Body node={node} graph={graph} onPatch={onPatch} />
        </Box>

        {/* Bottom-right, outside the border, and only where the dialect allows
            it: the corner is where every other tool puts this, and a handle
            inside the box would sit on top of whichever field ends there. */}
        {onResizeStart && (
          <Box
            onPointerDown={onResizeStart}
            aria-label="Resize node"
            sx={(theme) => ({
              position: "absolute",
              right: -4,
              bottom: -4,
              width: 12,
              height: 12,
              cursor: "nwse-resize",
              borderRadius: "0 0 3px 0",
              borderRight: `2px solid ${theme.palette.nebula.line2}`,
              borderBottom: `2px solid ${theme.palette.nebula.line2}`,
              "&:hover": {
                borderRightColor: theme.palette.nebula.accent,
                borderBottomColor: theme.palette.nebula.accent,
              },
            })}
          />
        )}
      </Box>

      {Attachment && <Attachment node={node} graph={graph} />}

      {spec.inputs(node).map((port, index) => (
        <Port
          key={`in:${port}`}
          side="in"
          port={port}
          index={index}
          node={node}
          spec={spec}
          graph={graph}
          connected={graph.edges.some((edge) => edge.to === node.id && edge.port === port)}
          registerPort={registerPort}
          onPortDown={onPortDown}
        />
      ))}
      {spec.outputs(node).map((port, index) => (
        <Port
          key={`out:${port}`}
          side="out"
          port={port}
          index={index}
          node={node}
          spec={spec}
          graph={graph}
          connected={graph.edges.some((edge) => edge.from === node.id && fromPortOf(edge) === port)}
          registerPort={registerPort}
          onPortDown={onPortDown}
        />
      ))}
    </Box>
  );
}

/**
 * The sockets, named, in their own band under the caption.
 *
 * A band of its own rather than words hung off the sides, and that is what
 * makes the names usable: the nodes on this canvas sit twenty pixels apart, so
 * anything drawn outside a card is over the card next door, and anything drawn
 * over the body is over a field somebody is using. Inside, in a row of their
 * own, they collide with nothing and the node grows by exactly the height of
 * what it has to say.
 *
 * Inputs run down the left and outputs down the right, paired row by row the
 * way every node editor lays this out - one row per socket, and a node with an
 * input and an output shares the row between them.
 *
 * Each side is marked `data-port-row`, which is how the sockets find the row
 * they belong to: they are absolutely positioned on the card's edge and take
 * their height from the row, so a name and its dot cannot drift apart however
 * the type scale changes.
 */
function PortRows<N extends GraphNode>({ node, spec }: Readonly<{ node: N; spec: NodeSpec<N> }>) {
  const inputs = spec.inputs(node);
  const outputs = spec.outputs(node);
  const rows = Math.max(inputs.length, outputs.length);
  if (rows === 0) return null;

  return (
    <Stack sx={{ px: "10px", pt: "7px", gap: "3px" }}>
      {Array.from({ length: rows }, (_, row) => {
        const into = inputs[row];
        const from = outputs[row];
        return (
          <Stack
            key={row}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            gap={1}
            sx={{ minHeight: 13 }}
          >
            <PortName node={node} spec={spec} port={into} side="in" />
            <PortName node={node} spec={spec} port={from} side="out" />
          </Stack>
        );
      })}
    </Stack>
  );
}

/** One socket's name, or an empty half-row where that side has no socket. */
function PortName<N extends GraphNode>({
  node,
  spec,
  port,
  side,
}: Readonly<{ node: N; spec: NodeSpec<N>; port: PortId | undefined; side: PortSide }>) {
  if (port === undefined) return <span />;
  const info = spec.portInfo(node, port, side);
  return (
    <Box
      component="span"
      data-port-row={port}
      sx={(theme) => ({
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        lineHeight: "13px",
        color: theme.palette.nebula[dye(info.tone)],
      })}
    >
      {info.label}
    </Box>
  );
}

/**
 * The card as the canvas uses it.
 *
 * Cast back to the component it wraps because `memo` erases the type
 * parameter, and a canvas that had to hand this an untyped node would lose
 * every guarantee the dialect's node type gives it.
 */
export const NodeCard = memo(DrawnNodeCard, sameCard) as typeof DrawnNodeCard;

function Port<N extends GraphNode>({
  side,
  port,
  index,
  node,
  spec,
  graph,
  connected,
  registerPort,
  onPortDown,
}: Readonly<{
  side: PortSide;
  port: PortId;
  index: number;
  node: N;
  spec: NodeSpec<N>;
  graph: NodeGraph<N>;
  connected: boolean;
  registerPort: RegisterPort;
  onPortDown: PortDown;
}>) {
  // A port the dialect is not sure about is drawn as a ring in the warning
  // tone rather than a filled dot. It is not an error - most useful graphs
  // have them - but it is the thing that silently changes what the graph
  // does, so it is worth being able to see at a glance which parts of a
  // canvas are settled and which are not.
  const warning = spec.warnPort?.(graph, node, port, side) ?? null;

  /**
   * Where the socket sits, measured against the row it belongs to.
   *
   * `spec.portTop` is a formula - so many pixels for the caption, so many per
   * row - and a formula is a second description of a layout that already
   * exists. When the body's type size or spacing moved, the sockets stayed
   * where the arithmetic said and drifted off their labels.
   *
   * So a body that wants its sockets aligned marks each row `data-port-row`,
   * and the socket takes its centre from that. Bodies that mark nothing keep
   * the formula, which is right for the nodes whose ports are chrome rather
   * than rows.
   */
  const dot = useRef<HTMLElement | null>(null);
  /**
   * One `ref` callback for the life of the port, not one per render.
   *
   * React re-runs a ref callback whose identity changed - with `null` first,
   * then with the element - so an inline arrow here made every port
   * de-register and re-register itself on every render of its node. The canvas
   * hands each new registration to a `ResizeObserver`, which answers with an
   * initial callback, so a fresh arrow function per render turned into a
   * measurement pass per port per keystroke.
   */
  const hold = useCallback(
    (el: HTMLElement | null) => {
      dot.current = el;
      registerPort(node.id, side, port, el);
    },
    [registerPort, node.id, side, port],
  );
  const [rowTop, setRowTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = dot.current;
    const card = el?.offsetParent as HTMLElement | null;
    const row = card?.querySelector<HTMLElement>(`[data-port-row="${CSS.escape(port)}"]`);
    if (!row || !card) {
      setRowTop((was) => (was === null ? was : null));
      return;
    }
    let top = 0;
    for (let at: HTMLElement | null = row; at && at !== card; at = at.offsetParent as HTMLElement | null) {
      top += at.offsetTop;
    }
    const centre = Math.round(top + row.offsetHeight / 2);
    setRowTop((was) => (was === centre ? was : centre));
  });
  // The type's own colour, except where the port is flagged - a warning is
  // about *this* socket rather than about what it carries, so it wins. The
  // word beside it is drawn by the canvas, over the nodes, so that a name can
  // never be clipped by whatever node happens to sit next door.
  const tone = warning ? "warn" : spec.portInfo(node, port, side).tone;
  const at = rowTop ?? spec.portTop(node, port, index, side);
  return (
    <Box
        ref={hold}
        // Names the socket, for the tests and for anything driving the canvas
        // from outside it.
        data-port={`${node.id}:${side}:${port}`}
        title={warning ?? undefined}
        onPointerDown={(e: ReactPointerEvent) => {
          e.stopPropagation();
          onPortDown(node.id, side, port, e);
        }}
        sx={(theme) => ({
          position: "absolute",
          [side === "in" ? "left" : "right"]: -5,
          top: at,
          transform: "translateY(-50%)",
          width: 9,
          height: 9,
          borderRadius: "50%",
          cursor: "crosshair",
          background: connected && !warning ? theme.palette.nebula[dye(tone)] : theme.palette.nebula.bg0,
          border: `1.5px solid ${
            connected || warning ? theme.palette.nebula[dye(tone)] : theme.palette.nebula.line2
          }`,
          // The dot is 9px and the thing being aimed at is the *port*, not the
          // dot. This grows what a press lands on to about the spacing between
          // two ports without growing what is drawn, which is the whole of why
          // a socket used to have to be hit exactly.
          "&::before": { content: '""', position: "absolute", inset: -6, borderRadius: "50%" },
          "&:hover": { borderColor: theme.palette.nebula.accent },
        })}
      />
  );
}
