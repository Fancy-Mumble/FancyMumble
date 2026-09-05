/**
 * Nebula's WYSIWYG text field.
 *
 * The same editor the Standard UI writes bios with - Tiptap, the same
 * extensions, the same HTML out - wearing Nebula's own colours instead of the
 * Standard stylesheet's, and reusable: what appears on the toolbar, whether the
 * field is one line or several, and how long the markup may get are all props.
 * A status line and a page of "about you" are the same component here, and so
 * is the next place that wants formatted text.
 *
 * What comes out is HTML, which is what the Mumble comment carries and what the
 * profile card renders. The card renders it through an allow-list rather than
 * trusting it (see `richText` in the shared card), so nothing here has to be
 * the thing that keeps a bio safe - this end only has to produce markup a
 * person meant to write.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, ClickAwayListener, useTheme } from "@mui/material";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { resizeImage } from "@core/features/settings/imageUtils";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  ImageIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
} from "@ui/icons";
import { richTextExtensions, type RichTextPreset } from "./richText";
import { Stack } from "./Stack";
import { radius } from "../../tokens";

/** A button the toolbar can carry. */
export type RichTextTool =
  "bold" | "italic" | "underline" | "strike" | "colour" | "image" | "heading" | "lists" | "align";

const DEFAULT_TOOLS: readonly RichTextTool[] = ["bold", "italic", "underline", "colour"];

/**
 * The headings a document offers.
 *
 * Deeper ones still survive the round trip - the schema carries all six - but
 * three is what a welcome screen uses and six buttons is a toolbar nobody
 * reads. Labelled from the live-doc catalogue, which already names these in
 * every locale this client ships.
 */
const HEADING_LEVELS = [
  { level: 1, labelKey: "chat:liveDoc.toolbar.h1" },
  { level: 2, labelKey: "chat:liveDoc.toolbar.h2" },
  { level: 3, labelKey: "chat:liveDoc.toolbar.h3" },
] as const;

/** The alignments, with the icon and the name each one gets. */
const ALIGNMENTS = [
  { value: "left", Icon: AlignLeftIcon, labelKey: "chat:liveDoc.toolbar.alignLeft" },
  { value: "center", Icon: AlignCenterIcon, labelKey: "chat:liveDoc.toolbar.alignCenter" },
  { value: "right", Icon: AlignRightIcon, labelKey: "chat:liveDoc.toolbar.alignRight" },
] as const;

/**
 * The quick-pick colours, matching the Standard UI's grid.
 *
 * A card can be repainted in anything, so a bio has to stay legible on a
 * surface this palette knows nothing about: these are the twelve that read on
 * both a light card and a dark one.
 */
const SWATCHES = [
  "#ffffff",
  "#cccccc",
  "#999999",
  "#ff4d4d",
  "#ff9933",
  "#ffcc00",
  "#66cc66",
  "#33bbff",
  "#9966ff",
  "#ff66cc",
  "#41b4f9",
  "#00ffaa",
];

/** Pictures ride inside the Mumble comment, so they are shrunk to fit one. */
const IMAGE_BOUND = { width: 400, height: 400, bytes: 80_000 };

/**
 * Drop a pasted screenshot into the document.
 *
 * Pasting a picture is how most people put one in, and without this the
 * clipboard's `<img src="blob:...">` arrives as a reference to a blob that does
 * not survive the paste - a broken image in the bio and nothing in the comment.
 * Read and shrunk here, it is carried by the profile itself.
 */
function pasteImage(view: EditorView, event: ClipboardEvent): boolean {
  const pasted = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
  if (!pasted) return false;
  event.preventDefault();
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const raw = reader.result;
    if (typeof raw !== "string") return;
    void resizeImage(raw, IMAGE_BOUND.width, IMAGE_BOUND.height, IMAGE_BOUND.bytes).then((src) => {
      const node = view.state.schema.nodes["image"].create({ src });
      view.dispatch(view.state.tr.replaceSelectionWith(node));
    });
  });
  reader.readAsDataURL(pasted);
  return true;
}

/** Tiptap writes this for an emptied document; the stores want "" for that. */
const EMPTY = "<p></p>";

export interface RichTextFieldProps {
  /** The markup being edited. */
  value: string;
  onChange: (html: string) => void;
  /** Called when the field is left - where a caller usually saves. */
  onCommit?: () => void;
  placeholder?: string;
  /**
   * One line: Enter is swallowed rather than starting a paragraph, which is
   * what a status is - the card flattens it to one line either way.
   */
  singleLine?: boolean;
  /** Cap on the markup, counted without embedded image data. */
  maxLength?: number;
  /**
   * How much document this field is willing to be.
   *
   * `prose` is the default because it is what a bio and a channel description
   * are, and widening the schema under them would change what they store.
   */
  preset?: RichTextPreset;
  tools?: readonly RichTextTool[];
  minHeight?: number;
  maxHeight?: number;
  /** Names the field for a screen reader, and for the tests. */
  ariaLabel: string;
  /**
   * Put the toolbar on a bar above the field rather than attached to its top.
   *
   * For editing something in place, where the field *is* the thing being laid
   * out: an attached toolbar would push the rest of the page down by 30px the
   * moment somebody clicked into a paragraph, and what they are editing would
   * no longer be where they clicked. Floated, the field keeps its own size and
   * the toolbar hangs over whatever is above it.
   */
  floating?: boolean;
  /** Extra controls at the end of the toolbar, for what a caller adds. */
  extras?: React.ReactNode;
}

export function RichTextField({
  value,
  onChange,
  onCommit,
  placeholder,
  singleLine = false,
  maxLength = 2000,
  preset = "prose",
  tools = DEFAULT_TOOLS,
  minHeight = singleLine ? 0 : 76,
  maxHeight = singleLine ? 0 : 220,
  ariaLabel,
  floating = false,
  extras,
}: Readonly<RichTextFieldProps>) {
  const { t } = useTranslation(["nebulaCommon", "nebulaChat", "chat"]);
  const { nebula } = useTheme().palette;
  const [swatches, setSwatches] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  // A `value` this component itself just produced must not be pushed back
  // through `setContent`, which would move the caret to the end mid-sentence.
  const echo = useRef(false);

  const extensions = useMemo(() => richTextExtensions(preset, placeholder ?? ""), [preset, placeholder]);

  const editor = useEditor({
    extensions,
    content: value,
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      const next = html === EMPTY ? "" : html;
      // Embedded pictures are most of the bytes and none of the writing, so
      // they are left out of the cap - otherwise one screenshot ends the
      // sentence someone is in the middle of.
      if (next.replaceAll(/src="data:[^"]+"/g, 'src=""').length > maxLength) return;
      echo.current = true;
      onChange(next);
    },
    editorProps: {
      attributes: { "aria-label": ariaLabel, role: "textbox" },
      handleKeyDown: singleLine ? (_view, event) => event.key === "Enter" && !event.shiftKey : undefined,
      handlePaste: singleLine ? undefined : pasteImage,
    },
  });

  // Follow the caller when it changes `value` underneath us - a profile
  // finishing its load, a reset - but never when we are the reason it changed.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (echo.current) {
      echo.current = false;
      return;
    }
    const current = editor.getHTML() === EMPTY ? "" : editor.getHTML();
    if (current !== value) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  const insertImage = useCallback(
    (chosen: File) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const raw = reader.result;
        if (typeof raw !== "string" || !editor) return;
        void resizeImage(raw, IMAGE_BOUND.width, IMAGE_BOUND.height, IMAGE_BOUND.bytes).then((src) =>
          editor.chain().focus().setImage({ src }).run(),
        );
      });
      reader.readAsDataURL(chosen);
    },
    [editor],
  );

  if (!editor) return null;

  const shown = new Set(tools);
  const colour = (editor.getAttributes("textStyle")["color"] as string | undefined) ?? nebula.text;

  return (
    <Box
      onBlur={(event) => {
        // Only when focus has left the field altogether - moving from the text
        // to a toolbar button is not leaving it.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onCommit?.();
      }}
      sx={{
        position: floating ? "relative" : "static",
        borderRadius: floating ? radius("sm") : radius("md"),
        background: floating ? "transparent" : nebula.card,
        border: `1px solid ${floating ? nebula.accent : nebula.line2}`,
        overflow: "visible",
        transition: "border-color 140ms ease",
        "&:focus-within": { borderColor: floating ? nebula.accent : nebula.accentLine },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={0.25}
        sx={
          floating
            ? {
                position: "absolute",
                zIndex: 35,
                top: "-38px",
                left: 0,
                px: "4px",
                py: "4px",
                whiteSpace: "nowrap",
                borderRadius: radius("md"),
                background: nebula.card,
                border: `1px solid ${nebula.line2}`,
                boxShadow: nebula.shadow,
              }
            : { px: "6px", py: "4px", borderBottom: `1px solid ${nebula.line}` }
        }
      >
        {shown.has("bold") && (
          <ToolButton
            editor={editor}
            mark="bold"
            label={t("chat:liveDoc.toolbar.bold")}
            onClick={(chain) => chain.toggleBold().run()}
          >
            <BoldIcon width={13} height={13} />
          </ToolButton>
        )}
        {shown.has("italic") && (
          <ToolButton
            editor={editor}
            mark="italic"
            label={t("chat:liveDoc.toolbar.italic")}
            onClick={(chain) => chain.toggleItalic().run()}
          >
            <ItalicIcon width={13} height={13} />
          </ToolButton>
        )}
        {shown.has("underline") && (
          <ToolButton
            editor={editor}
            mark="underline"
            label={t("nebulaCommon:richText.underline")}
            onClick={(chain) => chain.toggleUnderline().run()}
          >
            <Box component="span" sx={{ textDecoration: "underline", fontSize: 12.5, fontWeight: 600 }}>
              U
            </Box>
          </ToolButton>
        )}
        {shown.has("strike") && (
          <ToolButton
            editor={editor}
            mark="strike"
            label={t("chat:liveDoc.toolbar.strike")}
            onClick={(chain) => chain.toggleStrike().run()}
          >
            <Box component="span" sx={{ textDecoration: "line-through", fontSize: 12.5, fontWeight: 600 }}>
              S
            </Box>
          </ToolButton>
        )}

        {shown.has("heading") &&
          HEADING_LEVELS.map(({ level, labelKey }) => (
            <ToolButton
              key={level}
              editor={editor}
              active={editor.isActive("heading", { level })}
              label={t(labelKey)}
              onClick={(chain) => chain.toggleHeading({ level }).run()}
            >
              <Box component="span" sx={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1 }}>
                H{level}
              </Box>
            </ToolButton>
          ))}

        {shown.has("lists") && (
          <>
            <ToolButton
              editor={editor}
              mark="bulletList"
              label={t("chat:liveDoc.toolbar.bulletList")}
              onClick={(chain) => chain.toggleBulletList().run()}
            >
              <ListIcon width={13} height={13} />
            </ToolButton>
            <ToolButton
              editor={editor}
              mark="orderedList"
              label={t("chat:liveDoc.toolbar.orderedList")}
              onClick={(chain) => chain.toggleOrderedList().run()}
            >
              <ListOrderedIcon width={13} height={13} />
            </ToolButton>
          </>
        )}

        {shown.has("align") &&
          ALIGNMENTS.map(({ value: alignment, Icon, labelKey }) => (
            <ToolButton
              key={alignment}
              editor={editor}
              active={editor.isActive({ textAlign: alignment })}
              label={t(labelKey)}
              onClick={(chain) => chain.setTextAlign(alignment).run()}
            >
              <Icon width={13} height={13} />
            </ToolButton>
          ))}

        {shown.has("colour") && (
          <ClickAwayListener onClickAway={() => setSwatches(false)}>
            <Box sx={{ position: "relative", display: "inline-flex" }}>
              <ToolButton
                editor={editor}
                active={swatches}
                label={t("nebulaCommon:richText.textColour")}
                onClick={() => setSwatches((open) => !open)}
              >
                <Box
                  component="span"
                  sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1, borderBottom: `3px solid ${colour}` }}
                >
                  A
                </Box>
              </ToolButton>
              {swatches && (
                <Swatches
                  onPick={(picked) => {
                    editor.chain().focus().setColor(picked).run();
                    setSwatches(false);
                  }}
                  onClear={() => {
                    editor.chain().focus().unsetColor().run();
                    setSwatches(false);
                  }}
                />
              )}
            </Box>
          </ClickAwayListener>
        )}

        {shown.has("image") && (
          <>
            <Box
              component="input"
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              sx={{ display: "none" }}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const chosen = event.target.files?.[0];
                if (chosen) insertImage(chosen);
                event.target.value = "";
              }}
            />
            <ToolButton
              editor={editor}
              label={t("nebulaCommon:richText.insertImage")}
              onClick={() => file.current?.click()}
            >
              <ImageIcon width={13} height={13} />
            </ToolButton>
          </>
        )}
        {extras}
      </Stack>

      <Box
        sx={{
          px: "13px",
          py: singleLine ? "8px" : "10px",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: nebula.text,
          "& .tiptap": {
            outline: "none",
            ...(minHeight ? { minHeight } : {}),
            ...(maxHeight ? { maxHeight, overflowY: "auto" } : {}),
          },
          "& p": { margin: 0 },
          "& p + p": { marginTop: "0.5em" },
          // A document preset renders structure, so the structure has to look
          // like itself here as well as where it is finally read.
          "& h1, & h2, & h3, & h4, & h5, & h6": {
            margin: "0.6em 0 0.3em",
            lineHeight: 1.25,
            fontWeight: 700,
          },
          "& h1": { fontSize: "1.6em" },
          "& h2": { fontSize: "1.35em" },
          "& h3": { fontSize: "1.15em" },
          "& ul, & ol": { margin: "0.4em 0", paddingLeft: "1.4em" },
          "& li": { margin: "0.15em 0" },
          "& li > p": { margin: 0 },
          "& blockquote": {
            margin: "0.5em 0",
            paddingLeft: "0.8em",
            borderLeft: `2px solid ${nebula.line2}`,
            color: nebula.muted,
          },
          "& hr": { border: 0, borderTop: `1px solid ${nebula.line2}`, margin: "0.8em 0" },
          "& table": { borderCollapse: "collapse", margin: "0.5em 0" },
          "& td, & th": { border: `1px solid ${nebula.line2}`, padding: "3px 6px" },
          "& pre": {
            margin: "0.5em 0",
            padding: "6px 8px",
            borderRadius: radius("sm"),
            background: nebula.card2,
            overflowX: "auto",
          },
          "& img": {
            maxWidth: "100%",
            height: "auto",
            borderRadius: radius("md"),
            display: "block",
            margin: "4px 0",
          },
          // The card draws a link in its accent; the field has to agree, or
          // what is being written does not look like what will be read.
          "& a": { color: nebula.accent, textDecoration: "underline" },
          // The Placeholder extension marks the empty document; the hint has to
          // sit in the flow without taking a line of its own.
          "& p.is-editor-empty:first-of-type::before": {
            content: "attr(data-placeholder)",
            color: nebula.dim,
            pointerEvents: "none",
            float: "left",
            height: 0,
          },
        }}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}

function ToolButton({
  editor,
  mark,
  active,
  label,
  onClick,
  children,
}: Readonly<{
  editor: Editor;
  mark?: string;
  active?: boolean;
  label: string;
  onClick: (chain: ReturnType<Editor["chain"]>) => void;
  children: React.ReactNode;
}>) {
  const on = active ?? (mark ? editor.isActive(mark) : false);
  return (
    <Box
      component="button"
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      // The selection has to survive the click, or a mark would be applied to
      // nothing: the button never takes focus off the text.
      onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
      onClick={() => onClick(editor.chain().focus())}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 24,
        borderRadius: radius("sm"),
        color: on ? theme.palette.nebula.accent : theme.palette.nebula.muted,
        background: on ? theme.palette.nebula.accentSoft : "transparent",
        "&:hover": { background: on ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover },
        "&:focus-visible": { outline: `2px solid ${theme.palette.nebula.accentLine}`, outlineOffset: 1 },
      })}
    >
      {children}
    </Box>
  );
}

function Swatches({ onPick, onClear }: Readonly<{ onPick: (colour: string) => void; onClear: () => void }>) {
  const { t } = useTranslation("nebulaCommon");
  return (
    <Box
      sx={(theme) => ({
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 20,
        p: "8px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.bg0,
        border: `1px solid ${theme.palette.nebula.line2}`,
        boxShadow: theme.palette.nebula.shadow,
      })}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(6, 20px)", gap: "4px" }}>
        {SWATCHES.map((swatch) => (
          <Box
            key={swatch}
            component="button"
            type="button"
            aria-label={`Colour ${swatch}`}
            onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
            onClick={() => onPick(swatch)}
            sx={{
              all: "unset",
              cursor: "pointer",
              width: 20,
              height: 20,
              borderRadius: radius("sm"),
              background: swatch,
              border: "2px solid transparent",
              "&:hover": { transform: "scale(1.12)" },
            }}
          />
        ))}
      </Box>
      <Box
        component="button"
        type="button"
        onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
        onClick={onClear}
        sx={(theme) => ({
          all: "unset",
          cursor: "pointer",
          display: "block",
          textAlign: "center",
          width: "100%",
          mt: "6px",
          py: "3px",
          borderRadius: radius("sm"),
          fontSize: 11,
          color: theme.palette.nebula.muted,
          background: theme.palette.nebula.card2,
          "&:hover": { color: theme.palette.nebula.text },
        })}
      >
        {t("richText.resetColour")}
      </Box>
    </Box>
  );
}
