import type { PointerEvent as ReactPointerEvent } from "react";
import { Box, Typography, alpha } from "@mui/material";
import { CloseIcon } from "@ui/icons";
import { opaque, radius } from "../../../tokens";
import { Stack } from "../../primitives";
import { fromPortOf, type GraphNode, type NodeGraph, type NodeId, type PortId } from "./graph";
import type { NodeSpec, PortSide } from "./spec";

/** Hands the canvas the DOM node of a port so it can draw wires to it. */
export type RegisterPort = (node: NodeId, side: PortSide, port: PortId, el: HTMLElement | null) => void;

export type PortDown = (node: NodeId, side: PortSide, port: PortId, event: ReactPointerEvent) => void;

interface NodeCardProps<N extends GraphNode> {
  readonly node: N;
  readonly graph: NodeGraph<N>;
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
 * One node on the canvas: a caption, a body its dialect draws, and its ports.
 *
 * Everything specific to what the node *means* comes through the spec, so this
 * component is the same one whether the body asks where somebody is from or
 * which channels an answer puts them in.
 */
export function NodeCard<N extends GraphNode>({
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
  const tone = warning ? "warn" : "accent";
  return (
    <Box
      ref={(el: HTMLElement | null) => registerPort(node.id, side, port, el)}
      title={warning ?? undefined}
      onPointerDown={(e: ReactPointerEvent) => {
        e.stopPropagation();
        onPortDown(node.id, side, port, e);
      }}
      sx={(theme) => ({
        position: "absolute",
        [side === "in" ? "left" : "right"]: -5,
        top: spec.portTop(node, port, index, side),
        transform: "translateY(-50%)",
        width: 9,
        height: 9,
        borderRadius: "50%",
        cursor: "crosshair",
        background: connected && !warning ? theme.palette.nebula[tone] : theme.palette.nebula.bg0,
        border: `1.5px solid ${
          connected || warning ? theme.palette.nebula[tone] : theme.palette.nebula.line2
        }`,
        "&:hover": { borderColor: theme.palette.nebula.accent },
      })}
    />
  );
}
