/**
 * LiveDocMention - Tiptap node + ProseMirror plugin that adds the same
 * `@user` / `@role` / `@everyone` / `@here` chips the chat composer
 * supports, with the same wire format (`<@SESSION>` / `<@&ROLE>`) so
 * Live Doc markdown round-trips into chat messages and back.
 *
 * The Node renders an inline `<span class="mention ..." data-mention-*>`
 * - matching the markup `applyMentionsToHtml` emits in chat messages
 * - so MentionPopover's document-level click delegation picks it up
 * automatically and shows the same profile / role popover.
 *
 * Trigger detection lives in a small ProseMirror plugin that calls
 * `onQueryChange` whenever the caret is inside an active `@` token.
 * The host React component owns the popup list and inserts a mention
 * node via `commands.insertContent` when the user picks a candidate.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocMention: {
      /** Insert a mention chip at the current caret. */
      insertMention: (attrs: MentionAttrs) => ReturnType;
    };
  }
}

export type MentionVariant = "user" | "role" | "everyone" | "here";

export interface MentionAttrs {
  variant: MentionVariant;
  /** Session id for "user", role name for "role", empty otherwise. */
  target: string;
  /** Display label (without leading @). */
  label: string;
}

export interface MentionTriggerState {
  /** Doc range of the `@token` (inclusive `from`, exclusive `to`). */
  from: number;
  to: number;
  /** Caret-aligned bounding rect (used to position the popover). */
  rect: { left: number; top: number; bottom: number };
  query: string;
  kind: "user" | "role";
}

export interface MentionPluginOptions {
  /** Called whenever the trigger state changes (active token or null). */
  onChange: (state: MentionTriggerState | null) => void;
}

export const mentionPluginKey = new PluginKey<null>("liveDocMentionTrigger");

/** Parse the text immediately before the caret looking for an active
 *  `@` trigger, mirroring [`parseMentionTrigger`] from chat. */
function detectTrigger(
  text: string,
  cursorInText: number,
): { kind: "user" | "role"; offsetFromText: number; query: string } | null {
  if (cursorInText < 1) return null;
  let i = cursorInText - 1;
  while (i >= 0) {
    const ch = text.charAt(i);
    if (ch === "@") break;
    if (/[\s<>]/.test(ch)) return null;
    i -= 1;
  }
  if (i < 0 || text.charAt(i) !== "@") return null;
  if (i > 0) {
    const prev = text.charAt(i - 1);
    if (!/\s/.test(prev)) return null;
  }
  const after = text.charAt(i + 1);
  const kind: "user" | "role" = after === "&" ? "role" : "user";
  const queryStart = kind === "role" ? i + 2 : i + 1;
  return { kind, offsetFromText: i, query: text.slice(queryStart, cursorInText) };
}

/** Value equality for trigger states, ignoring the caret `rect` (which is
 *  positional and derived from `from`/`to`).  Used to suppress redundant
 *  `onChange` emissions: the plugin's `view.update` fires on every editor
 *  update, and emitting a fresh object each time drives a
 *  re-render -> view-update -> emit feedback loop that freezes the app. */
function sameTrigger(
  a: MentionTriggerState | null,
  b: MentionTriggerState | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.from === b.from && a.to === b.to && a.query === b.query && a.kind === b.kind;
}

/** Compute the active mention trigger for the current selection, or null. */
function triggerForSelection(view: EditorView): MentionTriggerState | null {
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty) return null;
  const $from = sel.$from;
  if (!$from.parent.isTextblock) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const trig = detectTrigger(before, before.length);
  if (!trig) return null;
  const tokenEnd = $from.pos;
  const coords = view.coordsAtPos(tokenEnd);
  return {
    from: $from.start() + trig.offsetFromText,
    to: tokenEnd,
    rect: { left: coords.left, top: coords.top, bottom: coords.bottom },
    query: trig.query,
    kind: trig.kind,
  };
}

export const LiveDocMention = Node.create<MentionPluginOptions>({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return {
      onChange: () => undefined,
    };
  },

  addAttributes() {
    return {
      variant: { default: "user" as MentionVariant },
      target: { default: "" },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-mention-session]",
        getAttrs: (el) => ({
          variant: "user",
          target: el.dataset.mentionSession ?? "",
          label: (el.textContent ?? "").replace(/^@/, ""),
        }),
      },
      {
        tag: "span[data-mention-role]",
        getAttrs: (el) => ({
          variant: "role",
          target: el.dataset.mentionRole ?? "",
          label: (el.textContent ?? "").replace(/^@/, ""),
        }),
      },
      {
        tag: "span[data-mention-everyone]",
        getAttrs: () => ({ variant: "everyone", target: "", label: "everyone" }),
      },
      {
        tag: "span[data-mention-here]",
        getAttrs: () => ({ variant: "here", target: "", label: "here" }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as MentionAttrs;
    const dataAttrs: Record<string, string> = {};
    let cls = "mention";
    switch (attrs.variant) {
      case "user":
        dataAttrs["data-mention-session"] = attrs.target;
        cls += " mention-user";
        break;
      case "role":
        dataAttrs["data-mention-role"] = attrs.target;
        cls += " mention-role";
        break;
      case "everyone":
        dataAttrs["data-mention-everyone"] = "1";
        cls += " mention-everyone";
        break;
      case "here":
        dataAttrs["data-mention-here"] = "1";
        cls += " mention-here";
        break;
    }
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: cls, ...dataAttrs }),
      `@${attrs.label}`,
    ];
  },

  addCommands() {
    return {
      insertMention:
        (attrs: MentionAttrs) =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent([
              { type: this.name, attrs },
              { type: "text", text: " " },
            ])
            .run(),
    };
  },

  addProseMirrorPlugins() {
    const onChange = this.options.onChange;
    return [
      new Plugin({
        key: mentionPluginKey,
        view: () => {
          // Remember the last emitted trigger so we only notify React when
          // it genuinely changes.  Without this guard the unconditional
          // emit-per-update drives an infinite render loop (e.g. clicking
          // an inline-code span) that freezes the whole app.
          let last: MentionTriggerState | null = null;
          let primed = false;
          return {
            update(view) {
              const next = triggerForSelection(view);
              if (primed && sameTrigger(last, next)) return;
              primed = true;
              last = next;
              onChange(next);
            },
            destroy() {
              onChange(null);
            },
          };
        },
      }),
    ];
  },
});
