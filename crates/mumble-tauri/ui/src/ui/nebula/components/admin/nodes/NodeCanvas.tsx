import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Box, Menu, MenuItem } from "@mui/material";
import { NodeCard } from "./NodeCard";
import {
  connect,
  disconnect,
  fromPortOf,
  patchNode,
  removeNode,
  type GraphNode,
  type NodeGraph,
  type NodeId,
  type PortId,
} from "./graph";
import { NODE_FOOTPRINT, type BlockDef, type NodeSpec, type PortSide } from "./spec";
import { boundsOf, useCanvasView } from "./useCanvasView";
import type { CanvasDrop } from "./useBlockCarry";

/** Where a port sits, in world coordinates. */
interface Point {
  x: number;
  y: number;
}

type PortKey = string;
const portKey = (node: NodeId, side: PortSide, port: PortId): PortKey => `${node}|${side}|${port}`;

function parsePortKey(key: PortKey): { node: NodeId; side: PortSide; port: PortId } {
  const [node, side, port] = key.split("|");
  return { node, side: side as PortSide, port };
}

/** Shared, so an idle canvas is not handed a fresh empty set each render. */
const EMPTY_SELECTION: ReadonlySet<NodeId> = new Set();

/** Breathing room past the furthest node, so there is always somewhere to drag to. */
const CANVAS_MARGIN = 420;

/**
 * Where the pointer sits on a block it carried in, in world units.
 *
 * A little inside the header rather than at the corner, because that is where
 * the hand was on the card: dropping puts the node under the pointer the way it
 * was being carried, not hanging off to one side of it.
 */
const GRAB = { x: 24, y: 14 };

interface NodeCanvasProps<N extends GraphNode> {
  readonly graph: NodeGraph<N>;
  readonly spec: NodeSpec<N>;
  readonly onChange: (next: NodeGraph<N>) => void;
  /**
   * Filled in with what it takes to drop a block here, for the block browser
   * above. Null whenever no canvas is on screen, which is what makes a drag
   * over the prose view land nowhere instead of somewhere invisible.
   */
  readonly dropRef?: MutableRefObject<CanvasDrop<N> | null>;
}

/**
 * The node canvas.
 *
 * Two layers: a fixed **viewport** that catches every gesture, and a **world**
 * inside it carrying one transform. Nodes are laid out in world coordinates
 * and never learn about the view, so panning and zooming cost them nothing.
 *
 * Navigation is KiCad's - see `useCanvasView`. The wheel zooms about the
 * pointer rather than scrolling, which is why the viewport clips instead of
 * scrolling: a scrollbar and a zoom that both answer the wheel fight over it.
 * The grid lives on the viewport rather than the world so it carries on past
 * wherever the nodes happen to end, which is what makes panning into empty
 * space read as canvas rather than as falling off the edge.
 */
export function NodeCanvas<N extends GraphNode>({ graph, spec, onChange, dropRef }: NodeCanvasProps<N>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  // Asked at the moment Home is pressed, so a graph that grew since mount
  // still fits.
  const bounds = useCallback(
    () => boundsOf(graph.nodes, (node) => ({ width: spec.width(node as N), height: NODE_FOOTPRINT })),
    [graph.nodes, spec],
  );
  const view = useCanvasView(viewportRef, bounds);
  const scale = view.scale;
  const ports = useRef(new Map<PortKey, HTMLElement>());
  const [geometry, setGeometry] = useState<Map<PortKey, Point>>(new Map());

  /** A wire being drawn, from an output to wherever the pointer is. */
  const [pending, setPending] = useState<{ from: NodeId; fromPort: PortId; at: Point } | null>(null);
  /**
   * A drag of the selection, holding where every moving node started.
   *
   * Origins rather than a running delta: accumulating one drifts, because
   * each frame rounds to whole pixels and the error compounds over a long
   * drag. Anchoring to where the nodes were means the rounding happens once
   * per frame against a fixed point.
   */
  const [dragging, setDragging] = useState<{
    origin: Point;
    started: ReadonlyMap<NodeId, Point>;
  } | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<NodeId>>(new Set());
  /** The rubber band, in world coordinates, while one is being dragged. */
  const [band, setBand] = useState<{
    from: Point;
    to: Point;
    add: boolean;
    /** Measured once, at the start: nodes do not move under a band. */
    boxes: readonly NodeBox[];
  } | null>(null);
  /** Where the pointer last was, so `A` can add a node under it. */
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const [addAt, setAddAt] = useState<{ left: number; top: number; world: Point } | null>(null);

  const registerPort = useCallback((node: NodeId, side: PortSide, port: PortId, el: HTMLElement | null) => {
    const key = portKey(node, side, port);
    if (el) ports.current.set(key, el);
    else ports.current.delete(key);
  }, []);

  /** Pointer position in world coordinates - the space nodes and wires live in. */
  const toWorld = view.toWorld;

  // Port centres are measured rather than computed. A node's height depends on
  // its text, its chips and how many rows are on it, so the only thing that
  // knows where a port ended up is the port.
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const measure = () => {
      const box = world.getBoundingClientRect();
      const next = new Map<PortKey, Point>();
      for (const [key, el] of ports.current) {
        const rect = el.getBoundingClientRect();
        // Rects are screen pixels and the world carries a scale, so the
        // offsets have to be divided back out. Missing this looks perfect at
        // 100% and drifts proportionally at every other zoom, which is a
        // long way to travel before anyone suspects the measurement.
        next.set(key, {
          x: (rect.left + rect.width / 2 - box.left) / scale,
          y: (rect.top + rect.height / 2 - box.top) / scale,
        });
      }
      setGeometry(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(world);
    for (const el of ports.current.values()) observer.observe(el);
    return () => observer.disconnect();
    // `scale` rather than the whole view: panning moves the world and every
    // port with it, so world coordinates are unchanged and re-measuring on a
    // pan would be a full pass per frame for an identical answer.
  }, [graph, scale]);

  /**
   * A block dropped in from the browser.
   *
   * Handed over rather than done up in the editor, because putting a node down
   * is this component's business: it owns the view transform that turns a
   * pointer into a place, and the selection the new node arrives in.
   *
   * Rebuilt every render on purpose - it closes over the current graph, and a
   * stale one would drop the node into the graph as it was when the browser
   * opened, quietly discarding everything drawn since.
   */
  useEffect(() => {
    if (!dropRef) return;
    dropRef.current = {
      accepts: (clientX, clientY) => {
        const box = viewportRef.current?.getBoundingClientRect();
        return (
          box !== undefined &&
          clientX >= box.left &&
          clientX <= box.right &&
          clientY >= box.top &&
          clientY <= box.bottom
        );
      },
      drop: (block: BlockDef<N>, clientX, clientY) => {
        const at = toWorld(clientX, clientY);
        const made = block.create(
          Math.max(0, Math.round(at.x - GRAB.x)),
          Math.max(0, Math.round(at.y - GRAB.y)),
        );
        onChange({ ...graph, nodes: [...graph.nodes, made] });
        // Selected on arrival, exactly as one added from the `A` menu is.
        setSelection(new Set([made.id]));
      },
    };
    return () => {
      dropRef.current = null;
    };
  });

  const startNodeDrag = (node: N, event: ReactPointerEvent) => {
    event.preventDefault();
    const additive = event.shiftKey || event.ctrlKey;
    // Dragging a node that is already selected moves the whole selection;
    // dragging an unselected one is a new selection of just that node. That
    // is what stops a stray drag silently scattering a careful selection.
    const moving: ReadonlySet<NodeId> = additive
      ? new Set([...selection, node.id])
      : selection.has(node.id)
        ? selection
        : new Set([node.id]);
    setSelection(moving);

    const started = new Map<NodeId, Point>();
    for (const candidate of graph.nodes) {
      if (moving.has(candidate.id)) started.set(candidate.id, { x: candidate.x, y: candidate.y });
    }
    setDragging({ origin: toWorld(event.clientX, event.clientY), started });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const startWire = (node: NodeId, side: PortSide, port: PortId, event: ReactPointerEvent) => {
    event.preventDefault();
    if (side === "out") {
      setPending({ from: node, fromPort: port, at: toWorld(event.clientX, event.clientY) });
      return;
    }
    // Grabbing a filled input picks the wire up rather than doing nothing, so a
    // mis-wired node is corrected by dragging instead of by hunting for an X.
    const held = graph.edges.find((edge) => edge.to === node && edge.port === port);
    if (!held) return;
    onChange(disconnect(graph, held.id));
    setPending({
      from: held.from,
      fromPort: fromPortOf(held),
      at: toWorld(event.clientX, event.clientY),
    });
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const at = toWorld(event.clientX, event.clientY);
    pointer.current = at;
    if (dragging) {
      const dx = at.x - dragging.origin.x;
      const dy = at.y - dragging.origin.y;
      onChange({
        ...graph,
        nodes: graph.nodes.map((node) => {
          const from = dragging.started.get(node.id);
          return from
            ? { ...node, x: Math.max(0, Math.round(from.x + dx)), y: Math.max(0, Math.round(from.y + dy)) }
            : node;
        }),
      });
      return;
    }
    if (band) setBand({ ...band, to: at });
    if (pending) setPending({ ...pending, at });
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    if (dragging) setDragging(null);
    if (band) {
      setSelection(band.add ? new Set([...selection, ...catching]) : catching);
      setBand(null);
    }
    if (!pending) return;
    const target = portAt(ports.current, event.clientX, event.clientY);
    if (target && target.side === "in") {
      onChange(
        connect(graph, spec, {
          from: pending.from,
          fromPort: pending.fromPort,
          to: target.node,
          port: target.port,
        }),
      );
    }
    setPending(null);
  };

  /**
   * What the band has caught *so far*.
   *
   * Drawn as selected while the drag is still happening, because a band
   * that shows nothing until it is released asks an operator to predict the
   * window-versus-crossing rule from the shape of the rectangle. With this
   * they watch it happen and can correct before letting go.
   */
  const catching = band ? caughtBy(band, band.boxes) : EMPTY_SELECTION;

  /** Left button on empty canvas starts a rubber band. */
  const startBand = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const at = toWorld(event.clientX, event.clientY);
    setBand({
      from: at,
      to: at,
      add: event.shiftKey || event.ctrlKey,
      boxes: measureNodes(worldRef.current, scale),
    });
    if (!event.shiftKey && !event.ctrlKey) setSelection(new Set());
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // A node body holds real fields - the greeting is a textarea - so a
    // bare letter has to mean "add a node" only when nobody is typing.
    const target = event.target as HTMLElement;
    if (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)) return;

    if (event.key === "a" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const box = viewportRef.current?.getBoundingClientRect();
      if (!box) return;
      // Anchored where the pointer is, so the node lands where the operator
      // was looking rather than wherever the last one went.
      setAddAt({
        left: box.left + pointer.current.x * scale + view.tx,
        top: box.top + pointer.current.y * scale + view.ty,
        world: pointer.current,
      });
    } else if (event.key === "Escape") {
      setSelection(new Set());
    } else if (event.key === "Delete" && selection.size > 0) {
      event.preventDefault();
      onChange([...selection].reduce((acc, id) => removeNode(acc, id), graph));
      setSelection(new Set());
    }
  };

  const extent = graph.nodes.reduce(
    (acc, node) => ({
      w: Math.max(acc.w, node.x + spec.width(node)),
      h: Math.max(acc.h, node.y + NODE_FOOTPRINT),
    }),
    { w: 0, h: 0 },
  );

  return (
    <Box
      ref={viewportRef}
      tabIndex={0}
      onPointerDown={(e) => {
        view.handlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        view.handlers.onPointerMove(e);
        onPointerMove(e);
      }}
      onPointerUp={(e) => {
        view.handlers.onPointerUp(e);
        onPointerUp(e);
      }}
      onContextMenu={view.handlers.onContextMenu}
      onKeyDown={onKeyDown}
      onPointerLeave={() => {
        setDragging(null);
        setPending(null);
      }}
      sx={(theme) => ({
        flex: 1,
        minHeight: 0,
        position: "relative",
        // Clipped, not scrolled: the wheel is spent on zoom, so a scrollbar
        // would be a second answer to the same gesture.
        overflow: "hidden",
        outline: "none",
        touchAction: "none",
        // A rubber band dragged across the canvas would otherwise sweep up the
        // text it passes over - every header, label and port caption highlights
        // blue and the drag ends holding a selection nobody asked for.
        userSelect: "none",
        // The fields are the exception, and have to be: a node body holds real
        // inputs, and text you cannot select is text you cannot edit. Stated
        // here rather than on each control because it is this element's
        // `user-select` they are escaping, and a reader who finds one without
        // the other has half the rule.
        "& input, & textarea, & [contenteditable='true']": { userSelect: "text" },
        cursor: view.panning ? "grabbing" : "default",
        borderTop: `1px solid ${theme.palette.nebula.line}`,
        borderBottom: `1px solid ${theme.palette.nebula.line}`,
        // The window's own wash, not a flat fill: the canvas is a surface
        // in the room the rest of the client is in, and a solid slab here
        // reads as a panel dropped on top of it.
        background: `${theme.palette.nebula.tint},${theme.palette.nebula.bg0}`,
        // The mock's dotted field, on the viewport so it carries on past the
        // nodes. It tracks the view itself: the spacing scales and the origin
        // follows the pan, so the dots stay nailed to the drawing rather than
        // sliding under it.
        backgroundImage: `radial-gradient(${theme.palette.nebula.line2} 1px, transparent 1px)`,
        backgroundSize: `${22 * scale}px ${22 * scale}px`,
        backgroundPosition: `${view.tx}px ${view.ty}px`,
      })}
    >
      <Box
        ref={worldRef}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) startBand(e);
        }}
        sx={{
          position: "absolute",
          left: 0,
          top: 0,
          width: extent.w + CANVAS_MARGIN,
          height: extent.h + CANVAS_MARGIN,
          transform: view.transform,
          transformOrigin: "0 0",
        }}
      >
        <Box
          component="svg"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          {graph.edges.map((edge) => {
            const from = geometry.get(portKey(edge.from, "out", fromPortOf(edge)));
            const to = geometry.get(portKey(edge.to, "in", edge.port));
            if (!from || !to) return null;
            return <Wire key={edge.id} from={from} to={to} tone={spec.wireTone(edge.port)} />;
          })}
          {pending &&
            (() => {
              const from = geometry.get(portKey(pending.from, "out", pending.fromPort));
              return from ? <Wire from={from} to={pending.at} tone="muted" dashed /> : null;
            })()}
        </Box>

        {band && (
          <Box
            sx={(theme) => ({
              position: "absolute",
              left: Math.min(band.from.x, band.to.x),
              top: Math.min(band.from.y, band.to.y),
              width: Math.abs(band.to.x - band.from.x),
              height: Math.abs(band.to.y - band.from.y),
              pointerEvents: "none",
              background: `${theme.palette.nebula.accent}14`,
              // Solid left-to-right, dashed right-to-left: the border says
              // which of the two selections this is before it is released.
              border: `1px ${band.to.x >= band.from.x ? "solid" : "dashed"} ${theme.palette.nebula.accent}`,
            })}
          />
        )}

        {graph.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            graph={graph}
            spec={spec}
            selected={selection.has(node.id) || catching.has(node.id)}
            onPatch={(patch) => onChange(patchNode(graph, node.id, patch))}
            onRemove={() => onChange(removeNode(graph, node.id))}
            onDragStart={(event) => startNodeDrag(node, event)}
            registerPort={registerPort}
            onPortDown={startWire}
          />
        ))}
      </Box>

      <Menu
        open={addAt !== null}
        anchorReference="anchorPosition"
        anchorPosition={addAt ? { left: addAt.left, top: addAt.top } : undefined}
        onClose={() => setAddAt(null)}
      >
        {spec.blocks.map((block) => (
          <MenuItem
            key={block.id}
            onClick={() => {
              if (!addAt) return;
              const made = block.create(Math.round(addAt.world.x), Math.round(addAt.world.y));
              onChange({ ...graph, nodes: [...graph.nodes, made] });
              // Selected on arrival, so it can be dragged or deleted without
              // hunting for it on a busy canvas.
              setSelection(new Set([made.id]));
              setAddAt(null);
            }}
          >
            {block.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

/**
 * The nodes a rubber band caught, measured off the page.
 *
 * From the DOM rather than from `x`, `y` and a nominal height: a node is as
 * tall as its own text, chips and rows make it, so a constant would select
 * things the band visibly missed and miss things it covered.
 */
/** A node's box in world coordinates, as the band sees it. */
export interface NodeBox {
  id: NodeId;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Which boxes a band catches.
 *
 * Dragged left-to-right, only boxes wholly inside are caught; right-to-left,
 * anything the band touches is. That is KiCad's window-versus-crossing rule,
 * and it is worth keeping: the first picks a cluster out of a busy canvas,
 * the second sweeps up everything along a line.
 */
export function caughtBy(band: { from: Point; to: Point }, boxes: readonly NodeBox[]): Set<NodeId> {
  const crossing = band.to.x < band.from.x;
  const left = Math.min(band.from.x, band.to.x);
  const right = Math.max(band.from.x, band.to.x);
  const top = Math.min(band.from.y, band.to.y);
  const bottom = Math.max(band.from.y, band.to.y);
  const caught = new Set<NodeId>();
  for (const box of boxes) {
    const hit = crossing
      ? box.x1 < right && box.x2 > left && box.y1 < bottom && box.y2 > top
      : box.x1 >= left && box.x2 <= right && box.y1 >= top && box.y2 <= bottom;
    if (hit) caught.add(box.id);
  }
  return caught;
}

/**
 * Every node's box, in world coordinates.
 *
 * Measured off the page rather than computed from `x`, `y` and a nominal
 * height: a node is as tall as its own text, chips and rows make it, so a
 * constant would catch things the band visibly missed and miss things it
 * plainly covered.
 */
function measureNodes(world: HTMLElement | null, scale: number): NodeBox[] {
  if (!world) return [];
  const origin = world.getBoundingClientRect();
  const boxes: NodeBox[] = [];
  for (const element of world.querySelectorAll<HTMLElement>("[data-node-id]")) {
    const id = element.dataset.nodeId;
    if (!id) continue;
    const rect = element.getBoundingClientRect();
    // Screen pixels back into world units, as everywhere else the world's
    // scale is crossed.
    const x1 = (rect.left - origin.left) / scale;
    const y1 = (rect.top - origin.top) / scale;
    boxes.push({ id, x1, y1, x2: x1 + rect.width / scale, y2: y1 + rect.height / scale });
  }
  return boxes;
}

/** Which registered port, if any, is under the pointer. */
function portAt(
  ports: Map<PortKey, HTMLElement>,
  clientX: number,
  clientY: number,
): { node: NodeId; side: PortSide; port: PortId } | null {
  // A 6px slop, because a 9px dot is a small thing to ask somebody to hit and
  // the wire is already following their pointer.
  const slop = 6;
  for (const [key, el] of ports) {
    const r = el.getBoundingClientRect();
    if (
      clientX >= r.left - slop &&
      clientX <= r.right + slop &&
      clientY >= r.top - slop &&
      clientY <= r.bottom + slop
    ) {
      return parsePortKey(key);
    }
  }
  return null;
}

/**
 * One wire.
 *
 * Coloured by what it *feeds*, not by where it comes from: the wire carrying
 * the condition into a greeting reads in the accent, one carrying prose reads
 * green, and everything upstream of a gate is quiet. That is what makes the
 * strands legible in a full canvas, and it is the dialect that decides which
 * is which.
 */
function Wire({
  from,
  to,
  tone,
  dashed,
}: Readonly<{ from: Point; to: Point; tone: "accent" | "ok" | "warn" | "muted"; dashed?: boolean }>) {
  // Half the horizontal gap, so a wire leaves and lands flat. A wire that
  // doubles back - the flow from one question to the next, below it - gets the
  // same reach from its own length, which turns the crossing into a loop
  // rather than a kink.
  const reach = Math.max(40, Math.abs(to.x - from.x) / 2);
  const d = `M${from.x},${from.y} C${from.x + reach},${from.y} ${to.x - reach},${to.y} ${to.x},${to.y}`;
  return (
    <Box
      component="path"
      d={d}
      sx={(theme) => ({
        fill: "none",
        strokeWidth: 1.5,
        strokeDasharray: dashed ? "4 4" : undefined,
        stroke: theme.palette.nebula[tone === "muted" ? "line2" : tone],
      })}
    />
  );
}
