import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, Box, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme, type NebulaMode } from "@nebula/theme";
import { Composer } from "@nebula/components/chat/Composer";
import type { ChatMessage } from "@core/types";
import type { StagedAttachment } from "@core/features/chat/useFileUpload";
import "@standard/theme.css";
import { initializeStandardAppearance } from "@standard/appearance";

initializeStandardAppearance();

const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f0a05a"/><stop offset=".55" stop-color="#8a5fa8"/>
        <stop offset="1" stop-color="#22304f"/></linearGradient></defs>
      <rect width="120" height="120" fill="url(#g)"/>
      <circle cx="86" cy="30" r="13" fill="#ffe6b8"/>
      <path d="M0 92 L34 62 L58 84 L84 58 L120 90 L120 120 L0 120Z" fill="#1a2138"/>
    </svg>`,
  );

function quote(id: string, name: string, body: string): ChatMessage {
  return { sender_session: 7, sender_name: name, body, channel_id: 1, is_own: false, message_id: id } as ChatMessage;
}

function file(partial: Omit<StagedAttachment, "choice" | "filePath">): StagedAttachment {
  return { filePath: `/tmp/${partial.filename}`, choice: { mode: "session" }, ...partial };
}

/** Put a real selection in the pane that is about one, once it has mounted. */
function Selected({ text, from, to }: { text: string; from: number; to: number }) {
  useEffect(() => {
    const field = document.querySelector<HTMLTextAreaElement>("[data-pane='sel'] textarea");
    if (!field) return;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    const id = setTimeout(() => {
      field.setSelectionRange(from, to);
      // The editor re-reads the live selection on a document pointer-up (it is
      // how a drag-select ends), which is the one hook a script can pull.
      document.dispatchEvent(new Event("pointerup", { bubbles: true }));
    }, 250);
    return () => clearTimeout(id);
  }, [text, from, to]);
  return null;
}

const BACKDROP: Record<NebulaMode, string> = {
  dark:
    "radial-gradient(680px 420px at 12% 8%,rgba(65,180,249,.20),transparent 62%)," +
    "radial-gradient(520px 520px at 78% 18%,rgba(125,130,255,.18),transparent 60%)," +
    "linear-gradient(160deg,#2a3350,#141a2e)",
  light:
    "radial-gradient(680px 420px at 12% 8%,rgba(22,145,220,.20),transparent 62%)," +
    "radial-gradient(520px 520px at 78% 18%,rgba(110,120,235,.16),transparent 60%)," +
    "linear-gradient(160deg,#ffffff,#e6e2d8)",
};

function Pane({
  label,
  mode,
  width = 560,
  children,
}: {
  label: string;
  mode: NebulaMode;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <Typography
        sx={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: ".04em",
          color: mode === "dark" ? "#8fa2c8" : "#5a6178",
        }}
      >
        {label.toUpperCase()}
      </Typography>
      <Box
        sx={{
          width,
          padding: "18px 0 4px",
          borderRadius: "20px",
          overflow: "hidden",
          background: BACKDROP[mode],
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function Board({ mode }: { mode: NebulaMode }) {
  return (
    <ThemeProvider theme={createNebulaTheme(mode)}>
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: "26px",
          padding: "26px",
          background: mode === "dark" ? "#0a0e1a" : "#e9e6de",
        }}
      >
        <Box data-pane="sel">
          <Pane mode={mode} label={`${mode} · text selected`}>
            <Composer target="#Gaming" onSend={() => {}} onAttach={() => {}} />
            <Selected text="tonight at nine — bring a full stack" from={0} to={15} />
          </Pane>
        </Box>

        <Pane mode={mode} label={`${mode} · reply`}>
          <Composer
            target="#Gaming"
            onSend={() => {}}
            onAttach={() => {}}
            quotes={[quote("m1", "Zewi", "did you see the sky tonight")]}
            onRemoveQuote={() => {}}
          />
        </Pane>

        <Pane mode={mode} label={`${mode} · reply ×2`}>
          <Composer
            target="#Gaming"
            onSend={() => {}}
            onAttach={() => {}}
            quotes={[
              quote("m1", "Zewi", "did you see the sky tonight"),
              quote("m2", "Jonas", "bring the tripod"),
            ]}
            onRemoveQuote={() => {}}
          />
        </Pane>

        <Pane mode={mode} label={`${mode} · attachments`}>
          <Composer
            target="#Gaming"
            onSend={() => {}}
            onAttach={() => {}}
            attachments={[
              file({ id: "a1", filename: "ferry.png", previewUrl: PHOTO }),
              file({ id: "a2", filename: "dusk-ridge.png", previewUrl: PHOTO }),
              file({ id: "a3", filename: "server-notes.pdf", sizeBytes: 860_160 }),
            ]}
            onRemoveAttachment={() => {}}
          />
        </Pane>

        <Pane mode={mode} label={`${mode} · uploading`}>
          <Composer
            target="#Gaming"
            onSend={() => {}}
            onAttach={() => {}}
            uploads={[
              {
                id: "u1",
                filename: "dusk-ridge.png",
                state: "uploading",
                progress: 68,
                totalBytes: 2_202_010,
                etaSeconds: 2,
                previewUrl: PHOTO,
              },
            ]}
            onCancelUpload={() => {}}
          />
        </Pane>

        <Pane mode={mode} label={`${mode} · reply + files + upload`}>
          <Composer
            target="#Gaming"
            onSend={() => {}}
            onAttach={() => {}}
            quotes={[quote("m1", "Zewi", "did you see the sky tonight")]}
            onRemoveQuote={() => {}}
            attachments={[file({ id: "a1", filename: "ferry.png", previewUrl: PHOTO })]}
            onRemoveAttachment={() => {}}
            uploads={[
              { id: "u1", filename: "clip.mov", state: "error", errorMessage: "File is too large" },
            ]}
            onCancelUpload={() => {}}
          />
        </Pane>
      </Box>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <CssBaseline />
    <Board mode="dark" />
    <Board mode="light" />
  </>,
);
