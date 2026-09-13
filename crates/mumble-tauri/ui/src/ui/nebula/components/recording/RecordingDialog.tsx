/**
 * Recording what this client hears to a WAV file.
 *
 * Standard's developer-mode tool in Nebula's dialog. The backend does the
 * recording; this picks where the file goes, starts and stops it, and shows it
 * running. The fields lock while it records, because the file they describe is
 * already open.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Dialog, DialogActions, DialogContent, IconButton, TextField, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { CloseIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { NEBULA_MONO, radius } from "../../tokens";
import { formatElapsed, loadTarget, saveTarget, type RecordingControls } from "./useRecording";

interface RecordingDialogProps {
  readonly recording: RecordingControls;
  /** Take the whole screen, as every dialog does on a phone. */
  readonly fullScreen?: boolean;
  readonly onClose: () => void;
}

export function RecordingDialog({ recording, fullScreen = false, onClose }: RecordingDialogProps) {
  const { t } = useTranslation(["sidebar", "common"]);
  const [target, setTarget] = useState(loadTarget);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = recording.state.is_recording;

  const act = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const browse = () =>
    act(async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, defaultPath: target.directory || undefined });
      if (typeof picked === "string") setTarget((prev) => ({ ...prev, directory: picked }));
    });

  const start = () =>
    act(async () => {
      const chosen = { directory: target.directory.trim(), filename: target.filename.trim() };
      saveTarget(chosen);
      await recording.start(chosen);
    });

  const canStart = !busy && target.directory.trim() !== "" && target.filename.trim() !== "";

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <Stack
        direction="row"
        alignItems="center"
        sx={(theme) => ({
          height: 52,
          px: "16px",
          borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
        })}
      >
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{t("sidebar:recordingModal.title")}</Typography>
        <IconButton size="small" sx={{ ml: "auto" }} aria-label={t("common:actions.close")} onClick={onClose}>
          <CloseIcon width={13} height={13} />
        </IconButton>
      </Stack>

      <DialogContent>
        <Stack gap={1.75} sx={{ pt: "4px" }}>
          {live && (
            <Stack
              direction="row"
              alignItems="center"
              gap={1}
              role="status"
              sx={(theme) => ({
                px: "10px",
                py: "8px",
                borderRadius: radius("md"),
                background: alpha(theme.palette.nebula.bad, 0.12),
                color: theme.palette.nebula.bad,
                fontSize: 12.5,
              })}
            >
              <Box
                aria-hidden
                sx={(theme) => ({
                  flex: "none",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: theme.palette.nebula.bad,
                })}
              />
              <Typography
                title={recording.state.file_path ?? undefined}
                sx={{ fontSize: 12.5, minWidth: 0, flex: 1 }}
                noWrap
              >
                {t("sidebar:recordingModal.recordingTo", { path: recording.state.file_path ?? "" })}
              </Typography>
              <Typography sx={{ fontFamily: NEBULA_MONO, fontSize: 12.5, flex: "none" }}>
                {formatElapsed(recording.state.elapsed_secs)}
              </Typography>
            </Stack>
          )}

          <TextField
            size="small"
            fullWidth
            label={t("sidebar:recordingModal.labelFormat")}
            value={t("sidebar:recordingModal.formatWav")}
            disabled={live}
            slotProps={{ input: { readOnly: true } }}
          />
          <Stack direction="row" gap={1} alignItems="flex-start">
            <TextField
              size="small"
              fullWidth
              label={t("sidebar:recordingModal.labelDirectory")}
              placeholder={t("sidebar:recordingModal.directoryPlaceholder")}
              value={target.directory}
              disabled={live}
              onChange={(event) => setTarget((prev) => ({ ...prev, directory: event.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Button variant="outlined" onClick={() => void browse()} disabled={live || busy} sx={{ flex: "none", height: 40 }}>
              {t("sidebar:recordingModal.browse")}
            </Button>
          </Stack>
          <TextField
            size="small"
            fullWidth
            label={t("sidebar:recordingModal.labelFilename")}
            value={target.filename}
            disabled={live}
            onChange={(event) => setTarget((prev) => ({ ...prev, filename: event.target.value }))}
            helperText={t("sidebar:recordingModal.wildcardHelp")}
          />
          {error && (
            <Typography role="alert" sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.bad })}>
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
        {live ? (
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void act(recording.stop)}
            sx={(theme) => ({
              background: theme.palette.nebula.bad,
              "&:hover": { background: alpha(theme.palette.nebula.bad, 0.85) },
            })}
          >
            {t("sidebar:recordingModal.stopRecording")}
          </Button>
        ) : (
          <Button variant="contained" disabled={!canStart} onClick={() => void start()}>
            {t("sidebar:recordingModal.startRecording")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
