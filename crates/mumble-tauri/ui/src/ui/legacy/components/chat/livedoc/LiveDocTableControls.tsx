/**
 * LiveDocTableControls - floating toolbar pinned just above the cell
 * the editor caret is currently inside.
 *
 * Header cell -> "add column left / right" buttons.
 * Any non-header (body) cell -> "add row above / below" buttons.
 */

import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Selection, type EditorState } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import { addColumn, addRow, TableMap } from "@tiptap/pm/tables";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  PlusIcon,
} from "../../../icons";
import styles from "./LiveDocEditor.module.css";

export interface TablePresence {
  readonly cellPos: number;
  readonly cellNode: PmNode;
  readonly isHeaderCell: boolean;
  readonly tablePos: number;
  readonly rowIndex: number;
  readonly colIndex: number;
}

/** Walk the ProseMirror ancestor chain of the caret to locate the
 *  innermost table cell + its row/column index within the enclosing
 *  table.  Returns null when the selection is outside any table. */
export function findTablePresence(state: EditorState): TablePresence | null {
  const { $head } = state.selection;
  let cellDepth: number | null = null;
  let cellNode: PmNode | null = null;
  let rowDepth: number | null = null;
  let tableDepth: number | null = null;

  for (let d = $head.depth; d > 0; d--) {
    const node = $head.node(d);
    if (cellDepth === null && (node.type.name === "tableCell" || node.type.name === "tableHeader")) {
      cellDepth = d;
      cellNode = node;
    }
    if (rowDepth === null && node.type.name === "tableRow") {
      rowDepth = d;
    }
    if (node.type.name === "table") {
      tableDepth = d;
      break;
    }
  }
  if (cellDepth === null || cellNode === null || rowDepth === null || tableDepth === null) {
    return null;
  }
  return {
    cellPos: $head.before(cellDepth),
    cellNode,
    isHeaderCell: cellNode.type.name === "tableHeader",
    tablePos: $head.before(tableDepth),
    rowIndex: $head.index(tableDepth),
    colIndex: $head.index(rowDepth),
  };
}

export type TableEditAction = "rowBefore" | "rowAfter" | "colBefore" | "colAfter";

/** Insert a row / column adjacent to the current table cell and move
 *  the caret into the newly inserted cell - all in a single atomic
 *  transaction so no plugin (Yjs sync, collaboration cursor, etc.)
 *  can interleave a stale selection between an insert dispatch and a
 *  follow-up selection dispatch. */
export function performTableEdit(editor: Editor, action: TableEditAction): void {
  const before = findTablePresence(editor.state);
  if (!before) return;

  const { tablePos, rowIndex, colIndex } = before;
  const state = editor.state;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return;

  const tableStart = tablePos + 1;
  const map = TableMap.get(table);
  // addRow / addColumn from prosemirror-tables read map / tableStart /
  // table off the rect; the left/top/right/bottom fields are required
  // by the TableRect type but unused for these calls.
  const rect = {
    map, tableStart, table,
    left: colIndex, right: colIndex + 1,
    top: rowIndex, bottom: rowIndex + 1,
  };

  let tr = state.tr;
  let targetRow = rowIndex;
  let targetCol = colIndex;
  switch (action) {
    case "rowBefore":
      tr = addRow(tr, rect, rowIndex);
      break;
    case "rowAfter":
      tr = addRow(tr, rect, rowIndex + 1);
      targetRow = rowIndex + 1;
      break;
    case "colBefore":
      tr = addColumn(tr, rect, colIndex);
      break;
    case "colAfter":
      tr = addColumn(tr, rect, colIndex + 1);
      targetCol = colIndex + 1;
      break;
  }
  if (!tr.docChanged) return;

  const newTable = tr.doc.nodeAt(tablePos);
  if (newTable && newTable.type.name === "table") {
    const newMap = TableMap.get(newTable);
    if (
      targetRow >= 0 && targetRow < newMap.height &&
      targetCol >= 0 && targetCol < newMap.width
    ) {
      const cellAbsPos = tableStart + newMap.positionAt(targetRow, targetCol, newTable);
      if (cellAbsPos + 1 <= tr.doc.content.size) {
        tr.setSelection(Selection.near(tr.doc.resolve(cellAbsPos + 1), 1)).scrollIntoView();
      }
    }
  }

  editor.view.dispatch(tr);
  editor.view.focus();
}

interface ControlPosition {
  readonly top: number;
  readonly left: number;
  readonly isHeaderCell: boolean;
}

interface LiveDocTableControlsProps {
  readonly editor: Editor;
  readonly pageRef: RefObject<HTMLDivElement | null>;
}

export default function LiveDocTableControls({ editor, pageRef }: LiveDocTableControlsProps) {
  const { t } = useTranslation("chat");
  const [position, setPosition] = useState<ControlPosition | null>(null);

  const recompute = useCallback(() => {
    const page = pageRef.current;
    if (!page) {
      setPosition(null);
      return;
    }
    const presence = findTablePresence(editor.state);
    if (!presence) {
      setPosition(null);
      return;
    }
    const dom = editor.view.nodeDOM(presence.cellPos) as HTMLElement | null;
    if (!dom || typeof dom.getBoundingClientRect !== "function") {
      setPosition(null);
      return;
    }
    const pageRect = page.getBoundingClientRect();
    const cellRect = dom.getBoundingClientRect();
    setPosition({
      top: cellRect.top - pageRect.top,
      left: cellRect.left - pageRect.left,
      isHeaderCell: presence.isHeaderCell,
    });
  }, [editor, pageRef]);

  useEffect(() => {
    recompute();
    const handler = () => recompute();
    editor.on("selectionUpdate", handler);
    editor.on("update", handler);
    return () => {
      editor.off("selectionUpdate", handler);
      editor.off("update", handler);
    };
  }, [editor, recompute]);

  if (!position) return null;

  return (
    <div
      className={styles.tableControls}
      style={{ top: position.top - 34, left: position.left }}
      role="toolbar"
      aria-label={t("liveDoc.toolbar.tableControls")}
    >
      {position.isHeaderCell ? (
        <>
          <TableCtlBtn
            label={t("liveDoc.toolbar.addColLeft")}
            onClick={() => performTableEdit(editor, "colBefore")}
          >
            <ArrowLeftIcon width={12} height={12} aria-hidden="true" />
            <PlusIcon width={10} height={10} aria-hidden="true" />
          </TableCtlBtn>
          <TableCtlBtn
            label={t("liveDoc.toolbar.addColRight")}
            onClick={() => performTableEdit(editor, "colAfter")}
          >
            <PlusIcon width={10} height={10} aria-hidden="true" />
            <ArrowRightIcon width={12} height={12} aria-hidden="true" />
          </TableCtlBtn>
        </>
      ) : (
        <>
          <TableCtlBtn
            label={t("liveDoc.toolbar.addRowAbove")}
            onClick={() => performTableEdit(editor, "rowBefore")}
          >
            <ArrowUpIcon width={12} height={12} aria-hidden="true" />
            <PlusIcon width={10} height={10} aria-hidden="true" />
          </TableCtlBtn>
          <TableCtlBtn
            label={t("liveDoc.toolbar.addRowBelow")}
            onClick={() => performTableEdit(editor, "rowAfter")}
          >
            <PlusIcon width={10} height={10} aria-hidden="true" />
            <ArrowDownIcon width={12} height={12} aria-hidden="true" />
          </TableCtlBtn>
        </>
      )}
    </div>
  );
}

interface TableCtlBtnProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

function TableCtlBtn({ label, onClick, children }: TableCtlBtnProps) {
  return (
    <button
      type="button"
      className={styles.tableControlBtn}
      // Prevent the button from stealing focus so the editor selection
      // (which the chain commands rely on) survives the click.
      onMouseDown={(e) => e.preventDefault()}
      // Stop the click from bubbling to the editorScroll wrapper - its
      // click handler treats any click outside .editorContent as
      // "click in the gray area" and reroutes focus to the end of the
      // doc, which would yank the caret out of the cell we just moved
      // it into.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
