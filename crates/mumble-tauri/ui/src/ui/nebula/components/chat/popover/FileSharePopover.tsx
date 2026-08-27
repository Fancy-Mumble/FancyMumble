import { useState } from "react";
import { Box, InputBase, Typography } from "@mui/material";
import type { FileAccessMode } from "@core/types";
import type { FileShareChoice } from "@core/features/chat/useFileUpload";
import { AttachIcon, LockIcon, UploadIcon } from "@ui/icons";
import { Stack } from "../../primitives";
import { PopoverPanel } from "./PopoverPanel";

/** The canvas's width for this panel. */
export const FILE_SHARE_POPOVER_WIDTH = 460;

/**
 * Where a file may be seen, asked before a byte leaves the machine.
 *
 * A popover rather than a modal, so the conversation it is about stays
 * readable behind it - you often want to check who is in the channel before
 * deciding whether a file is public.
 *
 * The modes are rows, not radio buttons: each is a full-width line on a
 * hairline with its own consequence spelled out, because "public" and
 * "this channel" differ in who can reach the link rather than in a label.
 */
export function FileSharePopover({
  left,
  filename,
  canSharePublic,
  onSubmit,
  onClose,
  onBrowse,
}: Readonly<{
  left: number;
  /** The picked file, or null when the panel is opened before choosing one. */
  filename: string | null;
  canSharePublic: boolean;
  onSubmit: (choice: FileShareChoice) => void;
  onClose: () => void;
  onBrowse: () => void;
}>) {
  const [mode, setMode] = useState<FileAccessMode>(canSharePublic ? "public" : "session");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const ready = filename !== null && (mode !== "password" || password.length > 0);

  return (
    <PopoverPanel width={FILE_SHARE_POPOVER_WIDTH} left={left} title="Share files" onClose={onClose}>
      <Box sx={{ p: "12px" }}>
        <Stack
          alignItems="center"
          justifyContent="center"
          gap="6px"
          onClick={onBrowse}
          sx={(theme) => ({
            height: 104,
            cursor: "pointer",
            borderRadius: "14px",
            border: `1px dashed ${theme.palette.nebula.accentLine}`,
            background: theme.palette.nebula.accentSoft,
          })}
        >
          <Box
            sx={(theme) => ({
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              borderRadius: "999px",
              background: theme.palette.nebula.accentSoft,
              color: theme.palette.nebula.accent,
            })}
          >
            <UploadIcon width={16} height={16} />
          </Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
            {filename ?? "Drop files, or paste from clipboard"}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
            Images, video, audio, documents
          </Typography>
        </Stack>
      </Box>

      {/*
       * The canvas lists the ways in: browse, and the recent things worth
       * attaching. "Recent screenshots" is not built - nothing in the client
       * indexes them yet - so it is left out rather than drawn as a row that
       * does nothing.
       */}
      <Row
        icon={<AttachIcon width={16} height={16} />}
        label="Browse files…"
        hint={shortcut}
        onClick={onBrowse}
      />

      {/*
       * Visibility is not on the canvas, and it cannot be dropped: the
       * uploader needs a mode, and "who can reach this link" is not a default
       * worth guessing on the user's behalf. It sits as one row rather than
       * three, cycling through what this server allows.
       */}
      <Row
        icon={<LockIcon width={16} height={16} />}
        label={MODE_LABELS[mode]}
        hint="change"
        onClick={() => setMode(nextMode(mode, canSharePublic))}
      />

      {mode === "password" && (
        <Box
          sx={(theme) => ({
            px: "14px",
            py: "10px",
            borderTop: `1px solid ${theme.palette.nebula.washLine}`,
          })}
        >
          <InputBase
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password for the link"
            inputProps={{ "aria-label": "Password for the link" }}
            sx={{ width: "100%", fontSize: 14, "& .MuiInputBase-input": { padding: 0 } }}
          />
        </Box>
      )}

      <Stack
        direction="row"
        alignItems="center"
        gap="10px"
        sx={(theme) => ({ px: "14px", py: "12px", borderTop: `1px solid ${theme.palette.nebula.washLine}` })}
      >
        <InputBase
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Say something about it…"
          inputProps={{ "aria-label": "Message to send with the file" }}
          sx={{ flex: 1, fontSize: 14, "& .MuiInputBase-input": { padding: 0 } }}
        />
        <Box
          component="button"
          type="button"
          disabled={!ready}
          onClick={() =>
            onSubmit({
              mode,
              password: mode === "password" ? password : undefined,
              message: message.trim() || undefined,
            })
          }
          sx={(theme) => ({
            all: "unset",
            cursor: ready ? "pointer" : "default",
            display: "grid",
            placeItems: "center",
            height: 32,
            px: "18px",
            borderRadius: "999px",
            fontSize: 13,
            fontWeight: 600,
            background: ready ? theme.palette.nebula.accent : theme.palette.nebula.card2,
            color: ready ? theme.palette.nebula.onAccent : theme.palette.nebula.dim,
          })}
        >
          Send
        </Box>
      </Stack>
    </PopoverPanel>
  );
}

const MODE_LABELS: Record<FileAccessMode, string> = {
  public: "Anyone with the link",
  password: "Anyone with the password",
  session: "Only people here now",
};

/** Step to the next visibility this server permits. */
function nextMode(mode: FileAccessMode, canSharePublic: boolean): FileAccessMode {
  const order: FileAccessMode[] = canSharePublic ? ["public", "password", "session"] : ["session"];
  return order[(order.indexOf(mode) + 1) % order.length];
}

/** What the canvas prints beside "Browse files…". */
const shortcut = navigator.platform.startsWith("Mac") ? "⌘O" : "Ctrl+O";

/** One 46px line on a hairline - the panel's only row shape. */
function Row({
  icon,
  label,
  hint,
  selected = false,
  onClick,
}: Readonly<{
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  selected?: boolean;
  onClick: () => void;
}>) {
  return (
    <Stack
      component="button"
      direction="row"
      alignItems="center"
      gap="12px"
      aria-pressed={selected}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        boxSizing: "border-box",
        width: "100%",
        height: 46,
        flex: "none",
        px: "14px",
        borderTop: `1px solid ${theme.palette.nebula.washLine}`,
        background: selected ? theme.palette.nebula.hover : "transparent",
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      {icon && <Box sx={(theme) => ({ display: "flex", color: theme.palette.nebula.muted })}>{icon}</Box>}
      <Typography sx={{ flex: 1, fontSize: 14 }}>{label}</Typography>
      {hint && (
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>{hint}</Typography>
      )}
    </Stack>
  );
}
