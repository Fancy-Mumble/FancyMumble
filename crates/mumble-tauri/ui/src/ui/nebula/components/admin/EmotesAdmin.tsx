import { useCallback, useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { inferMimeType } from "@core/utils/media";
import { NEBULA_MONO } from "../../tokens";
import { Stack } from "../primitives";
import { Banner, EmptyState, GroupTitle, SettingsCard, TextRow } from "../settings/controls";
import { AdminPage } from "./controls";

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

/**
 * Custom server emotes.
 *
 * The image is picked as a *path* rather than read here, because the upload is
 * the backend's job - the webview never holds the bytes. The type is inferred
 * from that path and checked before anything is sent, so an unsupported file is
 * refused with a reason rather than by the server, later, with a code.
 */
export function EmotesAdmin() {
  const { t } = useTranslation(["settings", "common"]);
  const emotes = useAppStore((state) => state.customServerEmotes);
  const addCustomEmote = useAppStore((state) => state.addCustomEmote);
  const removeCustomEmote = useAppStore((state) => state.removeCustomEmote);

  const [shortcode, setShortcode] = useState("");
  const [aliasEmoji, setAliasEmoji] = useState("");
  const [description, setDescription] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const pickFile = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Emote image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
      });
      if (typeof picked === "string") setFilePath(picked);
    } catch {
      setStatus({ kind: "err", text: t("emotes.errorPickerFailed") });
    }
  }, [t]);

  const submit = async () => {
    if (!filePath) return setStatus({ kind: "err", text: t("emotes.errorNeedsFile") });
    const mime = inferMimeType(filePath);
    if (!mime || !ALLOWED_MIME.includes(mime))
      return setStatus({ kind: "err", text: t("emotes.errorBadType") });
    if (!shortcode.trim() || !aliasEmoji.trim())
      return setStatus({ kind: "err", text: t("emotes.errorRequiredFields") });

    setSubmitting(true);
    setStatus(null);
    try {
      await addCustomEmote({
        shortcode: shortcode.trim(),
        aliasEmoji: aliasEmoji.trim(),
        description: description.trim() || undefined,
        filePath,
        mimeType: mime,
      });
      setShortcode("");
      setAliasEmoji("");
      setDescription("");
      setFilePath(null);
      setStatus({ kind: "ok", text: t("emotes.successAdded") });
    } catch (e) {
      setStatus({
        kind: "err",
        text: t("emotes.errorAddFailed", { detail: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (code: string) => {
    setDeleting(null);
    try {
      await removeCustomEmote(code);
      setStatus({ kind: "ok", text: t("emotes.successRemoved", { shortcode: code }) });
    } catch (e) {
      setStatus({
        kind: "err",
        text: t("emotes.errorRemoveFailed", { detail: e instanceof Error ? e.message : String(e) }),
      });
    }
  };

  return (
    <AdminPage title={t("emotes.addTitle")}>
      <SettingsCard>
        <TextRow
          label={t("emotes.fieldShortcode")}
          value={shortcode}
          onChange={setShortcode}
          placeholder="myCustom"
        />
        <TextRow
          label={t("emotes.fieldAliasEmoji")}
          value={aliasEmoji}
          onChange={setAliasEmoji}
          placeholder="🤣"
        />
        <TextRow
          label={t("emotes.fieldDescription")}
          value={description}
          onChange={setDescription}
          placeholder="(optional)"
        />
        <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "7px" }}>
          {t("emotes.fieldImage")}
        </Typography>
        <Stack direction="row" alignItems="center" gap={1.25}>
          <Button size="small" variant="outlined" onClick={() => void pickFile()}>
            {filePath ? t("emotes.changeFile") : t("emotes.chooseFile")}
          </Button>
          {filePath && (
            <Typography
              sx={(theme) => ({
                minWidth: 0,
                fontFamily: NEBULA_MONO,
                fontSize: 11,
                color: theme.palette.nebula.muted,
              })}
              noWrap
            >
              {filePath}
            </Typography>
          )}
        </Stack>
        <Button
          variant="contained"
          size="small"
          sx={{ mt: "14px" }}
          disabled={submitting}
          onClick={() => void submit()}
        >
          {submitting ? t("emotes.uploading") : t("emotes.addEmote")}
        </Button>
        {status && <Banner tone={status.kind === "err" ? "danger" : "ok"}>{status.text}</Banner>}
      </SettingsCard>

      <GroupTitle>{t("emotes.existingTitle", { count: emotes.length })}</GroupTitle>
      {emotes.length === 0 ? (
        <EmptyState>{t("emotes.noEmotes")}</EmptyState>
      ) : (
        <Stack gap={0.75}>
          {emotes.map((emote) => (
            <SettingsCard key={emote.shortcode} sx={{ p: "10px 14px" }}>
              <Stack direction="row" alignItems="center" gap={1.5}>
                <Box
                  component="img"
                  src={emote.imageDataUrl}
                  alt={emote.shortcode}
                  sx={{ flex: "none", width: 28, height: 28, objectFit: "contain" }}
                />
                <Stack direction="row" alignItems="center" gap={1.25} sx={{ flex: 1, minWidth: 0 }}>
                  <Box
                    component="code"
                    sx={{ fontFamily: NEBULA_MONO, fontSize: 11.5, fontWeight: 600 }}
                  >
                    :{emote.shortcode}:
                  </Box>
                  <Box component="span" sx={{ fontSize: 14 }}>
                    {emote.aliasEmoji}
                  </Box>
                  {emote.description && (
                    <Typography
                      sx={(theme) => ({
                        fontSize: 11,
                        fontStyle: "italic",
                        color: theme.palette.nebula.muted,
                      })}
                      noWrap
                    >
                      {emote.description}
                    </Typography>
                  )}
                </Stack>
                <Button
                  size="small"
                  color="error"
                  sx={{ flex: "none" }}
                  onClick={() => setDeleting(emote.shortcode)}
                >
                  {t("emotes.deleteButton")}
                </Button>
              </Stack>
            </SettingsCard>
          ))}
        </Stack>
      )}

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>{t("emotes.deleteButton")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5 }}>
            {deleting ? t("emotes.confirmDelete", { shortcode: deleting }) : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setDeleting(null)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            size="small"
            color="error"
            variant="contained"
            onClick={() => deleting && void remove(deleting)}
          >
            {t("emotes.deleteButton")}
          </Button>
        </DialogActions>
      </Dialog>
    </AdminPage>
  );
}
