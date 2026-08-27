import { Fragment } from "react";
import { Box, Tooltip } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { isApple } from "@core/utils/platform";
import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  SmileIcon,
  StrikethroughIcon,
} from "@ui/icons";
import { Stack } from "../primitives";
import { floatingSurface } from "../../theme";
import { radius } from "../../tokens";

/**
 * What a formatting button does to the draft.
 *
 * A mark wraps the selection in the two markers it is written with; a list is
 * a property of whole lines and so names its kind instead. Both are carried
 * out by `MarkdownInput`, which owns the dialect - this only says which.
 */
export type FormatAction =
  { kind: "mark"; before: string; after: string } | { kind: "list"; list: "bullet" | "ordered" };

interface FormatButton {
  /** What the button is called, in the tooltip and to assistive technology. */
  label: string;
  icon: React.ReactNode;
  action: FormatAction;
  /** Starts a new group, drawn behind a hairline. */
  separated?: boolean;
}

const mark = (before: string, after = before): FormatAction => ({ kind: "mark", before, after });

/**
 * The bar's contents, in the order the canvas draws them.
 *
 * Only marks this client can actually render are here. A button that inserted
 * a marker the message renderer prints back as literal text would look like
 * formatting and arrive as punctuation, which is worse than not offering it.
 */
const BUTTONS: readonly FormatButton[] = [
  { label: "Bold", icon: <BoldIcon width={15} height={15} />, action: mark("**") },
  { label: "Italic", icon: <ItalicIcon width={15} height={15} />, action: mark("*") },
  { label: "Strikethrough", icon: <StrikethroughIcon width={15} height={15} />, action: mark("~~") },
  { label: "Code", icon: <CodeIcon width={15} height={15} />, action: mark("`") },
  {
    label: "Link",
    icon: <Link2Icon width={15} height={15} />,
    // The selection becomes the text and the caret lands in the empty target,
    // which is the part the author still has to supply.
    action: mark("[", "](url)"),
    separated: true,
  },
  {
    label: "Bulleted list",
    icon: <ListIcon width={15} height={15} />,
    action: { kind: "list", list: "bullet" },
  },
  {
    label: "Numbered list",
    icon: <ListOrderedIcon width={15} height={15} />,
    action: { kind: "list", list: "ordered" },
  },
];

/** The bold shortcut, written the way this platform writes it. */
const BOLD_HINT = isApple ? "⌘B" : "Ctrl+B";

/**
 * The formatting bar that appears over a selection in the composer.
 *
 * It is drawn only while there is something to format. A toolbar that is
 * always there is a row of controls the reader has to skip past on every
 * glance at an empty composer, and the canvas gives that space to the message
 * river instead; a toolbar that follows the caret would sit over the words
 * being read. So it docks above the composer panel the moment a selection
 * exists, and leaves when it does not.
 *
 * The buttons are a second way to reach the shortcuts, not a second
 * implementation of them: each one calls the same `MarkdownInput` entry point
 * Ctrl+B does. The hint on the right says so, which is the whole reason it is
 * there - it teaches the keyboard while the mouse is being used.
 *
 * Emoji rides along at the end. It is not a mark, but the canvas keeps it here
 * rather than in the composer's row: everything that decorates the words
 * belongs on the bar that is about the words, and the row below is left to the
 * things you attach.
 */
export function FormatBar({
  onFormat,
  onEmoji,
}: Readonly<{
  onFormat: (action: FormatAction) => void;
  onEmoji?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="2px"
      role="toolbar"
      aria-label="Formatting"
      sx={(theme) => ({
        ...floatingSurface(theme),
        alignSelf: "flex-start",
        px: "6px",
        py: "5px",
        borderRadius: radius("md"),
      })}
    >
      {BUTTONS.map((button) => (
        <Fragment key={button.label}>
          {button.separated && <Hairline />}
          <Tooltip title={button.label}>
            <Box
              component="button"
              type="button"
              aria-label={button.label}
              // The composer's selection is what these act on, and a button
              // takes focus on mousedown - which collapses it before the click
              // ever arrives. Refusing the focus is what keeps the selection.
              onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
              onClick={() => onFormat(button.action)}
              sx={(theme: Theme) => ({
                all: "unset",
                cursor: "pointer",
                width: 26,
                height: 26,
                display: "grid",
                placeItems: "center",
                borderRadius: radius("sm"),
                color: theme.palette.nebula.muted,
                "&:hover": { color: theme.palette.nebula.text, background: theme.palette.nebula.card2 },
              })}
            >
              {button.icon}
            </Box>
          </Tooltip>
        </Fragment>
      ))}

      {onEmoji && (
        <>
          <Hairline />
          <Tooltip title="Insert emoji">
            <Box
              component="button"
              type="button"
              aria-label="Insert emoji"
              onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
              onClick={onEmoji}
              sx={(theme: Theme) => ({
                all: "unset",
                cursor: "pointer",
                width: 26,
                height: 26,
                display: "grid",
                placeItems: "center",
                borderRadius: radius("sm"),
                color: theme.palette.nebula.muted,
                "&:hover": { color: theme.palette.nebula.text, background: theme.palette.nebula.card2 },
              })}
            >
              <SmileIcon width={15} height={15} />
            </Box>
          </Tooltip>
        </>
      )}

      <Hairline />
      <Box
        aria-hidden
        sx={(theme) => ({
          px: "7px",
          fontFamily: theme.typography.fontFamily,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.02em",
          color: theme.palette.nebula.dim,
        })}
      >
        {BOLD_HINT}
      </Box>
    </Stack>
  );
}

/** The upright hairline that groups the bar, as the tool row uses too. */
function Hairline() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({ width: "1px", height: 16, mx: "5px", background: theme.palette.nebula.line2 })}
    />
  );
}
