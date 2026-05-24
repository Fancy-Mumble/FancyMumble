/**
 * Regression test for the bug where a click on a table-controls
 * button bubbled up to the editor scroll wrapper - whose onClick
 * focuses the editor at the end of the document - and yanked the
 * caret out of the cell `performTableEdit` had just moved it into.
 *
 * The fix is `e.stopPropagation()` inside `TableCtlBtn.onClick`.
 * This test ensures the propagation stops at the button.
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TextSelection } from "@tiptap/pm/state";
import { useRef } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import LiveDocTableControls from "../chat/livedoc/LiveDocTableControls";

function makeEditorWithCaretInHeader(): Editor {
  const editor = new Editor({
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
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph" }] },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
      ],
    },
  });
  // Park caret inside the first header cell (pos 3 lands inside the first
  // tableHeader's paragraph).
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3));
  editor.view.dispatch(tr);
  return editor;
}

function Harness({ editor, onWrapperClick }: { editor: Editor; onWrapperClick: () => void }) {
  const pageRef = useRef<HTMLDivElement>(null);
  return (
    <div onClick={onWrapperClick} data-testid="wrapper">
      <div ref={pageRef}>
        <LiveDocTableControls editor={editor} pageRef={pageRef} />
      </div>
    </div>
  );
}

describe("LiveDocTableControls click propagation", () => {
  it("clicking a control button does not bubble to the editor wrapper", () => {
    const editor = makeEditorWithCaretInHeader();
    const wrapperOnClick = vi.fn();
    try {
      const { getByLabelText } = render(
        <Harness editor={editor} onWrapperClick={wrapperOnClick} />,
      );
      const btn = getByLabelText("liveDoc.toolbar.addColRight");
      fireEvent.click(btn);
      expect(wrapperOnClick).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });
});
