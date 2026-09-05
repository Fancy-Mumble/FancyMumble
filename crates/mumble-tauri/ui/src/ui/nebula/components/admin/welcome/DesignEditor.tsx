import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ListSubheader, Menu, MenuItem, Divider, Typography, useTheme } from "@mui/material";
import { assemble, compileTarget } from "./compile";
import { HtmlSourceField } from "../../primitives";
import { alpha } from "@mui/material/styles";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { NEBULA_MONO, opaque, radius } from "../../../tokens";
import { RichTextField, Stack, type RichTextTool } from "../../primitives";
import { MiniSwitch, PlainInput, SectionLabel, ZOOM_STEP, boundsOf, useCanvasView } from "../nodes";
import { MAX_BODY, plainTextOf, richBody, splitInlineSlots, withoutSlotTokens } from "./markup";
import {
  BUILT_INS,
  BUILT_IN_GROUPS,
  BUILT_IN_GROUP_LABELS,
  builtIn,
  builtInsOf,
  isBuiltIn,
} from "./builtins";
import { snapTo, snapWidth, type Guide } from "./snapping";
import { BORDER_SWATCHES, SHADOW_PRESETS, TEXT_SHADOW_PRESETS } from "./design";
import { DESIGN_TEMPLATES } from "./templates";
import { PictureField, type Picked } from "./PictureField";
import { OnlineNow } from "../../welcome/OnlineNow";
import {
  BLOCK_LABELS,
  GRID,
  addInput,
  TARGETS,
  TARGET_LABELS,
  addBlock,
  CATEGORY_LABELS,
  PALETTE,
  PALETTE_CATEGORIES,
  addInlineUsage,
  carriesInline,
  isRichBody,
  designIssues,
  hideUsage,
  paletteFor,
  paletteOf,
  readableText,
  resizable,
  SECTION_LABELS,
  SECTIONS,
  usagesBySection,
  usagesOf,
  usagesOfInput,
  droppedOn,
  effective,
  gateOpen,
  isFlat,
  overrideCount,
  overrideOf,
  decodeBlock,
  encodeBlock,
  removeBlock,
  revertBlock,
  revertTarget,
  setInputPreview,
  setField,
  snap,
  type Block,
  type BlockType,
  keptAssets,
  type Design,
  type DesignAsset,
  type Input,
  type InputKind,
  type Issue,
  type PaletteItem,
  type Section,
  type Target,
  type Usage,
  NOTICE_STYLE,
  NOTICE_TONES,
  BACKGROUND_SWATCHES,
  TEXT_SWATCHES,
  copyDesignTo,
  droppedBy,
  inkFor,
  isAuto,
  reorderBlock,
  AUTO_COLOURS,
  type AutoColourId,
} from "./design";

/**
 * The design editor: a sheet, a palette, a layer list and a properties panel.
 *
 * Slides in from the right over the canvas, because the canvas is still the
 * context - which greeting this is, and what is wired into it, is on the node
 * behind the panel and stays legible there.
 *
 * ## Where each thing lives
 *
 * The top bar carries what this is and the target tabs; the left rail is the
 * palette and the layer list; the middle is the artboard; the right is the
 * inspector for whatever is selected. The declared inputs sit in a dock
 * *under* the artboard rather than in a rail, because an input is only ever
 * read next to its usages - which slot renders it, which block it gates - and
 * a rail on the far side of the sheet put the two at opposite edges.
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

/** Where a fresh block lands, how big it starts, and what it says. */
function makeBlock(item: PaletteItem, sheetW: number, y: number): Block {
  const wide = Math.min(432, sheetW - 88);
  const centred = (w: number) => Math.round((sheetW - w) / 2);
  const base: Block = { id: freshId(), type: item.type, x: 44, y: snap(y), w: wide };

  const made = ((): Block => {
    switch (item.type) {
      case "mark":
        return { ...base, x: centred(88), w: 88, h: 88, glyph: "◆", align: "center" };
      case "heading":
        return { ...base, size: 30, align: "center", text: "Heading" };
      case "text":
        return { ...base, size: 14, text: "Some words." };
      case "quote":
        return { ...base, size: 14, text: "Something worth quoting." };
      case "code":
        return { ...base, size: 12.5, text: "connect example.org:64738" };
      case "html":
        return { ...base, text: "<p>Written as <b>markup</b>.</p>" };
      case "list":
        return { ...base, size: 14, lines: ["First thing", "Second thing"] };
      case "button":
        return { ...base, align: "center", style: "button", text: "Do the thing", url: "" };
      case "callout":
        return { ...base, text: "Something worth setting apart." };
      case "notice":
        return { ...base, tone: "info", text: "Something worth knowing." };
      case "panel":
        return { ...base, bg: BACKGROUND_SWATCHES[0].colour, text: "What the panel says." };
      case "card":
        return { ...base, text: "What the card says." };
      case "footer":
        return { ...base, size: 11, text: "You are receiving this because you joined this server." };
      case "spacer":
        return { ...base, h: 24 };
      case "divider":
        return base;
      case "columns":
        return {
          ...base,
          items: [
            { kicker: "One", label: "First column", url: "" },
            { kicker: "Two", label: "Second column", url: "" },
          ],
        };
      case "links":
        return {
          ...base,
          items: [
            { kicker: "Browse", label: "Channel viewer", url: "" },
            { kicker: "Live", label: "Server status", url: "" },
          ],
        };
      case "social":
        return {
          ...base,
          items: [
            { kicker: "", label: "Forum", url: "" },
            { kicker: "", label: "Wiki", url: "" },
          ],
        };
      case "table":
        return {
          ...base,
          rows: [
            ["Channel", "What it is for"],
            ["Lobby", "Anyone, any time"],
          ],
        };
      case "image":
        return { ...base, x: centred(160), w: 160, h: 120, align: "center" };
      case "video":
        return { ...base, x: centred(240), w: 240, h: 135, align: "center", text: "Watch the tour", url: "" };
      case "qr":
        return { ...base, x: centred(96), w: 96, h: 96, align: "center", text: "", url: "" };
      case "rating":
        return { ...base, align: "center", size: 5 };
      case "countdown":
        return { ...base, align: "center", text: "Offer ends Sunday" };
      case "toggles":
        return { ...base, items: [] };
      case "ab":
        return { ...base, size: 14, text: "What most people get.", altText: "What everyone else gets." };
      case "repeater":
        return { ...base, size: 14 };
      default:
        return base;
    }
  })();

  // The preset last, so a palette entry always wins over the type's defaults -
  // which is the whole difference between `Button`, `Ghost btn` and `Link`.
  return { ...made, ...item.preset };
}

export function DesignEditor({
  design,
  name,
  detail,
  wired,
  values,
  onChange,
  onClose,
  onUndo,
  onRedo,
  onRenameInput,
  onRemoveInput,
}: Readonly<{
  design: Design;
  /** Which greeting this is. The node's own words, as its title. */
  name: string;
  /** Who it reaches, under the title. */
  detail: string;
  /**
   * Which declared inputs have a wire on them, from the canvas.
   *
   * The design cannot know this - what feeds an input is an edge - so without
   * it the editor has to assume the worst, and every input it drew was marked
   * unwired whether or not anything fed it.
   */
  wired?: ReadonlySet<string>;
  /**
   * What each declared input actually says, from the nodes wired to it.
   *
   * Only Preview uses it. The rest of the editor draws the input's *name*,
   * because that is what an operator is placing; Preview is the one view whose
   * whole job is to stop showing them the machinery.
   */
  values?: ReadonlyMap<string, string>;
  onChange: (next: Design) => void;
  onClose: () => void;
  /**
   * The canvas's own history, which already holds every design edit.
   *
   * The panel covers the canvas and takes the keyboard with it, so without
   * these an operator who deleted the wrong block had nowhere to press Ctrl+Z -
   * the step was on the stack the whole time and simply out of reach.
   */
  onUndo?: () => void;
  onRedo?: () => void;
  /**
   * Renaming and removing an input, which are the canvas's to do.
   *
   * A port is named by its input, and a *wire* lands on that port - so both of
   * these have to move an edge the design cannot see. Adding is not here
   * because a new input has nothing wired to it yet.
   */
  onRenameInput?: (id: string, name: string) => void;
  onRemoveInput?: (id: string) => void;
}>) {
  const [target, setTarget] = useState<Target>("base");
  const [selected, setSelected] = useState<string | null>(null);
  const [grid, setGrid] = useState(true);
  /**
   * The sheet with every mark of the editor taken off it.
   *
   * Not a separate window: the same artboard, with the selection, the guides,
   * the grid, the slot chrome and the gate frames suppressed, and gated-off
   * blocks actually hidden rather than dimmed. What an operator wants to check
   * is that the design reads, and the chrome that helps them build it is
   * exactly what stops them seeing that.
   */
  const [preview, setPreview] = useState(false);
  /** Which target tab was right-clicked, and where, for the "copy onto" menu. */
  const [copyOnto, setCopyOnto] = useState<{ target: Target; left: number; top: number } | null>(null);
  const [gallery, setGallery] = useState<{ left: number; top: number } | null>(null);
  /** Which input card the status bar last sent them to. */
  const [litInput, setLitInput] = useState<string | null>(null);
  /** Whether the "new input" menu under the artboard is open. */
  const [adding, setAdding] = useState(false);
  /** What is typed into the palette's search box. */
  const [search, setSearch] = useState("");
  /** Which input's full usage list is open over the dock, if any. */
  const [browsing, setBrowsing] = useState<string | null>(null);
  /** Which usage of the selected block's input the inspector is stepping to. */
  const [stepped, setStepped] = useState(0);
  /** Which half of the dock is showing: what the operator declared, or the rest. */
  const [dockTab, setDockTab] = useState<"yours" | "builtins">("yours");
  /** Which block's copy the placeholder picker is inserting into, if any. */
  const [picking, setPicking] = useState<string | null>(null);
  /**
   * How wide the panel is.
   *
   * Draggable, and it matters: the canvas behind it is the context - which
   * greeting this is, and what is wired into it - so an operator narrows the
   * panel to check a wire and widens it to lay the design out. Covering the
   * canvas entirely would make them close the editor to answer a question the
   * editor raised.
   */
  const [panelW, setPanelW] = useState(() => Math.min(PANEL_DEFAULT, panelCap()));
  /** The lines drawn while something is being dragged. */
  const [guides, setGuides] = useState<readonly Guide[]>([]);

  // Narrowing the window narrows the panel with it. Only ever downwards: a
  // width somebody dragged to is a decision, and growing the window back is
  // not a request to undo it.
  useEffect(() => {
    const onResize = () => setPanelW((held) => Math.min(held, panelCap()));
    globalThis.addEventListener("resize", onResize);
    return () => globalThis.removeEventListener("resize", onResize);
  }, []);

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

  /**
   * Open framed on the design, not at 1:1 in the middle of an empty canvas.
   *
   * A 520pt sheet at 100% in a viewport twice that size is a small document a
   * long way away, and the first thing anybody did was zoom in. Framed once, on
   * the first layout that has a size to frame against - after that the view is
   * the operator's and nothing moves it.
   */
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || design.blocks.length === 0) return;
    const box = viewport.current;
    if (!box || box.clientWidth === 0) return;
    framed.current = true;
    view.fit({ minX: 0, minY: 0, maxX: design.sheetW, maxY: sheetHeight(design) });
  }, [design, view]);

  /**
   * What each block actually measures on the sheet.
   *
   * Read off the DOM rather than stored, because for most blocks the height is
   * the content's: a paragraph is as tall as its words wrap to, and the design
   * has no number for that. Snapping needs it - without it a guide runs from
   * the top of one block to the top of another and stops in mid-air, having
   * lined up with nothing an operator can see.
   */
  const heights = useRef(new Map<string, number>());
  const measure = useCallback((id: string, node: HTMLElement | null) => {
    if (!node) {
      heights.current.delete(id);
      return;
    }
    heights.current.set(id, node.offsetHeight);
  }, []);

  const drag = useDrag(design, target, onChange, grid, setPanelW, setGuides, view.toWorld, heights);

  const shown = design.blocks.filter((block) => !droppedOn(block.type, target));
  /** The kinds this target will not draw, for the warning beside the banner. */
  const missing = droppedBy(design, target);
  /** A role, in this operator's theme, for everything the sheet draws. */
  const paint = useResolved();

  /**
   * The Classic target, previewed as the document it actually is.
   *
   * `null` everywhere else, which leaves the sheet drawn the way it always
   * was. Only Classic gets this treatment for now, and it is the one that
   * needed it: the sheet is laid out by this editor and the markup Qt receives
   * is laid out by Qt out of tables, so drawing the sheet again in Qt's
   * colours was showing an operator a layout no Mumble user will see - a plain
   * link where the message carries a filled button, no notice bars, no rules.
   *
   * Conditions resolve from the design's own preview toggles and slots from
   * whatever the canvas has wired, which is what every other preview here
   * does.
   */
  const asSent = useMemo(() => {
    if (!preview || target !== "qt") return null;
    return assemble(compileTarget(design, "qt"), "qt", {
      condition: (name) => design.conditions.find((input) => input.name === name)?.on !== false,
      slot: (name) => values?.get(name) ?? "",
    });
  }, [preview, target, design, values]);
  const chosen = design.blocks.find((block) => block.id === selected) ?? null;
  /**
   * What an input reads as, for Preview.
   *
   * A wired snippet first, then a built-in's sample, then whatever fallback the
   * operator set on the element - which is exactly the order the server
   * resolves them in, so a preview that looked right is right.
   */
  const resolve = useCallback(
    (name: string, fallback?: string) =>
      values?.get(name) ?? builtIn(name)?.sample ?? fallback ?? "",
    [values],
  );

  const offered = paletteFor(target, search);
  /** Every place an input is used, which most of this editor is now about. */
  const usages = usagesOf(design);
  const issues = designIssues(design, wired ?? new Set());
  /** Which blocks an issue names, so the layer list can mark them. */
  const faulty = new Set(issues.map((issue) => issue.block).filter((id): id is string => !!id));
  const unwired = (input: Input) => !isBuiltIn(input.name) && !(wired ?? new Set()).has(input.name);

  /**
   * How much room is left beside the sheet, so it starts centred.
   *
   * A margin rather than a transform: the pan and zoom own the transform, and
   * an offset folded into it would be undone the first time anybody dragged
   * the view. This is where the sheet *sits*; where it is being looked at from
   * is a separate question.
   */
  const [gutter, setGutter] = useState(40);
  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const measure = () =>
      setGutter(Math.max(40, Math.round((box.clientWidth - design.sheetW) / 2)));
    measure();
    // Guarded: the editor must still open where there is no `ResizeObserver` -
    // a test renderer, an old webview - and a sheet that does not re-centre on
    // a resize is a much smaller problem than one that throws on mount and
    // takes the whole panel with it.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [design.sheetW]);

  /** Zoom about the middle of the viewport, for the control that has no pointer. */
  const zoomBy = (factor: number) => {
    const box = viewport.current?.getBoundingClientRect();
    if (box) view.zoomAt(box.width / 2, box.height / 2, factor);
  };

  /**
   * Take the operator to whatever an issue is about.
   *
   * A block selects, which also scrolls the inspector onto it. An input has no
   * selection of its own, so its card in the dock is lit instead - and briefly,
   * because a highlight that stayed would become part of how the card looks.
   */
  const litTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (litTimer.current ? clearTimeout(litTimer.current) : undefined), []);
  const reveal = (issue: Issue) => {
    if (issue.block) {
      setSelected(issue.block);
      return;
    }
    if (!issue.input) return;
    setLitInput(issue.input);
    if (litTimer.current) clearTimeout(litTimer.current);
    litTimer.current = setTimeout(() => setLitInput(null), 2500);
  };

  const set = <K extends keyof Block>(key: K, value: Block[K]) => {
    if (chosen) onChange(setField(design, target, chosen.id, key, value));
  };

  /**
   * A picture chosen for the selected block.
   *
   * Two writes as one change: the asset joins the design's own list and the
   * block starts naming it. Separately they are a step on the undo stack where
   * a block points at a picture that is not there, which draws as a hole.
   */
  const pickPicture = (picked: Picked) => {
    if (!chosen) return;
    const asset: DesignAsset = {
      id: picked.id,
      mime: picked.mime,
      src: picked.src,
      w: picked.w,
      h: picked.h,
      bytes: picked.bytes,
    };
    const kept = (design.assets ?? []).filter((entry) => entry.id !== asset.id);
    onChange({
      ...setField(design, target, chosen.id, "asset", asset.id),
      assets: [...kept, asset],
    });
  };

  /**
   * The picture taken off the selected block.
   *
   * The asset goes with it when nothing else draws it. A design that kept every
   * picture it had ever been shown would pay for all of them on every join.
   */
  /**
   * The same two writes, for the picture painted *behind* a block.
   *
   * A separate pair rather than a parameter because they name different fields
   * on the block, and a block can carry both at once - a photograph behind a
   * card that also holds an icon.
   */
  const pickBackdrop = (picked: Picked) => {
    if (!chosen) return;
    const asset: DesignAsset = {
      id: picked.id,
      mime: picked.mime,
      src: picked.src,
      w: picked.w,
      h: picked.h,
      bytes: picked.bytes,
    };
    const kept = (design.assets ?? []).filter((entry) => entry.id !== asset.id);
    onChange({
      ...setField(design, target, chosen.id, "bgAsset", asset.id),
      assets: [...kept, asset],
    });
  };

  const clearBackdrop = () => {
    if (!chosen) return;
    const next = setField(design, target, chosen.id, "bgAsset", undefined);
    onChange({ ...next, assets: keptAssets(next) });
  };

  const clearPicture = () => {
    if (!chosen) return;
    const next = setField(design, target, chosen.id, "asset", undefined);
    onChange({ ...next, assets: keptAssets(next) });
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
      // And out of the window, so a block can be carried to another editor.
      // Best effort: a browser that refuses the write still has the copy above.
      void navigator.clipboard?.writeText?.(encodeBlock(block)).catch(() => undefined);
    },
    paste: () => {
      // The system clipboard first, so a block copied in another window wins
      // over one copied here an hour ago; the in-memory one is the fallback
      // for every case where reading is refused or holds something else.
      void (async () => {
        const text = await navigator.clipboard?.readText?.().catch(() => "");
        const held = decodeBlock(text ?? "") ?? clipboard.current;
        if (!held) return;
        // Offset, so a paste lands *beside* the original rather than exactly on
        // top of it where nobody can tell there are now two.
        const made = { ...held, id: freshId(), x: held.x + 16, y: held.y + 16 };
        onChange(addBlock(design, made));
        setSelected(made.id);
      })();
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

  /**
   * Every shortcut, from anywhere in the panel.
   *
   * On the panel rather than on the sheet, and that is the whole point of it.
   * The sheet is a `tabIndex={0}` div, so it only receives keys while it holds
   * focus - and selecting a block takes focus *away* from it, because starting
   * a drag calls `preventDefault` on the press and a defaulted-away press
   * never moves focus. So the one gesture that gives you something to delete
   * was the one that stopped Delete working.
   *
   * Bound here, the keys land wherever focus is inside the editor: the sheet,
   * the layer list, a properties row. The press that selects also pulls focus
   * into the panel explicitly, for the case where it began outside.
   *
   * Fields are excluded first and completely. Inside an input a bare Delete is
   * the character under the caret and Ctrl+Z is that field's own undo - the
   * word just typed, not the block deleted before it.
   */
  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    const from = event.target as HTMLElement;
    if (from.isContentEditable || /^(input|textarea|select)$/i.test(from.tagName)) return;

    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      // Ctrl+Y and Ctrl+Shift+Z are the same gesture on two platforms, and an
      // editor that knew only one of them is broken on the other.
      if (key === "z" || key === "y") {
        event.preventDefault();
        if (key === "y" || event.shiftKey) onRedo?.();
        else onUndo?.();
      } else if (key === "c" && chosen) {
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
      } else if ((key === "]" || key === "[") && chosen) {
        // The chord every design tool has for this, Shift for the whole way.
        event.preventDefault();
        const forward = key === "]";
        onChange(
          reorderBlock(
            design,
            chosen.id,
            event.shiftKey ? (forward ? "front" : "back") : forward ? "forward" : "backward",
          ),
        );
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
        onKeyDown={onPanelKeyDown}
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
          gap={1.25}
          sx={(theme) => ({
            flex: "none",
            px: "14px",
            py: "8px",
            background: theme.palette.nebula.panel,
            borderBottom: `1px solid ${theme.palette.nebula.line2}`,
          })}
        >
          {/* The greeting's own mark, so the bar says *which* design this is
              before it says anything about the tool. */}
          <Box
            aria-hidden
            sx={(theme) => ({
              flex: "none",
              display: "grid",
              placeItems: "center",
              width: "22px",
              height: "22px",
              borderRadius: radius("sm"),
              background: theme.palette.nebula.accent,
              color: theme.palette.nebula.onAccent,
              fontFamily: NEBULA_MONO,
              fontSize: 11,
              fontWeight: 600,
            })}
          >
            {name.slice(0, 1).toUpperCase()}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.01em" }} noWrap>
              {name}
            </Typography>
            <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })} noWrap>
              Message editor · {detail}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }} />

          <Kicker>Target</Kicker>
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
            onMenu={(id, at) => setCopyOnto({ target: id as Target, ...at })}
          />
          <Box sx={(theme) => ({ flex: "none", width: "1px", height: "24px", background: theme.palette.nebula.line2 })} />
          <Chrome label="Templates" glyph="▤" onClick={(at) => setGallery(at)} />
          <Chrome on={grid} label="Grid" glyph="#" onClick={() => setGrid((was) => !was)} />
          <Chrome on={preview} label="Preview" onClick={() => setPreview((was) => !was)} />
          <Chrome primary label="Done" onClick={onClose} />
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
            py: "7px",
            background: theme.palette.nebula.accentSoft,
            borderBottom: `1px solid ${theme.palette.nebula.accentLine}`,
          })}
        >
          <Box
            component="span"
            sx={(theme) => ({
              flex: "none",
              px: "7px",
              py: "2px",
              borderRadius: radius("sm"),
              background: theme.palette.nebula.accentSoft,
              color: theme.palette.nebula.accentText ?? theme.palette.nebula.accent,
              fontFamily: NEBULA_MONO,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            })}
          >
            {TARGET_LABELS[target].label}
          </Box>
          <Typography sx={(theme) => ({ flex: 1, fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {target === "base"
              ? "Edits here apply to every target. Switch a target tab above to override just that one."
              : `${TARGET_LABELS[target].title}. Editing here changes only this target.`}
          </Typography>
          {/* What this target will not draw of what is on the sheet. Nothing is
              lost from the design - the blocks are still there, and still drawn
              everywhere that can hold them - but they are not in the message
              these readers get, and that is worth knowing at the moment
              somebody starts working on this target rather than after they
              save. */}
          {missing.length > 0 && (
            <Stack
              direction="row"
              alignItems="center"
              gap={0.75}
              sx={(theme) => ({
                flex: "none",
                px: "8px",
                py: "3px",
                borderRadius: radius("sm"),
                background: alpha(theme.palette.nebula.warn, 0.16),
                color: theme.palette.nebula.warn,
                fontSize: 11,
              })}
            >
              <Box component="span" aria-hidden sx={{ fontWeight: 700 }}>
                !
              </Box>
              <span>
                {`${TARGET_LABELS[target].label} cannot draw ${missing
                  .map((type) => BLOCK_LABELS[type].toLowerCase())
                  .join(", ")} — ${missing.length === 1 ? "that block is" : "those blocks are"} left out here`}
              </span>
            </Stack>
          )}
          {overrideCount(design, target) > 0 && (
            <Chrome
              label={`Clear ${overrideCount(design, target)} override(s)`}
              onClick={() => onChange(revertTarget(design, target))}
            />
          )}
        </Stack>

        {/* -- the three panes ---------------------------------------------- */}
        <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "274px minmax(0, 1fr) 300px" }}>
          {/* The rail is two lists that both want the height: the palette is
              long enough to need scrolling of its own, and the layer list is
              the one an operator keeps an eye on - so it is capped rather than
              pushed off the bottom. */}
          <Box
            sx={(theme) => ({
              display: "grid",
              gridTemplateRows: "minmax(0, 1fr) auto",
              // The column as well as the rows. Without it the single implicit
              // column sizes to max-content - 408px for a three-up palette in a
              // 274px rail - and `overflow: hidden` then quietly cropped a
              // third of the palette off rather than wrapping it.
              gridTemplateColumns: "minmax(0, 1fr)",
              // A grid item defaults to `min-width: auto`, which lets its
              // content push the column wider than the track it was given -
              // the palette is a fixed three-up grid, so it did exactly that
              // and pushed the rail out over the canvas.
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              background: theme.palette.nebula.panel,
              borderRight: `1px solid ${theme.palette.nebula.line}`,
            })}
          >
            <Stack sx={{ minWidth: 0, minHeight: 0, p: "14px 14px 0" }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: "9px" }}>
                <SectionLabel>Insert</SectionLabel>
                <Hint>{PALETTE.length} blocks · click to add</Hint>
              </Stack>
              {/* Twenty-eight tiles is past the point where scanning works, and
                  everybody who already knows the name would rather type it. */}
              <Stack
                direction="row"
                alignItems="center"
                gap={0.9}
                sx={(theme) => ({
                  flex: "none",
                  height: "28px",
                  px: "9px",
                  borderRadius: radius("sm"),
                  background: theme.palette.nebula.bg0,
                  border: `1px solid ${theme.palette.nebula.line2}`,
                  "&:focus-within": { borderColor: theme.palette.nebula.accent },
                })}
              >
                <Box component="span" aria-hidden sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
                  ⌕
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
                  <PlainInput
                    value={search}
                    placeholder="Search blocks…"
                    ariaLabel="Search blocks"
                    onChange={setSearch}
                  />
                </Box>
                {search !== "" && (
                  <Box
                    component="button"
                    type="button"
                    aria-label="Clear the block search"
                    onClick={() => setSearch("")}
                    sx={(theme) => ({
                      all: "unset",
                      cursor: "pointer",
                      fontSize: 12,
                      color: theme.palette.nebula.dim,
                      "&:hover": { color: theme.palette.nebula.text },
                    })}
                  >
                    ×
                  </Box>
                )}
              </Stack>

              <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", mt: "4px", pb: "14px" }}>
                {PALETTE_CATEGORIES.map((category) => {
                  const items = offered.filter((item) => item.category === category);
                  if (items.length === 0) return null;
                  return (
                    <Box key={category}>
                      <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "14px", mb: "8px" }}>
                        <Kicker>{CATEGORY_LABELS[category]}</Kicker>
                        <Box sx={(theme) => ({ flex: 1, height: "1px", background: theme.palette.nebula.line })} />
                        <Mono>{items.length}</Mono>
                      </Stack>
                      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px" }}>
                        {items.map((item) => (
                          <Box
                            key={item.id}
                            component="button"
                            type="button"
                            title={item.label}
                            onClick={() => {
                              const made = makeBlock(item, design.sheetW, lowestOf(design) + 16);
                              onChange(addBlock(design, made));
                              setSelected(made.id);
                            }}
                            sx={(theme) => ({
                              all: "unset",
                              boxSizing: "border-box",
                              height: "64px",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              px: "4px",
                              cursor: "pointer",
                              fontSize: 11,
                              color: theme.palette.nebula.muted,
                              background: theme.palette.nebula.card,
                              border: `1px solid ${theme.palette.nebula.line2}`,
                              borderRadius: radius("sm"),
                              "&:hover": {
                                background: theme.palette.nebula.hover,
                                borderColor: theme.palette.nebula.accentLine,
                                color: theme.palette.nebula.text,
                              },
                            })}
                          >
                            <Box
                              aria-hidden
                              sx={{ height: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}
                            >
                              <PaletteMark item={item} />
                            </Box>
                            <Box
                              component="span"
                              sx={{
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.label}
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  );
                })}
                {offered.length === 0 && (
                  <Box sx={{ mt: "14px" }}>
                    <Hint>Nothing here matches “{search}”.</Hint>
                  </Box>
                )}
              </Box>
            </Stack>

            <Stack
              sx={(theme) => ({
                minHeight: 0,
                maxHeight: "38vh",
                p: "14px 8px 8px",
                borderTop: `1px solid ${theme.palette.nebula.line}`,
              })}
            >
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: "6px", mb: "8px" }}
              >
                <SectionLabel>Layers</SectionLabel>
                <Hint>top → bottom</Hint>
              </Stack>
            <Stack gap={0.1} sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {/* Reverse order, as every design tool lists them: the thing on
                  top of the sheet is the thing at the top of the list. */}
              {[...shown].reverse().map((block) => {
                const on = block.id === selected;
                const mine = usages.filter((usage) => usage.block === block.id);
                const gates = mine.filter((usage) => usage.kind === "gate").length;
                const slots = mine.length - gates;
                return (
                  <Box
                    key={block.id}
                    component="button"
                    type="button"
                    onClick={() => setSelected(block.id)}
                    sx={(theme) => ({
                      all: "unset",
                      boxSizing: "border-box",
                      display: "flex",
                      alignItems: "center",
                      gap: "9px",
                      height: "30px",
                      px: "8px",
                      cursor: "pointer",
                      borderRadius: radius("sm"),
                      color: on ? theme.palette.nebula.text : theme.palette.nebula.muted,
                      fontWeight: on ? 500 : 400,
                      background: on ? theme.palette.nebula.accentSoft : "transparent",
                      boxShadow: on ? `inset 0 0 0 1px ${theme.palette.nebula.accent}` : "none",
                      "&:hover": { background: on ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover },
                    })}
                  >
                    <Box
                      component="span"
                      aria-hidden
                      sx={(theme) => ({
                        flex: "none",
                        width: "14px",
                        textAlign: "center",
                        fontFamily: NEBULA_MONO,
                        fontSize: block.type === "slot" ? 10 : 11,
                        color: on ? theme.palette.nebula.accent : theme.palette.nebula.dim,
                      })}
                    >
                      {glyphOf(block)}
                    </Box>
                    <Box
                      component="span"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {layerLabel(block)}
                    </Box>
                    {/* How many inputs land in this row, which is the thing a
                        layer list could not say when a block had at most one. */}
                    {slots > 0 && <Count tone="accent">{slots}</Count>}
                    {gates > 0 && (
                      <Badge tone="ok">
                        if{gates > 1 ? ` ${gates}` : ""}
                      </Badge>
                    )}
                    {faulty.has(block.id) && <Dot tone="warn" />}
                  </Box>
                );
              })}
            </Stack>
            </Stack>
          </Box>

          {/* -- the sheet --------------------------------------------------- */}
          <Stack sx={{ minWidth: 0, minHeight: 0 }}>
            {/* The artboard's own caption: what is being drawn, and how big.
                Chrome rather than drawing, so it stays put and stays legible
                while the view is zoomed - a caption that shrank with the sheet
                would be unreadable at exactly the zoom that needs it. */}
            <Stack
              direction="row"
              alignItems="center"
              gap={1.5}
              sx={(theme) => ({
                flex: "none",
                height: "32px",
                px: "18px",
                background: theme.palette.nebula.panel,
                borderBottom: `1px solid ${theme.palette.nebula.line}`,
              })}
            >
              <Kicker>Artboard</Kicker>
              <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
                {TARGET_LABELS[target].label} design
              </Typography>
              <Mono>
                {design.sheetW} × {sheetHeight(design)}
              </Mono>
              <Box sx={{ flex: 1 }} />
              <Stack
                direction="row"
                alignItems="center"
                gap={0.25}
                sx={(theme) => ({
                  flex: "none",
                  p: "2px",
                  borderRadius: radius("sm"),
                  background: theme.palette.nebula.bg0,
                  border: `1px solid ${theme.palette.nebula.line2}`,
                })}
              >
                <Step label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
                  −
                </Step>
                <Box
                  component="button"
                  type="button"
                  title="Back to 1:1"
                  onClick={view.reset}
                  sx={(theme) => ({
                    all: "unset",
                    minWidth: "40px",
                    textAlign: "center",
                    cursor: "pointer",
                    fontFamily: NEBULA_MONO,
                    fontSize: 10.5,
                    color: theme.palette.nebula.muted,
                    "&:hover": { color: theme.palette.nebula.text },
                  })}
                >
                  {Math.round(view.scale * 100)}%
                </Box>
                <Step label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
                  +
                </Step>
              </Stack>
            </Stack>

            <Box
              ref={viewport}
              tabIndex={0}
              aria-label="Design sheet"
              onPointerDown={(event) => {
                view.handlers.onPointerDown(event);
                // Anything that reaches here landed on empty space: a block, a
                // handle and the in-place editor all stop the press at
                // themselves. The old test - that the press landed on the
                // viewport element itself - was never true for the artboard,
                // so clicking beside a block left it selected with its handles
                // still drawn.
                //
                // Left button only: the other two are the pan, and panning
                // away from something is not letting go of it.
                if (event.button === 0) {
                  setSelected(null);
                  setLitInput(null);
                }
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
              sx={(theme) => ({
                position: "relative",
                flex: 1,
                minHeight: 0,
                // Clipped rather than scrolled: the wheel is spent on zoom, so a
                // scrollbar would be a second answer to the same gesture.
                overflow: "hidden",
                outline: "none",
                touchAction: "none",
                userSelect: "none",
                "& input, & textarea": { userSelect: "text" },
                background: theme.palette.nebula.panel,
                // The backdrop's own dots, which say "this is a canvas, and the
                // sheet is the thing sitting on it". Coarser than the sheet's
                // own grid and behind it, so the two never read as one ruler.
                backgroundImage: `radial-gradient(${theme.palette.nebula.line2} 1px, transparent 1px)`,
                backgroundSize: "22px 22px",
                cursor: view.panning ? "grabbing" : "default",
              })}
            >
              <Box
                sx={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  pt: "40px",
                  pb: "80px",
                  pl: `${gutter}px`,
                  pr: `${gutter}px`,
                  transform: view.transform,
                  transformOrigin: "0 0",
                }}
              >
                <Box
                  sx={(theme) => ({
                    position: "relative",
                    flex: "none",
                    width: design.sheetW,
                    minHeight: sheetHeight(design),
                    background: theme.palette.nebula.bg0,
                    border: `1px solid ${theme.palette.nebula.line2}`,
                    borderRadius: radius("md"),
                    boxShadow: theme.palette.nebula.shadow,
                    // The grid is on the sheet rather than behind it, so what an
                    // operator snaps to is what they can see.
                    backgroundImage:
                      grid && !preview
                        ? `radial-gradient(${theme.palette.nebula.line} 1px, transparent 1px)`
                        : "none",
                    backgroundSize: "16px 16px",
                  })}
                >
                  {asSent !== null ? (
                    /* Previewing Classic Mumble shows the *compiled markup*,
                       not the sheet drawn again in Qt's colours. Those are two
                       different documents: the sheet is laid out by this editor
                       and the markup is laid out by Qt out of tables, and the
                       one an operator needs to check before pressing save is
                       the one that gets sent. Drawn on white, because that is
                       what Mumble's log is. */
                    <Box
                      sx={{
                        m: "12px",
                        p: "10px",
                        background: "#ffffff",
                        color: "#202020",
                        borderRadius: radius("sm"),
                        fontSize: 13,
                        lineHeight: 1.45,
                        "& a": { color: "#3399dd" },
                        "& table": { borderCollapse: "collapse" },
                        "& h1, & h2, & h3": { margin: "0.5em 0 0.3em" },
                        "& p": { margin: "0 0 0.5em" },
                      }}
                      dangerouslySetInnerHTML={{ __html: asSent }}
                    />
                  ) : null}
                  {asSent === null && shown.map((raw) => {
                    const block = effective(design, target, raw);
                    const off = !gateOpen(design, block);
                    // In preview a gated-off block is simply not there, which
                    // is what the client will do with it.
                    if (preview && off) return null;
                    const flat = isFlat(target);
                    const on = raw.id === selected && !preview;
                    const framed = !!block.gate && !flat && !preview;
                    const backdrop = design.assets?.find(
                      (asset) => asset.id === block.bgAsset,
                    )?.src;
                    // The usage this block *is*, where it is one: a slot block
                    // is a single usage, and it is the one the tag counts.
                    const mine = usages.find(
                      (usage) => usage.block === raw.id && usage.kind !== "gate",
                    );
                    const siblings = mine ? usages.filter((u) => u.input === mine.input).length : 0;
                    const gateUsage = usages.find(
                      (usage) => usage.block === raw.id && usage.kind === "gate",
                    );
                    return (
                      <Box
                        key={raw.id}
                        ref={(node: HTMLElement | null) => measure(raw.id, node)}
                        // Names what is on the sheet, for the tests and for
                        // anything driving the editor from outside it.
                        data-block={raw.id}
                        data-kind={block.type}
                        onPointerDown={(event: React.PointerEvent) => {
                          event.stopPropagation();
                          setSelected(raw.id);
                          // Starting a drag defaults the press away, which
                          // would leave focus wherever it was - outside the
                          // panel, where none of the shortcuts can hear it.
                          viewport.current?.focus({ preventScroll: true });
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
                          // A gated block is dimmed rather than hidden while it
                          // is being designed: this is the design, and a block
                          // you cannot see is one you cannot select to change
                          // the gate on.
                          opacity: off && !preview ? 0.34 : 1,
                          outline: on ? `1px solid ${theme.palette.nebula.accent}` : "none",
                          outlineOffset: 1,
                          // The fill and the ink the block asked for, on the
                          // wrapper - which is where the compiler puts them
                          // too, so the sheet and the message agree. The ink
                          // follows the fill when none was chosen, exactly as
                          // `colours` does on the way out, and a *role* is
                          // drawn in this operator's own theme, which is the
                          // one they can judge.
                          ...(block.bg
                            ? { background: paint(block.bg), padding: "10px 12px" }
                            : {}),
                          ...(block.fg || block.bg
                            ? { color: paint(block.fg ?? inkFor(block.bg ?? "")) }
                            : {}),
                          // The shape and the type, drawn the way they will be
                          // sent - a sheet that showed square corners for a
                          // rounded block would be a preview of the wrong
                          // thing.
                          // A hairline is paint too, and the sheet drew none of
                          // it: a card defined by its rule looked like loose
                          // text here and like a card in the message.
                          // The wash goes on before the flat fill, exactly as
                          // the compiler writes them: `background` is a
                          // shorthand that resets the colour, so the other way
                          // round the fill disappears here and not in the
                          // message, which is the worst way for the two to
                          // disagree.
                          ...(block.grad !== undefined
                            ? { backgroundImage: block.grad }
                            : {}),
                          ...(block.border !== undefined
                            ? {
                                border: `${block.borderWidth ?? 1}px ${block.borderStyle ?? "solid"} ${paint(block.border)}`,
                              }
                            : {}),
                          ...(block.borderTop !== undefined
                            ? {
                                borderTop: `${block.borderWidth ?? 1}px ${block.borderStyle ?? "solid"} ${paint(block.borderTop)}`,
                              }
                            : {}),
                          ...(block.shadow !== undefined ? { boxShadow: block.shadow } : {}),
                          // The picture behind, its geometry, and the blur of
                          // it - drawn here so the sheet shows what the message
                          // will rather than a plain box with a note about it.
                          ...(backdrop === undefined
                            ? {}
                            : {
                                backgroundImage: `url("${backdrop}")`,
                                backgroundSize: block.bgFit ?? "cover",
                                backgroundPosition: block.bgPos ?? "center",
                                backgroundRepeat: "no-repeat",
                              }),
                          ...(block.blurBehind === undefined
                            ? {}
                            : {
                                backdropFilter: `blur(${block.blurBehind}px)`,
                                WebkitBackdropFilter: `blur(${block.blurBehind}px)`,
                              }),
                          ...(block.blur === undefined ? {} : { filter: `blur(${block.blur}px)` }),
                          ...(block.ratio === undefined ? {} : { aspectRatio: block.ratio }),
                          ...(block.textShadow !== undefined ? { textShadow: block.textShadow } : {}),
                          ...(block.round === true ? { borderRadius: "50%" } : {}),
                          ...(block.margin !== undefined ? { margin: block.margin } : {}),
                          ...(block.padCss !== undefined ? { padding: block.padCss } : {}),
                          // A fitted block hugs its words rather than filling
                          // its column, which is the whole point of the control
                          // - a badge drawn full width on the sheet and as a
                          // pill in the message is a preview of the wrong
                          // thing. The block's own width stays as the limit,
                          // because that is what its cell is still worth in a
                          // row of more than one.
                          ...(block.fit === true && !flat
                            ? { width: "fit-content", maxWidth: block.w }
                            : {}),
                          ...(block.radius !== undefined ? { borderRadius: `${block.radius}px` } : {}),
                          ...(block.pad !== undefined ? { padding: `${block.pad}px` } : {}),
                          ...(block.weight !== undefined ? { fontWeight: block.weight } : {}),
                          ...(block.leading !== undefined ? { lineHeight: `${block.leading}%` } : {}),
                          ...(block.tracking !== undefined
                            ? { letterSpacing: `${(block.tracking / 100).toFixed(2)}em` }
                            : {}),
                          ...(block.measure !== undefined
                            ? {
                                "& > *": {
                                  maxWidth: `${block.measure}px`,
                                  marginLeft: block.align === "center" ? "auto" : undefined,
                                  marginRight: block.align === "center" ? "auto" : undefined,
                                },
                              }
                            : {}),
                        })}
                      >
                        {/* The gate, drawn as the group it is: everything inside
                            the dashed frame arrives only when the condition
                            holds. A corner tag said the same thing in less
                            space and read as a property of the block rather
                            than as a boundary around it. */}
                        {framed && (
                          <>
                            <Box
                              aria-hidden
                              sx={(theme) => ({
                                position: "absolute",
                                inset: "-12px",
                                pointerEvents: "none",
                                border: `1px dashed ${theme.palette.nebula.ok}`,
                                borderRadius: radius("sm"),
                                background: alpha(theme.palette.nebula.ok, 0.06),
                              })}
                            />
                            <Stack
                              direction="row"
                              alignItems="center"
                              gap={0.75}
                              sx={(theme) => ({
                                position: "absolute",
                                left: "-6px",
                                top: "-22px",
                                px: "8px",
                                py: "2px",
                                pointerEvents: "none",
                                whiteSpace: "nowrap",
                                borderRadius: radius("sm"),
                                border: `1px solid ${theme.palette.nebula.ok}`,
                                background: theme.palette.nebula.bg0,
                              })}
                            >
                              {gateUsage ? <Count tone="ok">{gateUsage.index}</Count> : <Dot tone="ok" />}
                              <Box
                                component="span"
                                sx={(theme) => ({
                                  fontFamily: NEBULA_MONO,
                                  fontSize: 9.5,
                                  letterSpacing: "0.06em",
                                  color: theme.palette.nebula.ok,
                                })}
                              >
                                shown if {block.gate}
                              </Box>
                            </Stack>
                          </>
                        )}
                        {on && !flat && (
                          <Stack
                            direction="row"
                            alignItems="center"
                            gap={0.75}
                            sx={(theme) => ({
                              position: "absolute",
                              // A gated block already has a chip at its top
                              // left, twelve pixels out; the two used to sit on
                              // top of each other.
                              ...(framed ? { right: 0 } : { left: 0 }),
                              top: -18,
                              height: "17px",
                              px: "6px",
                              borderRadius: `${radius("sm")} ${radius("sm")} 0 0`,
                              fontFamily: NEBULA_MONO,
                              fontSize: 9.5,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              whiteSpace: "nowrap",
                              color: theme.palette.nebula.onAccent,
                              background: theme.palette.nebula.accent,
                            })}
                          >
                            {/* Which of this input's usages you are looking at,
                                because with several on one sheet the tag is the
                                only thing that says which one this is. */}
                            {mine && siblings > 1 && (
                              <Box
                                component="span"
                                sx={{
                                  px: "4px",
                                  borderRadius: "999px",
                                  background: "rgba(255,255,255,0.25)",
                                  fontSize: 8,
                                }}
                              >
                                {mine.index}/{siblings}
                              </Box>
                            )}
                            {BLOCK_LABELS[block.type]}
                            <Box component="span" sx={{ opacity: 0.7 }}>
                              {block.h ? `${block.w} × ${block.h}` : `${block.w} wide`}
                            </Box>
                            {mine && (
                              <Box
                                component="button"
                                type="button"
                                title="Keep the usage, leave it out of the message"
                                onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
                                onClick={(event: React.MouseEvent) => {
                                  event.stopPropagation();
                                  onChange(hideUsage(design, mine, !mine.hidden));
                                }}
                                sx={{
                                  all: "unset",
                                  height: "13px",
                                  px: "5px",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                  fontSize: 8,
                                  background: "rgba(255,255,255,0.2)",
                                  "&:hover": { background: "rgba(255,255,255,0.38)" },
                                }}
                              >
                                {mine.hidden ? "◌ hidden" : "◉ hide"}
                              </Box>
                            )}
                          </Stack>
                        )}
                        {/* Edited where it sits, not in a panel on the far
                            side of the window. A paragraph's line breaks and
                            its width are the design, so typing it anywhere but
                            here means writing blind and checking afterwards. */}
                        {on && !flat && isRichBody(block.type) ? (
                          <Box onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}>
                            <RichTextField
                              floating
                              value={richBody(block.text)}
                              placeholder="what it says"
                              ariaLabel="Block text"
                              preset="document"
                              tools={TEXT_TOOLS}
                              maxLength={MAX_BODY}
                              minHeight={Math.max(24, block.h ?? 24)}
                              maxHeight={480}
                              onChange={(html) => set("text", html)}
                              extras={
                                <>
                                  <Box
                                    sx={(theme) => ({
                                      width: "1px",
                                      height: "16px",
                                      mx: "3px",
                                      background: theme.palette.nebula.line2,
                                    })}
                                  />
                                  <Box
                                    component="button"
                                    type="button"
                                    title="Put an input into this copy"
                                    onClick={() => setPicking(raw.id)}
                                    sx={(theme) => ({
                                      all: "unset",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "5px",
                                      height: "24px",
                                      px: "8px",
                                      cursor: "pointer",
                                      borderRadius: radius("sm"),
                                      fontSize: 11.5,
                                      color: theme.palette.nebula.accent,
                                      background: theme.palette.nebula.accentSoft,
                                      "&:hover": { background: theme.palette.nebula.accentLine },
                                    })}
                                  >
                                    <Box component="span" sx={{ fontFamily: NEBULA_MONO, fontSize: 11 }}>
                                      ⌗
                                    </Box>
                                    Insert
                                  </Box>
                                </>
                              }
                            />
                          </Box>
                        ) : (
                          <Preview
                            block={block}
                            flat={flat}
                            target={target}
                            chrome={!preview}
                            usages={usages.filter((usage) => usage.block === raw.id)}
                            onHide={(usage) => onChange(hideUsage(design, usage, !usage.hidden))}
                            resolve={resolve}
                            assets={design.assets}
                          />
                        )}
                        {/* A selection's own outline and its handles. Only the
                            blocks whose size is the operator's get live grips:
                            a slot takes the size of whatever arrives at send
                            time, so a handle on one would be resizing a
                            placeholder. */}
                        {on && !flat && (
                          <>
                            <Box
                              aria-hidden
                              sx={(theme) => ({
                                position: "absolute",
                                inset: "-1px",
                                pointerEvents: "none",
                                border: `1px solid ${theme.palette.nebula.accent}`,
                              })}
                            />
                            {HANDLES.map((handle) => {
                              const live = handle.mode !== undefined && resizable(block);
                              return (
                                <Box
                                  key={handle.id}
                                  aria-hidden={!live}
                                  aria-label={live ? `Resize the ${handle.edge} edge` : undefined}
                                  onPointerDown={
                                    live
                                      ? (event: React.PointerEvent) => {
                                          event.stopPropagation();
                                          drag.start(raw.id, block, event, handle.mode!);
                                        }
                                      : undefined
                                  }
                                  sx={(theme) => ({
                                    position: "absolute",
                                    ...handle.place,
                                    zIndex: 5,
                                    width: "8px",
                                    height: "8px",
                                    borderRadius: "2px",
                                    cursor: live ? handle.cursor : "default",
                                    background: theme.palette.nebula.bg0,
                                    border: `1px solid ${theme.palette.nebula.accent}`,
                                    opacity: live || resizable(block) ? 1 : 0.5,
                                  })}
                                />
                              );
                            })}
                          </>
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
              </Box>

            </Box>

            {picking !== null && (
              <PlaceholderPicker
                slots={design.slots}
                onPick={(name) => {
                  onChange(addInlineUsage(design, picking, name));
                  setPicking(null);
                }}
                onClose={() => setPicking(null)}
              />
            )}

            {/* -- the inputs dock ------------------------------------------- */}
            {/* Under the artboard rather than in a rail, because an input is
                read next to its usages: which slot draws it, which block it
                gates, and whether anything on the canvas feeds it at all. */}
            <Box
              sx={(theme) => ({
                position: "relative",
                flex: "none",
                background: theme.palette.nebula.panel,
                borderTop: `1px solid ${theme.palette.nebula.line2}`,
              })}
            >
              <Stack direction="row" alignItems="center" gap={1.25} sx={{ px: "18px", pt: "9px" }}>
                <Kicker>Data inputs</Kicker>
                {/* Two different things share this dock, and the difference
                    matters more than it looks: one half is wired by the
                    operator and can be left unfed, the other is answered by the
                    server and never can. */}
                <Stack
                  direction="row"
                  alignItems="center"
                  gap={0.25}
                  sx={(theme) => ({
                    flex: "none",
                    p: "3px",
                    borderRadius: radius("sm"),
                    background: theme.palette.nebula.bg0,
                    border: `1px solid ${theme.palette.nebula.line2}`,
                  })}
                >
                  {(
                    [
                      ["yours", `Yours ${design.slots.length + design.conditions.length}`],
                      ["builtins", `Built-ins ${BUILT_INS.length}`],
                    ] as const
                  ).map(([id, label]) => (
                    <Box
                      key={id}
                      component="button"
                      type="button"
                      aria-pressed={dockTab === id}
                      onClick={() => setDockTab(id)}
                      sx={(theme) => ({
                        all: "unset",
                        height: "21px",
                        px: "9px",
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer",
                        borderRadius: radius("sm"),
                        fontSize: 11,
                        color:
                          dockTab === id ? theme.palette.nebula.onAccent : theme.palette.nebula.muted,
                        background: dockTab === id ? theme.palette.nebula.accent : "transparent",
                        "&:hover":
                          dockTab === id
                            ? {}
                            : { background: theme.palette.nebula.hover, color: theme.palette.nebula.text },
                      })}
                    >
                      {label}
                    </Box>
                  ))}
                </Stack>
                <Hint>
                  {dockTab === "yours"
                    ? "values supplied at send time"
                    : "always answered by the server — nothing to wire"}
                </Hint>
                <Box sx={{ flex: 1 }} />
                <Box
                  component="button"
                  type="button"
                  aria-expanded={adding}
                  hidden={dockTab !== "yours"}
                  onClick={() => setAdding((was) => !was)}
                  sx={(theme) => ({
                    all: "unset",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    px: "11px",
                    py: "4px",
                    cursor: "pointer",
                    fontSize: 11.5,
                    borderRadius: radius("sm"),
                    color: theme.palette.nebula.accent,
                    background: theme.palette.nebula.accentSoft,
                    border: `1px dashed ${theme.palette.nebula.accentLine}`,
                    "&:hover": { borderColor: theme.palette.nebula.accent },
                  })}
                >
                  <Box component="span" sx={{ fontSize: 13, lineHeight: 1 }}>
                    +
                  </Box>
                  New input
                </Box>
              </Stack>

              {/* Named and described rather than two bare "+" buttons: which of
                  the two an operator wants is exactly the thing they are least
                  sure of when they come here. */}
              {adding && (
                <Stack
                  direction="row"
                  gap={1}
                  sx={(theme) => ({
                    mx: "18px",
                    mt: "9px",
                    p: "8px",
                    borderRadius: radius("md"),
                    background: theme.palette.nebula.card,
                    border: `1px solid ${theme.palette.nebula.line2}`,
                  })}
                >
                  <AddInput
                    glyph="Aa"
                    label="Text slot"
                    body="A placeholder replaced with a value when the message is sent."
                    onClick={() => {
                      onChange(addInput(design, "slot"));
                      setAdding(false);
                    }}
                  />
                  <AddInput
                    glyph="◑"
                    label="Toggle"
                    body="A true/false switch that shows or hides elements on the artboard."
                    onClick={() => {
                      onChange(addInput(design, "condition"));
                      setAdding(false);
                    }}
                  />
                </Stack>
              )}

              {browsing !== null && (
                <UsagesPanel
                  input={browsing}
                  kind={design.slots.some((entry) => entry.name === browsing) ? "slot" : "condition"}
                  usages={usagesOfInput(design, browsing)}
                  overridden={(usage) => overrideOf(design, target, usage.block) !== undefined}
                  emptyFallback={(usage) =>
                    usage.kind === "slot" &&
                    !design.blocks.find((block) => block.id === usage.block)?.fallback
                  }
                  onGo={(usage) => {
                    setSelected(usage.block);
                    setStepped(usage.index - 1);
                  }}
                  onRename={() => {
                    const entry = [...design.slots, ...design.conditions].find(
                      (candidate) => candidate.name === browsing,
                    );
                    if (entry) onRenameInput?.(entry.id, entry.name);
                  }}
                  onClose={() => setBrowsing(null)}
                />
              )}

              {dockTab === "builtins" && (
                <Stack direction="row" gap={1.25} sx={{ px: "18px", py: "10px", overflowX: "auto" }}>
                  {BUILT_IN_GROUPS.map((group) => (
                    <Box
                      key={group}
                      sx={(theme) => ({
                        flex: "none",
                        width: "320px",
                        p: "9px 10px",
                        borderRadius: radius("md"),
                        background: theme.palette.nebula.card,
                        border: `1px solid ${theme.palette.nebula.line2}`,
                      })}
                    >
                      <Stack direction="row" alignItems="center" gap={0.9} sx={{ mb: "6px" }}>
                        <Kicker>{BUILT_IN_GROUP_LABELS[group]}</Kicker>
                        <Box sx={{ flex: 1 }} />
                        <Stack direction="row" alignItems="center" gap={0.6}>
                          <Dot tone="ok" />
                          <Box component="span" sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}>
                            always wired
                          </Box>
                        </Stack>
                      </Stack>
                      <Stack gap={0.2}>
                        {builtInsOf(group).map((entry) => (
                          <Box
                            key={entry.name}
                            component="button"
                            type="button"
                            title={
                              chosen && FIELDS[chosen.type].includes("text")
                                ? `Put $${entry.name} into ${BLOCK_LABELS[chosen.type]}`
                                : "Select a block with copy to place this"
                            }
                            disabled={!chosen || !FIELDS[chosen.type].includes("text")}
                            onClick={() =>
                              chosen && onChange(addInlineUsage(design, chosen.id, entry.name))
                            }
                            sx={(theme) => ({
                              all: "unset",
                              boxSizing: "border-box",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              height: "27px",
                              px: "8px",
                              borderRadius: radius("sm"),
                              cursor: "pointer",
                              "&:hover": { background: theme.palette.nebula.hover },
                              "&[disabled]": { cursor: "default", opacity: 0.55 },
                            })}
                          >
                            <Box
                              component="span"
                              sx={(theme) => ({
                                flex: "none",
                                minWidth: "104px",
                                fontFamily: NEBULA_MONO,
                                fontSize: 11,
                                color: theme.palette.nebula.accent,
                              })}
                            >
                              ${entry.name}
                            </Box>
                            <Box
                              component="span"
                              sx={(theme) => ({
                                flex: 1,
                                minWidth: 0,
                                fontSize: 11,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                color: theme.palette.nebula.muted,
                              })}
                            >
                              {entry.about}
                            </Box>
                            <Mono>{entry.sample}</Mono>
                          </Box>
                        ))}
                      </Stack>
                    </Box>
                  ))}
                  <Box
                    sx={(theme) => ({
                      flex: "none",
                      width: "250px",
                      p: "10px",
                      borderRadius: radius("md"),
                      border: `1px dashed ${theme.palette.nebula.line2}`,
                      fontSize: 11,
                      color: theme.palette.nebula.dim,
                      textWrap: "pretty",
                    })}
                  >
                    These are the facts the server has at handshake. Missing values fall back to the
                    text you set on the element.
                  </Box>
                </Stack>
              )}

              <Stack
                direction="row"
                gap={1.25}
                sx={{ px: "18px", py: "10px", overflowX: "auto" }}
                hidden={dockTab !== "yours"}
              >
                {design.slots.length === 0 && design.conditions.length === 0 && (
                  <Hint>none yet — a design declares what it takes, and the canvas fills it</Hint>
                )}
                {[
                  ...design.slots.map((input) => ({ input, kind: "slot" as InputKind })),
                  ...design.conditions.map((input) => ({ input, kind: "condition" as InputKind })),
                ].map(({ input, kind }) => (
                  <InputCard
                    key={input.id}
                    input={input}
                    kind={kind}
                    wired={!unwired(input)}
                    lit={litInput === input.name}
                    bound={
                      chosen !== null &&
                      usages.some(
                        (usage) => usage.block === chosen.id && usage.input === input.name,
                      )
                    }
                    usages={usages.filter((usage) => usage.input === input.name)}
                    onGo={(usage) => {
                      setSelected(usage.block);
                      setStepped(usage.index - 1);
                    }}
                    onSelectAll={() => setBrowsing(input.name)}
                    onRename={(next) => onRenameInput?.(input.id, next)}
                    onRemove={() => onRemoveInput?.(input.id)}
                    onPreview={
                      kind === "condition"
                        ? (value) => onChange(setInputPreview(design, input.id, value))
                        : undefined
                    }
                  />
                ))}
                {design.slots.length + design.conditions.length > 0 && (
                  <Box
                    sx={(theme) => ({
                      flex: "none",
                      display: "grid",
                      placeItems: "center",
                      width: "250px",
                      p: "9px 10px",
                      borderRadius: radius("md"),
                      border: `1px dashed ${theme.palette.nebula.line2}`,
                      fontSize: 11,
                      color: theme.palette.nebula.dim,
                    })}
                  >
                    {design.slots.length + design.conditions.length} of{" "}
                    {design.slots.length + design.conditions.length} inputs
                  </Box>
                )}
              </Stack>
            </Box>
          </Stack>

          {/* -- properties --------------------------------------------------- */}
          <Pane left>
            {/* The name and the one destructive action on one row, as every
                inspector does it: what is selected, and the way to get rid of
                it. Everything below is what it is made of. */}
            <Stack
              direction="row"
              alignItems="center"
              gap={1}
              sx={(theme) => ({
                mx: "-14px",
                mt: "-14px",
                mb: "14px",
                px: "14px",
                height: "46px",
                borderBottom: `1px solid ${theme.palette.nebula.line}`,
              })}
            >
              <Stack direction="row" alignItems="center" gap={1.1} sx={{ flex: 1, minWidth: 0 }}>
                {chosen && <Glyph>{glyphOf(chosen)}</Glyph>}
                <Typography
                  sx={(theme) => ({
                    minWidth: 0,
                    fontSize: 12.5,
                    fontWeight: 600,
                    letterSpacing: "0.01em",
                    color: chosen ? theme.palette.nebula.text : theme.palette.nebula.dim,
                  })}
                  noWrap
                >
                  {chosen ? BLOCK_LABELS[chosen.type] : "Nothing selected"}
                </Typography>
              </Stack>
              {chosen && (
                <Chrome
                  danger
                  label="Delete"
                  onClick={() => {
                    onChange(removeBlock(design, chosen.id));
                    setSelected(null);
                  }}
                />
              )}
            </Stack>

            {!chosen && <Hint>Pick something on the artboard to change it.</Hint>}

            {chosen && overrideOf(design, target, chosen.id) && (
              <Stack direction="row" alignItems="center" gap={1} sx={{ mb: "12px" }}>
                <Typography sx={(theme) => ({ flex: 1, fontSize: 10.5, color: theme.palette.nebula.accent })}>
                  Overridden on {TARGET_LABELS[target].label}
                </Typography>
                <Quiet
                  label="Revert to base"
                  onClick={() => onChange(revertBlock(design, target, chosen.id))}
                />
              </Stack>
            )}

            {chosen && (
              <Properties
                design={design}
                block={effective(design, target, chosen)}
                wired={wired ?? new Set()}
                usages={usages}
                stepped={stepped}
                onStep={setStepped}
                onGo={(usage) => {
                  setSelected(usage.block);
                  setStepped(usage.index - 1);
                }}
                onBrowse={setBrowsing}
                onInsertInline={(input) => onChange(addInlineUsage(design, chosen.id, input))}
                onSet={set}
                onPickPicture={pickPicture}
                onClearPicture={clearPicture}
                onPickBackdrop={pickBackdrop}
                onClearBackdrop={clearBackdrop}
                onArrange={(to) => onChange(reorderBlock(design, chosen.id, to))}
              />
            )}
          </Pane>
        </Box>

        {/* Right-click on a target tab: start that target from a design that
          already exists rather than from the same blank sheet again. What is
          copied is the *effective* design on the source - base plus whatever
          that target had diverged into - and what the destination cannot draw
          is left behind rather than approximated. See `copyDesignTo`. */}
        <Menu
          open={copyOnto !== null}
          anchorReference="anchorPosition"
          anchorPosition={copyOnto ? { left: copyOnto.left, top: copyOnto.top } : undefined}
          onClose={() => setCopyOnto(null)}
        >
          <ListSubheader sx={{ lineHeight: "28px" }}>
            {copyOnto ? `Copy a design onto ${TARGET_LABELS[copyOnto.target].label}` : ""}
          </ListSubheader>
          {TARGETS.filter((entry) => entry !== copyOnto?.target).map((from) => {
            const dropped = copyOnto ? droppedBy(design, copyOnto.target).length : 0;
            return (
              <MenuItem
                key={from}
                onClick={() => {
                  if (!copyOnto) return;
                  onChange(copyDesignTo(design, from, copyOnto.target));
                  setTarget(copyOnto.target);
                  setCopyOnto(null);
                }}
              >
                {`From ${TARGET_LABELS[from].label}`}
                {dropped > 0 ? ` · ${dropped} kind${dropped === 1 ? "" : "s"} left out` : ""}
              </MenuItem>
            );
          })}
        </Menu>

        {/* The sheet gallery. Reached from inside the editor rather than from
          the canvas, because "what should this message look like" is a
          question somebody asks *after* they have drawn the rule and opened
          the sheet - and going back out to the canvas to answer it means
          losing the sheet they were looking at.

          It replaces the blocks and leaves the declared inputs alone: what
          feeds an input is an edge on the canvas, and changing the look of a
          message is not a reason to unplug it. */}
        <Menu
          open={gallery !== null}
          anchorReference="anchorPosition"
          anchorPosition={gallery ?? undefined}
          onClose={() => setGallery(null)}
        >
          <ListSubheader sx={{ lineHeight: "28px" }}>Start from a sheet</ListSubheader>
          {DESIGN_TEMPLATES.map((entry) => (
            <MenuItem
              key={entry.id}
              sx={{ display: "block", maxWidth: 340, py: "8px", whiteSpace: "normal" }}
              onClick={() => {
                const sheet = entry.build();
                onChange({
                  ...design,
                  sheetW: sheet.sheetW,
                  blocks: sheet.blocks,
                  // The design's own overrides described the blocks that have
                  // just been replaced, so keeping them would patch blocks that
                  // no longer exist.
                  overrides: {},
                  // Whatever the new sheet needs, plus whatever was already
                  // declared - an input with an edge on it must not vanish
                  // because a different sheet did not happen to use it.
                  conditions: merged(design.conditions, sheet.conditions),
                  slots: merged(design.slots, sheet.slots),
                });
                setGallery(null);
              }}
            >
              <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography
                sx={(theme) => ({ fontSize: 11, lineHeight: 1.45, color: theme.palette.nebula.dim })}
              >
                {entry.description}
              </Typography>
              <Typography
                sx={(theme) => ({
                  mt: "3px",
                  fontFamily: NEBULA_MONO,
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: theme.palette.nebula.dim,
                })}
              >
                {entry.targets}
              </Typography>
            </MenuItem>
          ))}
        </Menu>

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
        {/* What is wrong, and a way to *get to* it. Naming a fault without
            offering to show it makes an operator hunt through the layer list
            for the block the sentence is about. */}
        <Stack
          direction="row"
          alignItems="center"
          gap={1.25}
          sx={(theme) => ({
            flex: "none",
            px: "14px",
            py: "8px",
            background: theme.palette.nebula.panel,
            borderTop: `1px solid ${theme.palette.nebula.line2}`,
          })}
        >
          {issues.length > 0 && <Dot tone="warn" />}
          <Typography
            sx={(theme) => ({
              flex: 1,
              minWidth: 0,
              fontSize: 11.5,
              color: issues.length > 0 ? theme.palette.nebula.warn : theme.palette.nebula.dim,
            })}
            noWrap
          >
            {issues.length > 0
              ? `${issues.length} issue${issues.length === 1 ? "" : "s"} · ${issues[0].message}`
              : "Nothing outstanding."}
          </Typography>
          {issues.length > 0 && (issues[0].block || issues[0].input) && (
            <Chrome warn label="Fix" onClick={() => reveal(issues[0])} />
          )}
          <Mono>
            {TARGET_LABELS[target].label.toUpperCase()} · {shown.length} layers ·{" "}
            {design.slots.length + design.conditions.length} inputs · {usages.length} usages
          </Mono>
        </Stack>
      </Box>
    </>
  );
}

/**
 * How wide the panel opens, and the range it may be dragged to.
 *
 * Wide enough for the three panes *and* room around the artboard: the rails are
 * fixed at 274 and 300, so every pixel taken off this comes out of the canvas -
 * and at 1180 a 520pt sheet had 40px of margin, which reads as a document
 * jammed into its own window rather than as a drawing on a table.
 *
 * Capped by `panelCap`, so on a narrower window this is simply "as wide as
 * there is room for".
 */
const PANEL_DEFAULT = 1560;

/**
 * How much canvas is left beside the panel, however narrow the window is.
 *
 * The panel is anchored to the right edge and sized in pixels, so on a window
 * narrower than it, its *left* side - the rail holding Insert, Inputs and
 * Layers - goes off the screen entirely: no way to add a block, no way to
 * declare an input, and no scrollbar to tell anybody there is something there.
 * Which is not a narrow-window nicety - it is the editor missing a third of
 * itself on any window under `PANEL_DEFAULT`.
 */
const PANEL_GUTTER = 48;

/** The widest the panel may be in a window this size. */
function panelCap(): number {
  // Guarded for a window narrower than the gutter, which is not a real window
  // but is a real value during a resize.
  return Math.max(360, (globalThis.innerWidth || PANEL_DEFAULT) - PANEL_GUTTER);
}
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

/**
 * What a press on the sheet turned into.
 *
 * Both resize edges, because a block's height is its content's on all but two
 * types - so every handle a selection draws changes the *width*, and which
 * edge it moves is the only thing that distinguishes them.
 */
type DragMode = "move" | "resize-e" | "resize-s" | "resize-se" | "panel";

/** Dragging and resizing on the sheet. */
function useDrag(
  design: Design,
  target: Target,
  onChange: (next: Design) => void,
  grid: boolean,
  onPanel: (width: number) => void,
  onGuides: (guides: readonly Guide[]) => void,
  toWorld: (clientX: number, clientY: number) => { x: number; y: number },
  /** What the sheet measured, so a guide spans the blocks it lined up. */
  heights: React.RefObject<Map<string, number>>,
) {
  const [held, setHeld] = useState<{
    id: string;
    mode: DragMode;
    from: { x: number; y: number; w: number; h: number };
    at: { x: number; y: number };
  } | null>(null);

  const start = (id: string, block: Block, event: React.PointerEvent, mode: DragMode) => {
    event.preventDefault();
    setHeld({
      id,
      mode,
      from: { x: block.x, y: block.y, w: block.w, h: block.h ?? 0 },
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
      from: { x: 0, y: 0, w: width, h: 0 },
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
      // The cap wins over the minimum: on a window narrower than `PANEL_MIN`
      // the panel is as wide as there is room for, never wider than the screen.
      onPanel(Math.min(panelCap(), Math.max(PANEL_MIN, held.from.w - (event.clientX - held.at.x))));
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

    if (held.mode.startsWith("resize")) {
      let next = design;
      const guides: Guide[] = [];

      // The east grip and the south grip are one gesture each; the corner is
      // both at once, which is why the two are applied independently rather
      // than switched between.
      if (held.mode === "resize-e" || held.mode === "resize-se") {
        const landed = snapWidth(moving, held.from.w + dx, others, design.sheetW, grid, heights.current);
        guides.push(...landed.guides);
        next = setField(next, target, held.id, "w", landed.w);
      }
      if (held.mode === "resize-s" || held.mode === "resize-se") {
        // No snapping on the vertical: the candidates are other blocks' tops
        // and bottoms, and a block being made taller is being sized against its
        // own content rather than lined up with a neighbour.
        next = setField(next, target, held.id, "h", Math.max(16, snap(held.from.h + dy, grid)));
      }
      onGuides(guides);
      onChange(next);
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
      heights.current,
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

/**
 * One declared input, as a card in the dock under the artboard.
 *
 * The card answers the three things asked of an input in one place: what it is
 * called, what on the sheet uses it, and whether anything on the canvas
 * actually feeds it. That last one is the whole reason the dock is here - an
 * input nothing feeds renders empty at send time, and a list of names in a rail
 * had nowhere to say so.
 *
 * The name is committed on blur or Enter rather than on every keystroke, and
 * that is not politeness - the name is normalised and made unique when it
 * lands, so committing per keystroke would rewrite the field under the caret:
 * a space would become an underscore mid-word, and a name that momentarily
 * matched another would gain a `_2` that the next letter turned into nonsense.
 */
function InputCard({
  input,
  kind,
  wired,
  lit,
  bound,
  usages,
  onGo,
  onSelectAll,
  onRename,
  onRemove,
  onPreview,
}: Readonly<{
  input: Input;
  kind: InputKind;
  /** Whether the canvas has a wire on this input's port. */
  wired: boolean;
  /** Briefly, because the status bar sent the operator here. */
  lit: boolean;
  /** Whether what is selected on the sheet is the thing using this input. */
  bound: boolean;
  /** Every place it is used, which is what the card is mostly about. */
  usages: readonly Usage[];
  onGo: (usage: Usage) => void;
  onSelectAll: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  /** Conditions only: what the sheet should assume while it is being drawn. */
  onPreview?: (on: boolean) => void;
}>) {
  const [draft, setDraft] = useState(input.name);
  // The committed name wins whenever it changes under us - a rename that came
  // back different (taken, or normalised) has to show, or the field says one
  // thing while every port says another.
  const [seen, setSeen] = useState(input.name);
  if (seen !== input.name) {
    setSeen(input.name);
    setDraft(input.name);
  }

  const commit = () => {
    if (draft !== input.name) onRename(draft);
  };

  const marked = bound || lit;
  // Past a handful, a chip each stops being a list and becomes a wall - so the
  // card switches to counts per section and sends the operator to the full list
  // rather than trying to draw a hundred and forty-eight of anything.
  const many = usages.length > CHIP_LIMIT;
  const sections = usagesBySection(usages);

  return (
    <Box
      sx={(theme) => ({
        position: "relative",
        flex: "none",
        width: many ? "286px" : "250px",
        boxSizing: "border-box",
        p: "9px 10px",
        borderRadius: radius("md"),
        background: marked ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
        border: `1px solid ${marked ? theme.palette.nebula.accent : theme.palette.nebula.line2}`,
      })}
    >
      {/* Tethered upward at the thing that uses it, so the card belonging to
          the selected slot is not something to be found by reading names. */}
      {bound && (
        <Box
          aria-hidden
          sx={(theme) => ({
            position: "absolute",
            top: "-5px",
            left: "18px",
            width: "9px",
            height: "9px",
            transform: "rotate(45deg)",
            background: theme.palette.nebula.accentSoft,
            borderLeft: `1px solid ${theme.palette.nebula.accent}`,
            borderTop: `1px solid ${theme.palette.nebula.accent}`,
          })}
        />
      )}

      <Stack direction="row" alignItems="center" gap={1}>
        {onPreview ? (
          <Box
            onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
            title="What the sheet assumes while you draw. Never sent."
            sx={{ flex: "none", display: "flex" }}
          >
            <MiniSwitch
              checked={input.on !== false}
              label={`Preview ${input.name} as ${input.on === false ? "on" : "off"}`}
              onChange={() => onPreview(input.on === false)}
            />
          </Box>
        ) : (
          <Glyph>Aa</Glyph>
        )}
        <Box
          component="input"
          value={draft}
          aria-label={`${kind === "slot" ? "Text slot" : "Toggle"} name`}
          spellCheck={false}
          onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            // Escape puts back what is actually named, rather than committing a
            // half-typed one on the way out.
            if (event.key === "Escape") setDraft(input.name);
          }}
          sx={(theme) => ({
            flex: 1,
            minWidth: 0,
            boxSizing: "border-box",
            px: "5px",
            py: "2px",
            fontFamily: NEBULA_MONO,
            fontSize: 11.5,
            color: theme.palette.nebula.text,
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: radius("sm"),
            outline: "none",
            "&:hover": { borderColor: theme.palette.nebula.line2 },
            "&:focus": { borderColor: theme.palette.nebula.accent },
          })}
        />
        <Box
          component="button"
          type="button"
          aria-label={`Remove ${input.name}`}
          onClick={onRemove}
          sx={(theme) => ({
            all: "unset",
            flex: "none",
            px: "4px",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            color: theme.palette.nebula.dim,
            "&:hover": { color: theme.palette.nebula.bad },
          })}
        >
          ×
        </Box>
      </Stack>

      <Box
        sx={(theme) => ({
          mt: "7px",
          pt: "7px",
          borderTop: `1px solid ${marked ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
        })}
      >
        <Stack direction="row" alignItems="center" gap={0.9}>
          <Kicker>
            {usages.length === 0
              ? "not placed"
              : kind === "slot"
                ? `used in ${usages.length} place${usages.length === 1 ? "" : "s"}`
                : `gates ${usages.length} element${usages.length === 1 ? "" : "s"}`}
          </Kicker>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" alignItems="center" gap={0.6} sx={{ flex: "none" }}>
            <Dot tone={wired ? "ok" : "warn"} />
            <Box
              component="span"
              sx={(theme) => ({
                fontSize: 10.5,
                color: wired ? theme.palette.nebula.muted : theme.palette.nebula.warn,
              })}
            >
              {wired ? "wired" : "unwired"}
            </Box>
          </Stack>
        </Stack>

        {usages.length === 0 && (
          <Box sx={{ mt: "6px" }}>
            <Hint>nowhere on the sheet yet</Hint>
          </Box>
        )}

        {usages.length > 0 && !many && (
          <Stack direction="row" flexWrap="wrap" gap={0.7} sx={{ mt: "6px" }}>
            {usages.map((usage) => (
              <Box
                key={usage.id}
                component="button"
                type="button"
                title={`Go to usage ${usage.index}`}
                onClick={() => onGo(usage)}
                sx={(theme) => {
                  const colour =
                    kind === "slot" ? theme.palette.nebula.accent : theme.palette.nebula.ok;
                  return {
                    all: "unset",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    height: "20px",
                    px: "7px 0 4px",
                    pl: "4px",
                    pr: "7px",
                    cursor: "pointer",
                    borderRadius: radius("sm"),
                    background: alpha(colour, usage.hidden ? 0.08 : 0.2),
                    color: colour,
                    fontSize: 10.5,
                    opacity: usage.hidden ? 0.6 : 1,
                  };
                }}
              >
                <Count tone={kind === "slot" ? "accent" : "ok"}>{usage.index}</Count>
                {usage.hidden ? "hidden" : usage.label}
              </Box>
            ))}
            {usages.length > 1 && (
              <Box
                component="button"
                type="button"
                onClick={onSelectAll}
                sx={(theme) => ({
                  all: "unset",
                  height: "20px",
                  px: "6px",
                  cursor: "pointer",
                  fontSize: 10.5,
                  color: theme.palette.nebula.accent,
                  "&:hover": { textDecoration: "underline" },
                })}
              >
                Select all
              </Box>
            )}
          </Stack>
        )}

        {many && (
          <Stack direction="row" alignItems="center" gap={0.7} sx={{ mt: "6px" }}>
            {[...sections.entries()].map(([section, count]) => (
              <Box
                key={section}
                component="span"
                sx={(theme) => ({
                  height: "20px",
                  px: "7px",
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: radius("sm"),
                  background: theme.palette.nebula.card2,
                  color: theme.palette.nebula.muted,
                  fontSize: 10.5,
                  whiteSpace: "nowrap",
                })}
              >
                {SECTION_LABELS[section]} {count}
              </Box>
            ))}
            <Box sx={{ flex: 1 }} />
            <Box
              component="button"
              type="button"
              onClick={onSelectAll}
              sx={(theme) => ({
                all: "unset",
                cursor: "pointer",
                fontSize: 10.5,
                whiteSpace: "nowrap",
                color: theme.palette.nebula.accent,
                "&:hover": { textDecoration: "underline" },
              })}
            >
              Show all →
            </Box>
          </Stack>
        )}
      </Box>
    </Box>
  );
}

/**
 * Every usage of one input, over the dock.
 *
 * The card summarises; this is where an operator goes when the summary is not
 * enough - a hundred and forty-eight places is not a list to be scrolled but
 * one to be filtered and stepped through, so it opens with the filters that
 * actually get asked (which ones diverge on this target, which have no
 * fallback) and groups the rest by where on the sheet they are.
 *
 * Anchored to the dock rather than floated in the middle, because the card it
 * came from is the context: the panel opens directly above it.
 */
function UsagesPanel({
  input,
  kind,
  usages,
  overridden,
  emptyFallback,
  onGo,
  onRename,
  onClose,
}: Readonly<{
  input: string;
  kind: InputKind;
  usages: readonly Usage[];
  /** Whether this usage's block diverges on the target being looked at. */
  overridden: (usage: Usage) => boolean;
  /** Whether it is a slot with nothing to show when the value is empty. */
  emptyFallback: (usage: Usage) => boolean;
  onGo: (usage: Usage) => void;
  onRename: () => void;
  onClose: () => void;
}>) {
  const [filter, setFilter] = useState<"all" | "overridden" | "empty">("all");
  const [needle, setNeedle] = useState("");
  const [open, setOpen] = useState<ReadonlySet<Section>>(new Set(SECTIONS));

  const counts = {
    all: usages.length,
    overridden: usages.filter(overridden).length,
    empty: usages.filter(emptyFallback).length,
  };

  const matching = usages
    .filter((usage) =>
      filter === "all" ? true : filter === "overridden" ? overridden(usage) : emptyFallback(usage),
    )
    .filter((usage) => needle === "" || usage.label.toLowerCase().includes(needle.toLowerCase()));

  return (
    <Box
      role="dialog"
      aria-label={`Usages of ${input}`}
      sx={(theme) => ({
        position: "absolute",
        zIndex: 30,
        left: "18px",
        right: "18px",
        bottom: "100%",
        mb: "10px",
        maxHeight: "46vh",
        display: "flex",
        flexDirection: "column",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        boxShadow: theme.palette.nebula.shadow,
        overflow: "hidden",
      })}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={1.25}
        sx={(theme) => ({
          flex: "none",
          p: "9px 11px",
          borderBottom: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <Glyph>{kind === "slot" ? "Aa" : "◑"}</Glyph>
        <Box component="span" sx={{ fontFamily: NEBULA_MONO, fontSize: 12 }}>
          {input}
        </Box>
        <Box
          component="span"
          sx={(theme) => ({
            px: "6px",
            py: "1px",
            borderRadius: radius("sm"),
            background: theme.palette.nebula.card2,
            color: theme.palette.nebula.muted,
            fontFamily: NEBULA_MONO,
            fontSize: 10,
          })}
        >
          {usages.length} usages
        </Box>
        <Box sx={{ flex: 1 }} />
        <Stack
          direction="row"
          alignItems="center"
          gap={0.9}
          sx={(theme) => ({
            minWidth: "180px",
            height: "26px",
            px: "9px",
            borderRadius: radius("sm"),
            background: theme.palette.nebula.bg0,
            border: `1px solid ${theme.palette.nebula.line2}`,
            "&:focus-within": { borderColor: theme.palette.nebula.accent },
          })}
        >
          <Box component="span" aria-hidden sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
            ⌕
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
            <PlainInput
              value={needle}
              placeholder="Filter usages…"
              ariaLabel="Filter usages"
              onChange={setNeedle}
            />
          </Box>
        </Stack>
        <Step label="Close the usage list" onClick={onClose}>
          ×
        </Step>
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        gap={0.75}
        sx={(theme) => ({
          flex: "none",
          p: "8px 11px",
          borderBottom: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        {(
          [
            ["all", `All ${counts.all}`],
            ["overridden", `Overridden ${counts.overridden}`],
            ["empty", `Empty fallback ${counts.empty}`],
          ] as const
        ).map(([id, label]) => (
          <Box
            key={id}
            component="button"
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            sx={(theme) => ({
              all: "unset",
              height: "23px",
              px: "9px",
              cursor: "pointer",
              borderRadius: radius("sm"),
              fontSize: 11,
              color: filter === id ? theme.palette.nebula.text : theme.palette.nebula.muted,
              background: filter === id ? theme.palette.nebula.card2 : "transparent",
              border: `1px solid ${filter === id ? theme.palette.nebula.line2 : "transparent"}`,
              "&:hover": { background: theme.palette.nebula.hover },
            })}
          >
            {label}
          </Box>
        ))}
        <Box sx={{ flex: 1 }} />
        <Hint>grouped by section</Hint>
      </Stack>

      <Box sx={{ flex: 1, minHeight: "110px", overflowY: "auto" }}>
        {SECTIONS.map((section) => {
          const rows = matching.filter((usage) => usage.section === section);
          if (rows.length === 0) return null;
          const shown = open.has(section);
          return (
            <Box key={section}>
              <Box
                component="button"
                type="button"
                onClick={() =>
                  setOpen((was) => {
                    const next = new Set(was);
                    if (next.has(section)) next.delete(section);
                    else next.add(section);
                    return next;
                  })
                }
                sx={(theme) => ({
                  all: "unset",
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: "11px",
                  width: "100%",
                  height: "30px",
                  px: "11px",
                  cursor: "pointer",
                  background: theme.palette.nebula.card2,
                  borderBottom: `1px solid ${theme.palette.nebula.line}`,
                })}
              >
                <Box component="span" aria-hidden sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
                  {shown ? "▾" : "▸"}
                </Box>
                <Box component="span" sx={{ flex: 1, fontSize: 11.5, fontWeight: 600 }}>
                  {SECTION_LABELS[section]}
                </Box>
                <Mono>{rows.length}</Mono>
              </Box>
              {shown &&
                rows.map((usage) => (
                  <Box
                    key={usage.id}
                    component="button"
                    type="button"
                    onClick={() => onGo(usage)}
                    sx={(theme) => ({
                      all: "unset",
                      boxSizing: "border-box",
                      display: "flex",
                      alignItems: "center",
                      gap: "11px",
                      width: "100%",
                      height: "29px",
                      pl: "28px",
                      pr: "11px",
                      cursor: "pointer",
                      "&:hover": { background: theme.palette.nebula.hover },
                    })}
                  >
                    <Count tone="quiet">{usage.index}</Count>
                    <Box
                      component="span"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {usage.label}
                      {usage.hidden ? " · hidden" : ""}
                    </Box>
                    <Box
                      component="span"
                      sx={(theme) => ({
                        fontFamily: NEBULA_MONO,
                        fontSize: 10,
                        color: overridden(usage)
                          ? theme.palette.nebula.warn
                          : theme.palette.nebula.dim,
                      })}
                    >
                      {overridden(usage) ? "OVERRIDE" : "BASE"}
                    </Box>
                  </Box>
                ))}
            </Box>
          );
        })}
        {matching.length === 0 && (
          <Box sx={{ p: "14px" }}>
            <Hint>Nothing matches that filter.</Hint>
          </Box>
        )}
      </Box>

      <Stack
        direction="row"
        alignItems="center"
        gap={1}
        sx={(theme) => ({
          flex: "none",
          p: "9px 11px",
          borderTop: `1px solid ${theme.palette.nebula.line}`,
          background: theme.palette.nebula.panel,
        })}
      >
        <Chrome label="Rename everywhere" onClick={onRename} />
        <Box sx={{ flex: 1 }} />
        <Hint>a row takes you to that usage on the artboard</Hint>
      </Stack>
    </Box>
  );
}

/**
 * What can be put inside a sentence, in one list.
 *
 * The operator's own inputs and the server's built-ins together, because at the
 * moment of writing "hello ___" nobody is thinking about which of the two kinds
 * a name belongs to - they are thinking of the word. The distinction still
 * shows, in the section headings and in whether a row says what it will read
 * as, but it is not the first question the list asks.
 */
function PlaceholderPicker({
  slots,
  onPick,
  onClose,
}: Readonly<{ slots: readonly Input[]; onPick: (name: string) => void; onClose: () => void }>) {
  const [needle, setNeedle] = useState("");
  const match = (name: string, about: string) =>
    needle === "" ||
    name.toLowerCase().includes(needle.toLowerCase()) ||
    about.toLowerCase().includes(needle.toLowerCase());

  const yours = slots.filter((input) => match(input.name, ""));
  const groups = BUILT_IN_GROUPS.map((group) => ({
    group,
    rows: builtInsOf(group).filter((entry) => match(entry.name, entry.about)),
  })).filter((entry) => entry.rows.length > 0);

  // Escape, wherever focus happens to be. A popover that can only be dismissed
  // by finding its own × is one people end up clicking around.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* The click-away. A transparent sheet rather than a document listener,
          so the press that dismisses cannot also land on whatever was under
          it - selecting a block on the way out of a menu is never meant. */}
      <Box
        onPointerDown={(event: React.PointerEvent) => {
          event.stopPropagation();
          onClose();
        }}
        sx={{ position: "absolute", inset: 0, zIndex: 49 }}
      />
    <Box
      role="dialog"
      aria-label="Insert a placeholder"
      onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
      sx={(theme) => ({
        position: "absolute",
        zIndex: 50,
        left: "50%",
        top: "80px",
        transform: "translateX(-50%)",
        width: "560px",
        maxWidth: "calc(100% - 24px)",
        maxHeight: "60%",
        display: "flex",
        flexDirection: "column",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        boxShadow: theme.palette.nebula.shadow,
        overflow: "hidden",
      })}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={1.1}
        sx={(theme) => ({
          flex: "none",
          p: "9px 11px",
          borderBottom: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <Kicker>Insert placeholder</Kicker>
        <Stack
          direction="row"
          alignItems="center"
          gap={0.9}
          sx={(theme) => ({
            flex: 1,
            height: "26px",
            px: "9px",
            borderRadius: radius("sm"),
            background: theme.palette.nebula.bg0,
            border: `1px solid ${theme.palette.nebula.line2}`,
            "&:focus-within": { borderColor: theme.palette.nebula.accent },
          })}
        >
          <Box component="span" aria-hidden sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
            ⌕
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
            <PlainInput
              value={needle}
              placeholder="Type to filter…"
              ariaLabel="Filter placeholders"
              onChange={setNeedle}
            />
          </Box>
        </Stack>
        <Step label="Close the placeholder list" onClick={onClose}>
          ×
        </Step>
      </Stack>

      <Box sx={{ flex: 1, minHeight: "120px", overflowY: "auto", p: "7px" }}>
        {yours.length > 0 && (
          <>
            <Box sx={{ px: "8px", py: "5px" }}>
              <Kicker>Your inputs</Kicker>
            </Box>
            {yours.map((input) => (
              <Row
                key={input.id}
                name={input.name}
                about="Filled by whatever the canvas wires to it"
                sample="unwired until then"
                onPick={onPick}
              />
            ))}
          </>
        )}
        {groups.map(({ group, rows }) => (
          <Box key={group}>
            <Box sx={{ px: "8px", py: "5px", mt: "6px" }}>
              <Kicker>{BUILT_IN_GROUP_LABELS[group]}</Kicker>
            </Box>
            {rows.map((entry) => (
              <Row
                key={entry.name}
                name={entry.name}
                about={entry.about}
                sample={entry.sample}
                onPick={onPick}
              />
            ))}
          </Box>
        ))}
        {yours.length === 0 && groups.length === 0 && (
          <Box sx={{ p: "14px" }}>
            <Hint>Nothing matches “{needle}”.</Hint>
          </Box>
        )}
      </Box>
    </Box>
    </>
  );
}

/** One placeholder in the picker: what it is called, what it is, what it says. */
function Row({
  name,
  about,
  sample,
  onPick,
}: Readonly<{ name: string; about: string; sample: string; onPick: (name: string) => void }>) {
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onPick(name)}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        height: "30px",
        px: "10px",
        cursor: "pointer",
        borderRadius: radius("sm"),
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      <Box
        component="span"
        sx={(theme) => ({
          flex: "none",
          minWidth: "132px",
          fontFamily: NEBULA_MONO,
          fontSize: 11.5,
          color: theme.palette.nebula.accent,
        })}
      >
        ${name}
      </Box>
      <Box
        component="span"
        sx={(theme) => ({
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: theme.palette.nebula.muted,
        })}
      >
        {about}
      </Box>
      <Mono>{sample}</Mono>
    </Box>
  );
}

/** How many usages a card will draw one chip each for before it summarises. */
const CHIP_LIMIT = 4;

/** One of the two kinds an operator can declare, named and explained. */
function AddInput({
  glyph,
  label,
  body,
  onClick,
}: Readonly<{ glyph: string; label: string; body: string; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        flex: 1,
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        p: "9px",
        cursor: "pointer",
        borderRadius: radius("sm"),
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      <Box sx={{ flex: "none", mt: "1px" }}>
        <Glyph>{glyph}</Glyph>
      </Box>
      <Stack gap={0.3} sx={{ minWidth: 0 }}>
        <Box component="span" sx={(theme) => ({ fontSize: 12, fontWeight: 600, color: theme.palette.nebula.text })}>
          {label}
        </Box>
        <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted, textWrap: "pretty" })}>
          {body}
        </Box>
      </Stack>
    </Box>
  );
}

function Pane({ children, left }: Readonly<{ children: React.ReactNode; left?: boolean }>) {
  return (
    <Box
      sx={(theme) => ({
        minWidth: 0,
        overflowY: "auto",
        p: "14px",
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
 * The editor's own chrome: a small outlined control, rounded like every other
 * Nebula control.
 *
 * An earlier draft made these square on the argument that a tool window should
 * not look like the document it edits. In practice it made the editor look like
 * a different application bolted onto the admin page - so they take the pack's
 * radius scale, and what separates instrument from drawing is the sheet's own
 * shadow and ground, which is where that distinction actually lives.
 *
 * The variants are the four jobs a button has on this bar: quiet by default,
 * `on` for a toggle that is holding, `primary` for the one action that leaves,
 * and `danger`/`warn` for the two that carry a consequence.
 */
function Chrome({
  label,
  glyph,
  on,
  primary,
  danger,
  warn,
  onClick,
}: Readonly<{
  label: string;
  glyph?: string;
  on?: boolean;
  primary?: boolean;
  danger?: boolean;
  warn?: boolean;
  /** Handed where the button is, for the ones that open a menu under it. */
  onClick: (at: { left: number; top: number }) => void;
}>) {
  const filled = on || primary;
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={on === undefined ? undefined : on}
      onClick={(event: React.MouseEvent<HTMLElement>) => {
        // Where the button *is*, not where the pointer was: a menu that opens
        // under the button is in the same place however it was pressed, which
        // includes from the keyboard, where there is no pointer at all.
        const box = event.currentTarget.getBoundingClientRect();
        onClick({ left: box.left, top: box.bottom + 4 });
      }}
      sx={(theme) => ({
        all: "unset",
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: "7px",
        height: "30px",
        px: "12px",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: primary ? 600 : 400,
        whiteSpace: "nowrap",
        borderRadius: radius("sm"),
        color: filled
          ? theme.palette.nebula.onAccent
          : warn
            ? theme.palette.nebula.warn
            : theme.palette.nebula.muted,
        background: filled
          ? theme.palette.nebula.accent
          : warn
            ? alpha(theme.palette.nebula.warn, 0.12)
            : theme.palette.nebula.card,
        border: `1px solid ${
          filled
            ? theme.palette.nebula.accent
            : warn
              ? alpha(theme.palette.nebula.warn, 0.35)
              : theme.palette.nebula.line2
        }`,
        "&:hover": filled
          ? { filter: "brightness(1.08)" }
          : danger
            ? {
                color: theme.palette.nebula.bad,
                borderColor: alpha(theme.palette.nebula.bad, 0.5),
                background: alpha(theme.palette.nebula.bad, 0.1),
              }
            : { color: theme.palette.nebula.text, borderColor: theme.palette.nebula.accentLine },
      })}
    >
      {glyph && (
        <Box component="span" aria-hidden sx={{ fontFamily: NEBULA_MONO, fontSize: 11 }}>
          {glyph}
        </Box>
      )}
      {label}
    </Box>
  );
}

/**
 * The target tabs: one rounded well with the held tab filled inside it.
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
  onMenu,
}: Readonly<{
  value: string;
  options: readonly { id: string; label: string; title: string; marked: boolean }[];
  onChange: (id: string) => void;
  /** Right-click on a tab: where "copy a design onto this target" lives. */
  onMenu?: (id: string, at: { left: number; top: number }) => void;
}>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={0.25}
      sx={(theme) => ({
        flex: "none",
        p: "3px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.bg0,
        border: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      {options.map((option) => {
        const on = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            type="button"
            title={option.title}
            aria-pressed={on}
            onContextMenu={
              onMenu
                ? (event: React.MouseEvent) => {
                    event.preventDefault();
                    onMenu(option.id, { left: event.clientX, top: event.clientY });
                  }
                : undefined
            }
            onClick={() => onChange(option.id)}
            sx={(theme) => ({
              all: "unset",
              display: "flex",
              alignItems: "center",
              height: "26px",
              px: "12px",
              cursor: "pointer",
              fontFamily: NEBULA_MONO,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              borderRadius: radius("sm"),
              color: on ? theme.palette.nebula.onAccent : theme.palette.nebula.muted,
              background: on ? theme.palette.nebula.accent : "transparent",
              "&:hover": on ? {} : { background: theme.palette.nebula.hover, color: theme.palette.nebula.text },
            })}
          >
            {option.label}
            {option.marked && (
              <Box
                component="span"
                sx={(theme) => ({
                  ml: "5px",
                  color: on ? theme.palette.nebula.onAccent : theme.palette.nebula.accent,
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

/* -- the small marks the editor is written in ----------------------------- */

/** A mono all-caps label, for the things a design tool names in the margin. */
function Kicker({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        flex: "none",
        fontFamily: NEBULA_MONO,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: theme.palette.nebula.dim,
      })}
    >
      {children}
    </Box>
  );
}

/** An aside, in the quietest thing that is still readable. */
function Hint({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
      {children}
    </Box>
  );
}

/** A measurement. Mono, because these are read as numbers and compared. */
function Mono({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        flex: "none",
        fontFamily: NEBULA_MONO,
        fontSize: 11,
        color: theme.palette.nebula.dim,
      })}
    >
      {children}
    </Box>
  );
}

/** The 5px status light: wired, gated, at fault. */
function Dot({ tone }: Readonly<{ tone: "ok" | "warn" }>) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        flex: "none",
        width: "5px",
        height: "5px",
        borderRadius: "50%",
        background: tone === "ok" ? theme.palette.nebula.ok : theme.palette.nebula.warn,
      })}
    />
  );
}

/**
 * A numbered pip: which usage of its input this is.
 *
 * The same number in every place a usage appears - the artboard tag, the layer
 * row, the dock chip, the inspector's stepper and the overlay - because that
 * number is the only handle an operator has on "the second one".
 */
function Count({ tone, children }: Readonly<{ tone: "ok" | "accent" | "quiet"; children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      sx={(theme) => {
        const colour = tone === "ok" ? theme.palette.nebula.ok : theme.palette.nebula.accent;
        return {
          flex: "none",
          display: "inline-grid",
          placeItems: "center",
          minWidth: "14px",
          height: "14px",
          px: "3px",
          borderRadius: "999px",
          background: tone === "quiet" ? alpha(colour, 0.35) : colour,
          color: tone === "quiet" ? theme.palette.nebula.text : theme.palette.nebula.onAccent,
          fontFamily: NEBULA_MONO,
          fontSize: 8.5,
          fontWeight: 600,
          lineHeight: 1,
        };
      }}
    >
      {children}
    </Box>
  );
}

/** A tinted chip, for the one or two words that qualify a row. */
function Badge({ tone, children }: Readonly<{ tone: "ok" | "accent"; children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      sx={(theme) => {
        const colour = tone === "ok" ? theme.palette.nebula.ok : theme.palette.nebula.accent;
        return {
          flex: "none",
          px: "6px",
          py: "1px",
          borderRadius: radius("sm"),
          background: alpha(colour, 0.16),
          color: colour,
          fontFamily: NEBULA_MONO,
          fontSize: 9,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        };
      }}
    >
      {children}
    </Box>
  );
}

/** The little square that stands in for a kind: `Aa`, `H1`, `¶`. */
function Glyph({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        flex: "none",
        display: "inline-grid",
        placeItems: "center",
        width: "22px",
        height: "20px",
        borderRadius: radius("sm"),
        background: theme.palette.nebula.accentSoft,
        color: theme.palette.nebula.accent,
        fontFamily: NEBULA_MONO,
        fontSize: 9.5,
        fontWeight: 600,
      })}
    >
      {children}
    </Box>
  );
}

/** One end of the zoom control. */
function Step({
  label,
  onClick,
  children,
}: Readonly<{ label: string; onClick: () => void; children: React.ReactNode }>) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        display: "grid",
        placeItems: "center",
        width: "24px",
        height: "22px",
        cursor: "pointer",
        borderRadius: radius("sm"),
        fontSize: 13,
        color: theme.palette.nebula.muted,
        "&:hover": { background: theme.palette.nebula.hover, color: theme.palette.nebula.text },
      })}
    >
      {children}
    </Box>
  );
}

/** A bordered group in the inspector: one heading, one set of fields. */
function Group({ label, children, aside }: Readonly<{ label: string; children: React.ReactNode; aside?: React.ReactNode }>) {
  return (
    <Box
      sx={(theme) => ({
        p: "12px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ mb: "9px" }}>
        <Kicker>{label}</Kicker>
        {aside}
      </Stack>
      {children}
    </Box>
  );
}

/**
 * The little picture on a palette tile.
 *
 * Drawn rather than typed, for the ones a symbol cannot say: a divider *is* a
 * line, a button is a filled bar and a ghost button is the same bar outlined,
 * and no glyph in any font distinguishes those two. The rest keep a mono
 * character, because `H1` and `¶` are already the notation people know.
 *
 * Sized against a 20x14 box so the whole palette lines up, and coloured from
 * the theme rather than the mock's greys so it survives the light scheme.
 */
function PaletteMark({ item }: Readonly<{ item: PaletteItem }>) {
  const glyph = (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({ fontFamily: NEBULA_MONO, fontSize: 13, lineHeight: 1, color: theme.palette.nebula.dim })}
    >
      {item.glyph}
    </Box>
  );

  switch (item.id) {
    case "divider":
      return <Box aria-hidden sx={(theme) => ({ width: "20px", height: "1px", background: theme.palette.nebula.dim })} />;
    case "spacer":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({
            width: "20px",
            height: "12px",
            borderTop: `1px dashed ${theme.palette.nebula.dim}`,
            borderBottom: `1px dashed ${theme.palette.nebula.dim}`,
          })}
        />
      );
    case "columns":
      return (
        <Box aria-hidden sx={{ display: "flex", gap: "2px" }}>
          {[0, 1].map((n) => (
            <Box
              key={n}
              sx={(theme) => ({
                width: "8px",
                height: "14px",
                borderRadius: "2px",
                border: `1px solid ${theme.palette.nebula.dim}`,
              })}
            />
          ))}
        </Box>
      );
    case "table":
      return (
        <Box
          aria-hidden
          sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", width: "18px", height: "14px" }}
        >
          {[0, 1, 2, 3].map((n) => (
            <Box
              key={n}
              sx={(theme) => ({
                background: n % 3 === 0 ? theme.palette.nebula.dim : theme.palette.nebula.line2,
              })}
            />
          ))}
        </Box>
      );
    case "notice":
      return (
        <Box
          aria-hidden
          sx={{
            width: "20px",
            height: "14px",
            borderLeft: `3px solid ${NOTICE_STYLE.warning.rule}`,
            background: NOTICE_STYLE.warning.wash,
          }}
        />
      );
    case "panel":
      return (
        <Box aria-hidden sx={{ width: "20px", height: "14px", borderRadius: "2px", background: "#3399dd" }} />
      );
    case "html":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({
            fontFamily: NEBULA_MONO,
            fontSize: 10,
            color: theme.palette.nebula.accent,
          })}
        >
          {"<>"}
        </Box>
      );
    case "callout":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({
            width: "20px",
            height: "14px",
            borderLeft: `3px solid ${theme.palette.nebula.dim}`,
            background: theme.palette.nebula.card2,
          })}
        />
      );
    case "card":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({
            width: "20px",
            height: "14px",
            borderRadius: "3px",
            border: `1px solid ${theme.palette.nebula.dim}`,
            background: theme.palette.nebula.card2,
          })}
        />
      );
    case "image":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({
            width: "20px",
            height: "14px",
            borderRadius: "2px",
            border: `1px solid ${theme.palette.nebula.dim}`,
          })}
        />
      );
    case "button":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({ width: "20px", height: "11px", borderRadius: "3px", background: theme.palette.nebula.accent })}
        />
      );
    case "ghost":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({
            width: "20px",
            height: "11px",
            borderRadius: "3px",
            border: `1px solid ${theme.palette.nebula.accent}`,
          })}
        />
      );
    case "slot":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({
            display: "grid",
            placeItems: "center",
            width: "22px",
            height: "16px",
            borderRadius: "4px",
            background: theme.palette.nebula.accentSoft,
            color: theme.palette.nebula.accent,
            fontFamily: NEBULA_MONO,
            fontSize: 9,
            fontWeight: 600,
          })}
        >
          Aa
        </Box>
      );
    case "toggles":
      return (
        <Box
          aria-hidden
          sx={(theme) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            width: "16px",
            height: "10px",
            p: "1px",
            borderRadius: "5px",
            background: theme.palette.nebula.ok,
          })}
        >
          <Box sx={(theme) => ({ width: "8px", height: "8px", borderRadius: "50%", background: theme.palette.nebula.card })} />
        </Box>
      );
    default:
      return glyph;
  }
}

/**
 * Which mark stands for a block, in the palette and in the layer list.
 *
 * Read off the palette entry it came from, so a tile picked from the palette is
 * recognisable in the list a second later without reading either label - and
 * there is one place a mark is chosen rather than two that can disagree.
 */
const glyphOf = (block: Block): string => paletteOf(block).glyph;

/**
 * A selection's eight marks, and which of them actually move an edge.
 *
 * Three are live - east for the width, south for the height, and the corner for
 * both - and the rest are drawn because a selection with handles on one side
 * reads as half-selected. The dead ones carry no cursor and no handler, so
 * nothing invites a drag that would do nothing.
 */
const HANDLES: readonly {
  id: string;
  edge: string;
  mode?: "resize-e" | "resize-s" | "resize-se";
  cursor?: string;
  place: Record<string, string>;
}[] = [
  { id: "nw", edge: "top left", place: { left: "-4px", top: "-4px" } },
  { id: "n", edge: "top", place: { left: "50%", top: "-4px", marginLeft: "-4px" } },
  { id: "ne", edge: "top right", place: { right: "-4px", top: "-4px" } },
  { id: "w", edge: "left", place: { left: "-4px", top: "50%", marginTop: "-4px" } },
  {
    id: "e",
    edge: "right",
    mode: "resize-e",
    cursor: "ew-resize",
    place: { right: "-4px", top: "50%", marginTop: "-4px" },
  },
  { id: "sw", edge: "bottom left", place: { left: "-4px", bottom: "-4px" } },
  {
    id: "s",
    edge: "bottom",
    mode: "resize-s",
    cursor: "ns-resize",
    place: { left: "50%", bottom: "-4px", marginLeft: "-4px" },
  },
  {
    id: "se",
    edge: "bottom right",
    mode: "resize-se",
    cursor: "nwse-resize",
    place: { right: "-4px", bottom: "-4px" },
  },
];

/** A choice of two or three, as one rounded well. The properties panel's own. *//** A choice of two or three, as one divided box. The properties panel's own. */
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
      gap={0.25}
      sx={(theme) => ({
        width: "100%",
        boxSizing: "border-box",
        p: "3px",
        borderRadius: radius("sm"),
        background: theme.palette.nebula.bg0,
        border: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      {options.map((option) => {
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
              py: "5px",
              cursor: "pointer",
              fontSize: 11.5,
              borderRadius: radius("sm"),
              color: on ? theme.palette.nebula.onAccent : theme.palette.nebula.muted,
              background: on ? theme.palette.nebula.accent : "transparent",
              "&:hover": on ? {} : { background: theme.palette.nebula.hover, color: theme.palette.nebula.text },
            })}
          >
            {option.label}
          </Box>
        );
      })}
    </Stack>
  );
}

/**
 * A role, as this operator's own theme paints it.
 *
 * The editor has to draw *something*, and the honest something is the colour
 * the person designing would see if they were reading the greeting. That is
 * also the most useful something: it is their theme, so it is the one they can
 * judge - and the chip beside it says out loud that everybody else gets their
 * own.
 */
function useResolved(): (colour: string | undefined) => string | undefined {
  const { nebula } = useTheme().palette;
  return (colour) => {
    if (colour === undefined) return undefined;
    if (!isAuto(colour)) return colour;
    switch (colour) {
      case "auto:accent":
        return nebula.accent;
      case "auto:onAccent":
        return nebula.onAccent;
      case "auto:surface":
        return opaque(nebula.card, nebula.bg0);
      case "auto:muted":
        return nebula.muted;
      default:
        return nebula.text;
    }
  };
}

/**
 * A colour, picked from a short list.
 *
 * Built to sit beside `Choice` rather than beside the rich-text editor's
 * swatch popover: the same inset well, the same border, the same accent on
 * the chosen one. A popover would be the third floating surface in a panel
 * that is already a floating surface, and this fits in a row.
 *
 * The first entry is always "none", and it is not decoration. A block with no
 * colour of its own is drawn in the reader's - which on a client whose theme
 * this editor knows nothing about is the only choice that is right for
 * everybody, and so the one worth being able to get back to.
 */
function Swatches({
  value,
  options,
  auto,
  none,
  onChange,
}: Readonly<{
  value: string | undefined;
  options: readonly { readonly label: string; readonly colour: string }[];
  /** The roles offered before the fixed colours, and what each is called. */
  auto: readonly AutoColourId[];
  /** What "no colour of its own" is called here. */
  none: string;
  onChange: (colour: string | undefined) => void;
}>) {
  const resolve = useResolved();
  return (
    <Stack
      direction="row"
      gap={0.5}
      sx={(theme) => ({
        flexWrap: "wrap",
        width: "100%",
        boxSizing: "border-box",
        p: "5px",
        borderRadius: radius("sm"),
        background: theme.palette.nebula.bg0,
        border: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      <Box
        component="button"
        type="button"
        title={none}
        aria-label={none}
        aria-pressed={value === undefined}
        onClick={() => onChange(undefined)}
        sx={(theme) => ({
          all: "unset",
          cursor: "pointer",
          width: 22,
          height: 22,
          borderRadius: radius("sm"),
          background: theme.palette.nebula.card,
          // A rule through it, which is what "none" looks like everywhere.
          backgroundImage: `linear-gradient(45deg, transparent 45%, ${theme.palette.nebula.dim} 45%, ${theme.palette.nebula.dim} 55%, transparent 55%)`,
          boxShadow:
            value === undefined
              ? `0 0 0 2px ${theme.palette.nebula.accent}`
              : `inset 0 0 0 1px ${theme.palette.nebula.line2}`,
        })}
      />
      {auto.map((id) => {
        const on = value === id;
        const shown = resolve(id) ?? AUTO_COLOURS[id].fallback;
        return (
          <Box
            key={id}
            component="button"
            type="button"
            title={`${AUTO_COLOURS[id].label} — follows each reader's own theme`}
            aria-label={`${AUTO_COLOURS[id].label}, automatic`}
            aria-pressed={on}
            onClick={() => onChange(id)}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              width: 22,
              height: 22,
              borderRadius: radius("sm"),
              background: shown,
              // Ringed differently from a fixed colour, because it is a
              // different kind of thing: this one changes per reader.
              boxShadow: on
                ? `0 0 0 2px ${theme.palette.nebula.accent}`
                : `inset 0 0 0 1px ${theme.palette.nebula.accentLine}`,
              outline: `1px dashed ${theme.palette.nebula.accentLine}`,
              outlineOffset: 1,
            })}
          />
        );
      })}
      {/* The rule between "whatever the reader's theme says" and "this exact
          colour, for everybody". */}
      {auto.length > 0 && (
        <Box
          aria-hidden
          sx={(theme) => ({ width: "1px", alignSelf: "stretch", background: theme.palette.nebula.line2 })}
        />
      )}
      {options.map((swatch) => {
        const on = value === swatch.colour;
        return (
          <Box
            key={swatch.colour}
            component="button"
            type="button"
            title={swatch.label}
            aria-label={swatch.label}
            aria-pressed={on}
            onClick={() => onChange(swatch.colour)}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              width: 22,
              height: 22,
              borderRadius: radius("sm"),
              background: swatch.colour,
              boxShadow: on
                ? `0 0 0 2px ${theme.palette.nebula.accent}`
                : `inset 0 0 0 1px ${theme.palette.nebula.line2}`,
            })}
          />
        );
      })}
    </Stack>
  );
}

/** A bordered field, which is what every input in this panel is. */
/**
 * Who is online, as the editor can draw it.
 *
 * The one block whose value is not known at save time: `compile.ts` emits a
 * `fm-presence` marker and the reading client swaps in a live component (see
 * `presenceMarkup`). So this is a stand-in, and it says so by drawing example
 * discs rather than anybody in particular - what the operator is placing is
 * the shape and the words, which are the only parts they choose.
 *
 * `faces` is where drawing stops and counting starts, so the preview shows
 * that many discs and then the same "+n" the live component would.
 */
function PresenceMark({
  block,
  align,
  size,
}: Readonly<{ block: Block; align: "left" | "center" | "right"; size: number }>) {
  const faces = Math.max(0, Math.min(8, Math.round(block.faces ?? 3)));
  const words = (block.text ?? "").trim() || "online";
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={0.75}
      sx={{
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ pl: faces > 0 ? "6px" : 0 }}>
        {Array.from({ length: faces }, (_, n) => (
          <Box
            key={n}
            sx={(theme) => ({
              width: size + 4,
              height: size + 4,
              ml: "-6px",
              borderRadius: "50%",
              background: theme.palette.nebula.card2,
              border: `1px solid ${theme.palette.nebula.line2}`,
            })}
          />
        ))}
      </Stack>
      <Box component="span" sx={{ fontSize: size }}>
        {faces > 0 ? `+12 ${words}` : words}
      </Box>
    </Stack>
  );
}

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
        borderRadius: radius("sm"),
        "&:focus-within": { borderColor: theme.palette.nebula.accent },
      })}
    >
      {children}
    </Box>
  );
}

/**
 * What the toolbar offers a text block.
 *
 * Body copy, so the marks and lists and nothing else. Three of the field's
 * buttons are deliberately missing:
 *
 * * **Heading** - a heading is its own block here, with its own size and its
 *   own place on the sheet. One typed inside a paragraph would be a second way
 *   to say the same thing, drawn differently on every target.
 * * **Align** - the block is aligned, from the properties panel, and the design
 *   compiles that onto the cell it sits in. A paragraph aligned inside a block
 *   aligned the other way is a fight nobody can see the two halves of.
 * * **Image** - the same reason a message body offers none: a picture is a
 *   data: URL several times the body cap, paid on every join.
 */
const TEXT_TOOLS: readonly RichTextTool[] = ["bold", "italic", "underline", "strike", "lists", "colour"];

/**
 * What a layer row is called.
 *
 * Its words where it has any, its kind where it has none - which is how a
 * layer list is read: `Welcome aboard` finds the heading, and `Heading` would
 * only find it among the other headings. A text block holds markup, and
 * `<p>Welcome` in a one-line row is the tags rather than the words, so it is
 * flattened first.
 */
function layerLabel(block: Block): string {
  if (block.type === "slot" || block.type === "repeater") {
    return `${BLOCK_LABELS[block.type]} · ${block.slot || "unbound"}`;
  }
  // Through `readableText` so an inline usage reads as `$name` rather than as
  // the braces around it - the row is meant to say what the block says.
  const words = readableText(block);
  const text = block.type === "text" ? plainTextOf(richBody(words)).replaceAll("\n", " ") : words;
  return text.trim() || BLOCK_LABELS[block.type];
}

/**
 * What a block looks like on the sheet. Not the final rendering — the shape.
 *
 * `chrome` is what separates designing from previewing: a slot is a labelled
 * placeholder while the design is being built and simply the space it will
 * occupy once the editor's marks are taken off.
 */
function Preview({
  block,
  flat,
  target,
  chrome = true,
  usages = [],
  onHide,
  resolve,
  assets,
}: Readonly<{
  block: Block;
  flat: boolean;
  target: Target;
  /** The design's own pictures, so a block drawing one can find it. */
  assets?: readonly DesignAsset[];
  chrome?: boolean;
  /** Preview only: what an input reads as. */
  resolve?: (name: string, fallback?: string) => string;
  /** This block's own usages, for the chips drawn inside its copy. */
  usages?: readonly Usage[];
  onHide?: (usage: Usage) => void;
}>) {
  const align = flat ? "left" : (block.align ?? "left");
  const size = flat ? 13 : (block.size ?? 14);
  const assetSrc = assets?.find((entry) => entry.id === block.asset)?.src;
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
      // The plain tab is the one place the markup is *not* what a reader gets,
      // so it is not what the sheet shows: that target is sent the flattened
      // text, and seeing the paragraphs and bullets it collapses to is the
      // point of standing on that tab.
      // The plain tab is the one place the markup is *not* what a reader gets,
      // so it is not what the sheet shows: that target is sent the flattened
      // text, and seeing the paragraphs and bullets it collapses to is the
      // point of standing on that tab.
      return flat ? (
        <Typography sx={(theme) => ({ fontSize: size, whiteSpace: "pre-line", color: theme.palette.nebula.muted })}>
          {plainTextOf(richBody(withoutSlotTokens(block.text ?? "", (name) => resolve?.(name) ?? `$${name}`)))}
        </Typography>
      ) : (
        <Box
          sx={(theme) => ({
            fontSize: size,
            textAlign: align,
            color: theme.palette.nebula.muted,
            // Tiptap's own margins are a document's, and a block on a sheet is
            // positioned by the operator: the first paragraph has to start
            // where the block starts, or every text block sits a line below
            // where it was dragged.
            "& > :first-of-type": { marginTop: 0 },
            "& > :last-child": { marginBottom: 0 },
            "& ul, & ol": { paddingLeft: "1.4em" },
          })}
        >
          <Copy
            text={block.text ?? ""}
            rich
            usages={usages}
            onHide={onHide}
            chrome={chrome}
            resolve={resolve}
          />
        </Box>
      );
    case "divider":
      return <Box sx={(theme) => ({ height: "1px", background: theme.palette.nebula.line2 })} />;
    case "html":
      // Rendered rather than shown as source: the sheet is what the message
      // looks like, and a block of escaped angle brackets on it would be a
      // preview of the wrong thing. Through the same allow-list the reader
      // filters it through, so what is drawn here is what survives.
      return (
        <Box
          sx={{ fontSize: size, textAlign: align, "& > *:first-of-type": { marginTop: 0 } }}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.text ?? "") }}
        />
      );
    case "panel":
      // Just its words: the fill is drawn by the wrapper, which is where the
      // compiler puts it as well.
      return (
        <Box sx={{ fontSize: size, textAlign: align }}>
          <Copy text={block.text ?? ""} rich usages={usages} onHide={onHide} chrome={chrome} resolve={resolve} />
        </Box>
      );
    case "notice": {
      const paint = NOTICE_STYLE[block.tone ?? "info"];
      return (
        <Box sx={{ display: "flex", background: paint.wash, borderLeft: `4px solid ${paint.rule}` }}>
          <Box
            aria-hidden
            sx={{
              flex: "none",
              width: 26,
              pt: "7px",
              textAlign: "center",
              fontWeight: 700,
              fontSize: size,
              color: paint.rule,
            }}
          >
            {paint.mark}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, px: "8px", py: "6px", fontSize: size, color: paint.ink }}>
            <Copy text={block.text ?? ""} rich usages={usages} onHide={onHide} chrome={chrome} resolve={resolve} />
          </Box>
        </Box>
      );
    }
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
          <Copy text={block.text ?? ""} rich usages={usages} onHide={onHide} chrome={chrome} resolve={resolve} />
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
      // Without the editor's marks a slot is only the space its value will
      // take, so that is all it draws.
      if (chrome && block.hidden) {
        return (
          <Stack
            direction="row"
            alignItems="center"
            gap={1}
            sx={(theme) => ({
              minHeight: "26px",
              px: "12px",
              borderRadius: radius("sm"),
              border: `1px dashed ${theme.palette.nebula.accentLine}`,
              background: alpha(theme.palette.nebula.accent, 0.04),
              fontFamily: NEBULA_MONO,
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: theme.palette.nebula.dim,
            })}
          >
            hidden · ${block.slot}
          </Stack>
        );
      }
      return chrome ? (
        <Stack
          direction="row"
          alignItems="center"
          gap={1.1}
          sx={(theme) => ({
            minHeight: "44px",
            px: "12px",
            borderRadius: radius("sm"),
            border: `1px solid ${theme.palette.nebula.accentLine}`,
            background: theme.palette.nebula.accentSoft,
          })}
        >
          <Glyph>Aa</Glyph>
          <Box
            component="span"
            sx={(theme) => ({
              fontFamily: NEBULA_MONO,
              fontSize: 12,
              color: theme.palette.nebula.accent,
            })}
          >
            ${block.slot || "not chosen"}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Hint>value at send time</Hint>
        </Stack>
      ) : (
        <Typography sx={{ fontSize: size, textAlign: align }}>
          {block.hidden || !block.slot ? "" : resolve?.(block.slot, block.fallback)}
        </Typography>
      );
    case "quote":
      return (
        <Box
          sx={(theme) => ({
            pl: "12px",
            borderLeft: `3px solid ${theme.palette.nebula.line2}`,
            fontSize: size,
            fontStyle: "italic",
            textAlign: align,
            color: theme.palette.nebula.muted,
          })}
        >
          <Copy text={block.text ?? ""} rich usages={usages} onHide={onHide} chrome={chrome} resolve={resolve} />
        </Box>
      );
    case "code":
      return (
        <Box
          sx={(theme) => ({
            px: "10px",
            py: "8px",
            borderRadius: radius("sm"),
            background: theme.palette.nebula.card2,
            fontFamily: NEBULA_MONO,
            fontSize: size,
            whiteSpace: "pre-wrap",
            color: theme.palette.nebula.text,
          })}
        >
          {block.text}
        </Box>
      );
    case "list":
      return (
        <Stack gap={0.4} sx={{ textAlign: align }}>
          {(block.lines ?? []).map((line, index) => (
            <Stack key={index} direction="row" gap={1}>
              <Box component="span" aria-hidden sx={(theme) => ({ color: theme.palette.nebula.dim })}>
                •
              </Box>
              <Box component="span" sx={(theme) => ({ fontSize: size, color: theme.palette.nebula.muted })}>
                {line}
              </Box>
            </Stack>
          ))}
        </Stack>
      );
    case "presence":
      // The real component, on the artboard. An operator laying out a cluster
      // needs to see the size it actually is, and a drawn placeholder would be
      // the wrong width the moment anybody was online - which is the whole
      // class of mistake this block exists to stop making by hand.
      return <OnlineNow label={block.text} faces={block.faces} height={block.h ?? 34} />;
    case "group":
      // A group holds blocks that are drawn *beside* it on the sheet rather
      // than inside it in the DOM - it is nested by geometry, so the sheet is
      // already showing the nesting and a second copy of the children here
      // would draw each of them twice.
      //
      // What it draws is therefore only itself: the box, at the height it was
      // given, with its flow named while the editor chrome is on so an
      // operator can tell a stack from a row without selecting it.
      return (
        <Box
          sx={(theme) => ({
            height: block.h ?? 80,
            display: "grid",
            placeItems: "start",
            fontFamily: NEBULA_MONO,
            fontSize: 9,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: theme.palette.nebula.dim,
            // Only when nothing has been given a shape of its own: a group
            // that has a fill or a rule is already visible, and a dashed
            // outline over the top of it is chrome drawn onto the design.
            ...(block.bg === undefined && block.border === undefined && block.grad === undefined
              ? { outline: `1px dashed ${theme.palette.nebula.line2}`, outlineOffset: -1 }
              : {}),
          })}
        >
          {/* Named only where there is nothing else to see. A group with a
            fill, a rule or a wash is already visible, and a word printed on
            top of it is chrome drawn into the design. */}
          {chrome && block.bg === undefined && block.border === undefined && block.grad === undefined
            ? (block.flow ?? "stack")
            : ""}
        </Box>
      );
    case "spacer":
      return (
        <Box
          sx={(theme) => ({
            height: block.h ?? 24,
            display: "grid",
            placeItems: "center",
            border: `1px dashed ${theme.palette.nebula.line2}`,
            borderLeft: "none",
            borderRight: "none",
            fontFamily: NEBULA_MONO,
            fontSize: 9.5,
            color: theme.palette.nebula.dim,
          })}
        >
          {chrome ? `${block.h ?? 24}px` : ""}
        </Box>
      );
    case "columns":
      return (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(1, (block.items ?? []).length)}, minmax(0, 1fr))`,
            gap: "8px",
          }}
        >
          {(block.items ?? []).map((item, index) => (
            <Box
              key={index}
              sx={(theme) => ({
                px: "9px",
                py: "7px",
                borderRadius: radius("sm"),
                border: `1px solid ${theme.palette.nebula.line2}`,
              })}
            >
              <Typography
                sx={(theme) => ({ fontSize: 9, letterSpacing: "0.12em", color: theme.palette.nebula.dim })}
              >
                {item.kicker.toUpperCase()}
              </Typography>
              <Typography sx={(theme) => ({ fontSize: size, color: theme.palette.nebula.muted })}>
                {item.label}
              </Typography>
            </Box>
          ))}
        </Box>
      );
    case "table":
      return (
        <Box sx={(theme) => ({ border: `1px solid ${theme.palette.nebula.line2}`, borderRadius: radius("sm") })}>
          {(block.rows ?? []).map((cells, row) => (
            <Box
              key={row}
              sx={(theme) => ({
                display: "grid",
                gridTemplateColumns: `repeat(${Math.max(1, cells.length)}, minmax(0, 1fr))`,
                borderTop: row === 0 ? "none" : `1px solid ${theme.palette.nebula.line}`,
              })}
            >
              {cells.map((cell, column) => (
                <Box
                  key={column}
                  sx={(theme) => ({
                    px: "8px",
                    py: "5px",
                    fontSize: size - 1,
                    fontWeight: row === 0 ? 700 : 400,
                    color: row === 0 ? theme.palette.nebula.text : theme.palette.nebula.muted,
                    borderLeft: column === 0 ? "none" : `1px solid ${theme.palette.nebula.line}`,
                  })}
                >
                  {cell}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      );
    case "card":
      return (
        <Box
          sx={(theme) => ({
            px: "12px",
            py: "10px",
            borderRadius: radius("md"),
            border: `1px solid ${theme.palette.nebula.line2}`,
            background: theme.palette.nebula.card,
            fontSize: size,
            textAlign: align,
            color: theme.palette.nebula.muted,
          })}
        >
          <Copy text={block.text ?? ""} rich usages={usages} onHide={onHide} chrome={chrome} resolve={resolve} />
        </Box>
      );
    case "footer":
      return (
        <Typography sx={(theme) => ({ fontSize: size, textAlign: align, color: theme.palette.nebula.dim })}>
          <Copy text={block.text ?? ""} rich usages={usages} onHide={onHide} chrome={chrome} resolve={resolve} />
        </Typography>
      );
    case "social":
      return (
        <Stack direction="row" gap={1} sx={{ justifyContent: align === "center" ? "center" : "flex-start" }}>
          {(block.items ?? []).map((item, index) => (
            <Box
              key={index}
              sx={(theme) => ({
                px: "9px",
                py: "5px",
                borderRadius: radius("sm"),
                border: `1px solid ${theme.palette.nebula.line2}`,
                fontSize: size - 1,
                color: theme.palette.nebula.accent,
              })}
            >
              {item.label}
            </Box>
          ))}
        </Stack>
      );
    case "video":
      return (
        <Box
          sx={(theme) => ({
            height: block.h ?? 135,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            borderRadius: radius("sm"),
            border: `1px solid ${theme.palette.nebula.line2}`,
            background: theme.palette.nebula.card2,
            color: theme.palette.nebula.dim,
            fontSize: 10.5,
          })}
        >
          <Box component="span" aria-hidden sx={{ fontSize: 20 }}>
            ▶
          </Box>
          {block.text || "video"}
        </Box>
      );
    case "presence":
      return <PresenceMark block={block} align={align} size={size} />;
    case "qr":
      return <QrMark block={block} />;
    case "rating": {
      const filled = Math.max(0, Math.min(5, Math.round(block.stars ?? 5)));
      return (
        <Stack
          direction="row"
          gap={0.5}
          sx={{ justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start" }}
        >
          {[0, 1, 2, 3, 4].map((n) => (
            <Box
              key={n}
              component="span"
              sx={(theme) => ({
                fontSize: size + 4,
                lineHeight: 1,
                color: n < filled ? theme.palette.nebula.accent : theme.palette.nebula.line2,
              })}
            >
              {n < filled ? "★" : "☆"}
            </Box>
          ))}
        </Stack>
      );
    }
    case "countdown":
      return <Countdown block={block} align={align} size={size} chrome={chrome} />;
    case "toggles":
      // Each branch with the condition that switches it on, because that
      // pairing is the whole block and neither half reads alone.
      return (
        <Stack gap={0.6}>
          {(block.items ?? []).length === 0 && chrome && (
            <Box
              sx={(theme) => ({
                px: "10px",
                py: "9px",
                borderRadius: radius("sm"),
                border: `1px dashed ${theme.palette.nebula.line2}`,
                fontSize: 11,
                color: theme.palette.nebula.dim,
              })}
            >
              No branches yet
            </Box>
          )}
          {(block.items ?? []).map((item, index) => (
            <Stack key={index} direction="row" alignItems="center" gap={1}>
              {chrome && <Badge tone="ok">if {item.kicker || "—"}</Badge>}
              <Box component="span" sx={(theme) => ({ fontSize: size, color: theme.palette.nebula.muted })}>
                {item.label}
              </Box>
            </Stack>
          ))}
        </Stack>
      );
    case "ab":
      return (
        <Stack gap={0.6}>
          {(
            [
              ["A", block.text, false],
              ["B", block.altText, true],
            ] as const
          ).map(([which, copy, alt]) => (
            <Stack key={which} direction="row" alignItems="flex-start" gap={1}>
              {chrome && <Badge tone={alt ? "accent" : "ok"}>{which}</Badge>}
              <Box
                component="span"
                sx={(theme) => ({
                  fontSize: size,
                  color: alt ? theme.palette.nebula.dim : theme.palette.nebula.muted,
                })}
              >
                {copy}
              </Box>
            </Stack>
          ))}
        </Stack>
      );
    case "repeater":
      return (
        <Stack
          direction="row"
          alignItems="center"
          gap={1.1}
          sx={(theme) => ({
            minHeight: "40px",
            px: "12px",
            borderRadius: radius("sm"),
            border: `1px dashed ${theme.palette.nebula.accentLine}`,
            background: theme.palette.nebula.accentSoft,
          })}
        >
          <Glyph>⧉</Glyph>
          <Box component="span" sx={(theme) => ({ fontFamily: NEBULA_MONO, fontSize: 12, color: theme.palette.nebula.accent })}>
            ${block.slot || "not chosen"}
          </Box>
          <Box sx={{ flex: 1 }} />
          {chrome && <Hint>one block per line of the value</Hint>}
        </Stack>
      );
    case "image":
      // The picture itself, at the size it will be sent. This used to be a
      // dashed box saying "server artwork", from when an image meant the
      // server's livery and the compiler could not reach it; a design carries
      // its own picture now, and a sheet that draws a placeholder where the
      // message has a picture is a sheet nobody can lay anything out against.
      return block.asset !== undefined || block.src ? (
        <Box
          component="img"
          src={assetSrc ?? block.src}
          alt=""
          sx={{ width: block.w, height: block.h, display: "block" }}
        />
      ) : (
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
          no picture yet
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

/**
 * A block's copy, with any inline usage drawn as the chip it is.
 *
 * Shared, because a `{{name}}` left as four literal braces in the middle of a
 * callout is the same bug as it was in a paragraph. `rich` is the one thing
 * that differs: a text block's runs are markup and go through the sanitiser, a
 * callout's are words.
 */
function Copy({
  text,
  rich,
  usages,
  onHide,
  chrome,
  resolve,
}: Readonly<{
  text: string;
  rich: boolean;
  usages: readonly Usage[];
  onHide?: (usage: Usage) => void;
  chrome: boolean;
  resolve?: (name: string, fallback?: string) => string;
}>) {
  if (!chrome || !text.includes("{{")) {
    // Preview reads the tokens away into what they will say; a hidden usage
    // reads away into nothing, which is what hiding one means.
    const plain = chrome ? text : withoutSlotTokens(text, (name) => resolve?.(name) ?? "");
    return rich ? (
      <Box dangerouslySetInnerHTML={{ __html: sanitizeHtml(richBody(plain)) }} />
    ) : (
      <>{plain}</>
    );
  }

  let seen = -1;
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
      {splitInlineSlots(text).map((piece, index) => {
        if ("slot" in piece) {
          seen += 1;
          const at = seen;
          return (
            <InlineSlot
              key={`s${index}`}
              name={piece.slot}
              hidden={piece.hidden}
              usage={usages.find((entry) => entry.kind === "inline" && entry.at === at)}
              onHide={onHide}
            />
          );
        }
        return rich ? (
          <Box
            key={`l${index}`}
            component="span"
            sx={{ "& > *": { display: "inline" }, "& p": { margin: 0 } }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(richBody(piece.literal)) }}
          />
        ) : (
          <Box key={`l${index}`} component="span">
            {piece.literal}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * A countdown, drawn as the units it is counting down.
 *
 * The editor shows how far off the date is *now*, because that is what an
 * operator is checking when they set it. The message cannot: a greeting is
 * assembled at handshake and then sits in a scrollback, so what it carries is
 * the date. The note under the boxes says so rather than leaving somebody to
 * find out from a reader.
 */
function Countdown({
  block,
  align,
  size,
  chrome,
}: Readonly<{ block: Block; align: "left" | "center" | "right"; size: number; chrome: boolean }>) {
  const target = block.until ? new Date(`${block.until}T00:00:00Z`) : null;
  const valid = target !== null && !Number.isNaN(target.getTime());
  const left = valid ? Math.max(0, target.getTime() - Date.now()) : 0;
  const units = [
    { label: "days", value: Math.floor(left / 86_400_000) },
    { label: "hrs", value: Math.floor(left / 3_600_000) % 24 },
    { label: "min", value: Math.floor(left / 60_000) % 60 },
  ];
  const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  return (
    <Stack gap={0.75} sx={{ alignItems: justify }}>
      {block.text && (
        <Typography sx={(theme) => ({ fontSize: size - 1, color: theme.palette.nebula.muted })}>
          {block.text}
        </Typography>
      )}
      {valid ? (
        <Stack direction="row" gap={0.75}>
          {units.map((unit) => (
            <Stack
              key={unit.label}
              sx={(theme) => ({
                alignItems: "center",
                minWidth: "46px",
                px: "8px",
                py: "5px",
                borderRadius: radius("sm"),
                background: theme.palette.nebula.card2,
                border: `1px solid ${theme.palette.nebula.line2}`,
              })}
            >
              <Box
                component="span"
                sx={(theme) => ({
                  fontFamily: NEBULA_MONO,
                  fontSize: size + 4,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  color: theme.palette.nebula.text,
                })}
              >
                {String(unit.value).padStart(2, "0")}
              </Box>
              <Box component="span" sx={(theme) => ({ fontSize: 9, color: theme.palette.nebula.dim })}>
                {unit.label}
              </Box>
            </Stack>
          ))}
        </Stack>
      ) : (
        chrome && (
          <Box
            sx={(theme) => ({
              px: "10px",
              py: "8px",
              borderRadius: radius("sm"),
              border: `1px dashed ${theme.palette.nebula.line2}`,
              fontSize: 11,
              color: theme.palette.nebula.dim,
            })}
          >
            No date set
          </Box>
        )
      )}
      {chrome && valid && <Hint>the message carries the date, not a ticking clock</Hint>}
    </Stack>
  );
}

/**
 * A QR code's shape, standing in for the code itself.
 *
 * The real one is generated from the link when the message is built, so what
 * the sheet can show is how much room it takes and that it is a code rather
 * than a picture. Drawn from the link's own characters so two different links
 * do not look identical, which would read as a bug.
 */
function QrMark({ block }: Readonly<{ block: Block }>) {
  const side = block.h ?? 96;
  const seed = [...(block.url ?? "qr")].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const cells = 11;
  const finder = (row: number, column: number) =>
    (row < 3 && column < 3) || (row < 3 && column > cells - 4) || (row > cells - 4 && column < 3);

  return (
    <Box
      sx={(theme) => ({
        width: side,
        height: side,
        p: "6px",
        display: "grid",
        gridTemplateColumns: `repeat(${cells}, 1fr)`,
        gap: "1px",
        borderRadius: radius("sm"),
        background: theme.palette.nebula.card2,
        border: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      {Array.from({ length: cells * cells }, (_, index) => {
        const row = Math.floor(index / cells);
        const column = index % cells;
        const on = finder(row, column)
          ? !(row % 4 === 1 && column % 4 === 1)
          : (seed + row * 7 + column * 13) % 3 === 0;
        return (
          <Box
            key={index}
            sx={(theme) => ({ background: on ? theme.palette.nebula.muted : "transparent" })}
          />
        );
      })}
    </Box>
  );
}

/**
 * One inline usage, drawn inside the copy it sits in.
 *
 * Numbered and switchable in place, because an inline usage has no outline and
 * no handles of its own - the paragraph around it owns those - so the chip is
 * the only thing an operator can point at.
 */
function InlineSlot({
  name,
  hidden,
  usage,
  onHide,
}: Readonly<{ name: string; hidden: boolean; usage?: Usage; onHide?: (usage: Usage) => void }>) {
  const known = builtIn(name);
  return (
    <Box
      component="span"
      // A built-in says what it will actually read as; a declared input has
      // nothing to say yet, because nothing has been wired to it.
      title={known ? `${known.about} — e.g. ${known.sample}` : undefined}
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        px: "5px",
        py: "2px",
        borderRadius: radius("sm"),
        // Solid for a built-in, dashed for one of the operator's own: the
        // dashes mean "something still has to be wired here", and a built-in
        // never does.
        border: `1px ${known ? "solid" : "dashed"} ${theme.palette.nebula.accent}`,
        background: alpha(theme.palette.nebula.accent, 0.08),
        fontFamily: NEBULA_MONO,
        fontSize: 12,
        color: theme.palette.nebula.accent,
      })}
    >
      {usage && <Count tone="accent">{usage.index}</Count>}
      <Box component="span" sx={(theme) => ({ color: hidden ? theme.palette.nebula.dim : "inherit" })}>
        {hidden ? "hidden" : `$${name}`}
      </Box>
      {usage && onHide && (
        <Box
          component="button"
          type="button"
          title="Keep the usage, leave it out of the message"
          onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            onHide(usage);
          }}
          sx={(theme) => ({
            all: "unset",
            display: "inline-grid",
            placeItems: "center",
            width: "15px",
            height: "15px",
            borderRadius: "3px",
            cursor: "pointer",
            fontSize: 9,
            background: alpha(theme.palette.nebula.accent, 0.2),
            "&:hover": { background: alpha(theme.palette.nebula.accent, 0.4) },
          })}
        >
          ◉
        </Box>
      )}
    </Box>
  );
}

/**
 * The fields of whatever is selected, grouped by the question they answer.
 *
 * Grouped rather than listed, because the panel is read by jumping to a
 * heading: what it says, what it looks like, when it appears, where it sits.
 * A flat column of eight labelled fields makes every one of those a search.
 *
 * What is bound comes first, and carries its own wiring warning - an unfed slot
 * renders as nothing at send time, and the status bar at the far corner of the
 * editor is too far from the thing at fault to be the only place that says so.
 */
function Properties({
  design,
  block,
  wired,
  usages,
  stepped,
  onStep,
  onGo,
  onBrowse,
  onInsertInline,
  onSet,
  onPickPicture,
  onClearPicture,
  onPickBackdrop,
  onClearBackdrop,
  onArrange,
}: Readonly<{
  design: Design;
  block: Block;
  wired: ReadonlySet<string>;
  usages: readonly Usage[];
  /** Which sibling usage the stepper is pointing at. */
  stepped: number;
  onStep: (at: number) => void;
  onGo: (usage: Usage) => void;
  onBrowse: (input: string) => void;
  /** Put another inline usage of an input into this block's copy. */
  onInsertInline: (input: string) => void;
  onSet: <K extends keyof Block>(key: K, value: Block[K]) => void;
  /** A chosen picture, which lands on the design as well as on the block. */
  onPickPicture: (picked: Picked) => void;
  onClearPicture: () => void;
  /** The same, for the picture painted behind a block rather than in it. */
  onPickBackdrop: (picked: Picked) => void;
  onClearBackdrop: () => void;
  /** Move this block through the stack. Blocks overlap; this is which wins. */
  onArrange: (to: "front" | "forward" | "backward" | "back") => void;
}>) {
  const has = (field: keyof Block) => FIELDS[block.type].includes(field);
  const gated = !!block.gate;
  const bound = has("slot") ? block.slot : undefined;
  /** Everywhere the bound input is used, this block included. */
  const siblings = bound ? usages.filter((usage) => usage.input === bound) : [];
  const here = siblings.findIndex((usage) => usage.block === block.id);
  const at = Math.min(Math.max(stepped, 0), Math.max(0, siblings.length - 1));

  return (
    <Stack gap={1.5}>
      {has("slot") && (
        <Group
          label="Bound input"
          aside={
            bound && (
              <Stack direction="row" alignItems="center" gap={0.6}>
                <Dot tone={wired.has(bound) ? "ok" : "warn"} />
                <Box
                  component="span"
                  sx={(theme) => ({
                    fontSize: 10.5,
                    color: wired.has(bound) ? theme.palette.nebula.muted : theme.palette.nebula.warn,
                  })}
                >
                  {wired.has(bound) ? "wired" : "unwired"}
                </Box>
              </Stack>
            )
          }
        >
          <Picker
            value={block.slot ?? ""}
            options={[
              { id: "", label: "not chosen" },
              ...design.slots.map((input) => ({ id: input.name, label: input.name })),
            ]}
            onChange={(slot) => onSet("slot", slot)}
          />
          {/* The other places this input lands. Without this an operator
              changing a value has no way to know what else moves - and the
              answer, that all of them do, is the one thing they most need to
              be told before they change it. */}
          {siblings.length > 1 && (
            <Box
              sx={(theme) => ({
                mt: "9px",
                pt: "9px",
                borderTop: `1px solid ${theme.palette.nebula.line}`,
              })}
            >
              <Stack direction="row" alignItems="center" gap={0.9} sx={{ mb: "6px" }}>
                <Kicker>Other usages</Kicker>
                <Hint>{siblings.length - 1}</Hint>
                <Box sx={{ flex: 1 }} />
                <Step label="Previous usage" onClick={() => onStep(Math.max(0, at - 1))}>
                  ◀
                </Step>
                <Mono>
                  {at + 1}/{siblings.length}
                </Mono>
                <Step label="Next usage" onClick={() => onStep(Math.min(siblings.length - 1, at + 1))}>
                  ▶
                </Step>
              </Stack>
              <Stack gap={0.5}>
                {siblings.map((usage, index) => {
                  const current = index === here;
                  return (
                    <Box
                      key={usage.id}
                      component="button"
                      type="button"
                      onClick={() => onGo(usage)}
                      sx={(theme) => ({
                        all: "unset",
                        boxSizing: "border-box",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        height: "28px",
                        px: "8px",
                        cursor: "pointer",
                        borderRadius: radius("sm"),
                        background: current ? theme.palette.nebula.accentSoft : theme.palette.nebula.bg0,
                        boxShadow: current
                          ? `inset 0 0 0 1px ${theme.palette.nebula.accentLine}`
                          : `inset 0 0 0 1px ${theme.palette.nebula.line2}`,
                        "&:hover": { background: theme.palette.nebula.hover },
                      })}
                    >
                      <Count tone={current ? "accent" : "quiet"}>{usage.index}</Count>
                      <Box component="span" sx={{ flex: 1, minWidth: 0, fontSize: 11.5 }} >
                        {usage.label}
                      </Box>
                      <Box
                        component="span"
                        sx={(theme) => ({
                          fontSize: current ? 10 : 11,
                          color: current ? theme.palette.nebula.accent : theme.palette.nebula.dim,
                        })}
                      >
                        {current ? "editing" : "→"}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
              <Box sx={{ mt: "6px" }}>
                <Chrome label="Show all usages…" onClick={() => bound && onBrowse(bound)} />
              </Box>
              <Typography sx={(theme) => ({ mt: "7px", fontSize: 11, color: theme.palette.nebula.dim })}>
                Editing the input’s value changes every usage. Style stays per element.
              </Typography>
            </Box>
          )}
          {bound && !wired.has(bound) && (
            <Note>
              Nothing feeds <Code>{bound}</Code> yet — the slot renders empty. Wire it on the canvas
              behind this panel.
            </Note>
          )}
        </Group>
      )}

      {has("fallback") && (
        <Group label="Fallback text">
          <Boxed>
            <PlainInput
              value={block.fallback ?? ""}
              placeholder="Shown when empty…"
              ariaLabel="Fallback text"
              onChange={(text) => onSet("fallback", text)}
            />
          </Boxed>
          <Typography sx={(theme) => ({ mt: "8px", fontSize: 11, color: theme.palette.nebula.dim })}>
            Sent in the input’s place when nothing feeds it, instead of a hole in the message.
          </Typography>
        </Group>
      )}

      {(has("lines") || has("rows") || has("items") || has("altText")) && (
        <Group label={has("altText") ? "Variants" : "Rows"}>
          <Stack gap={1.25}>
            {/* One line each, edited as text. A repeater of little field
                groups is the tidier form and the slower one to actually use:
                these are lists of short strings, and typing them as lines is
                how somebody writes a list. */}
            {has("lines") && (
              <Field label="Items — one per line">
                <Boxed>
                  <PlainInput
                    value={(block.lines ?? []).join("\n")}
                    placeholder={"First thing\nSecond thing"}
                    ariaLabel="List items"
                    multiline
                    onChange={(text) => onSet("lines", text.split("\n"))}
                  />
                </Boxed>
              </Field>
            )}
            {has("rows") && (
              <Field label="Rows — cells split by |">
                <Boxed>
                  <PlainInput
                    value={(block.rows ?? []).map((row) => row.join(" | ")).join("\n")}
                    placeholder={"Channel | What it is for\nLobby | Anyone, any time"}
                    ariaLabel="Table rows"
                    multiline
                    onChange={(text) =>
                      onSet(
                        "rows",
                        text.split("\n").map((row) => row.split("|").map((cell) => cell.trim())),
                      )
                    }
                  />
                </Boxed>
              </Field>
            )}
            {has("items") && (
              <Field
                label={
                  block.type === "toggles" ? "Branches — toggle | what it says" : "Items — label | link"
                }
              >
                <Boxed>
                  <PlainInput
                    value={(block.items ?? [])
                      .map((item) => `${item.kicker} | ${item.label}`.trim())
                      .join("\n")}
                    placeholder={
                      block.type === "toggles"
                        ? "is_new_member | Welcome aboard"
                        : "Browse | Channel viewer"
                    }
                    ariaLabel="Items"
                    multiline
                    onChange={(text) =>
                      onSet(
                        "items",
                        text
                          .split("\n")
                          .filter((line) => line.trim() !== "")
                          .map((line) => {
                            const [first = "", second = ""] = line.split("|");
                            return { kicker: first.trim(), label: second.trim(), url: "" };
                          }),
                      )
                    }
                  />
                </Boxed>
              </Field>
            )}
            {has("altText") && (
              <Field label="B — sent when the toggle does not hold">
                <Boxed>
                  <PlainInput
                    value={block.altText ?? ""}
                    placeholder="what everyone else gets"
                    ariaLabel="Variant B"
                    multiline
                    onChange={(text) => onSet("altText", text)}
                  />
                </Boxed>
              </Field>
            )}
          </Stack>
        </Group>
      )}

      {(has("text") || has("glyph") || has("url")) && (
        <Group label="Content">
          <Stack gap={1.25}>
            {has("text") && block.type === "html" && (
              /* The one block whose content *is* markup, so it is edited as
                 markup - highlighted, because a wall of uncoloured angle
                 brackets is not a thing anybody finds a typo in. The same
                 field the message editor's own HTML view uses. */
              <HtmlSourceField
                value={block.text ?? ""}
                ariaLabel="Block markup"
                minHeight={140}
                maxHeight={320}
                onChange={(html) => onSet("text", html)}
              />
            )}
            {has("text") &&
              block.type !== "html" &&
              (isRichBody(block.type) ? (
                <RichTextField
                  value={richBody(block.text)}
                  placeholder="what it says"
                  ariaLabel="Block text"
                  preset="document"
                  tools={TEXT_TOOLS}
                  maxLength={MAX_BODY}
                  minHeight={96}
                  maxHeight={260}
                  onChange={(html) => onSet("text", html)}
                />
              ) : (
                <Boxed>
                  <PlainInput
                    value={block.text ?? ""}
                    placeholder="what it says"
                    ariaLabel="Block text"
                    multiline={block.type !== "button"}
                    onChange={(text) => onSet("text", text)}
                  />
                </Boxed>
              ))}
            {/* The only way to put an input *inside* a sentence. Without it an
                inline usage could be read and hidden but never made, and an
                operator would have to know to type the braces.

                Prose only. A button's label is one string that becomes one
                `<a>`, so splitting it in half around an input would produce two
                buttons - and a heading split in two is two headings. Those
                blocks can still be *bound* to an input; what they cannot do is
                hold one mid-sentence. */}
            {carriesInline(block.type) && design.slots.length > 0 && (
              <Field label="Insert an input">
                <Stack direction="row" flexWrap="wrap" gap={0.7}>
                  {design.slots.map((input) => (
                    <Box
                      key={input.id}
                      component="button"
                      type="button"
                      title={`Put ${input.name} into this copy`}
                      onClick={() => onInsertInline(input.name)}
                      sx={(theme) => ({
                        all: "unset",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        height: "22px",
                        px: "8px",
                        cursor: "pointer",
                        borderRadius: radius("sm"),
                        border: `1px dashed ${theme.palette.nebula.accentLine}`,
                        color: theme.palette.nebula.accent,
                        fontFamily: NEBULA_MONO,
                        fontSize: 11,
                        "&:hover": { background: theme.palette.nebula.accentSoft },
                      })}
                    >
                      + ${input.name}
                    </Box>
                  ))}
                </Stack>
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
          </Stack>
        </Group>
      )}

      {(has("align") || has("style") || has("size") || has("tone") || has("bg") || has("fg")) && (
        <Group label="Appearance">
          <Stack gap={1.25}>
            {has("align") && (
              <Field label="Alignment">
                <Choice
                  value={block.align ?? "left"}
                  options={[
                    { id: "left", label: "Left" },
                    { id: "center", label: "Centre" },
                    { id: "right", label: "Right" },
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
            {has("fg") && (
              <Field label="Text colour">
                <Swatches
                  value={block.fg}
                  options={TEXT_SWATCHES}
                  auto={["auto:text", "auto:muted", "auto:accent"]}
                  none="Default — the reader's own colour"
                  onChange={(colour) => onSet("fg", colour)}
                />
              </Field>
            )}
            {has("bg") && (
              <Field label="Background">
                <Swatches
                  value={block.bg}
                  options={BACKGROUND_SWATCHES}
                  auto={["auto:surface", "auto:accent"]}
                  none="None — no fill behind it"
                  onChange={(colour) => onSet("bg", colour)}
                />
              </Field>
            )}
            {has("tone") && (
              <Field label="Kind">
                <Choice
                  value={block.tone ?? "info"}
                  options={NOTICE_TONES.map((tone) => ({
                    id: tone,
                    label: `${NOTICE_STYLE[tone].mark}  ${tone[0].toUpperCase()}${tone.slice(1)}`,
                  }))}
                  onChange={(tone) => onSet("tone", tone as Block["tone"])}
                />
              </Field>
            )}
            {has("stars") && (
              <Field label="Stars">
                <Choice
                  value={String(Math.max(1, Math.min(5, Math.round(block.stars ?? 5))))}
                  options={[1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: String(n) }))}
                  onChange={(value) => onSet("stars", Number(value))}
                />
              </Field>
            )}
            {has("until") && (
              <Field label="Counts down to">
                <Boxed>
                  <PlainInput
                    value={block.until ?? ""}
                    placeholder="2026-12-24"
                    ariaLabel="Countdown date"
                    onChange={(value) => onSet("until", value)}
                  />
                </Boxed>
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
          </Stack>
        </Group>
      )}

      {(has("radius") || has("pad") || has("weight") || has("tracking") || has("leading") || has("measure") || has("flow") || has("src") || has("faces") || has("shadow") || has("border")) && (
        <Group label="Shape & type">
          <Stack gap={1.25}>
            <Hint>Left alone, each of these is whatever the client's own default is.</Hint>
            {has("weight") && (
              <Field label="Weight">
                {/* The stops a variable face actually wants. 400 reads thin on
                  a dark ground and 700 reads like a shout; the weights current
                  interfaces set are between the named ones, and a control that
                  offered Normal, Semi and Heavy could not ask for either. */}
                <Choice
                  value={String(block.weight ?? 0)}
                  options={[
                    { id: "0", label: "Auto" },
                    { id: "400", label: "400" },
                    { id: "510", label: "510" },
                    { id: "590", label: "590" },
                    { id: "800", label: "800" },
                  ]}
                  onChange={(value) => onSet("weight", value === "0" ? undefined : Number(value))}
                />
              </Field>
            )}
            {has("border") && (
              <Field label="Rule">
                <Swatches
                  value={block.border}
                  options={BORDER_SWATCHES}
                  auto={["auto:line", "auto:accent"]}
                  none="None — no rule around it"
                  onChange={(colour) => onSet("border", colour)}
                />
              </Field>
            )}
            {has("borderWidth") && block.border !== undefined && (
              <Field label="Thickness">
                {/* Only once there is a rule to be thick. A thickness control
                  on a block with no border is a control that does nothing,
                  which is worse than one that is not there. */}
                <Choice
                  value={String(block.borderWidth ?? 1)}
                  options={[
                    { id: "1", label: "1px" },
                    { id: "2", label: "2px" },
                    { id: "3", label: "3px" },
                    { id: "4", label: "4px" },
                  ]}
                  onChange={(value) => onSet("borderWidth", value === "1" ? undefined : Number(value))}
                />
              </Field>
            )}
            {has("borderStyle") && block.border !== undefined && (
              <Field label="Rule style">
                <Choice
                  value={block.borderStyle ?? "solid"}
                  options={[
                    { id: "solid", label: "Solid" },
                    { id: "dashed", label: "Dashed" },
                    { id: "dotted", label: "Dotted" },
                  ]}
                  onChange={(value) =>
                    onSet("borderStyle", value === "solid" ? undefined : (value as Block["borderStyle"]))
                  }
                />
              </Field>
            )}
            {has("picFit") && (
              <Field label="Picture fills">
                {/* Cover crops to fill the box, which is what a band wants.
                  Contain fits the whole picture in and keeps its shape - "take
                  the height and stay in proportion", which is what a logo or a
                  mark needs and what cropping would ruin. */}
                <Choice
                  value={block.picFit ?? "none"}
                  options={[
                    { id: "none", label: "As is" },
                    { id: "cover", label: "Cover" },
                    { id: "contain", label: "Contain" },
                  ]}
                  onChange={(value) =>
                    onSet("picFit", value === "none" ? undefined : (value as Block["picFit"]))
                  }
                />
              </Field>
            )}
            {has("ratio") && (
              <Field label="Shape">
                <Choice
                  value={block.ratio ?? ""}
                  options={[
                    { id: "", label: "Free" },
                    { id: "1", label: "Square" },
                    { id: "16/9", label: "16:9" },
                    { id: "21/9", label: "Band" },
                  ]}
                  onChange={(value) => onSet("ratio", value === "" ? undefined : value)}
                />
              </Field>
            )}
            {has("bgAsset") && (
              <Field label="Picture behind">
                <PictureField
                  block={block}
                  assets={design.assets}
                  onPick={onPickBackdrop}
                  onClear={onClearBackdrop}
                  behind
                />
              </Field>
            )}
            {has("bgFit") && block.bgAsset !== undefined && (
              <Field label="It fills">
                <Choice
                  value={block.bgFit ?? "cover"}
                  options={[
                    { id: "cover", label: "Cover" },
                    { id: "contain", label: "Contain" },
                    { id: "fill", label: "Stretch" },
                  ]}
                  onChange={(value) => onSet("bgFit", value as Block["bgFit"])}
                />
              </Field>
            )}
            {has("blurBehind") && (
              <Field label="Frosted">
                {/* A blur of whatever is behind, which needs a fill over it to
                  be visible - and which is the only way to put words on a
                  photograph and keep both readable. */}
                <Choice
                  value={String(block.blurBehind ?? 0)}
                  options={[
                    { id: "0", label: "Clear" },
                    { id: "6", label: "Light" },
                    { id: "14", label: "Frosted" },
                    { id: "28", label: "Heavy" },
                  ]}
                  onChange={(value) =>
                    onSet("blurBehind", value === "0" ? undefined : Number(value))
                  }
                />
              </Field>
            )}
            {has("blur") && (
              <Field label="Blur it">
                <Choice
                  value={String(block.blur ?? 0)}
                  options={[
                    { id: "0", label: "Sharp" },
                    { id: "3", label: "Soft" },
                    { id: "10", label: "Blurred" },
                  ]}
                  onChange={(value) => onSet("blur", value === "0" ? undefined : Number(value))}
                />
              </Field>
            )}
            {has("shadow") && (
              <Field label="Shadow">
                {/* Named rather than typed, because the useful ones are not
                  drop shadows: a spread ring stands in for a border, and an
                  inset highlight along the top edge is how a dark surface says
                  "raised" - light falls from above, so only the top edge
                  catches it. */}
                <Presets
                  value={block.shadow}
                  options={SHADOW_PRESETS}
                  none="None"
                  onChange={(css) => onSet("shadow", css)}
                />
              </Field>
            )}
            {has("textShadow") && (
              <Field label="Shadow on the words">
                <Presets
                  value={block.textShadow}
                  options={TEXT_SHADOW_PRESETS}
                  none="None"
                  onChange={(css) => onSet("textShadow", css)}
                />
              </Field>
            )}
            {has("grow") && (
              <Field label="In a row">
                {/* Only means anything inside a row: that is the one flow with
                  space left over to divide. A pair of growing buttons takes
                  half the row each whatever their labels say. */}
                <Choice
                  value={block.grow === true ? "grow" : "natural"}
                  options={[
                    { id: "natural", label: "Its own width" },
                    { id: "grow", label: "Share the row" },
                  ]}
                  onChange={(value) => onSet("grow", value === "grow" ? true : undefined)}
                />
              </Field>
            )}
            {has("fit") && (
              <Field label="Width">
                <Choice
                  value={block.fit === true ? "fit" : "full"}
                  options={[
                    { id: "full", label: "Full" },
                    { id: "fit", label: "Fits words" },
                  ]}
                  onChange={(value) => onSet("fit", value === "fit" ? true : undefined)}
                />
              </Field>
            )}
            {has("radius") && (
              <Field label="Corners">
                <Choice
                  value={String(block.radius ?? 0)}
                  options={[
                    { id: "0", label: "Square" },
                    { id: "6", label: "Soft" },
                    { id: "12", label: "Round" },
                    { id: "999", label: "Pill" },
                  ]}
                  onChange={(value) => onSet("radius", value === "0" ? undefined : Number(value))}
                />
              </Field>
            )}
            {has("flow") && (
              <Field label="Layout">
                <Choice
                  value={block.flow ?? "stack"}
                  options={[
                    { id: "stack", label: "Stack" },
                    { id: "row", label: "Row" },
                    { id: "cells", label: "Columns" },
                  ]}
                  onChange={(value) => onSet("flow", value === "stack" ? undefined : (value as Block["flow"]))}
                />
              </Field>
            )}
            {has("gap") && (
              <Field label="Gap">
                {/* Negative on purpose. A row of avatars is a row whose
                  children overlap, and there is no other way to say it. */}
                <PlainInput
                  value={block.gap === undefined ? "" : String(block.gap)}
                  placeholder="0"
                  onChange={(value) =>
                    onSet("gap", value.trim() === "" ? undefined : Number(value))
                  }
                />
              </Field>
            )}
            {has("grad") && (
              <Field label="Gradient">
                {/* Written whole, because there is no smaller vocabulary for a
                  gradient that a control could usefully offer. It sits behind
                  the flat fill rather than instead of it. */}
                <PlainInput
                  value={block.grad ?? ""}
                  placeholder="linear-gradient(140deg,#6e8bff,#3d4ba8)"
                  onChange={(value) => onSet("grad", value.trim() === "" ? undefined : value)}
                />
              </Field>
            )}
            {has("borderTop") && (
              <Field label="Lit top edge">
                <Swatches
                  value={block.borderTop}
                  options={[{ label: "Light", colour: "#ffffff" }]}
                  auto={["auto:line", "auto:accent"]}
                  none="None — the same rule all round"
                  onChange={(colour) => onSet("borderTop", colour)}
                />
              </Field>
            )}
            {has("round") && (
              <Field label="Circle">
                <Choice
                  value={block.round === true ? "yes" : "no"}
                  options={[
                    { id: "no", label: "Box" },
                    { id: "yes", label: "Round" },
                  ]}
                  onChange={(value) => onSet("round", value === "yes" ? true : undefined)}
                />
              </Field>
            )}
            {has("valign") && (
              <Field label="Sits">
                <Choice
                  value={block.valign ?? "baseline"}
                  options={[
                    { id: "baseline", label: "Baseline" },
                    { id: "top", label: "Top" },
                    { id: "middle", label: "Middle" },
                  ]}
                  onChange={(value) =>
                    onSet("valign", value === "baseline" ? undefined : (value as Block["valign"]))
                  }
                />
              </Field>
            )}
            {has("bare") && (
              <Field label="These words are">
                <Choice
                  value={block.bare === true ? "line" : "prose"}
                  options={[
                    { id: "prose", label: "Prose" },
                    { id: "line", label: "One line" },
                  ]}
                  onChange={(value) => onSet("bare", value === "line" ? true : undefined)}
                />
              </Field>
            )}
            {has("faces") && (
              <Field label="Faces shown">
                {/* A cluster is a glance, not a census: past four or five
                  overlapping discs nobody is reading faces any more and the
                  number beside them is doing all the work. */}
                <Choice
                  value={String(block.faces ?? 3)}
                  options={[
                    { id: "0", label: "None" },
                    { id: "3", label: "3" },
                    { id: "4", label: "4" },
                    { id: "5", label: "5" },
                  ]}
                  onChange={(value) => onSet("faces", Number(value))}
                />
              </Field>
            )}
            {has("asset") && (
              <Field label="Picture">
                <PictureField
                  block={block}
                  assets={design.assets}
                  onPick={onPickPicture}
                  onClear={onClearPicture}
                />
              </Field>
            )}
            {has("src") && (
              <Field label="Icon, inlined">
                {/* A data URI, because the sanitiser every reader renders
                  through drops an `<img>` pointing anywhere else - so that a
                  greeting cannot be used to log the address of everybody who
                  joins. It also has to be small: a greeting that travels as a
                  *string* is capped at 4096 characters, and base64 costs a
                  third more than the picture does.
                  
                  A Fancy client is sent bytes instead and is held to neither -
                  see `greeting_binary` on the server. The picker that targets
                  that budget lands with the rest of that path; until then this
                  is the field, and it is honest about what fits. */}
                <PlainInput
                  value={block.src ?? ""}
                  placeholder="data:image/webp;base64,…"
                  onChange={(value) => onSet("src", value.trim() === "" ? undefined : value)}
                />
              </Field>
            )}
            {has("margin") && (
              <Field label="Outer space">
                <PlainInput
                  value={block.margin ?? ""}
                  placeholder="0 0 20px"
                  onChange={(value) => onSet("margin", value.trim() === "" ? undefined : value)}
                />
              </Field>
            )}
            {has("padCss") && (
              <Field label="Inner space, per side">
                <PlainInput
                  value={block.padCss ?? ""}
                  placeholder="9px 17px"
                  onChange={(value) => onSet("padCss", value.trim() === "" ? undefined : value)}
                />
              </Field>
            )}
            {has("pad") && (
              <Field label="Inner space">
                <Choice
                  value={String(block.pad ?? 0)}
                  options={[
                    { id: "0", label: "None" },
                    { id: "10", label: "Snug" },
                    { id: "18", label: "Roomy" },
                    { id: "28", label: "Airy" },
                  ]}
                  onChange={(value) => onSet("pad", value === "0" ? undefined : Number(value))}
                />
              </Field>
            )}
            {has("leading") && (
              <Field label="Line height">
                <Choice
                  value={String(block.leading ?? 0)}
                  options={[
                    { id: "0", label: "Auto" },
                    { id: "105", label: "Tight" },
                    { id: "140", label: "Prose" },
                    { id: "170", label: "Loose" },
                  ]}
                  onChange={(value) => onSet("leading", value === "0" ? undefined : Number(value))}
                />
              </Field>
            )}
            {has("tracking") && (
              <Field label="Letter spacing">
                <Choice
                  value={String(block.tracking ?? 0)}
                  options={[
                    { id: "-3", label: "Tight" },
                    { id: "0", label: "Normal" },
                    { id: "8", label: "Wide" },
                    { id: "16", label: "Widest" },
                  ]}
                  onChange={(value) => onSet("tracking", value === "0" ? undefined : Number(value))}
                />
              </Field>
            )}
            {has("measure") && (
              <Field label="Text width">
                <Choice
                  value={String(block.measure ?? 0)}
                  options={[
                    { id: "0", label: "Full" },
                    { id: "420", label: "Wide" },
                    { id: "340", label: "Read" },
                  ]}
                  onChange={(value) => onSet("measure", value === "0" ? undefined : Number(value))}
                />
              </Field>
            )}
          </Stack>
        </Group>
      )}

      <Group label="Arrange">
        <Stack gap={1}>
          <Hint>Blocks overlap. This is which one is on top.</Hint>
          <Stack direction="row" gap={0.5}>
            {(
              [
                ["front", "Front", "Bring to front"],
                ["forward", "Forward", "Bring forward (Ctrl+])"],
                ["backward", "Back", "Send backward (Ctrl+[)"],
                ["back", "Bottom", "Send to back"],
              ] as const
            ).map(([to, label, title]) => (
              <Box
                key={to}
                component="button"
                type="button"
                title={title}
                onClick={() => onArrange(to)}
                sx={(theme) => ({
                  all: "unset",
                  flex: 1,
                  textAlign: "center",
                  cursor: "pointer",
                  px: "6px",
                  py: "5px",
                  borderRadius: radius("sm"),
                  fontSize: 11,
                  color: theme.palette.nebula.muted,
                  border: `1px solid ${theme.palette.nebula.line2}`,
                  "&:hover": { color: theme.palette.nebula.text, background: theme.palette.nebula.hover },
                })}
              >
                {label}
              </Box>
            ))}
          </Stack>
        </Stack>
      </Group>

      {/* Every block can be gated, which is what makes one design cover the
          variations that used to need a greeting each. */}
      {block.type !== "theme" && (
        <Group label="Visibility">
          <Choice
            value={gated ? "if" : "always"}
            options={[
              { id: "always", label: "Always" },
              { id: "if", label: "Only if…" },
            ]}
            onChange={(id) =>
              onSet("gate", id === "always" ? undefined : (design.conditions[0]?.name ?? undefined))
            }
          />
          {gated ? (
            <Box sx={{ mt: "9px" }}>
              <Picker
                value={block.gate ?? ""}
                options={design.conditions.map((input) => ({ id: input.name, label: input.name }))}
                onChange={(gate) => onSet("gate", gate === "" ? undefined : gate)}
              />
            </Box>
          ) : (
            <Typography sx={(theme) => ({ mt: "9px", fontSize: 11, color: theme.palette.nebula.dim })}>
              {design.conditions.length === 0
                ? "Declare a toggle under the artboard first, then gate this on it."
                : "Pick “Only if…” to gate this element on a toggle input."}
            </Typography>
          )}
        </Group>
      )}

      <Group label="Position & size">
        {/* Four cells rather than one combined field: these are read off the
            sheet and compared against another block's, and a single "44 · 264 ·
            432" is three numbers nobody can line up against three others. */}
        {!resizable(block) && (
          <Typography sx={(theme) => ({ mb: "8px", fontSize: 11, color: theme.palette.nebula.dim })}>
            Data-input elements can’t be resized — they take the size of the value. Use{" "}
            <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.accent })}>
              hide
            </Box>{" "}
            on the element to drop this usage.
          </Typography>
        )}
        <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "6px" }}>
          <Num label="X" value={block.x} onChange={(value) => onSet("x", value)} />
          <Num label="Y" value={block.y} onChange={(value) => onSet("y", value)} />
          <Num
            label="W"
            value={block.w}
            onChange={resizable(block) ? (value) => onSet("w", Math.max(48, value)) : undefined}
          />
          {/* Height is the content's on every type but these two, and a box an
              operator can type into that then ignores them is worse than one
              that says so. */}
          {block.h === undefined || !resizable(block) ? (
            <Num label="H" value={block.h} />
          ) : (
            <Num label="H" value={block.h} onChange={(value) => onSet("h", Math.max(16, value))} />
          )}
        </Box>
      </Group>
    </Stack>
  );
}

/** One measurement cell. Without an `onChange` it reads as what it is: derived. */
function Num({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value?: number; onChange?: (value: number) => void }>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={0.9}
      sx={(theme) => ({
        boxSizing: "border-box",
        height: "30px",
        px: "9px",
        borderRadius: radius("sm"),
        background: theme.palette.nebula.bg0,
        border: `1px solid ${theme.palette.nebula.line2}`,
        "&:focus-within": { borderColor: theme.palette.nebula.accent },
      })}
    >
      <Box
        component="span"
        aria-hidden
        sx={(theme) => ({ fontFamily: NEBULA_MONO, fontSize: 10, color: theme.palette.nebula.dim })}
      >
        {label}
      </Box>
      {onChange !== undefined && value !== undefined ? (
        <Box sx={{ flex: 1, minWidth: 0, fontFamily: NEBULA_MONO, fontSize: 11.5 }}>
          <PlainInput
            value={String(value)}
            placeholder="0"
            ariaLabel={label}
            onChange={(raw) => {
              const digits = raw.replace(/\D/g, "");
              if (digits !== "") onChange(Number(digits));
            }}
          />
        </Box>
      ) : (
        <Box
          component="span"
          sx={(theme) => ({ fontFamily: NEBULA_MONO, fontSize: 11.5, color: theme.palette.nebula.dim })}
        >
          {value ?? "auto"}
        </Box>
      )}
    </Stack>
  );
}

/** A warning that belongs to the field above it. */
function Note({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Stack
      direction="row"
      gap={1}
      sx={(theme) => ({
        mt: "9px",
        p: "9px",
        borderRadius: radius("sm"),
        background: alpha(theme.palette.nebula.warn, 0.1),
        border: `1px solid ${alpha(theme.palette.nebula.warn, 0.24)}`,
      })}
    >
      <Box
        component="span"
        aria-hidden
        sx={(theme) => ({ flex: "none", fontSize: 11, lineHeight: 1.35, color: theme.palette.nebula.warn })}
      >
        !
      </Box>
      <Box
        component="span"
        sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.warn, textWrap: "pretty" })}
      >
        {children}
      </Box>
    </Stack>
  );
}

/** An input's name in running prose. */
function Code({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box component="span" sx={{ fontFamily: NEBULA_MONO }}>
      {children}
    </Box>
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
        borderRadius: radius("sm"),
        outline: "none",
        "&:focus": { borderColor: theme.palette.nebula.accent },
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

/**
 * Two lists of declared inputs, with nothing dropped.
 *
 * Applying a sheet must not unplug anything: an input is what a wire on the
 * canvas lands on, so an input that disappears because a different sheet did
 * not happen to use it is an edge that silently stops feeding anything. The
 * kept list is therefore what was there, plus whatever the new sheet needs and
 * did not find.
 */
function merged<T extends { id: string; name: string }>(
  had: readonly T[],
  wants: readonly T[],
): T[] {
  const names = new Set(had.map((input) => input.name));
  return [...had, ...wants.filter((input) => !names.has(input.name))];
}

/**
 * A named choice that stands for a piece of CSS.
 *
 * The same shape as `Choice`, except the value stored is the CSS rather than
 * the name - so a design that was given a shadow keeps that shadow even if the
 * list of presets is edited later, and a hand-written one shows as "Custom"
 * rather than being quietly reset to the nearest preset.
 */
function Presets({
  value,
  options,
  none,
  onChange,
}: Readonly<{
  value: string | undefined;
  options: readonly { readonly id: string; readonly label: string; readonly css: string }[];
  none: string;
  onChange: (css: string | undefined) => void;
}>) {
  const known = options.find((option) => option.css === value);
  const custom = value !== undefined && known === undefined;
  return (
    <Choice
      value={value === undefined ? "" : (known?.id ?? "custom")}
      options={[
        { id: "", label: none },
        ...options.map((option) => ({ id: option.id, label: option.label })),
        // Offered only when there is one, so the list does not carry a choice
        // that cannot be chosen.
        ...(custom ? [{ id: "custom", label: "Custom" }] : []),
      ]}
      onChange={(id) => {
        if (id === "custom") return;
        onChange(id === "" ? undefined : options.find((option) => option.id === id)?.css);
      }}
    />
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

/**
 * Which fields each block type shows in the properties panel.
 *
 * `fg` and `bg` are on everything that draws words of its own. They are not a
 * property of one kind of block - a heading, a list and a paragraph all read
 * better on a fill sometimes - and confining them to a "panel" meant wrapping
 * content in a block it did not belong in to give it a colour.
 *
 * The four that do not offer them, and why: a **notice** decides both from its
 * own tone, a **divider** and a **spacer** have no words to colour, and a
 * **theme** is a container the reader never sees.
 *
 * A **slot** does offer them, which it did not used to: it draws somebody
 * else's words rather than its own, and the box around those words is still
 * this design's business. A snippet dropped into a page with no cell around it
 * was the visible half of that.
 *
 * `fit` goes wherever paint does, and only there. It is the width of a fill or
 * a rule that anybody can see, so on a block with neither it is a control that
 * does nothing.
 */
const FIELDS: Record<BlockType, (keyof Block)[]> = {
  mark: ["glyph", "align", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  heading: ["text", "align", "size", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  text: ["text", "align", "size", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  button: ["text", "url", "align", "style", "radius", "pad", "padCss", "size", "weight", "fg", "bg", "grad", "border", "borderWidth", "borderStyle", "borderTop", "shadow", "textShadow", "margin", "grow"],
  divider: [],
  callout: ["text", "align", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  notice: ["text", "tone", "radius", "shadow"],
  panel: ["text", "align", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  links: ["items"],
  slot: ["slot", "fallback", "align", "size", "fg", "bg", "radius", "pad", "weight", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  theme: [],
  quote: ["text", "align", "size", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  list: ["lines", "size", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  code: ["text", "size", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  html: ["text"],
  spacer: [],
  columns: ["items"],
  table: ["rows"],
  card: ["text", "align", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  video: ["text", "url", "align"],
  footer: ["text", "align", "size", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  social: ["items"],
  qr: ["url", "align"],
  rating: ["stars", "align", "fg"],
  countdown: ["text", "until", "align", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  toggles: ["items"],
  repeater: ["slot", "fallback", "align", "size", "fg", "bg", "radius", "pad", "border", "fit"],
  ab: ["text", "altText", "align", "size", "fg", "bg", "radius", "pad", "weight", "tracking", "leading", "measure", "border", "borderWidth", "borderStyle", "shadow", "textShadow", "fit", "grow", "bgAsset", "bgFit", "blurBehind", "ratio", "grad", "borderTop", "round", "valign", "margin", "padCss", "leadPx"],
  // A group has no words of its own, so it takes the box controls and none of
  // the type ones. `flow` and `gap` are its alone: they are what it does.
  group: ["flow", "gap", "align", "bg", "grad", "border", "borderTop", "borderWidth", "borderStyle", "shadow", "radius", "round", "pad", "padCss", "margin", "fit", "bgAsset", "bgFit", "blurBehind", "ratio"],
  image: ["asset", "src", "picFit", "ratio", "blur", "align", "margin", "valign", "grow", "border", "borderWidth", "borderStyle", "radius", "round", "shadow"],
  presence: ["text", "faces", "size", "align", "fg", "bg", "grad", "border", "borderWidth", "borderStyle", "borderTop", "shadow", "textShadow", "radius", "round", "pad", "padCss", "margin", "weight", "tracking", "leadPx", "fit", "valign"],
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
