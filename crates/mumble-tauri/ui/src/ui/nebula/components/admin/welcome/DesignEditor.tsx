import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Menu, MenuItem, Divider, Typography } from "@mui/material";
import { Stack } from "../../primitives";
import { PlainInput, SectionLabel, boundsOf, useCanvasView } from "../nodes";
import { snapTo, snapWidth, type Guide } from "./snapping";
import {
  BLOCK_LABELS,
  GRID,
  TARGETS,
  TARGET_LABELS,
  addBlock,
  designProblems,
  droppedOn,
  effective,
  gateOpen,
  insertableOn,
  isFlat,
  overrideCount,
  overrideOf,
  removeBlock,
  revertBlock,
  revertTarget,
  setField,
  snap,
  type Block,
  type BlockType,
  type Design,
  type Target,
} from "./design";

/**
 * The design editor: a sheet, a palette, a layer list and a properties panel.
 *
 * Slides in from the right over the canvas, because the canvas is still the
 * context - which greeting this is, and what is wired into it, is on the node
 * behind the panel and stays legible there.
 *
 * ## The target tabs are the whole idea
 *
 * `Base` is the design. The other four are what particular clients get, and
 * each of them takes only the subset it can honour: an image is not offered on
 * the Qt tab at all, a badge is not offered on Plain. Editing on a target tab
 * writes a *patch* on the field touched and nothing else, so a heading moved on
 * base moves everywhere that has not diverged on that field.
 *
 * That is what makes free positioning safe. An operator lays the design out
 * once, and each client takes what it can draw - rather than the design being
 * pinned to the least capable target from the start.
 */

let seq = 0;

const freshId = () => {
  seq += 1;
  return `b${Date.now().toString(36)}${seq.toString(36)}`;
};

/** Where a fresh block of each type lands, and how big it starts. */
function makeBlock(type: BlockType, sheetW: number, y: number): Block {
  const wide = Math.min(432, sheetW - 88);
  const base: Block = { id: freshId(), type, x: 44, y: snap(y), w: wide };
  switch (type) {
    case "mark":
      return { ...base, x: Math.round((sheetW - 88) / 2), w: 88, h: 88, glyph: "◆", align: "center" };
    case "heading":
      return { ...base, size: 30, align: "center", text: "Heading" };
    case "text":
      return { ...base, size: 14, text: "Some words." };
    case "button":
      return { ...base, align: "center", style: "button", text: "Do the thing", url: "" };
    case "callout":
      return { ...base, text: "Something worth setting apart." };
    case "links":
      return {
        ...base,
        items: [
          { kicker: "Browse", label: "Channel viewer", url: "" },
          { kicker: "Live", label: "Server status", url: "" },
        ],
      };
    case "image":
      return { ...base, w: 160, h: 120, align: "center" };
    default:
      return base;
  }
}

export function DesignEditor({
  design,
  title,
  onChange,
  onClose,
}: Readonly<{
  design: Design;
  /** Which greeting this is, and who it reaches. The node's own words. */
  title: string;
  onChange: (next: Design) => void;
  onClose: () => void;
}>) {
  const [target, setTarget] = useState<Target>("base");
  const [selected, setSelected] = useState<string | null>(null);
  const [grid, setGrid] = useState(true);
  /**
   * How wide the panel is.
   *
   * Draggable, and it matters: the canvas behind it is the context - which
   * greeting this is, and what is wired into it - so an operator narrows the
   * panel to check a wire and widens it to lay the design out. Covering the
   * canvas entirely would make them close the editor to answer a question the
   * editor raised.
   */
  const [panelW, setPanelW] = useState(PANEL_DEFAULT);
  /** The lines drawn while something is being dragged. */
  const [guides, setGuides] = useState<readonly Guide[]>([]);

  const viewport = useRef<HTMLDivElement>(null);
  // The same navigation the node canvas has, from the same hook: wheel zooms
  // about the pointer, middle or right drag pans, Home fits. An operator who
  // has learnt it on one surface has learnt it on both.
  const extent = useCallback(
    () =>
      boundsOf(design.blocks, (block) => ({
        width: (block as Block).w,
        height: (block as Block).h ?? 80,
      })),
    [design.blocks],
  );
  const view = useCanvasView(viewport, extent);

  const drag = useDrag(design, target, onChange, grid, setPanelW, setGuides, view.toWorld);

  const shown = design.blocks.filter((block) => !droppedOn(block.type, target));
  const chosen = design.blocks.find((block) => block.id === selected) ?? null;
  const problems = designProblems(design);

  const set = <K extends keyof Block>(key: K, value: Block[K]) => {
    if (chosen) onChange(setField(design, target, chosen.id, key, value));
  };

  /** The last block copied here. Session-local, like the canvas's own. */
  const clipboard = useRef<Block | null>(null);
  const [menuAt, setMenuAt] = useState<{ left: number; top: number; id: string } | null>(null);

  /**
   * Everything that can be done to a block, in one place.
   *
   * The keyboard, the context menu and the properties panel are three ways to
   * reach the same set - so they are defined once and cannot drift into
   * disagreeing about what "duplicate" means.
   */
  const actions = {
    copy: (block: Block) => {
      clipboard.current = block;
    },
    paste: () => {
      const held = clipboard.current;
      if (!held) return;
      // Offset, so a paste lands *beside* the original rather than exactly on
      // top of it where nobody can tell there are now two.
      const made = { ...held, id: freshId(), x: held.x + 16, y: held.y + 16 };
      onChange(addBlock(design, made));
      setSelected(made.id);
    },
    duplicate: (block: Block) => {
      const made = { ...block, id: freshId(), x: block.x + 16, y: block.y + 16 };
      onChange(addBlock(design, made));
      setSelected(made.id);
    },
    remove: (block: Block) => {
      onChange(removeBlock(design, block.id));
      setSelected(null);
    },
    nudge: (block: Block, dx: number, dy: number) => {
      const moved = setField(design, target, block.id, "x", Math.max(0, block.x + dx));
      onChange(setField(moved, target, block.id, "y", Math.max(0, block.y + dy)));
    },
    centre: (block: Block) => {
      onChange(setField(design, target, block.id, "x", Math.round((design.sheetW - block.w) / 2)));
    },
    fill: (block: Block) => {
      const moved = setField(design, target, block.id, "x", 44);
      onChange(setField(moved, target, block.id, "w", Math.max(48, design.sheetW - 88)));
    },
    front: (block: Block) => {
      // Order in the list is stacking order and, for the flat targets, reading
      // order - so "bring to front" is genuinely "put it last".
      onChange({
        ...design,
        blocks: [...design.blocks.filter((entry) => entry.id !== block.id), block],
      });
    },
    back: (block: Block) => {
      onChange({
        ...design,
        blocks: [block, ...design.blocks.filter((entry) => entry.id !== block.id)],
      });
    },
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // A properties field is a real input; a bare Delete there means the
    // character under the caret, not the block.
    const from = event.target as HTMLElement;
    if (from.isContentEditable || /^(input|textarea|select)$/i.test(from.tagName)) return;

    const chord = event.ctrlKey || event.metaKey;
    if (chord) {
      const key = event.key.toLowerCase();
      if (key === "c" && chosen) {
        event.preventDefault();
        actions.copy(chosen);
      } else if (key === "x" && chosen) {
        event.preventDefault();
        actions.copy(chosen);
        actions.remove(chosen);
      } else if (key === "v") {
        event.preventDefault();
        actions.paste();
      } else if (key === "d" && chosen) {
        event.preventDefault();
        actions.duplicate(chosen);
      }
      return;
    }

    if (event.key === "Escape") setSelected(null);
    else if ((event.key === "Delete" || event.key === "Backspace") && chosen) {
      event.preventDefault();
      actions.remove(chosen);
    } else if (event.key.startsWith("Arrow") && chosen) {
      event.preventDefault();
      // A grid step, or one pixel with Shift held: the coarse move is what an
      // arrow key is for, and the fine one is what somebody presses Shift to
      // ask for.
      const step = event.shiftKey ? 1 : GRID;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      actions.nudge(chosen, dx, dy);
    }
  };

  const menuBlock = menuAt ? design.blocks.find((block) => block.id === menuAt.id) : undefined;

  return (
    <>
      {/* The canvas stays visible and stays dimmed: readable enough to follow a
          wire, quiet enough that the panel is plainly what has focus. */}
      <Box
        onPointerDown={onClose}
        sx={{ position: "absolute", inset: 0, zIndex: 29, background: "rgba(12,15,19,0.42)" }}
      />
      <Box
        role="dialog"
        aria-label="Design editor"
        {...drag.handlers}
        sx={(theme) => ({
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: panelW,
          zIndex: 30,
          display: "flex",
          flexDirection: "column",
          background: theme.palette.nebula.bg0,
          borderLeft: `1px solid ${theme.palette.nebula.line2}`,
          boxShadow: "-18px 0 48px rgba(0,0,0,0.34)",
        })}
      >
        {/* The grip. A wide invisible target with a short visible bar, because
            a 1px edge is not something anybody can grab. */}
        <Box
          onPointerDown={(event: React.PointerEvent) => drag.startPanel(panelW, event)}
          aria-label="Resize the design editor"
          sx={{
            position: "absolute",
            left: -4,
            top: 0,
            bottom: 0,
            width: "9px",
            cursor: "col-resize",
            zIndex: 1,
          }}
        />
        <Box
          sx={(theme) => ({
            position: "absolute",
            left: -2,
            top: "50%",
            width: 3,
            height: 46,
            transform: "translateY(-50%)",
            background: theme.palette.nebula.accent,
            pointerEvents: "none",
          })}
        />
        {/* -- the bar ------------------------------------------------------ */}
        <Stack
          direction="row"
          alignItems="center"
          gap={1.5}
          sx={(theme) => ({
            flex: "none",
            px: "14px",
            py: "9px",
            borderBottom: `1px solid ${theme.palette.nebula.line}`,
          })}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}
            >
              Design editor
            </Typography>
            <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })} noWrap>
              {title}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }} />

          <Tabs
            value={target}
            options={TARGETS.map((entry) => ({
              id: entry,
              label: TARGET_LABELS[entry].label,
              title: TARGET_LABELS[entry].title,
              // A dot rather than a count: what matters at a glance is *that* a
              // target has diverged, and the number is on the banner below.
              marked: overrideCount(design, entry) > 0,
            }))}
            onChange={(id) => setTarget(id as Target)}
          />
          <Chrome on={grid} label="Grid" onClick={() => setGrid((was) => !was)} />
          <Chrome label="Close" onClick={onClose} />
        </Stack>

        {/* The one line that says what a target tab does, because nothing else
          on screen would tell you that editing here is not editing base. */}
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={(theme) => ({
            flex: "none",
            px: "14px",
            py: "6px",
            background: theme.palette.nebula.panel,
            borderBottom: `1px solid ${theme.palette.nebula.line}`,
          })}
        >
          <Typography
            sx={(theme) => ({
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: theme.palette.nebula.dim,
            })}
          >
            {TARGET_LABELS[target].label}
          </Typography>
          <Typography sx={(theme) => ({ flex: 1, fontSize: 11, color: theme.palette.nebula.muted })}>
            {target === "base"
              ? "Every target inherits this. Switch a target tab to diverge just there."
              : `${TARGET_LABELS[target].title}. Editing here changes only this target.`}
          </Typography>
          {overrideCount(design, target) > 0 && (
            <Chrome
              label={`Clear ${overrideCount(design, target)} override(s)`}
              onClick={() => onChange(revertTarget(design, target))}
            />
          )}
        </Stack>

        {/* -- the three panes ---------------------------------------------- */}
        <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "172px 1fr 236px" }}>
          <Pane>
            <SectionLabel>Insert</SectionLabel>
            <Stack gap={0.4} sx={{ mt: "9px" }}>
              {insertableOn(target).map((type) => (
                <Box
                  key={type}
                  component="button"
                  type="button"
                  onClick={() => {
                    const made = makeBlock(type, design.sheetW, lowestOf(design) + 16);
                    onChange(addBlock(design, made));
                    setSelected(made.id);
                  }}
                  sx={(theme) => ({
                    all: "unset",
                    display: "flex",
                    justifyContent: "space-between",
                    px: "9px",
                    py: "5px",
                    cursor: "pointer",
                    fontSize: 11.5,
                    color: theme.palette.nebula.text,
                    border: `1px solid ${theme.palette.nebula.line2}`,
                    "&:hover": {
                      borderColor: theme.palette.nebula.accentLine,
                      color: theme.palette.nebula.accent,
                    },
                  })}
                >
                  {BLOCK_LABELS[type]}
                  <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.dim })}>
                    +
                  </Box>
                </Box>
              ))}
            </Stack>

            <Box sx={{ mt: "18px" }}>
              <SectionLabel>Layers</SectionLabel>
            </Box>
            <Stack gap={0.2} sx={{ mt: "8px" }}>
              {/* Reverse order, as every design tool lists them: the thing on
                top of the sheet is the thing at the top of the list. */}
              {[...shown].reverse().map((block) => (
                <Box
                  key={block.id}
                  component="button"
                  type="button"
                  onClick={() => setSelected(block.id)}
                  sx={(theme) => ({
                    all: "unset",
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    px: "7px",
                    py: "3px",
                    cursor: "pointer",
                    fontSize: 11,
                    color: block.id === selected ? theme.palette.nebula.accent : theme.palette.nebula.muted,
                    background: block.id === selected ? theme.palette.nebula.accentSoft : "transparent",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  })}
                >
                  {BLOCK_LABELS[block.type]}
                  {block.text ? ` · ${block.text}` : ""}
                </Box>
              ))}
            </Stack>
          </Pane>

          {/* -- the sheet --------------------------------------------------- */}
          <Box
            ref={viewport}
            tabIndex={0}
            onPointerDown={(event) => {
              view.handlers.onPointerDown(event);
              if (event.target === event.currentTarget) setSelected(null);
            }}
            onPointerMove={(event) => {
              view.handlers.onPointerMove(event);
              drag.handlers.onPointerMove(event);
            }}
            onPointerUp={(event) => {
              view.handlers.onPointerUp(event);
              drag.handlers.onPointerUp();
            }}
            onContextMenu={view.handlers.onContextMenu}
            onKeyDown={onKeyDown}
            sx={(theme) => ({
              position: "relative",
              // Clipped rather than scrolled: the wheel is spent on zoom, so a
              // scrollbar would be a second answer to the same gesture.
              overflow: "hidden",
              outline: "none",
              touchAction: "none",
              userSelect: "none",
              "& input, & textarea": { userSelect: "text" },
              background: theme.palette.nebula.panel,
              cursor: view.panning ? "grabbing" : "default",
            })}
          >
            <Box
              sx={{
                position: "absolute",
                left: 0,
                top: 0,
                p: "22px",
                transform: view.transform,
                transformOrigin: "0 0",
              }}
            >
              <Stack sx={{ flex: "none" }}>
                {/* The artboard's own caption: what is being drawn, and how big. A
                design tool says this, and without it the sheet is a white
                rectangle with no scale. */}
                <Stack direction="row" alignItems="center" gap={1} sx={{ mb: "7px" }}>
                  <Typography
                    sx={(theme) => ({
                      flex: "none",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 9,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: theme.palette.nebula.dim,
                    })}
                  >
                    Artboard · {TARGET_LABELS[target].label} design
                  </Typography>
                  <Box sx={(theme) => ({ flex: 1, height: "1px", background: theme.palette.nebula.line })} />
                  <Typography
                    sx={(theme) => ({
                      flex: "none",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 9,
                      color: theme.palette.nebula.dim,
                    })}
                  >
                    {design.sheetW} × {sheetHeight(design)}
                  </Typography>
                </Stack>
                <Box
                  sx={(theme) => ({
                    position: "relative",
                    flex: "none",
                    width: design.sheetW,
                    minHeight: sheetHeight(design),
                    background: theme.palette.nebula.bg0,
                    border: `1px solid ${theme.palette.nebula.line2}`,
                    // The grid is on the sheet rather than behind it, so what an
                    // operator snaps to is what they can see.
                    backgroundImage: grid
                      ? `radial-gradient(${theme.palette.nebula.line} 1px, transparent 1px)`
                      : "none",
                    backgroundSize: "16px 16px",
                  })}
                >
                  {shown.map((raw) => {
                    const block = effective(design, target, raw);
                    const off = !gateOpen(design, block);
                    const flat = isFlat(target);
                    return (
                      <Box
                        key={raw.id}
                        onPointerDown={(event: React.PointerEvent) => {
                          event.stopPropagation();
                          setSelected(raw.id);
                          // Left button only: the right one belongs to the menu,
                          // and to the canvas's own pan.
                          if (!flat && event.button === 0) drag.start(raw.id, block, event, "move");
                        }}
                        onContextMenu={(event: React.MouseEvent) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelected(raw.id);
                          setMenuAt({ left: event.clientX, top: event.clientY, id: raw.id });
                        }}
                        sx={(theme) => ({
                          position: flat ? "relative" : "absolute",
                          ...(flat
                            ? { margin: "8px 12px" }
                            : { left: block.x, top: block.y, width: block.w }),
                          cursor: flat ? "pointer" : "move",
                          // A gated block is dimmed rather than hidden: this is the
                          // design, and a block you cannot see is one you cannot
                          // select to change the gate on.
                          opacity: off ? 0.34 : 1,
                          outline: raw.id === selected ? `1px solid ${theme.palette.nebula.accent}` : "none",
                          outlineOffset: 1,
                        })}
                      >
                        {raw.id === selected && !flat && (
                          <Typography
                            sx={(theme) => ({
                              position: "absolute",
                              left: 0,
                              top: -13,
                              px: "4px",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 8.5,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              whiteSpace: "nowrap",
                              color: theme.palette.nebula.bg0,
                              background: theme.palette.nebula.accent,
                            })}
                          >
                            {BLOCK_LABELS[block.type]} {block.w} × {block.x},{block.y}
                          </Typography>
                        )}
                        <Preview block={block} flat={flat} target={target} />
                        {block.gate && (
                          <Typography
                            sx={(theme) => ({
                              position: "absolute",
                              right: 0,
                              top: -13,
                              px: "4px",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 8.5,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              color: theme.palette.nebula.bg0,
                              background: theme.palette.nebula.accent,
                              borderRadius: "2px",
                            })}
                          >
                            if {block.gate}
                          </Typography>
                        )}
                        {raw.id === selected && !flat && (
                          <Box
                            onPointerDown={(event: React.PointerEvent) => {
                              event.stopPropagation();
                              drag.start(raw.id, block, event, "resize");
                            }}
                            sx={(theme) => ({
                              position: "absolute",
                              right: -4,
                              bottom: -4,
                              width: "9px",
                              height: "9px",
                              cursor: "ew-resize",
                              background: theme.palette.nebula.accent,
                            })}
                          />
                        )}
                      </Box>
                    );
                  })}

                  {/* The lines that caught it, drawn while the drag lasts.
                    Nothing snaps silently: a block that moved somewhere the
                    operator did not drag it, with nothing on screen saying
                    why, is worse than no snapping at all. */}
                  {drag.held !== null &&
                    guides.map((guide, index) => (
                      <Box
                        key={`${guide.axis}${guide.at}${index}`}
                        aria-hidden
                        sx={(theme) => ({
                          position: "absolute",
                          pointerEvents: "none",
                          // A page guide is a property of the sheet, so it is
                          // drawn quieter and dashed; a guide between two blocks
                          // is about those two, and says so by being solid.
                          ...(guide.sheet
                            ? {
                                background: "none",
                                opacity: 0.75,
                                [guide.axis === "x" ? "borderLeft" : "borderTop"]:
                                  `1px dashed ${theme.palette.nebula.accent}`,
                              }
                            : { background: theme.palette.nebula.accent }),
                          // Every length spelled out in px. MUI's sizing system
                          // reads a bare `width: 1` as `100%`, which turns a
                          // one-pixel rule into a rectangle over the whole sheet.
                          ...(guide.axis === "x"
                            ? {
                                left: `${guide.at}px`,
                                top: `${Math.min(guide.from, guide.to) - 12}px`,
                                width: "1px",
                                height: `${Math.abs(guide.to - guide.from) + 24}px`,
                              }
                            : {
                                top: `${guide.at}px`,
                                left: `${Math.min(guide.from, guide.to) - 12}px`,
                                height: "1px",
                                width: `${Math.abs(guide.to - guide.from) + 24}px`,
                              }),
                        })}
                      />
                    ))}
                </Box>
              </Stack>
            </Box>
          </Box>

          {/* -- properties --------------------------------------------------- */}
          <Pane left>
            {/* The name and the one destructive action on one row, as every
                inspector does it: what is selected, and the way to get rid of
                it. Everything below is what it is made of. */}
            <Stack direction="row" alignItems="baseline" gap={1}>
              <Typography
                sx={(theme) => ({
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: chosen ? theme.palette.nebula.text : theme.palette.nebula.dim,
                })}
                noWrap
              >
                {chosen ? BLOCK_LABELS[chosen.type] : "Nothing selected"}
              </Typography>
              {chosen && (
                <Quiet
                  label="Delete"
                  onClick={() => {
                    onChange(removeBlock(design, chosen.id));
                    setSelected(null);
                  }}
                />
              )}
            </Stack>

            {chosen && overrideOf(design, target, chosen.id) && (
              <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "8px" }}>
                <Typography sx={(theme) => ({ flex: 1, fontSize: 10.5, color: theme.palette.nebula.accent })}>
                  Overridden on {TARGET_LABELS[target].label}
                </Typography>
                <Quiet
                  label="Revert to base"
                  onClick={() => onChange(revertBlock(design, target, chosen.id))}
                />
              </Stack>
            )}

            {chosen && <Properties design={design} block={effective(design, target, chosen)} onSet={set} />}
          </Pane>
        </Box>

        {/* Right-click on a block. The same actions the keyboard has, for the
          hand that is already on the mouse. */}
        <Menu
          open={menuAt !== null && menuBlock !== undefined}
          anchorReference="anchorPosition"
          anchorPosition={menuAt ? { left: menuAt.left, top: menuAt.top } : undefined}
          onClose={() => setMenuAt(null)}
        >
          {menuBlock && [
            <MenuItem
              key="dup"
              onClick={() => {
                actions.duplicate(menuBlock);
                setMenuAt(null);
              }}
            >
              Duplicate
            </MenuItem>,
            <MenuItem
              key="copy"
              onClick={() => {
                actions.copy(menuBlock);
                setMenuAt(null);
              }}
            >
              Copy
            </MenuItem>,
            <MenuItem
              key="paste"
              disabled={clipboard.current === null}
              onClick={() => {
                actions.paste();
                setMenuAt(null);
              }}
            >
              Paste
            </MenuItem>,
            <Divider key="d1" />,
            <MenuItem
              key="centre"
              onClick={() => {
                actions.centre(menuBlock);
                setMenuAt(null);
              }}
            >
              Centre on the sheet
            </MenuItem>,
            <MenuItem
              key="fill"
              onClick={() => {
                actions.fill(menuBlock);
                setMenuAt(null);
              }}
            >
              Fill the width
            </MenuItem>,
            <Divider key="d2" />,
            <MenuItem
              key="front"
              onClick={() => {
                actions.front(menuBlock);
                setMenuAt(null);
              }}
            >
              Bring to front
            </MenuItem>,
            <MenuItem
              key="back"
              onClick={() => {
                actions.back(menuBlock);
                setMenuAt(null);
              }}
            >
              Send to back
            </MenuItem>,
            ...(overrideOf(design, target, menuBlock.id)
              ? [
                  <Divider key="d3" />,
                  <MenuItem
                    key="revert"
                    onClick={() => {
                      onChange(revertBlock(design, target, menuBlock.id));
                      setMenuAt(null);
                    }}
                  >
                    Revert to base
                  </MenuItem>,
                ]
              : []),
            <Divider key="d4" />,
            <MenuItem
              key="del"
              onClick={() => {
                actions.remove(menuBlock);
                setMenuAt(null);
              }}
            >
              Delete
            </MenuItem>,
          ]}
        </Menu>

        {/* -- the footer ---------------------------------------------------- */}
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={(theme) => ({
            flex: "none",
            px: "14px",
            py: "8px",
            borderTop: `1px solid ${theme.palette.nebula.line}`,
          })}
        >
          <Typography
            sx={(theme) => ({
              flex: 1,
              fontSize: 11,
              color: problems.length > 0 ? theme.palette.nebula.warn : theme.palette.nebula.dim,
            })}
          >
            {problems.length > 0
              ? problems[0]
              : `${design.blocks.length} blocks · ${design.slots.length} slots · ${design.conditions.length} toggles`}
          </Typography>
        </Stack>
      </Box>
    </>
  );
}

/** How wide the panel opens, and the range it may be dragged to. */
const PANEL_DEFAULT = 1180;
const PANEL_MIN = 560;

/**
 * How tall the sheet is drawn.
 *
 * The one number the horizontal centre line is measured against, so it lives
 * beside the thing that renders the sheet rather than being computed twice with
 * a chance of disagreeing.
 */
function sheetHeight(design: Design): number {
  return Math.round(lowestOf(design) + 80);
}

/** Where the sheet ends, so a new block lands under everything. */
function lowestOf(design: Design): number {
  return design.blocks.reduce((low, block) => Math.max(low, block.y + (block.h ?? 40)), 120);
}

/** Dragging and resizing on the sheet. */
function useDrag(
  design: Design,
  target: Target,
  onChange: (next: Design) => void,
  grid: boolean,
  onPanel: (width: number) => void,
  onGuides: (guides: readonly Guide[]) => void,
  toWorld: (clientX: number, clientY: number) => { x: number; y: number },
) {
  const [held, setHeld] = useState<{
    id: string;
    mode: "move" | "resize" | "panel";
    from: { x: number; y: number; w: number };
    at: { x: number; y: number };
  } | null>(null);

  const start = (id: string, block: Block, event: React.PointerEvent, mode: "move" | "resize") => {
    event.preventDefault();
    setHeld({
      id,
      mode,
      from: { x: block.x, y: block.y, w: block.w },
      at: { x: event.clientX, y: event.clientY },
    });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const startPanel = (width: number, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setHeld({
      id: "",
      mode: "panel",
      from: { x: 0, y: 0, w: width },
      at: { x: event.clientX, y: event.clientY },
    });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  // Anchored to where it started rather than accumulating a delta: a running
  // total rounds every frame and drifts over a long drag.
  const move = (event: React.PointerEvent) => {
    if (!held) return;
    if (held.mode === "panel") {
      // The grip is on the *left* edge of a right-hand panel, so dragging left
      // makes it wider - which is why the delta is subtracted. In screen
      // pixels, because the panel is chrome and never zooms.
      onPanel(Math.max(PANEL_MIN, held.from.w - (event.clientX - held.at.x)));
      return;
    }

    // Everything else is in sheet units. Screen deltas would move a block at
    // half speed when the view is zoomed to 2x, which is the classic way a
    // canvas feels broken without anybody being able to say why.
    const now = toWorld(event.clientX, event.clientY);
    const from = toWorld(held.at.x, held.at.y);
    const dx = now.x - from.x;
    const dy = now.y - from.y;

    const moving = design.blocks.find((block) => block.id === held.id);
    if (!moving) return;
    const others = design.blocks.filter((block) => block.id !== held.id);

    if (held.mode === "resize") {
      const landed = snapWidth(moving, held.from.w + dx, others, design.sheetW, grid);
      onGuides(landed.guides);
      onChange(setField(design, target, held.id, "w", landed.w));
      return;
    }

    const landed = snapTo(
      moving,
      held.from.x + dx,
      held.from.y + dy,
      others,
      design.sheetW,
      grid,
      sheetHeight(design),
    );
    onGuides(landed.guides);
    onChange(setField(setField(design, target, held.id, "x", landed.x), target, held.id, "y", landed.y));
  };

  const release = useCallback(() => {
    setHeld(null);
    // The guides belong to the gesture, not to the drawing.
    onGuides([]);
  }, [onGuides]);

  /**
   * The release is heard on the window, not only on the sheet.
   *
   * A drag that finished over the properties panel, over the left rail, or off
   * the window entirely used to leave the gesture running and its guide lines
   * drawn - a rule sitting on the sheet with nothing being dragged and no way
   * to get rid of it but to start another drag.
   */
  useEffect(() => {
    if (!held) return;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [held, release]);

  return { start, startPanel, handlers: { onPointerMove: move, onPointerUp: release }, held };
}

function Pane({ children, left }: Readonly<{ children: React.ReactNode; left?: boolean }>) {
  return (
    <Box
      sx={(theme) => ({
        overflowY: "auto",
        p: "13px",
        // A surface of its own, so the sheet in the middle reads as the thing
        // being worked on and the rails read as the tools.
        background: theme.palette.nebula.panel,
        [left ? "borderLeft" : "borderRight"]: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      {children}
    </Box>
  );
}

/**
 * The editor's own chrome: square, outlined, unrounded.
 *
 * Deliberately not the canvas's pills. A design editor is a tool window over a
 * drawing surface, and its controls read as instruments rather than as part of
 * the document being drawn - which is what stops an operator mistaking the
 * toolbar for something they are laying out.
 */
function Chrome({ label, on, onClick }: Readonly<{ label: string; on?: boolean; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        flex: "none",
        px: "11px",
        py: "5px",
        cursor: "pointer",
        fontSize: 11.5,
        color: on ? theme.palette.nebula.bg0 : theme.palette.nebula.muted,
        background: on ? theme.palette.nebula.accent : "transparent",
        border: `1px solid ${on ? theme.palette.nebula.accent : theme.palette.nebula.line2}`,
        "&:hover": { borderColor: theme.palette.nebula.accentLine },
      })}
    >
      {label}
    </Box>
  );
}

/**
 * The target tabs: one outlined box, divided rather than spaced.
 *
 * Joined, because they are five views of one thing and a gap between them
 * would read as five separate buttons. The mark is a dot for a target that has
 * diverged - the count is on the banner, where there is room to say what it
 * means.
 */
function Tabs({
  value,
  options,
  onChange,
}: Readonly<{
  value: string;
  options: readonly { id: string; label: string; title: string; marked: boolean }[];
  onChange: (id: string) => void;
}>) {
  return (
    <Stack
      direction="row"
      sx={(theme) => ({ flex: "none", border: `1px solid ${theme.palette.nebula.line2}` })}
    >
      {options.map((option, index) => {
        const on = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            type="button"
            title={option.title}
            aria-pressed={on}
            onClick={() => onChange(option.id)}
            sx={(theme) => ({
              all: "unset",
              px: "13px",
              py: "5px",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: on ? theme.palette.nebula.bg0 : theme.palette.nebula.muted,
              background: on ? theme.palette.nebula.accent : "transparent",
              borderRight: index === options.length - 1 ? "none" : `1px solid ${theme.palette.nebula.line2}`,
              "&:hover": { color: on ? theme.palette.nebula.bg0 : theme.palette.nebula.text },
            })}
          >
            {option.label}
            {option.marked && (
              <Box
                component="span"
                sx={(theme) => ({
                  ml: "5px",
                  color: on ? theme.palette.nebula.bg0 : theme.palette.nebula.accent,
                })}
              >
                ·
              </Box>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

/** A choice of two or three, as one divided box. The properties panel's own. */
function Choice({
  value,
  options,
  onChange,
}: Readonly<{
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
}>) {
  return (
    <Stack
      direction="row"
      sx={(theme) => ({ width: "100%", border: `1px solid ${theme.palette.nebula.line2}` })}
    >
      {options.map((option, index) => {
        const on = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.id)}
            sx={(theme) => ({
              all: "unset",
              flex: 1,
              textAlign: "center",
              py: "6px",
              cursor: "pointer",
              fontSize: 11,
              color: on ? theme.palette.nebula.bg0 : theme.palette.nebula.muted,
              background: on ? theme.palette.nebula.accent : "transparent",
              borderRight: index === options.length - 1 ? "none" : `1px solid ${theme.palette.nebula.line2}`,
              "&:hover": { color: on ? theme.palette.nebula.bg0 : theme.palette.nebula.text },
            })}
          >
            {option.label}
          </Box>
        );
      })}
    </Stack>
  );
}

/** A bordered field, which is what every input in this panel is. */
function Boxed({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      sx={(theme) => ({
        width: "100%",
        boxSizing: "border-box",
        px: "9px",
        py: "6px",
        background: theme.palette.nebula.bg0,
        border: `1px solid ${theme.palette.nebula.line2}`,
        "&:focus-within": { borderColor: theme.palette.nebula.accentLine },
      })}
    >
      {children}
    </Box>
  );
}

/** What a block looks like on the sheet. Not the final rendering — the shape. */
function Preview({ block, flat, target }: Readonly<{ block: Block; flat: boolean; target: Target }>) {
  const align = flat ? "left" : (block.align ?? "left");
  const size = flat ? 13 : (block.size ?? 14);
  switch (block.type) {
    case "mark":
      return (
        <Box
          sx={(theme) => ({
            height: block.h ?? 88,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: (block.h ?? 88) / 2.4,
            color: theme.palette.nebula.accent,
            border: `1px solid ${theme.palette.nebula.line2}`,
          })}
        >
          {block.glyph}
        </Box>
      );
    case "heading":
      return (
        <Typography sx={{ fontSize: size, fontWeight: 700, textAlign: align, lineHeight: 1.15 }}>
          {block.text}
        </Typography>
      );
    case "text":
      return (
        <Typography sx={(theme) => ({ fontSize: size, textAlign: align, color: theme.palette.nebula.muted })}>
          {block.text}
        </Typography>
      );
    case "divider":
      return <Box sx={(theme) => ({ height: "1px", background: theme.palette.nebula.line2 })} />;
    case "callout":
      return (
        <Box
          sx={(theme) => ({
            px: "10px",
            py: "8px",
            fontSize: size,
            textAlign: align,
            color: theme.palette.nebula.muted,
            border: `1px solid ${theme.palette.nebula.accentLine}`,
            background: theme.palette.nebula.accentSoft,
          })}
        >
          {block.text}
        </Box>
      );
    case "button": {
      const asLink = block.style === "link" || target === "qt" || flat;
      return (
        <Box sx={{ textAlign: align }}>
          <Box
            component="span"
            sx={(theme) => ({
              display: "inline-block",
              px: asLink ? 0 : "16px",
              py: asLink ? 0 : "8px",
              fontSize: size,
              fontWeight: 700,
              color: asLink ? theme.palette.nebula.accent : "#fff",
              background: asLink ? "transparent" : theme.palette.nebula.accent,
              textDecoration: asLink ? "underline" : "none",
            })}
          >
            {block.text}
          </Box>
        </Box>
      );
    }
    case "links":
      return (
        <Box
          sx={{
            display: target === "qt" || flat ? "block" : "grid",
            gridTemplateColumns: `repeat(${Math.max(1, (block.items ?? []).length)}, 1fr)`,
            gap: "8px",
          }}
        >
          {(block.items ?? []).map((item, index) => (
            <Box
              key={index}
              sx={(theme) => ({
                px: "9px",
                py: "7px",
                border: `1px solid ${theme.palette.nebula.line2}`,
              })}
            >
              <Typography
                sx={(theme) => ({ fontSize: 9, letterSpacing: "0.12em", color: theme.palette.nebula.dim })}
              >
                {item.kicker.toUpperCase()}
              </Typography>
              <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.accent })}>
                {item.label} →
              </Typography>
            </Box>
          ))}
        </Box>
      );
    case "slot":
      return (
        <Box
          sx={(theme) => ({
            px: "10px",
            py: "9px",
            border: `1px dashed ${theme.palette.nebula.accentLine}`,
            fontSize: 11,
            color: theme.palette.nebula.dim,
          })}
        >
          Slot · {block.slot || "not chosen"}
        </Box>
      );
    case "image":
      return (
        <Box
          sx={(theme) => ({
            height: block.h ?? 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10.5,
            color: theme.palette.nebula.dim,
            border: `1px dashed ${theme.palette.nebula.line2}`,
          })}
        >
          server artwork
        </Box>
      );
    case "theme":
      return (
        <Box
          sx={(theme) => ({
            px: "10px",
            py: "9px",
            border: `1px dashed ${theme.palette.nebula.line2}`,
            fontSize: 10.5,
            color: theme.palette.nebula.dim,
          })}
        >
          Theme block
        </Box>
      );
  }
  return null;
}

/** The fields of whatever is selected. */
function Properties({
  design,
  block,
  onSet,
}: Readonly<{
  design: Design;
  block: Block;
  onSet: <K extends keyof Block>(key: K, value: Block[K]) => void;
}>) {
  const has = (field: keyof Block) => FIELDS[block.type].includes(field);

  // Every control below fills the pane. A panel of half-width pills reads as a
  // form somebody stopped laying out; the fields are the panel.
  return (
    <Stack gap={1.75} sx={{ mt: "16px" }}>
      {has("text") && (
        <Field label="Content">
          <Boxed>
            <PlainInput
              value={block.text ?? ""}
              placeholder="what it says"
              ariaLabel="Block text"
              multiline={block.type !== "button"}
              onChange={(text) => onSet("text", text)}
            />
          </Boxed>
        </Field>
      )}
      {has("glyph") && (
        <Field label="Glyph">
          <Boxed>
            <PlainInput
              value={block.glyph ?? ""}
              placeholder="◆"
              ariaLabel="Badge"
              maxLength={2}
              onChange={(glyph) => onSet("glyph", glyph)}
            />
          </Boxed>
        </Field>
      )}
      {has("url") && (
        <Field label="Link">
          <Boxed>
            <PlainInput
              value={block.url ?? ""}
              placeholder="https://…"
              ariaLabel="Link"
              onChange={(url) => onSet("url", url)}
            />
          </Boxed>
        </Field>
      )}
      {has("align") && (
        <Field label="Alignment">
          <Choice
            value={block.align ?? "left"}
            options={[
              { id: "left", label: "left" },
              { id: "center", label: "center" },
              { id: "right", label: "right" },
            ]}
            onChange={(align) => onSet("align", align as Block["align"])}
          />
        </Field>
      )}
      {has("style") && (
        <Field label="Treatment">
          <Choice
            value={block.style ?? "button"}
            options={[
              { id: "button", label: "Solid" },
              { id: "link", label: "Link" },
            ]}
            onChange={(style) => onSet("style", style as Block["style"])}
          />
        </Field>
      )}
      {has("size") && (
        <Field label="Size (px)">
          <Boxed>
            <PlainInput
              value={String(block.size ?? 14)}
              placeholder="14"
              ariaLabel="Font size"
              onChange={(size) => onSet("size", Number(size.replace(/\D/g, "")) || 14)}
            />
          </Boxed>
        </Field>
      )}
      <Field label="X · Y · Width">
        {/* All three on one line, edited as one: they are one decision - where
            this sits - and three spinners would make it three. */}
        <Boxed>
          <PlainInput
            value={`${block.x} · ${block.y} · ${block.w}`}
            placeholder="0 · 0 · 400"
            ariaLabel="Position and width"
            onChange={(raw) => {
              const parts = raw
                .split(/[^0-9]+/)
                .filter(Boolean)
                .map(Number);
              if (parts.length !== 3) return;
              onSet("x", parts[0]);
              onSet("y", parts[1]);
              onSet("w", parts[2]);
            }}
          />
        </Boxed>
      </Field>
      {has("slot") && (
        <Field label="Bound slot">
          <Picker
            value={block.slot ?? ""}
            options={design.slots.map((input) => ({ id: input.name, label: input.name }))}
            onChange={(slot) => onSet("slot", slot)}
          />
        </Field>
      )}
      {block.type !== "theme" && (
        <Field label="Show if">
          {/* Every block can be gated, which is what makes one design cover
              the variations that used to need a greeting each. */}
          <Picker
            value={block.gate ?? ""}
            options={[
              { id: "", label: "always" },
              ...design.conditions.map((input) => ({ id: input.name, label: input.name })),
            ]}
            onChange={(gate) => onSet("gate", gate === "" ? undefined : gate)}
          />
        </Field>
      )}
    </Stack>
  );
}

/**
 * A full-width choice, drawn as the platform's own select.
 *
 * A native `<select>` rather than the canvas's pill menu: this list is as long
 * as the design has conditions, and a pop-over anchored to a pill in a 236px
 * panel is a menu that opens over the thing it is describing.
 */
function Picker({
  value,
  options,
  onChange,
}: Readonly<{
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
}>) {
  return (
    <Box
      component="select"
      value={value}
      onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
      sx={(theme) => ({
        width: "100%",
        px: "8px",
        py: "5px",
        fontFamily: "inherit",
        fontSize: 11.5,
        color: theme.palette.nebula.text,
        background: theme.palette.nebula.bg0,
        border: `1px solid ${theme.palette.nebula.line2}`,
        borderRadius: 0,
        outline: "none",
        "&:focus": { borderColor: theme.palette.nebula.accentLine },
      })}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </Box>
  );
}

/** A plain-text action, for the things an inspector puts beside a title. */
function Quiet({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        flex: "none",
        cursor: "pointer",
        fontSize: 11,
        color: theme.palette.nebula.dim,
        "&:hover": { color: theme.palette.nebula.accent },
      })}
    >
      {label}
    </Box>
  );
}

/** Which fields each block type shows in the properties panel. */
const FIELDS: Record<BlockType, (keyof Block)[]> = {
  mark: ["glyph", "align"],
  heading: ["text", "align", "size"],
  text: ["text", "align", "size"],
  button: ["text", "url", "align", "style"],
  divider: [],
  image: ["align"],
  callout: ["text", "align"],
  links: [],
  slot: ["slot"],
  theme: [],
};

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <Box>
      <Typography
        sx={(theme) => ({
          mb: "6px",
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: theme.palette.nebula.dim,
        })}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
}
