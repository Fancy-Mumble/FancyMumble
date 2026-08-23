import { useRef, useState } from "react";
import { Stack } from "../primitives";
import { Box, Dialog, DialogContent, IconButton, InputBase, Tooltip } from "@mui/material";
import { useTypingIndicator } from "@core/features/chat/typing/useTypingIndicator";
import { PlusIcon, SendIcon } from "@ui/icons";
import { KlipyGifBrowser } from "@standard/pages/settings/KlipyGifBrowser";
import { glassChrome } from "../../theme";
import { radius } from "../../tokens";

interface ComposerProps {
  /** Placeholder target, e.g. "#Gaming" or "@Lorelando". */
  target: string;
  disabled?: boolean;
  onSend: (html: string) => void | Promise<void>;
  onAttach?: () => void;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * The composer pill.
 *
 * The mock's composer is one rounded bar floating over the message river, with
 * the send action as a filled accent disc rather than a labelled button. Enter
 * sends and Shift+Enter breaks the line, which is what the rest of the app
 * does; the textarea grows to a few lines and then scrolls.
 */
export function Composer({ target, disabled = false, onSend, onAttach }: Readonly<ComposerProps>) {
  const [draft, setDraft] = useState("");
  const [gifOpen, setGifOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { notifyTyping, resetTyping } = useTypingIndicator();

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    resetTyping();
    void onSend(escapeHtml(text).replaceAll("\n", "<br>"));
  };

  return (
    <Box sx={{ flex: "none", px: "26px", pt: "12px", pb: "24px" }}>
      <Stack
        direction="row"
        // Centred, not bottom-aligned: the bar is one line tall at rest, and a
        // bottom-aligned row parks a single line of text against the pill's
        // lower edge instead of on its centre line.
        alignItems="center"
        gap={1.125}
        sx={(theme) => ({
          minHeight: 50,
          px: "15px",
          py: "8px",
          borderRadius: "999px",
          ...glassChrome(theme),
          border: `1px solid ${theme.palette.nebula.line2}`,
          boxShadow: "0 6px 24px rgba(0,0,0,.12)",
          opacity: disabled ? 0.6 : 1,
        })}
      >
        {/* Rendered only when wired: a permanently disabled button is a promise
            the composer cannot keep. */}
        {onAttach && (
          <Tooltip title="Attach a file">
            <IconButton aria-label="Attach a file" onClick={onAttach} sx={{ width: 28, height: 28 }}>
              <PlusIcon width={16} height={16} />
            </IconButton>
          </Tooltip>
        )}
        <Box
          component="button"
          onClick={() => setGifOpen(true)}
          sx={(theme) => ({
            all: "unset",
            cursor: "pointer",
            px: "8px",
            py: "4px",
            borderRadius: radius("sm"),
            fontSize: 10,
            fontWeight: 500,
            color: theme.palette.nebula.muted,
            background: theme.palette.nebula.card2,
            "&:hover": { background: theme.palette.nebula.hover },
          })}
        >
          GIF
        </Box>
        <InputBase
          inputRef={inputRef}
          multiline
          maxRows={6}
          value={draft}
          disabled={disabled}
          placeholder={`Message ${target}`}
          inputProps={{ "aria-label": `Message ${target}` }}
          onChange={(event) => {
            setDraft(event.target.value);
            notifyTyping();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          sx={{
            flex: 1,
            fontSize: 13,
            // InputBase adds its own vertical padding on top of the row's, which
            // pushes a single line off the pill's centre line.
            "& .MuiInputBase-input": { padding: 0, lineHeight: 1.5 },
          }}
        />
        <Tooltip title="Send">
          <span>
            <IconButton
              aria-label="Send message"
              disabled={disabled || !draft.trim()}
              onClick={submit}
              sx={(theme) => ({
                flex: "none",
                width: 32,
                height: 32,
                borderRadius: "50%",
                color: "#fff",
                background: theme.palette.nebula.accent,
                boxShadow: `0 4px 14px ${theme.palette.nebula.accent}66`,
                "&:hover": { background: theme.palette.nebula.accent, filter: "brightness(1.08)" },
                "&.Mui-disabled": { background: theme.palette.nebula.card2, color: theme.palette.nebula.dim },
              })}
            >
              <SendIcon width={13} height={13} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Dialog open={gifOpen} onClose={() => setGifOpen(false)} maxWidth="sm" fullWidth>
        <DialogContent sx={{ p: 1.5 }}>
          <KlipyGifBrowser
            onSelect={(url) => {
              setGifOpen(false);
              void onSend(`<img src="${url}" alt="GIF">`);
            }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
}
