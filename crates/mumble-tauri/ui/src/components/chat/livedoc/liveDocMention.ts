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

declare module "@tiptap/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
          target: (el as HTMLElement).dataset.mentionSession ?? "",
          label: ((el as HTMLElement).textContent ?? "").replace(/^@/, ""),
        }),
      },
      {
        tag: "span[data-mention-role]",
        getAttrs: (el) => ({
          variant: "role",
          target: (el as HTMLElement).dataset.mentionRole ?? "",
          label: ((el as HTMLElement).textContent ?? "").replace(/^@/, ""),
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
        view: () => ({
          update(view) {
            const { state } = view;
            const sel = state.selection;
            if (!sel.empty) {
              onChange(null);
              return;
            }
            const $from = sel.$from;
            const parent = $from.parent;
            if (!parent.isTextblock) {
              onChange(null);
              return;
            }
            const before = parent.textBetween(0, $from.parentOffset, undefined, "￼");
            const trig = detectTrigger(before, before.length);
            if (!trig) {
              onChange(null);
              return;
            }
            const tokenStart = $from.start() + trig.offsetFromText;
            const tokenEnd = $from.pos;
            const coords = view.coordsAtPos(tokenEnd);
            onChange({
              from: tokenStart,
              to: tokenEnd,
              rect: { left: coords.left, top: coords.top, bottom: coords.bottom },
              query: trig.query,
              kind: trig.kind,
            });
          },
          destroy() {
            onChange(null);
          },
        }),
      }),
    ];
  },
});
