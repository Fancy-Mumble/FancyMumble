import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { HtmlSourceField, RichTextField, richTextSurvives, Stack, type RichTextTool } from "../../primitives";
import { PlainInput, useScrollGuard } from "../nodes";
import { MAX_BODY, switchView, writeMarkup, writeSections, type BodyView, type MessageNode } from "./model";
import { ScreenEditor } from "./ScreenEditor";

/**
 * A message node's body, in the three ways a message gets written.
 *
 * The node canvas decides *who* reads a greeting; this is where somebody
 * decides what it says, and it is the same editor Nebula writes bios and
 * channel descriptions with, widened to the document preset - a welcome screen
 * has headings, lists and centred text, and the bio schema silently dropped all
 * three.
 *
 * Three views, and each earns its place:
 *
 * * **Plain** is one line of prose, and most snippets are exactly that. It is
 *   also the only view that leaves the markup half off the wire, which matters
 *   on a server with `allow_html` switched off.
 * * **Rich** is the WYSIWYG.
 * * **HTML** is the source, and it is not a power-user affordance. An editor is
 *   a schema, and a document it has no node for comes back out of it *smaller*:
 *   a welcome text written by hand years ago can hold markup no WYSIWYG here can
 *   represent, and offering only the editor would flatten it the first time
 *   somebody fixed a typo - silently, in a field showing what looked like their
 *   own document. So a document that would not survive cannot be opened in the
 *   editor at all, and the row says why.
 *
 * A greeting has a fourth: **Screen**, where it is built out of bands - a hero,
 * a button, a row of links - that the client draws in its own type scale. It is
 * offered only on the greeting, because a snippet is a paragraph appended to
 * one and a paragraph has no hero in it.
 *
 * There is no image button, at any width. A picture is a data: URL several
 * times the 4096 characters the server takes for a body, and the greeting is
 * paid for on every join.
 */

/** What the toolbar offers a message body. Ordered as the toolbar reads. */
const TOOLS: readonly RichTextTool[] = [
  "bold",
  "italic",
  "underline",
  "strike",
  "heading",
  "lists",
  "align",
  "colour",
];

/**
 * When the character count appears.
 *
 * Not always: a counter under every node on a canvas of eleven is eleven
 * numbers nobody is reading. It shows once there is a reason to look, which is
 * near enough to the cap that the next paragraph might not fit.
 */
const COUNT_FROM = 0.7;

export function BodyEditor({
  node,
  placeholder,
  ariaLabel,
  minHeight,
  maxHeight,
  onPatch,
}: Readonly<{
  node: MessageNode;
  placeholder: string;
  ariaLabel: string;
  minHeight: number;
  maxHeight: number;
  onPatch: (patch: Partial<MessageNode>) => void;
}>) {
  const guard = useScrollGuard<HTMLDivElement>();
  // Skipped while the editor is the thing that wrote it: what comes out of
  // Tiptap survives Tiptap by construction, and the check is a parse and a
  // re-serialise that would otherwise run on every keystroke.
  const survives = useMemo(
    // A screen's markup is generated from its bands rather than typed, so it
    // is Tiptap's own output by construction and the check would only be
    // re-serialising it on every keystroke to learn that.
    () =>
      node.view === "rich" ||
      node.view === "screen" ||
      node.view === "legacy" ||
      richTextSurvives(node.html, "document"),
    [node.view, node.html],
  );
  // A document the editor cannot hold falls back to source however the view was
  // left, so nothing can put an operator in front of a lossy copy of their own
  // welcome text.
  const shown: BodyView = node.view === "rich" && !survives ? "source" : node.view;

  const written = shown === "plain" ? node.body : node.html;
  const used = [...written].length;
  // Only the greeting: a snippet is prose appended to one, and a hero inside a
  // paragraph appended to a greeting is not a thing that means anything.
  const screens = node.kind === "greeting";

  return (
    // The guard sits on a plain box rather than on the stack: it needs the DOM
    // element to hang a native listener on, and it is that element's subtree
    // the wheel has to be caught in.
    <Box ref={guard} sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <Stack direction="row" alignItems="center" gap={0.25}>
        <ViewButton on={shown === "plain"} label="Plain" onClick={() => onPatch(switchView(node, "plain"))} />
        <ViewButton
          on={shown === "rich"}
          // Not merely unselected: choosing it would rewrite the document, and
          // an operator cannot be expected to know that from a toolbar.
          disabled={!survives}
          title={survives ? undefined : LOSSY}
          label="Rich"
          onClick={() => onPatch(switchView(node, "rich"))}
        />
        <ViewButton
          on={shown === "source"}
          label="HTML"
          onClick={() => onPatch(switchView(node, "source"))}
        />
        {screens && (
          <ViewButton
            on={shown === "screen"}
            label="Screen"
            onClick={() => onPatch(switchView(node, "screen"))}
          />
        )}
        {screens && (
          <ViewButton
            on={shown === "legacy"}
            label="Qt"
            title="The same bands, compiled for Mumble 1.5 and older"
            onClick={() => onPatch(switchView(node, "legacy"))}
          />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        {used > MAX_BODY * COUNT_FROM && (
          <Typography
            sx={(theme) => ({
              flex: "none",
              fontSize: 9.5,
              fontVariantNumeric: "tabular-nums",
              color: used > MAX_BODY ? theme.palette.nebula.warn : theme.palette.nebula.dim,
            })}
          >
            {used}/{MAX_BODY}
          </Typography>
        )}
      </Stack>

      {shown === "plain" && (
        <PlainInput
          value={node.body}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          multiline
          onChange={(body) => onPatch({ body } as Partial<MessageNode>)}
        />
      )}

      {shown === "rich" && (
        <RichTextField
          value={node.html}
          onChange={(html) => onPatch(writeMarkup(html))}
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          preset="document"
          maxLength={MAX_BODY}
          tools={TOOLS}
          minHeight={minHeight}
          maxHeight={maxHeight}
        />
      )}

      {(shown === "screen" || shown === "legacy") && node.kind === "greeting" && (
        <>
          {shown === "legacy" && (
            <Typography
              sx={(theme) => ({ fontSize: 10, lineHeight: 1.45, color: theme.palette.nebula.muted })}
            >
              Compiled for Qt: tables, inline colour, no rounded corners. Wire it behind a client version
              condition so only the old clients get it.
            </Typography>
          )}
          <ScreenEditor
            sections={node.sections}
            onChange={(sections) => onPatch(writeSections(sections, shown))}
          />
        </>
      )}

      {shown === "source" && (
        <HtmlSourceField
          value={node.html}
          onChange={(html) => onPatch(writeMarkup(html))}
          ariaLabel={ariaLabel}
          minHeight={minHeight}
          maxHeight={maxHeight}
        />
      )}

      {!survives && (
        <Typography sx={(theme) => ({ fontSize: 10, lineHeight: 1.45, color: theme.palette.nebula.muted })}>
          {LOSSY}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Why the editor is refusing to open a document.
 *
 * Said in full rather than as "unsupported markup": the operator's question is
 * whether their welcome screen is broken, and the answer is that it is fine and
 * this editor is the thing that cannot be trusted with it.
 */
const LOSSY =
  "This markup uses tags the editor cannot hold without rewriting them - tables, most likely. Editing it here as HTML keeps it exactly as it is.";

/** One of the three views, as a pill in the node's own scale. */
function ViewButton({
  on,
  label,
  disabled,
  title,
  onClick,
}: Readonly<{
  on: boolean;
  label: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}>) {
  return (
    <Box
      component="button"
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={on}
      // A node is dragged by its header, but a press anywhere else must not
      // start a rubber band across the canvas behind it either.
      onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        flex: "none",
        px: "7px",
        py: "2px",
        cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: "999px",
        fontSize: 10,
        fontWeight: on ? 700 : 500,
        letterSpacing: "0.04em",
        opacity: disabled ? 0.45 : 1,
        color: on ? theme.palette.nebula.accent : theme.palette.nebula.dim,
        background: on ? theme.palette.nebula.accentSoft : "transparent",
        border: `1px solid ${on ? theme.palette.nebula.accentLine : "transparent"}`,
        "&:hover": disabled ? {} : { color: on ? theme.palette.nebula.accent : theme.palette.nebula.text },
      })}
    >
      {label}
    </Box>
  );
}
