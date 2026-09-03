import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, alpha } from "@mui/material";
import { CloseIcon } from "@ui/icons";
import { radius } from "../../../tokens";
import { Stack } from "../../primitives";
import { ANNOTATION_SIZES, type Annotation } from "./annotate";
import type { NodeId } from "./graph";
import type { NebulaTokens } from "../../../tokens";
import type { Tone } from "./spec";

/**
 * The annotation layer, drawn behind the wires and the nodes.
 *
 * Behind, always, and that is not a stacking preference: an annotation is
 * furniture, and furniture that covered a node would make the node unclickable
 * for the sake of a caption. A frame is the case that proves it - its whole
 * purpose is to sit *around* a cluster - so its middle passes pointers straight
 * through to whatever is inside it, and only its edge, its caption and its
 * corner take a press.
 *
 * Editing is in place: the text is a textarea that looks like text. There is no
 * inspector panel and no "edit" mode, because a note somebody cannot correct
 * where they are reading it is a note that stays wrong.
 */

export type AnnotationDrag = (note: Annotation, event: ReactPointerEvent) => void;
export type AnnotationResize = (note: Annotation, event: ReactPointerEvent) => void;

interface AnnotationLayerProps {
  readonly annotations: readonly Annotation[];
  readonly selection: ReadonlySet<NodeId>;
  readonly onPatch: (id: NodeId, patch: Partial<Annotation>) => void;
  readonly onRemove: (id: NodeId) => void;
  readonly onDragStart: AnnotationDrag;
  readonly onResizeStart: AnnotationResize;
}

export function AnnotationLayer({
  annotations,
  selection,
  onPatch,
  onRemove,
  onDragStart,
  onResizeStart,
}: AnnotationLayerProps) {
  return (
    <>
      {annotations.map((note) => (
        <AnnotationView
          key={note.id}
          note={note}
          selected={selection.has(note.id)}
          onPatch={(patch) => onPatch(note.id, patch)}
          onRemove={() => onRemove(note.id)}
          onDragStart={(event) => onDragStart(note, event)}
          onResizeStart={(event) => onResizeStart(note, event)}
        />
      ))}
    </>
  );
}

function AnnotationView({
  note,
  selected,
  onPatch,
  onRemove,
  onDragStart,
  onResizeStart,
}: Readonly<{
  note: Annotation;
  selected: boolean;
  onPatch: (patch: Partial<Annotation>) => void;
  onRemove: () => void;
  onDragStart: (event: ReactPointerEvent) => void;
  onResizeStart: (event: ReactPointerEvent) => void;
}>) {
  const [hovered, setHovered] = useState(false);
  const frame = note.kind === "frame";
  const shown = selected || hovered;

  return (
    <Box
      data-annotation-id={note.id}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      sx={{
        position: "absolute",
        left: note.x,
        top: note.y,
        width: note.w,
        height: note.h,
        // A frame is a ring around other things, so the hole in the middle has
        // to be a hole: pointers pass through to the nodes inside it, and the
        // parts that are actually the frame turn them back on.
        pointerEvents: frame ? "none" : "auto",
      }}
    >
      <Box
        onPointerDown={frame ? undefined : onDragStart}
        sx={(theme) => {
          const colour = toneColour(theme.palette.nebula, note.tone);
          return {
            position: "absolute",
            inset: 0,
            borderRadius: radius(frame ? "lg" : "md"),
            cursor: frame ? "default" : "grab",
            "&:active": { cursor: frame ? "default" : "grabbing" },
            ...(frame
              ? {
                  // Dashed, and only a wash of colour: a frame has to read as a
                  // boundary rather than as a card, or a cluster inside one
                  // looks like a node inside a panel.
                  border: `1px dashed ${alpha(colour, 0.55)}`,
                  background: alpha(colour, 0.05),
                  pointerEvents: "none",
                }
              : note.kind === "note"
                ? {
                    border: `1px solid ${alpha(colour, 0.35)}`,
                    background: alpha(colour, 0.08),
                  }
                : {}),
            outline: selected ? `2px solid ${theme.palette.nebula.accent}` : "none",
            outlineOffset: 2,
          };
        }}
      />

      {/* A frame's caption is also its handle. Nothing else on it takes a
          press, so without this there would be no way to pick one up. */}
      {frame ? (
        <Stack
          direction="row"
          alignItems="center"
          gap={0.5}
          onPointerDown={onDragStart}
          sx={(theme) => ({
            position: "absolute",
            left: 10,
            top: -11,
            maxWidth: "calc(100% - 20px)",
            px: "7px",
            py: "1px",
            pointerEvents: "auto",
            cursor: "grab",
            "&:active": { cursor: "grabbing" },
            borderRadius: radius("sm"),
            background: theme.palette.nebula.bg0,
            border: `1px solid ${alpha(toneColour(theme.palette.nebula, note.tone), 0.5)}`,
          })}
        >
          <Text note={note} onPatch={onPatch} bare />
        </Stack>
      ) : (
        <Box sx={{ position: "absolute", inset: note.kind === "note" ? "9px 11px" : 0 }}>
          <Text note={note} onPatch={onPatch} />
        </Box>
      )}

      {shown && (
        <Stack
          direction="row"
          gap={0.25}
          sx={{ position: "absolute", right: 2, top: frame ? 4 : 2, pointerEvents: "auto" }}
        >
          {(["muted", "accent", "ok", "warn"] as const).map((tone) => (
            <Box
              key={tone}
              component="button"
              type="button"
              aria-label={`Colour ${tone}`}
              onPointerDown={(event: ReactPointerEvent) => event.stopPropagation()}
              onClick={() => onPatch({ tone })}
              sx={(theme) => ({
                all: "unset",
                width: 9,
                height: 9,
                cursor: "pointer",
                borderRadius: "2px",
                background: toneColour(theme.palette.nebula, tone),
                opacity: note.tone === tone ? 1 : 0.35,
                "&:hover": { opacity: 1 },
              })}
            />
          ))}
          <Box
            component="button"
            type="button"
            aria-label="Remove annotation"
            onPointerDown={(event: ReactPointerEvent) => event.stopPropagation()}
            onClick={onRemove}
            sx={(theme) => ({
              all: "unset",
              display: "flex",
              ml: "3px",
              cursor: "pointer",
              color: theme.palette.nebula.dim,
              "&:hover": { color: theme.palette.nebula.text },
            })}
          >
            <CloseIcon width={9} height={9} />
          </Box>
        </Stack>
      )}

      {shown && (
        <Box
          onPointerDown={onResizeStart}
          aria-label="Resize annotation"
          sx={(theme) => ({
            position: "absolute",
            right: -3,
            bottom: -3,
            width: 12,
            height: 12,
            pointerEvents: "auto",
            cursor: "nwse-resize",
            borderRadius: "2px",
            background: theme.palette.nebula.accent,
            opacity: 0.8,
            "&:hover": { opacity: 1 },
          })}
        />
      )}
    </Box>
  );
}

/**
 * The words, editable where they are read.
 *
 * A textarea rather than a click-to-edit toggle: the toggle is a mode, and a
 * mode is a thing to be in and to get stuck in. Sized to its box, so a note
 * that outgrows its rectangle is a rectangle somebody drags bigger - which is
 * the same gesture as everything else on this layer.
 */
function Text({
  note,
  onPatch,
  bare,
}: Readonly<{ note: Annotation; onPatch: (patch: Partial<Annotation>) => void; bare?: boolean }>) {
  const heading = note.kind === "title";
  return (
    <Box
      component="textarea"
      value={note.text}
      aria-label={`${note.kind} annotation`}
      spellCheck={false}
      // The press that puts the caret in must not also pick the annotation up,
      // and must not start a rubber band on the canvas behind it.
      onPointerDown={(event: ReactPointerEvent) => event.stopPropagation()}
      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onPatch({ text: event.target.value })}
      sx={(theme) => ({
        display: "block",
        width: "100%",
        height: bare ? 15 : "100%",
        boxSizing: "border-box",
        p: 0,
        border: 0,
        resize: "none",
        overflow: "hidden",
        background: "transparent",
        color: bare
          ? toneColour(theme.palette.nebula, note.tone)
          : note.kind === "note"
            ? theme.palette.nebula.muted
            : toneColour(theme.palette.nebula, note.tone),
        fontFamily: "inherit",
        fontSize: heading ? 20 : bare || note.kind === "label" ? 10.5 : 11.5,
        fontWeight: heading ? 700 : bare ? 600 : 400,
        letterSpacing: heading ? "-0.01em" : bare ? "0.06em" : undefined,
        textTransform: bare ? "uppercase" : undefined,
        lineHeight: heading ? 1.15 : 1.5,
        outline: "none",
        "&::placeholder": { color: theme.palette.nebula.dim },
      })}
    />
  );
}

/** A tone as the colour it names, with `muted` reading as the quiet one. */
function toneColour(nebula: NebulaTokens, tone: Tone): string {
  return nebula[tone === "muted" ? "dim" : tone];
}

/** How small each kind may be dragged, for the canvas's resize. */
export function minimumOf(note: Annotation): { w: number; h: number } {
  const size = ANNOTATION_SIZES[note.kind];
  return { w: size.minW, h: size.minH };
}
