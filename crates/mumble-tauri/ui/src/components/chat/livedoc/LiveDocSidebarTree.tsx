/**
 * Recursive renderer for the Live Doc sidebar tree.  Renders each
 * section as a top-level folder; folders nest arbitrarily and contain
 * document links.  All mutations go through `useLiveDocSidebarStore`.
 *
 * Folders/sections and document links can be reorganised by drag and
 * drop: drop a node onto a folder/section to move it inside, or onto the
 * root drop zone at the bottom to promote a folder to a top-level
 * section.  Dragging is implemented with **pointer events** (not the
 * HTML5 drag-and-drop API) because Tauri's webview intercepts OS-level
 * drag-and-drop, so native `drop` events never reach our elements - the
 * same reason `ServerTabsBar` uses pointer events.
 */

import { createContext, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EditIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  LockIcon,
  PlusIcon,
  TrashIcon,
} from "../../../icons";
import type { LiveDocDocLink, LiveDocFolder } from "../../../types";
import ConfirmDialog from "../../elements/ConfirmDialog";
import { openPrompt } from "../../elements/promptDialogStore";
import { useLiveDocSidebarStore } from "./sidebarStore";
import styles from "./LiveDocSidebar.module.css";

/** Movement past this many pixels promotes a press into a drag. */
const DRAG_THRESHOLD_PX = 4;
/** Sentinel drop-target id for the bottom "promote to section" zone. */
const ROOT_DROP_ID = "__livedoc_root__";

/** What is currently being dragged. */
type DragItem =
  | { readonly kind: "folder"; readonly id: string }
  | { readonly kind: "doc"; readonly link: LiveDocDocLink; readonly parentId: string };

/** Stable key used to mark the dragged row as "lifted". */
function dragKey(item: DragItem): string {
  return item.kind === "folder" ? `f:${item.id}` : `d:${item.parentId}:${item.link.slug}`;
}

/** Drag controller shared with every row via context. */
interface DndApi {
  begin: (item: DragItem, label: string, e: React.PointerEvent) => void;
  move: (e: React.PointerEvent) => void;
  /** Completes the gesture; returns `true` when it was a drag (so the
   *  caller suppresses its click/activation), `false` for a plain tap. */
  end: (e: React.PointerEvent) => boolean;
  cancel: () => void;
  readonly draggingKey: string | null;
  readonly dropTargetId: string | null;
}
const DndCtx = createContext<DndApi | null>(null);

/** Resolve the drop-target folder id under a screen point by walking up
 *  from the topmost element to the nearest `data-drop-folder-id`. */
function folderIdAtPoint(x: number, y: number): string | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    const id = el.dataset?.dropFolderId;
    if (id) return id;
    el = el.parentElement;
  }
  return null;
}

interface TreeProps {
  readonly sections: ReadonlyArray<LiveDocFolder>;
  readonly currentSlug: string;
  readonly onOpenDoc: (link: LiveDocDocLink) => void;
  readonly onCreateDocInFolder?: (folderId: string) => void;
  readonly onRenameActiveDoc?: (slug: string, title: string) => void;
}

export default function LiveDocSidebarTree({
  sections,
  currentSlug,
  onOpenDoc,
  onCreateDocInFolder,
  onRenameActiveDoc,
}: TreeProps) {
  const { t } = useTranslation("chat");
  const moveNode = useLiveDocSidebarStore((s) => s.moveNode);
  const moveDoc = useLiveDocSidebarStore((s) => s.moveDoc);
  const dragRef = useRef<{
    item: DragItem;
    label: string;
    pointerId: number;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const ghostPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [ghost, setGhost] = useState<{ label: string; kind: DragItem["kind"] } | null>(null);

  const positionGhost = (x: number, y: number) => {
    ghostPointRef.current = { x, y };
    const el = ghostElRef.current;
    if (el) el.style.transform = `translate(${x + 12}px, ${y + 14}px)`;
  };

  const validTarget = (item: DragItem, target: string | null): boolean => {
    if (!target) return false;
    if (target === ROOT_DROP_ID) return item.kind === "folder";
    // Dropping a folder onto itself is a no-op; the model also refuses
    // descendant moves, but blocking self here avoids a misleading
    // highlight.
    if (item.kind === "folder" && item.id === target) return false;
    return true;
  };

  const dnd = useMemo<DndApi>(
    () => ({
      begin: (item, label, e) => {
        dragRef.current = {
          item,
          label,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          started: false,
        };
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // Capture can fail if the pointer was already released; ignore.
        }
      },
      move: (e) => {
        const st = dragRef.current;
        if (!st || st.pointerId !== e.pointerId) return;
        if (!st.started) {
          if (
            Math.abs(e.clientX - st.startX) < DRAG_THRESHOLD_PX &&
            Math.abs(e.clientY - st.startY) < DRAG_THRESHOLD_PX
          ) {
            return;
          }
          st.started = true;
          setDraggingKey(dragKey(st.item));
          positionGhost(e.clientX, e.clientY);
          setGhost({ label: st.label, kind: st.item.kind });
        }
        positionGhost(e.clientX, e.clientY);
        const target = folderIdAtPoint(e.clientX, e.clientY);
        setDropTargetId(validTarget(st.item, target) ? target : null);
      },
      end: (e) => {
        const st = dragRef.current;
        dragRef.current = null;
        setDraggingKey(null);
        setDropTargetId(null);
        setGhost(null);
        if (!st || !st.started) return false;
        const target = folderIdAtPoint(e.clientX, e.clientY);
        if (validTarget(st.item, target) && target) {
          if (st.item.kind === "folder") {
            moveNode(st.item.id, target === ROOT_DROP_ID ? null : target);
          } else if (target !== ROOT_DROP_ID) {
            moveDoc(st.item.link, st.item.parentId, target);
          }
        }
        return true;
      },
      cancel: () => {
        dragRef.current = null;
        setDraggingKey(null);
        setDropTargetId(null);
        setGhost(null);
      },
      draggingKey,
      dropTargetId,
    }),
    [moveNode, moveDoc, draggingKey, dropTargetId],
  );

  if (sections.length === 0) {
    return <div className={styles.empty}>{t("liveDoc.sidebar.empty")}</div>;
  }
  return (
    <DndCtx.Provider value={dnd}>
      <div>
        {sections.map((section) => (
          <FolderNode
            key={section.id}
            node={section}
            depth={0}
            isSection
            currentSlug={currentSlug}
            onOpenDoc={onOpenDoc}
            onCreateDocInFolder={onCreateDocInFolder}
            onRenameActiveDoc={onRenameActiveDoc}
          />
        ))}
        {/* Drop a folder here to promote it to a top-level section. */}
        <div
          className={`${styles.rootDropZone} ${dropTargetId === ROOT_DROP_ID ? styles.rootDropZoneActive : ""}`}
          data-drop-folder-id={ROOT_DROP_ID}
        />
      </div>
      {ghost &&
        createPortal(
          <div
            ref={ghostElRef}
            className={styles.dragGhost}
            style={{
              transform: `translate(${ghostPointRef.current.x + 12}px, ${ghostPointRef.current.y + 14}px)`,
            }}
            aria-hidden="true"
          >
            {ghost.kind === "folder" ? (
              <FolderIcon width={14} height={14} aria-hidden="true" />
            ) : (
              <FileTextIcon width={14} height={14} aria-hidden="true" />
            )}
            <span className={styles.dragGhostLabel}>{ghost.label}</span>
          </div>,
          document.body,
        )}
    </DndCtx.Provider>
  );
}

interface NodeProps {
  readonly node: LiveDocFolder;
  readonly depth: number;
  readonly isSection: boolean;
  readonly currentSlug: string;
  readonly onOpenDoc: (link: LiveDocDocLink) => void;
  readonly onCreateDocInFolder?: (folderId: string) => void;
  readonly onRenameActiveDoc?: (slug: string, title: string) => void;
}

function FolderNode({
  node,
  depth,
  isSection,
  currentSlug,
  onOpenDoc,
  onCreateDocInFolder,
  onRenameActiveDoc,
}: NodeProps) {
  const { t } = useTranslation("chat");
  const dnd = useContext(DndCtx);
  const [open, setOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const startedHere = useRef(false);
  const addFolder = useLiveDocSidebarStore((s) => s.addFolder);
  const renameNode = useLiveDocSidebarStore((s) => s.renameNode);
  const removeNode = useLiveDocSidebarStore((s) => s.removeNode);

  const onAddFolder = () => {
    void openPrompt({
      title: t("liveDoc.sidebar.newFolder"),
      label: t("liveDoc.sidebar.newFolderPrompt"),
    }).then((name) => {
      if (name?.trim()) addFolder(node.id, name);
    });
  };
  const onRename = () => {
    void openPrompt({
      title: t("liveDoc.sidebar.rename"),
      label: t("liveDoc.sidebar.renamePrompt"),
      defaultValue: node.name,
    }).then((name) => {
      if (name?.trim()) renameNode(node.id, name);
    });
  };

  const isDragTarget = dnd?.dropTargetId === node.id;
  const isLifted = dnd?.draggingKey === `f:${node.id}`;

  return (
    <div>
      <div
        className={`${styles.row} ${isDragTarget ? styles.dragOver : ""} ${isLifted ? styles.dragging : ""}`.trim()}
        style={{ paddingLeft: 8 + depth * 12 }}
        role="button"
        tabIndex={0}
        data-drop-folder-id={node.id}
        onPointerDown={(e) => {
          // Leave the action buttons (rename/delete/...) to their own
          // click handlers; only the row body initiates a drag.
          if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
          startedHere.current = true;
          dnd?.begin({ kind: "folder", id: node.id }, node.name, e);
        }}
        onPointerMove={(e) => dnd?.move(e)}
        onPointerUp={(e) => {
          if (!startedHere.current) return;
          startedHere.current = false;
          const wasDrag = dnd?.end(e) ?? false;
          if (!wasDrag) setOpen((v) => !v);
        }}
        onPointerCancel={() => {
          startedHere.current = false;
          dnd?.cancel();
        }}
        onKeyDown={(e) => e.key === "Enter" && setOpen((v) => !v)}
      >
        <span className={styles.caret}>
          {open ? (
            <ChevronDownIcon width={14} height={14} />
          ) : (
            <ChevronRightIcon width={14} height={14} />
          )}
        </span>
        {!isSection && <FolderIcon width={14} height={14} aria-hidden="true" />}
        <span className={`${styles.rowLabel} ${isSection ? styles.sectionName : ""}`}>
          {node.name}
        </span>
        <span className={styles.rowActions}>
          {onCreateDocInFolder && (
            <button type="button" className={styles.miniBtn} onClick={(e) => { e.stopPropagation(); onCreateDocInFolder(node.id); }} title={t("liveDoc.sidebar.newDocumentHere")}>
              <FileTextIcon width={13} height={13} />
            </button>
          )}
          <button type="button" className={styles.miniBtn} onClick={(e) => { e.stopPropagation(); onAddFolder(); }} title={t("liveDoc.sidebar.newFolder")}>
            <PlusIcon width={13} height={13} />
          </button>
          <button type="button" className={styles.miniBtn} onClick={(e) => { e.stopPropagation(); onRename(); }} title={t("liveDoc.sidebar.rename")}>
            <EditIcon width={13} height={13} />
          </button>
          <button type="button" className={styles.miniBtn} onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }} title={t("liveDoc.sidebar.delete")}>
            <TrashIcon width={13} height={13} />
          </button>
        </span>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t("liveDoc.sidebar.delete")}
          body={t("liveDoc.sidebar.deleteConfirm", { name: node.name })}
          confirmLabel={t("liveDoc.sidebar.delete")}
          danger
          onConfirm={() => { removeNode(node.id); setConfirmDelete(false); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {open && (
        <div>
          {node.folders.map((f) => (
            <FolderNode
              key={f.id}
              node={f}
              depth={depth + 1}
              isSection={false}
              currentSlug={currentSlug}
              onOpenDoc={onOpenDoc}
              onCreateDocInFolder={onCreateDocInFolder}
              onRenameActiveDoc={onRenameActiveDoc}
            />
          ))}
          {node.docs.map((doc) => (
            <DocRow
              key={doc.slug}
              doc={doc}
              parentId={node.id}
              depth={depth + 1}
              active={doc.slug === currentSlug}
              onOpenDoc={onOpenDoc}
              onRenameActiveDoc={onRenameActiveDoc}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DocRowProps {
  readonly doc: LiveDocDocLink;
  readonly parentId: string;
  readonly depth: number;
  readonly active: boolean;
  readonly onOpenDoc: (link: LiveDocDocLink) => void;
  readonly onRenameActiveDoc?: (slug: string, title: string) => void;
}

function DocRow({ doc, parentId, depth, active, onOpenDoc, onRenameActiveDoc }: DocRowProps) {
  const { t } = useTranslation("chat");
  const dnd = useContext(DndCtx);
  const startedHere = useRef(false);
  const removeDocLink = useLiveDocSidebarStore((s) => s.removeDocLink);
  const renameDocLink = useLiveDocSidebarStore((s) => s.renameDocLink);
  const onRename = () => {
    void openPrompt({
      title: t("liveDoc.sidebar.renameDoc"),
      label: t("liveDoc.sidebar.renameDocPrompt"),
      defaultValue: doc.title,
    }).then((name) => {
      const trimmed = name?.trim();
      if (!trimmed) return;
      renameDocLink(doc.slug, trimmed);
      if (active) onRenameActiveDoc?.(doc.slug, trimmed);
    });
  };

  const isLifted = dnd?.draggingKey === `d:${parentId}:${doc.slug}`;

  return (
    <div
      className={`${styles.row} ${active ? styles.docActive : ""} ${isLifted ? styles.dragging : ""}`.trim()}
      style={{ paddingLeft: 8 + depth * 12 }}
      role="button"
      tabIndex={0}
      // Dropping onto a document lands in its containing folder.
      data-drop-folder-id={parentId}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        startedHere.current = true;
        dnd?.begin({ kind: "doc", link: doc, parentId }, doc.title, e);
      }}
      onPointerMove={(e) => dnd?.move(e)}
      onPointerUp={(e) => {
        if (!startedHere.current) return;
        startedHere.current = false;
        const wasDrag = dnd?.end(e) ?? false;
        if (!wasDrag) onOpenDoc(doc);
      }}
      onPointerCancel={() => {
        startedHere.current = false;
        dnd?.cancel();
      }}
      onKeyDown={(e) => e.key === "Enter" && onOpenDoc(doc)}
      title={doc.title}
    >
      <span className={styles.caret} />
      <FileTextIcon width={14} height={14} aria-hidden="true" />
      <span className={styles.rowLabel}>{doc.title}</span>
      {doc.channel === null ? (
        <LockIcon width={12} height={12} aria-label={t("liveDoc.private")} />
      ) : (
        <GlobeIcon width={12} height={12} aria-label={t("liveDoc.published")} />
      )}
      <span className={styles.rowActions}>
        <button
          type="button"
          className={styles.miniBtn}
          onClick={(e) => { e.stopPropagation(); onRename(); }}
          title={t("liveDoc.sidebar.renameDoc")}
        >
          <EditIcon width={13} height={13} />
        </button>
        <button
          type="button"
          className={styles.miniBtn}
          onClick={(e) => { e.stopPropagation(); removeDocLink(parentId, doc.slug); }}
          title={t("liveDoc.sidebar.removeLink")}
        >
          <TrashIcon width={13} height={13} />
        </button>
      </span>
    </div>
  );
}
