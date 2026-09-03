import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Box, Divider, ListSubheader, Menu, MenuItem } from "@mui/material";
import { NodeCard } from "./NodeCard";
import { AnnotationLayer, minimumOf } from "./AnnotationLayer";
import {
  addAnnotation,
  annotationsOf,
  makeAnnotation,
  patchAnnotation,
  removeAnnotation,
  type Annotation,
  type AnnotationKind,
} from "./annotate";
import { copyOut, decodeClipping, encodeClipping, pasteInto, type Clipping } from "./clipboard";
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
import { insertFragment, type CanvasInsert, type Fragment } from "./templates";
import { boundsOf, useCanvasView } from "./useCanvasView";
import type { CanvasDrop } from "./useBlockCarry";

/** The annotation kinds, in the order the add menu offers them. */
const ANNOTATION_LABELS: readonly (readonly [AnnotationKind, string])[] = [
  ["title", "Title"],
  ["note", "Note"],
  ["frame", "Frame around a region"],
  ["label", "Small label"],
];

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

/** How long a finger has to rest on empty canvas before the add menu opens. */
const LONG_PRESS_MS = 480;
/** How far it may drift while resting. Below this, a finger is holding still. */
const LONG_PRESS_SLOP = 10;

/**
 * Where the pointer sits on a block it carried in, in world units.
 *
 * A little inside the header rather than at the corner, because that is where
 * the hand was on the card: dropping puts the node under the pointer the way it
 * was being carried, not hanging off to one side of it.
 */
const GRAB = { x: 24, y: 14 };

/** Which way each arrow key moves a selection. */
const NUDGES: Readonly<Record<string, { x: number; y: number } | undefined>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/** One press: a pixel, for lining two nodes up exactly. */
const NUDGE_STEP = 1;
/** With Shift: far enough to be a move rather than an adjustment. */
const NUDGE_FAR = 20;

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
  /**
   * Filled in with what it takes to lay a template down here.
   *
   * Same arrangement as `dropRef`, for the same reason: putting nodes onto a
   * canvas is this component's business, because it owns the view the operator
   * is looking through and the selection the new nodes arrive in.
   */
  readonly insertRef?: MutableRefObject<CanvasInsert<N> | null>;
  /** Bound to Ctrl+Z and Ctrl+Shift+Z, where the page keeps a history. */
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
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
export function NodeCanvas<N extends GraphNode>({
  graph,
  spec,
  onChange,
  dropRef,
  insertRef,
  onUndo,
  onRedo,
}: NodeCanvasProps<N>) {
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
  /**
   * A resize in flight, of a node or of an annotation.
   *
   * Anchored to where the thing started and where the pointer started, for the
   * same reason a node drag is: a running delta accumulates a rounding error
   * over a long drag, and a box that grew by 401px when the pointer moved 400
   * is a box nobody can set to a round number.
   */
  const [resizing, setResizing] = useState<{
    id: NodeId;
    layer: "node" | "annotation";
    origin: Point;
    from: { w: number; h: number };
    min: { w: number; h: number };
  } | null>(null);
  /** An annotation being dragged, and where it started. */
  const [movingNote, setMovingNote] = useState<{ id: NodeId; origin: Point; from: Point } | null>(null);
  /** Where the pointer last was, so `A` can add a node under it. */
  const pointer = useRef<Point>({ x: 0, y: 0 });
  /** A finger held still on empty canvas, on its way to the add menu. */
  const longPress = useRef<{ start: Point; timer: number }>({ start: { x: 0, y: 0 }, timer: 0 });
  /**
   * The last thing copied here.
   *
   * Kept alongside the system clipboard rather than instead of it: reading the
   * system clipboard can be refused, and a paste that silently did nothing
   * because a permission was declined would be indistinguishable from a bug.
   * The system copy is what makes a paste into a *second* window work.
   */
  const clipboard = useRef<Clipping<N> | null>(null);
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

  /**
   * A template laid onto this canvas.
   *
   * Rebuilt every render for the same reason the drop is: it closes over the
   * current graph, and a stale one would add the template to the graph as it
   * was when the gallery opened, quietly discarding everything drawn since.
   *
   * The view is refitted afterwards. A template lands clear of what is already
   * drawn, which on a full canvas is off-screen to the right - and a gallery
   * button that appears to do nothing is one nobody presses twice.
   */
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = {
      insert: (fragment: Fragment<N>, replace: boolean) => {
        const laid = insertFragment(graph, fragment, { replace, width: (node) => spec.width(node) });
        onChange(laid.graph);
        setSelection(new Set(laid.added));
        view.fit(
          boundsOf(laid.graph.nodes, (node) => ({
            width: spec.width(node as N),
            height: NODE_FOOTPRINT,
          })),
        );
      },
    };
    return () => {
      insertRef.current = null;
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

  const startResize = (
    id: NodeId,
    layer: "node" | "annotation",
    from: { w: number; h: number },
    min: { w: number; h: number },
    event: ReactPointerEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setResizing({ id, layer, origin: toWorld(event.clientX, event.clientY), from, min });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const startNoteDrag = (note: Annotation, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection(new Set([note.id]));
    setMovingNote({
      id: note.id,
      origin: toWorld(event.clientX, event.clientY),
      from: { x: note.x, y: note.y },
    });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  /** Drop a fresh annotation, selected, where the add menu was opened. */
  const addNote = (kind: AnnotationKind, at: Point) => {
    const made = makeAnnotation(kind, Math.max(0, Math.round(at.x)), Math.max(0, Math.round(at.y)));
    onChange(addAnnotation(graph, made));
    setSelection(new Set([made.id]));
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
    if (longPress.current.timer !== 0) {
      const travelled = Math.hypot(
        event.clientX - longPress.current.start.x,
        event.clientY - longPress.current.start.y,
      );
      if (travelled > LONG_PRESS_SLOP) cancelLongPress();
    }
    if (resizing) {
      const w = Math.max(resizing.min.w, Math.round(resizing.from.w + (at.x - resizing.origin.x)));
      const h = Math.max(resizing.min.h, Math.round(resizing.from.h + (at.y - resizing.origin.y)));
      onChange(
        resizing.layer === "node"
          ? patchNode(graph, resizing.id, { w, h } as Partial<N>)
          : patchAnnotation(graph, resizing.id, { w, h }),
      );
      return;
    }
    if (movingNote) {
      const dx = at.x - movingNote.origin.x;
      const dy = at.y - movingNote.origin.y;
      onChange(
        patchAnnotation(graph, movingNote.id, {
          x: Math.max(0, Math.round(movingNote.from.x + dx)),
          y: Math.max(0, Math.round(movingNote.from.y + dy)),
        }),
      );
      return;
    }
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
    cancelLongPress();
    if (resizing) setResizing(null);
    if (movingNote) setMovingNote(null);
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

  /**
   * A press on empty canvas.
   *
   * With a mouse, a rubber band. With a finger, a pan - sweeping to select is
   * a mouse idiom, and a canvas whose one-finger drag selected instead of
   * moving would feel stuck to anyone who has used a map. The long press is
   * the finger's version of the `A` key, which a touchscreen also does not
   * have.
   */
  const startBand = (event: ReactPointerEvent) => {
    if (event.pointerType === "touch") {
      setSelection(new Set());
      armLongPress(event);
      view.beginPan(event);
      return;
    }
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

  /**
   * Open the add menu if this finger stays put.
   *
   * Cancelled by any movement past a few pixels, because a pan starts as a
   * press that has not travelled yet, and a menu that opened mid-pan would
   * fire on almost every gesture.
   */
  const armLongPress = (event: ReactPointerEvent) => {
    const start = { x: event.clientX, y: event.clientY };
    const world = toWorld(event.clientX, event.clientY);
    clearTimeout(longPress.current.timer);
    longPress.current = {
      start,
      timer: window.setTimeout(() => {
        setAddAt({ left: start.x, top: start.y, world });
      }, LONG_PRESS_MS),
    };
  };

  const cancelLongPress = () => {
    clearTimeout(longPress.current.timer);
    longPress.current.timer = 0;
  };

  /** What the selection would be copied as, or null when it is empty. */
  const copySelection = (): Clipping<N> | null => {
    const clip = copyOut(graph, selection);
    if (!clip) return null;
    clipboard.current = clip;
    // Best effort, and never awaited: the in-memory copy above is what makes
    // the paste work, and this is only so a copy can leave the window.
    void navigator.clipboard?.writeText?.(encodeClipping(clip)).catch(() => undefined);
    return clip;
  };

  /** Put down whatever was copied, under the pointer. */
  const paste = (clip: Clipping<N> | null) => {
    if (!clip || (clip.nodes.length === 0 && clip.annotations.length === 0)) return;
    const laid = pasteInto(graph, clip, pointer.current);
    onChange(laid.graph);
    // Selected on arrival, so it can be dragged into place, or deleted, without
    // hunting for which of the two identical clusters is the new one.
    setSelection(new Set(laid.added));
  };

  /**
   * Move the selection by `step` pixels, both layers together.
   *
   * The arrows are how a node is placed exactly - dragging is fast and lands
   * a pixel out, and two nodes a pixel apart read as crooked on a canvas whose
   * whole point is being readable. Shift makes the step a coarse one, which is
   * the same pair of gestures every editor with a canvas has.
   */
  const nudge = (by: { x: number; y: number }, step: number) => {
    const dx = by.x * step;
    const dy = by.y * step;
    const moved = [...selection].reduce((acc, id) => {
      const node = acc.nodes.find((candidate) => candidate.id === id);
      if (node) {
        return patchNode(acc, id, {
          x: Math.max(0, node.x + dx),
          y: Math.max(0, node.y + dy),
        } as Partial<N>);
      }
      const note = annotationsOf(acc).find((candidate) => candidate.id === id);
      if (!note || !spec.annotate) return acc;
      return patchAnnotation(acc, id, { x: Math.max(0, note.x + dx), y: Math.max(0, note.y + dy) });
    }, graph);
    onChange(moved);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // A node body holds real fields - the greeting is a textarea - so a
    // bare letter has to mean "add a node" only when nobody is typing. The
    // same guard is what leaves Ctrl+C and Ctrl+V to the field somebody is
    // typing in, where they mean the text and not the nodes.
    const target = event.target as HTMLElement;
    if (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)) return;

    const chord = event.ctrlKey || event.metaKey;
    if (chord) {
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        copySelection();
        return;
      }
      if (key === "x") {
        event.preventDefault();
        if (copySelection()) {
          onChange([...selection].reduce((acc, id) => removeAnnotation(removeNode(acc, id), id), graph));
          setSelection(new Set());
        }
        return;
      }
      if (key === "v") {
        event.preventDefault();
        // The system clipboard first, so a copy made in another window wins
        // over one made here an hour ago; the in-memory copy is the fallback
        // for every case where reading is refused or holds something else.
        const held = clipboard.current;
        void (async () => {
          const text = await navigator.clipboard?.readText?.().catch(() => "");
          paste(decodeClipping<N>(text ?? "") ?? held);
        })();
        return;
      }
      if (key === "d") {
        event.preventDefault();
        // Duplicate: a copy and a paste in one press, and the only one of
        // these that does not touch the clipboard - somebody duplicating a
        // node has not asked to lose what they copied earlier.
        const clip = copyOut(graph, selection);
        if (clip) {
          const laid = pasteInto(graph, clip, { x: pointer.current.x, y: pointer.current.y });
          onChange(laid.graph);
          setSelection(new Set(laid.added));
        }
        return;
      }
      if (key === "a") {
        event.preventDefault();
        setSelection(
          new Set([
            ...graph.nodes.map((node) => node.id),
            ...(spec.annotate ? annotationsOf(graph).map((note) => note.id) : []),
          ]),
        );
        return;
      }
      if (key === "z" || key === "y") {
        event.preventDefault();
        // Ctrl+Y and Ctrl+Shift+Z are the same gesture on two platforms, and
        // an editor that knew only one of them is broken on the other.
        if (key === "y" || event.shiftKey) onRedo?.();
        else onUndo?.();
        return;
      }
      return;
    }

    const arrow = NUDGES[event.key];
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
    } else if ((event.key === "Delete" || event.key === "Backspace") && selection.size > 0) {
      event.preventDefault();
      // Backspace as well as Delete: a laptop keyboard often has only the one
      // key, and on a Mac it is the delete key - an editor that knew only the
      // other is an editor you cannot delete anything in.
      //
      // Both layers: the selection is one set, and an operator who selected a
      // note and pressed Delete meant the note.
      onChange([...selection].reduce((acc, id) => removeAnnotation(removeNode(acc, id), id), graph));
      setSelection(new Set());
    } else if (arrow && selection.size > 0) {
      event.preventDefault();
      nudge(arrow, event.shiftKey ? NUDGE_FAR : NUDGE_STEP);
    }
  };

  const notes = spec.annotate ? annotationsOf(graph) : [];

  // Over both layers: a frame drawn past the last node still has to have
  // canvas under it, or the thing an operator just drew is off the edge.
  const extent = [
    ...graph.nodes.map((node) => ({
      w: node.x + spec.width(node),
      h: node.y + NODE_FOOTPRINT,
    })),
    ...notes.map((note) => ({ w: note.x + note.w, h: note.y + note.h })),
  ].reduce((acc, box) => ({ w: Math.max(acc.w, box.w), h: Math.max(acc.h, box.h) }), { w: 0, h: 0 });

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
        setResizing(null);
        setMovingNote(null);
        cancelLongPress();
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
        {/* Behind the wires and the nodes, always: an annotation is
            furniture, and furniture that covered a node would make the node
            unclickable for the sake of a caption. */}
        {notes.length > 0 && (
          <AnnotationLayer
            annotations={notes}
            selection={selection}
            onPatch={(id, patch) => onChange(patchAnnotation(graph, id, patch))}
            onRemove={(id) => onChange(removeAnnotation(graph, id))}
            onDragStart={startNoteDrag}
            onResizeStart={(note, event) =>
              startResize(note.id, "annotation", { w: note.w, h: note.h }, minimumOf(note), event)
            }
          />
        )}

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
            onResizeStart={
              spec.resizable?.(node)
                ? (event) =>
                    startResize(
                      node.id,
                      "node",
                      { w: spec.width(node), h: node.h ?? 0 },
                      spec.minSize?.(node) ?? { w: 120, h: 0 },
                      event,
                    )
                : undefined
            }
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

        {/* The annotation layer's own section. Here rather than in the block
            browser because these are not blocks: they wire to nothing, and
            where one goes is the whole of what an operator is deciding - which
            is exactly what this menu, anchored under the pointer, answers. */}
        {spec.annotate && <Divider />}
        {spec.annotate && <ListSubheader sx={{ lineHeight: "28px" }}>Annotate</ListSubheader>}
        {spec.annotate &&
          ANNOTATION_LABELS.map(([kind, label]) => (
            <MenuItem
              key={kind}
              onClick={() => {
                if (!addAt) return;
                addNote(kind, addAt.world);
                setAddAt(null);
              }}
            >
              {label}
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
