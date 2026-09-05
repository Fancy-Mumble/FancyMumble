# Design blocks

_Architecture for the welcome editor's design block, its typed inputs, and the
design editor that opens from it._

## What this replaces, and why

The welcome editor today has a greeting node that holds one body in up to four
representations — plain text, rich markup, hand-written HTML, and a list of
layout bands — with a view switcher on the node deciding which one is being
written. That got us a long way and it has three faults that cannot be fixed
inside it:

1. **The band list is a fixed vocabulary in a fixed order.** There is no
   nesting, no way to show a paragraph only to some people, and no way to place
   a reusable snippet anywhere but appended at the end.
2. **Targeting an old client means writing a second greeting.** Mumble 1.5 and
   older render a subset of HTML 4, so the current answer is a second greeting
   node behind a client-version condition — two documents saying the same thing,
   which drift the first time one is edited.
3. **A variation means another greeting node.** "The same welcome, but with a
   line about registration being closed" is a second complete greeting, a
   second condition, and a shadowing warning from the solver telling you the two
   overlap.

A design block fixes all three with one idea: **a design is a tree of blocks
with a declared, typed signature**, and the graph fills that signature.

```
              ┌──────────────────────────────┐
  conditions ─┤ BOOL inputs → visibility     │
              │                              │→ one resolved greeting
  text nodes ─┤ TEXT inputs → slots          │
              └──────────────────────────────┘
                     the design block
```

## The model

Implemented in `welcome/design.ts`, with the mock as the authority.

### A design

```ts
interface Design {
  /** What the positions are relative to. Draggable, 560-1180. */
  sheetW: number;
  /** TEXT inputs: fed by reusable-text nodes, rendered by `slot` blocks. */
  slots: Input[];
  /** BOOL inputs: fed by settled conditions, used as gates. */
  conditions: Input[];
  blocks: Block[];
  /** Per target, per block, a patch. Never a second design. */
  overrides: Partial<Record<Variant, Record<string, Partial<Block>>>>;
}

type Target = "base" | "plain" | "rich" | "html" | "qt";
type Variant = Exclude<Target, "base">;
```

Two input lists rather than one with a `kind`, because the two are wired to
different things and drawn as different ports: a text input takes prose, a
condition takes a settled yes/no. The greeting node draws one port per entry of
each, plus `WHEN`.

A condition may be fed only by a **filter or a gate**, never a bare condition —
the same rule gates already obey, and for the same reason: an undecided answer
driving a visibility toggle would hide a block for reasons nobody can see.

### Blocks

```ts
interface Block {
  id: string;
  type: BlockType;
  /** Absolute, snapped to a 4px grid. */
  x: number; y: number; w: number; h?: number;
  size?: number;
  align?: "left" | "center" | "right";
  /** Words on most blocks; markup on `text`, which is written in the WYSIWYG. */
  text?: string;
  glyph?: string;                    // mark
  style?: "button" | "link";         // button
  slot?: string;                     // slot: which text input
  gate?: string;                     // any block: which condition switches it on
  items?: LinkItem[];                // links
}

type BlockType =
  | "mark" | "heading" | "text" | "button" | "divider"
  | "image" | "callout" | "links" | "slot" | "theme";
```

A `text` block holds **markup**, not words: its content is written in the same
WYSIWYG the rest of Nebula writes bios and channel descriptions with, so a
paragraph can carry bold, italics, colour and a list. Every other block that
takes `text` — a heading, a button label, a callout — holds plain words, because
each of those is a single run that the target draws in its own way.

That markup is the *base*, and each target takes what it can: `html` and `rich`
are sent it filtered through the client's own allow-list, `qt` through
`qtSafe`, and `plain` gets `plainTextOf` — structure as line breaks, list items
as bullets. The size stays a block property and rides on the layout cell, since
a body that brings its own `<p>` has nowhere to put it: `div` is not on the
allow-list and a `span` wrapped around a paragraph is closed by the parser at
the first one.

The toolbar deliberately offers less than the field can: no heading (that is
its own block), no alignment (that is the block's, and two of them would
fight), and no image (a data: URL is several times the body cap, paid on every
join). Copy written before the block had an editor — and every template, whose
words are plain strings in the source — is read as the plain text it is and
wrapped a paragraph per line.

`gate` names a condition rather than holding an expression. Anything more
complicated belongs on the canvas, where it can be drawn, read back as a
sentence and checked by the solver — a second expression language inside the
design editor would be the same logic in a place nobody can see it.

### Overrides

A patch per block per target, applied over the base:

```ts
effective(design, target, block)   // base, with this target's patch on top
setField(design, target, id, k, v) // writes the block on base, a patch elsewhere
revertBlock / revertTarget         // back to base, one block or all of them
```

Editing a heading on `base` moves it in every target that has not diverged *on
that field* — which is the whole reason this is one design and not four
documents. `removeBlock` takes the block's overrides with it, so a new block
reusing an id never inherits a stranger's patch.

## What arbitrary means

**Corrected against the design mock.** An earlier draft of this section argued
that a design should be a vertical stack of blocks with no geometry, because a
Qt client cannot honour coordinates. That was the wrong trade, and the mock
answers it better.

Blocks carry **absolute positions** — `x`, `y`, `w` on a sheet, snapped to a
4px grid, dragged and resized. The sheet itself is resizable between 560 and
1180. Free positioning is safe because the **target selector** is the mechanism
that makes it safe, in two halves:

* **A target renders only the block types it can.** `plain` drops `mark`,
  `image`, `divider` and `links` — those are shape, and shape has no plain-text
  spelling worth having. `qt` and `rich` drop `image`, because the artwork lives
  in the server's livery and those paths cannot fetch it.
* **The palette follows the tab.** On the Qt tab you are not offered an image at
  all. A block that cannot be drawn is not one you can add, rather than one you
  add and then wonder about.

And `plain` — the one target with no geometry whatsoever — **flattens**. Reading
order is derived from the positions, top to bottom then left to right, so there
is no second ordering to maintain and no way for it to disagree with the sheet.
A block dragged above another in the editor moves above it in the plain text,
with nothing to press.

That is the whole of it: design freely on base, and each target takes the subset
it can honour, with field-level overrides where it needs to differ.

## Compiling

`welcome/compile.ts`. Runs in the editor at save time, once, per target.

Every client is sent markup: a greeting travels in `ServerSync.welcome_text`,
which is a string, so there is nowhere for a design to arrive as itself and the
fork reads the `rich` target like everyone else reads theirs. The base design
has absolute positions that none of those targets has: Qt has no `position` at
all, and the sanitiser every HTML surface renders through allows no flexbox and
no grid. **A table is the only layout primitive that survives the trip** —
which is exactly what the hand-written welcome screens this replaces were built
out of.

So positions become rows. Blocks whose tops line up within 16px are one row,
ordered left to right; each row becomes a `<tr>` with a cell per block and
widths taken from the design. A single-column design — which most are — comes
out as one cell per row and reads exactly as drawn.

Proximity of *tops* rather than overlap of extents, because most blocks carry no
height: it is their content's. Guessing one at 28px silently welds a rule to the
paragraph below it. The case this gets conservatively wrong is a tall block
beside two stacked ones, which splits into two rows rather than inventing a
nested cell — and the operator sees exactly that on the target tab.

### Parts

The output is a list, not a string, because two things are only known when
somebody connects: which gated blocks are on, and what is wired into each slot.

```ts
interface Part {
  literal?: string;   // markup or text, already generated
  slot?: string;      // an input name: the server substitutes
  visibleIf?: string; // a condition name; absent means always
}
```

A row is one part unless something in it is decided per peer — a gate can remove
a cell, a slot is substituted whole — in which case it splits to one part per
block. Either would otherwise leave the server re-balancing a table, which is a
layout engine in Rust and the one thing this design exists to avoid.

## The wire

### What is stored

The design, plus the compiled parts per target.

```proto
message Greet {
  // …existing html / plain / once
  Design design = 6;
}

message Design {
  repeated Input slots = 1;
  repeated Input conditions = 2;
  uint32 sheet_w = 3;
  bytes tree = 4;                       // the editor's own JSON
  map<string, Compiled> compiled = 5;   // "rich" | "html" | "qt" | "plain"
}

message Compiled { repeated Part parts = 1; }

message Part {
  oneof body {
    string literal = 1;
    string slot = 2;
  }
  string visible_if = 3;
  bool negated = 4;
}
```

### What the server does at handshake

Nothing it does not already do:

1. Choose the greeting — the first whose `WHEN` is a definite yes, as now.
2. Pick the target from the peer's announced version and `allow_html`.
3. Evaluate each condition input's wired condition, with the facts in hand.
4. Walk that target's parts: drop the ones whose condition is false, substitute
   each slot with the wired snippet, join with that target's separator.

Step 4 is a loop over a list. `assemble` in `compile.ts` is the same walk, used
by the preview, so what an operator sees is what will be sent.

## The editor

A panel that slides in from the right over the canvas, opened by a button on
the design block.

```
┌ DESIGN EDITOR ──────────── BASE PLAIN RICH HTML QT ─ Grid ─ Close ┐
│ Greeting #1 · matches joined less than 1 week ago                 │
│ BASE  Every target inherits this. Switch a tab to diverge there.  │
├────────────┬──────────────────────────────┬───────────────────────┤
│ INSERT     │                              │ PROPERTIES            │
│  Heading + │        ARTBOARD              │  (of the selection)   │
│  Text    + │        520 × 720             │                       │
│  Button  + │                              │                       │
│  …         │   live native render, with   │                       │
│            │   selection outlines and     │                       │
│ LAYERS     │   IF <INPUT> chips on any    │                       │
│  …tree…    │   conditional block          │                       │
├────────────┴──────────────────────────────┴───────────────────────┤
│ LIVE  3 greetings, tried in the order drawn · editing base        │
│                              TEST GREETING   SAVE & BROADCAST     │
└───────────────────────────────────────────────────────────────────┘
```

Points worth stating:

* **The artboard renders through the real renderer.** Not an approximation —
  the same component that draws a greeting for the person arriving, so anything
  the sanitiser drops is missing here too.
* **A target tab shows what that target will actually be.** `QT` renders the
  Qt-compiled markup, `PLAIN` the text. You see the old client's version by
  clicking a tab, not by imagining it.
* **Editing on a target tab diverges only the field you touched**, and the
  header says so. A diverged field is marked in the properties panel with a way
  back to inherited.
* **Layers is the tree**, reverse order, and it is where a group is collapsed or
  a block is reparented. The artboard is for choosing and typing.

## Consequences for what exists

| Today | After |
|---|---|
| `text` node with Plain / Rich / HTML views | rich text only, as asked |
| `greeting` node with four views and a band list | design block: `WHEN` + one port per input |
| `sections: Section[]` on the wire | `design`, with `sections` read for migration |
| Second greeting node for old clients | a `qt` target override |
| Second greeting node for a variation | a bool input and a `visibleIf` |
| `markupOfScreen` / `legacyMarkupOfScreen` / `plainOfScreen` | retargeted from `Section[]` to resolved `Block[]` — the compilers survive |
| `WelcomeScreen` renderer | survives; gains groups, slots and conditionals |
| The shadowing solver | unchanged, and needed less often |

Migration is mechanical and worth doing rather than dropping: a stored
`sections` list is a flat `root` with no inputs and no overrides; a stored
html-only greeting is a single `text` block.

## Validation

Client-side, so the status bar names the problem before a save is refused:

* an input with no wire, where a `slot` or `visibleIf` uses it
* a `slot` for an input that no longer exists
* a bool input fed by an unfiltered condition
* a `visibleIf` whose input is `text` (or a `slot` whose input is `bool`)
* a group whose every child is hidden on a target
* the caps below

Server-side, refusing the write and naming the node:

| Cap | Why |
|---|---|
| inputs per design | a node with forty ports is not a node |
| blocks per design, and nesting depth | bounded walk at handshake |
| parts per compiled target | bounded assembly |
| characters per target, after assembly | paid on every join — the existing `MAX_BODY` |
| link scheme: http(s) only | already enforced; unchanged |

## State of play

Built, tested and green from the editor to the handshake, with one gap in the
middle: **the client never puts a design on the wire.** `toWire` in
`welcome/greetingStore.ts` carries a greeting's `body`, `html`, `sections` and
`legacy` and no `design`, and `compileAll` has no caller outside its own tests,
so a design lives only as long as the editor is open. Everything on both sides
of that is done: the editor compiles, and the server stores and assembles what
it is given.

### Done

| Piece | Where | Tests |
|---|---|---|
| The model — blocks, inputs, overrides, `resolve` | `welcome/design.ts` | 22 |
| Compiling to parts, per target | `welcome/compile.ts` | 20 |
| Alignment snapping and page guides | `welcome/snapping.ts` | 20 |
| Qt subset compiler and `qtViolations` | `welcome/qtHtml.ts` | in the template suite |
| The design block node — dynamic ports, thumbnail | `welcome/spec.tsx`, `welcome/DesignBody.tsx` | in `nodes/blocks.test.ts` |
| The editor — sheet, palette, layers, properties, target tabs, zoom/pan, snapping, shortcuts, context menu | `welcome/DesignEditor.tsx` | — |
| Proto and validation — `GreetingDesign`, `DesignPart`, `GreetingEdge.input`, caps, digest | `serverconfig.proto`, `runtime/src/greeting.rs` | 61 |
| Assembly at handshake — target choice, gates, slots | `runtime/src/greeting.rs`, `session-lifecycle/src/handshake.rs` | 13 |
| The text block's WYSIWYG — markup per target, flattened on `plain` | `welcome/DesignEditor.tsx`, `welcome/compile.ts`, `welcome/markup.ts` | 7 |
| Editing the signature — add, rename, remove an input, wire and all | `welcome/design.ts`, `welcome/model.ts`, `welcome/DesignEditor.tsx` | 15 |
| Shortcuts — undo/redo in the panel, a block clipboard that leaves the window | `welcome/DesignEditor.tsx`, `welcome/design.ts` | 4 |

### Editing the signature

The inputs pane in the editor's left rail adds, renames and removes them. Two
of those three are **graph** operations rather than design ones, and that is the
whole subtlety: a wire lands on `in:<name>`, so the name is the binding. A
rename that touched only the design would leave the snippet wired to a port that
no longer exists — drawn nowhere, and removable by nobody. `renameDesignInput`
and `removeDesignInput` in `welcome/model.ts` move the design, the blocks that
name it, every target's override of those blocks, and the edge, in one step.

The pane is in the left rail, which is where the panel's own width bug hid it:
the panel opens at a fixed 1180px anchored to the right edge, so on any window
narrower than that, its left third — Insert, Inputs and Layers — was simply off
the screen, with no scrollbar to say so. It is clamped to the window now, and
narrows with it.

Names are normalised to `[a-z0-9_]` and made unique across *both* lists, since
both become ports on one node. The field commits on blur rather than per
keystroke: normalising as you type would turn a space into an underscore
mid-word and append a `_2` the next letter made nonsense of.

`Input.wired` is gone. Nothing ever wrote it, so the check that read it —
"this input has nothing wired to it" — fired on every design forever.
`designProblems` now takes the wired names, which `graphStatus` reads off the
edges.

### Assembly at handshake

`greeting_for` in `session-lifecycle/src/handshake.rs` calls `greeting::assemble`,
which is the same walk as `assemble` in `welcome/compile.ts` — the client uses
that one for the preview, so what an operator sees is what will be sent. It:

1. picks the target from the peer's announced versions and `allow_html` —
   `plain` where the server forbids markup, `rich` for the fork, `qt` for
   Mumble 1.5 and older, `html` above that. A peer that announced no version is
   read as old rather than new: `qt` renders in a client that understands more,
   and the other way round leaves somebody reading tags;
2. evaluates each condition input by walking the edge with
   `port == INPUT && input == <name>` and asking `truth` of what feeds it. A
   gate the server cannot settle hides its part;
3. substitutes each slot from the snippet wired to that input — its text half
   for `plain`, its markup half everywhere else. `qt` is sent the markup:
   Qt keeps the words inside a tag it does not know, and doing better would
   cost an HTML parser on the login path and a second copy of the editor's
   sanitiser to keep in step with it;
4. joins the parts whose condition holds, with that target's separator.

A greeting with no design, and a design with nothing compiled for the target
this peer needs, both fall back to `compose` — the `html` and `plain` halves the
editor fills in anyway, which is what makes a half-migrated document safe to
store.

### The gap: nothing sends it

`toWire` gains a `design` on the greeting node — `sheetW`, `slots`,
`conditions`, the block tree as the JSON the proto already calls opaque, and
`compileAll`'s output as `compiled` — and `fromWire` reads it back, opening the
node in the design view when one is there. The server end of this is already
written and tested; this is the client half that was never wired.

### Also outstanding

* The `theme` block is a placeholder in the artboard; it does not render.
* A pinned welcome message, so a dismissed greeting can be read again.
* A Fancy-version condition node, distinct from the Mumble version one.
* `{name}` / `{channel}` / `{server}` are substituted by this editor's preview
  and by nothing else in the stack.

## Order of work

1. **Model and resolver** — `Design`, `Input`, `Block`, `Override`, `resolve`,
   with tests. No UI.
2. **Compilers retargeted** to resolved `Block[]`, emitting parts. The three
   existing compilers keep their tests.
3. **Proto and runtime** — `Design`, `Compiled`, `Part`; assembly at handshake;
   caps; `GreetingEdge.input_id` for the dynamic ports.
4. **Dynamic ports** in the graph engine — `inputs(node)` already takes the
   node, so this is a widened `PortId` in the welcome dialect and a wire-format
   change, not an engine change.
5. **The design block node** — ports, thumbnail, the button.
6. **The editor shell** — slide-in, insert rail, layers, artboard, properties.
7. **Target tabs and divergence.**
8. **Simplify the text node** to rich-only, and migrate.

Steps 1–4 are the load-bearing half and are testable without any of the UI.
