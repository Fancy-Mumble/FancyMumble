/**
 * Regression tests for the table-presence helper that drives
 * LiveDocTableControls. Verifies the helper correctly classifies
 * the caret as inside a header cell or a body cell, returns the
 * cell's pmPos so the floating toolbar can be placed above that
 * specific cell, and reports null when the caret is outside any
 * table.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import { findTablePresence, performTableEdit } from "../chat/livedoc/LiveDocTableControls";

function makeEditor(): Editor {
  return new Editor({
    extensions: [StarterKit, Table, TableRow, TableHeader, TableCell],
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H1" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H2" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A1" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A2" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B1" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B2" }] }] },
              ],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "outside" }] },
      ],
    },
  });
}

/** Find the first text position inside the first descendant of `parent`
 *  whose node type matches `typeName`. Returns the absolute doc pos. */
function findCaretInto(editor: Editor, typeName: string, occurrence: number): number {
  let found: number | null = null;
  let seen = 0;
  editor.state.doc.descendants((node: PmNode, pos: number) => {
    if (found !== null) return false;
    if (node.type.name === typeName) {
      if (seen === occurrence) {
        // pos points at the cell node; +2 lands inside its paragraph.
        found = pos + 2;
        return false;
      }
      seen += 1;
    }
    return true;
  });
  if (found === null) throw new Error(`no ${typeName} #${occurrence} found`);
  return found;
}

function setCaret(editor: Editor, pos: number): void {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos));
  editor.view.dispatch(tr);
}

describe("findTablePresence", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("returns null when caret is outside any table", () => {
    editor = makeEditor();
    const outsidePos = findCaretInto(editor, "paragraph", 6); // first non-table paragraph
    setCaret(editor, outsidePos);
    expect(findTablePresence(editor.state)).toBeNull();
  });

  it("flags a header cell as isHeaderCell and returns that cell's pos", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableHeader", 0));
    const presence = findTablePresence(editor.state);
    expect(presence).not.toBeNull();
    expect(presence?.isHeaderCell).toBe(true);
    expect(presence?.cellNode.type.name).toBe("tableHeader");
  });

  it("flags a first non-header (row 2) body cell as not isHeaderCell", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableCell", 0)); // row 2, col 1
    const presence = findTablePresence(editor.state);
    expect(presence?.isHeaderCell).toBe(false);
    expect(presence?.cellNode.type.name).toBe("tableCell");
  });

  it("flags a last-row body cell as not isHeaderCell", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableCell", 2)); // first cell of row B (last row)
    const presence = findTablePresence(editor.state);
    expect(presence?.isHeaderCell).toBe(false);
    expect(presence?.cellNode.type.name).toBe("tableCell");
  });

  it("returns distinct cellPos values for distinct cells", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableHeader", 0));
    const first = findTablePresence(editor.state)?.cellPos;
    setCaret(editor, findCaretInto(editor, "tableHeader", 1));
    const second = findTablePresence(editor.state)?.cellPos;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it("reports row/col index for a body cell", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableCell", 1)); // row 2, col 2 (zero-indexed: row 1, col 1)
    const presence = findTablePresence(editor.state);
    expect(presence?.rowIndex).toBe(1);
    expect(presence?.colIndex).toBe(1);
  });
});

describe("performTableEdit", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("addRowAfter inserts a row below and moves caret into the new row", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableCell", 0)); // row 2, col 1
    const before = findTablePresence(editor.state);
    expect(before?.rowIndex).toBe(1);

    performTableEdit(editor, "rowAfter");

    const after = findTablePresence(editor.state);
    expect(after?.rowIndex).toBe(2); // moved into the newly inserted row
    expect(after?.colIndex).toBe(0); // same column
    expect(after?.isHeaderCell).toBe(false);
  });

  it("addRowBefore inserts a row above and moves caret into the new row", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableCell", 2)); // row 3, col 1
    performTableEdit(editor, "rowBefore");

    const after = findTablePresence(editor.state);
    expect(after?.rowIndex).toBe(2); // new row is now at index 2; original shifted to 3
    expect(after?.colIndex).toBe(0);
  });

  it("addColumnAfter inserts a column to the right and moves caret into it", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableHeader", 0)); // header row, col 1
    performTableEdit(editor, "colAfter");

    const after = findTablePresence(editor.state);
    expect(after?.colIndex).toBe(1); // new column is at index 1
    expect(after?.isHeaderCell).toBe(true); // header row -> new cell is also header
  });

  it("addColumnBefore inserts a column to the left and moves caret into it", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "tableHeader", 1)); // header row, col 2
    performTableEdit(editor, "colBefore");

    const after = findTablePresence(editor.state);
    expect(after?.colIndex).toBe(1); // new column inserted at index 1; original shifted to 2
    expect(after?.isHeaderCell).toBe(true);
  });

  it("is a no-op when the caret is outside any table", () => {
    editor = makeEditor();
    setCaret(editor, findCaretInto(editor, "paragraph", 6));
    const sizeBefore = editor.state.doc.content.size;
    performTableEdit(editor, "colAfter");
    expect(editor.state.doc.content.size).toBe(sizeBefore);
  });
});
