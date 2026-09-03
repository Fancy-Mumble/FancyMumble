import { Box, Typography } from "@mui/material";
import { radius } from "../../../tokens";
import { Stack } from "../../primitives";
import { SectionLabel } from "../nodes";
import { compileTarget } from "./compile";
import { flowOf, type Design } from "./design";

/**
 * A design block's body on the canvas: its signature, and a way in.
 *
 * What a node has to say from across a full canvas is *what it takes* and
 * *roughly what it looks like* - which is the input list and the thumbnail.
 * What it says is not the design itself: a design is a page, and a page inside
 * a 300px node is neither readable nor editable. The button is the whole of the
 * interaction here.
 *
 * The input names are drawn against the ports on the node's left edge, so an
 * operator reading a wire can see which input it lands on without tracing it.
 */
export function DesignBody({ design, onOpen }: Readonly<{ design: Design; onOpen: () => void }>) {
  const blocks = design.blocks.length;
  const slots = design.slots.length;

  return (
    <Stack gap={1}>
      <SectionLabel>Theme inputs</SectionLabel>

      {design.slots.length === 0 && design.conditions.length === 0 && (
        <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
          none yet — a design declares these
        </Typography>
      )}

      {/* Ordered exactly as `inputsOf` orders the ports, so the names line up
          with the sockets they belong to. */}
      {design.slots.map((input) => (
        <InputRow key={input.id} name={input.name} kind="TEXT" wired={Boolean(input.wired)} />
      ))}
      {design.conditions.map((input) => (
        <InputRow key={input.id} name={input.name} kind="BOOL" wired />
      ))}

      <Thumbnail design={design} />

      <Box
        component="button"
        type="button"
        onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
        onClick={onOpen}
        sx={(theme) => ({
          all: "unset",
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          px: "9px",
          py: "6px",
          cursor: "pointer",
          textAlign: "center",
          borderRadius: radius("sm"),
          fontSize: 11.5,
          fontWeight: 600,
          color: theme.palette.nebula.accent,
          background: theme.palette.nebula.accentSoft,
          border: `1px solid ${theme.palette.nebula.accentLine}`,
          "&:hover": { background: theme.palette.nebula.hover },
        })}
      >
        {`Design · ${blocks} block${blocks === 1 ? "" : "s"} · ${slots} slot${slots === 1 ? "" : "s"}`}
      </Box>
    </Stack>
  );
}

/** One declared input, beside the port it is wired to. */
function InputRow({ name, kind, wired }: Readonly<{ name: string; kind: "TEXT" | "BOOL"; wired: boolean }>) {
  return (
    <Stack direction="row" alignItems="center" gap={0.75}>
      <Typography
        sx={(theme) => ({
          flex: 1,
          minWidth: 0,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          color: wired ? theme.palette.nebula.accent : theme.palette.nebula.muted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        })}
      >
        {name}
      </Typography>
      <Typography
        sx={(theme) => ({
          flex: "none",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 9,
          letterSpacing: "0.12em",
          color: theme.palette.nebula.dim,
        })}
      >
        {kind}
      </Typography>
    </Stack>
  );
}

/**
 * The design at a glance.
 *
 * Grey bars at the real positions rather than a rendering of the content: at
 * this size the words are unreadable anyway, and what an operator is checking
 * from across the canvas is which of four greetings this is - which the
 * *shape* answers and a paragraph of 3px text does not.
 */
function Thumbnail({ design }: Readonly<{ design: Design }>) {
  const blocks = flowOf(design, "base");
  const height = blocks.reduce((tallest, block) => Math.max(tallest, block.y + (block.h ?? 24)), 1);
  const scale = 100 / Math.max(design.sheetW, 1);

  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: "relative",
        width: "100%",
        // Bounded, so a long design is a tall-ish thumbnail rather than a
        // node three screens high.
        paddingTop: `${Math.min(70, height * scale)}%`,
        borderRadius: radius("sm"),
        background: theme.palette.nebula.panel,
        border: `1px solid ${theme.palette.nebula.line}`,
        overflow: "hidden",
      })}
    >
      {blocks.map((block) => (
        <Box
          key={block.id}
          sx={(theme) => ({
            position: "absolute",
            left: `${(block.x / design.sheetW) * 100}%`,
            top: `${(block.y / Math.max(height, 1)) * 100}%`,
            width: `${(block.w / design.sheetW) * 100}%`,
            height: block.type === "divider" ? "1.5px" : "5px",
            borderRadius: "1px",
            background:
              block.gate !== undefined ? theme.palette.nebula.accentLine : theme.palette.nebula.line2,
          })}
        />
      ))}
    </Box>
  );
}

/** How many parts this design compiles to, for the footer of the editor. */
export function partCount(design: Design): number {
  return compileTarget(design, "html").length;
}
