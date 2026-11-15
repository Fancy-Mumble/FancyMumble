/**
 * The node editor, without a dialect.
 *
 * A page brings a `NodeSpec` - the kinds on its palette, how each one draws
 * itself, and what a finished graph turns into - and gets the canvas, the
 * wiring rules and the chrome for nothing.
 */
export { NodeEditor } from "./NodeEditor";
export { BrowsePanel } from "./BrowsePanel";
export { TemplatePanel } from "./TemplatePanel";
export {
  insertFragment,
  offsetFor,
  wire,
  type CanvasInsert,
  type Fragment,
  type GraphTemplate,
  type TemplateGallery,
  type TemplateStrings,
  type TemplateWire,
} from "./templates";
export { useFavorites } from "./useFavorites";
export { useScrollGuard } from "./useScrollGuard";
export { ZOOM_STEP, boundsOf, useCanvasView, type CanvasView } from "./useCanvasView";
export { useGraphHistory, type History } from "./useGraphHistory";
export { copyOut, decodeClipping, encodeClipping, pasteInto, type Clipping } from "./clipboard";
export {
  ANNOTATION_SIZES,
  addAnnotation,
  annotationsOf,
  enclosedBy,
  makeAnnotation,
  patchAnnotation,
  removeAnnotation,
  type Annotation,
  type AnnotationKind,
} from "./annotate";
export { useBlockCarry, type CanvasDrop, type Carry } from "./useBlockCarry";
export { NodeCanvas, type CanvasAdd } from "./NodeCanvas";
export { NodeCard } from "./NodeCard";
export {
  AddChip,
  Caret,
  MiniSwitch,
  PaletteChip,
  PillMenu,
  PillSelect,
  PlainInput,
  SectionLabel,
  Segmented,
  TagChip,
  ToggleRow,
  type PillOption,
} from "./controls";
export {
  OUT,
  canConnect,
  connect,
  dependsOn,
  disconnect,
  edgesInto,
  feedsOf,
  fromPortOf,
  mayBeUnknown,
  nextId,
  nodeOf,
  patchNode,
  removeNode,
  sourceOf,
  sourcesOf,
  targetsOf,
  usesOf,
  type Edge,
  type GraphNode,
  type Link,
  type NodeGraph,
  type NodeId,
  type PortId,
  type Wiring,
} from "./graph";
export {
  NODE_FOOTPRINT,
  type BlockDef,
  type EditorStrings,
  type GraphStatus,
  type NodeAttachmentProps,
  type NodeBodyProps,
  type NodeSpec,
  type PortInfo,
  type PortSide,
  type PortSummary,
  type Tone,
} from "./spec";
