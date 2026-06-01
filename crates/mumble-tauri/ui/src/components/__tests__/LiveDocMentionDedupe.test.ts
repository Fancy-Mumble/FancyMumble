/**
 * Regression test for the "clicking inline code freezes the app" bug.
 *
 * Root cause: the LiveDocMention ProseMirror plugin emitted `onChange`
 * on *every* editor view update.  In the live editor each emission sets
 * React state, which re-renders and re-syncs the ProseMirror view, which
 * fires another view update -> another emission -> an infinite
 * render loop ("Maximum update depth exceeded") that froze the whole app.
 *
 * The fix dedupes emissions: `onChange` only fires when the active mention
 * trigger genuinely changes.  This test drives many redundant view updates
 * for an unchanged selection and asserts the plugin emits only once.
 */
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { LiveDocMention, type MentionTriggerState } from "../chat/livedoc/liveDocMention";

function makeEditor(onChange: (s: MentionTriggerState | null) => void): Editor {
  return new Editor({
    extensions: [StarterKit, LiveDocMention.configure({ onChange })],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hello " },
            { type: "text", marks: [{ type: "code" }], text: "codeword" },
            { type: "text", text: " tail" },
          ],
        },
      ],
    },
  });
}

describe("LiveDocMention trigger dedupe", () => {
  it("does not re-emit onChange for redundant view updates (freeze guard)", () => {
    const onChange = vi.fn();
    const editor = makeEditor(onChange);
    try {
      // Park the caret inside the inline-code span (no active "@" trigger).
      editor.commands.setTextSelection(9);
      const baseline = onChange.mock.calls.length;

      // Simulate the re-render -> view-sync churn that previously drove the
      // infinite loop: many no-op meta transactions, each of which runs the
      // plugin's `view.update`.
      for (let n = 0; n < 25; n += 1) {
        editor.view.dispatch(editor.state.tr.setMeta("noop", n));
      }

      // Without the dedupe guard this would grow by ~25 (one per update),
      // which in the live editor is the runaway render loop.
      expect(onChange.mock.calls.length).toBe(baseline);
      expect(onChange).toHaveBeenLastCalledWith(null);
    } finally {
      editor.destroy();
    }
  });
});
