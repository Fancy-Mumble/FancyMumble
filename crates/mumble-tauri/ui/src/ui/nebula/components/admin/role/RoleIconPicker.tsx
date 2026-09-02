import { Suspense, lazy, useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Box, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { dataUrlToBytes, textureToDataUrl } from "@core/profileFormat";
import { formatBytes } from "@core/utils/format";
import { radius } from "../../../tokens";
import { Stack } from "../../primitives";

// The crop/zoom editor is a tool surface rather than a design, and Nebula
// already reuses this one for the profile avatar - see ProfileSettings.
const ImageEditor = lazy(() =>
  import("@standard/pages/settings/ImageEditor").then((module) => ({ default: module.ImageEditor })),
);

export interface RoleIconPickerProps {
  readonly value: number[] | null | undefined;
  readonly onChange: (next: number[] | null) => void;
  /**
   * Maximum icon size in bytes. When omitted, falls back to the server's
   * `max_image_message_length`.
   */
  readonly maxBytes?: number;
  readonly disabled?: boolean;
}

/** Hard floor, so a misconfigured server still allows a usable icon. */
const MIN_BUDGET_BYTES = 16 * 1024;
/** Soft cap, so a runaway server config cannot stuff multi-MB icons into ACLs. */
const MAX_BUDGET_BYTES = 1024 * 1024;
/** Output resolution. A cropped square that scales down into a chip. */
const ICON_SIZE = 128;

function clampBudget(maxBytes: number | undefined, serverMax: number): number {
  const requested = maxBytes ?? (serverMax > 0 ? serverMax : MIN_BUDGET_BYTES);
  return Math.max(MIN_BUDGET_BYTES, Math.min(MAX_BUDGET_BYTES, requested));
}

/**
 * The role's icon, cropped by the same editor the profile avatar uses.
 *
 * The cropped output is stored as raw bytes in `AclGroup.icon` and forwarded to
 * the server unchanged, so the budget is the server's own image limit rather
 * than a number this pack picked.
 */
export function RoleIconPicker({ value, onChange, maxBytes, disabled }: RoleIconPickerProps) {
  const { t } = useTranslation("settings");
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const serverMax = useAppStore((s) => s.serverConfig.max_image_message_length);
  const budget = useMemo(() => clampBudget(maxBytes, serverMax), [maxBytes, serverMax]);

  const previewSrc = useMemo(() => (value && value.length > 0 ? textureToDataUrl(value) : null), [value]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setEditorSrc(reader.result as string);
    reader.onerror = () => setError(t("roleDisplay.iconPickerErrorRead"));
    reader.readAsDataURL(file);
  };

  const handleEditorConfirm = useCallback(
    (dataUrl: string) => {
      try {
        onChange(dataUrlToBytes(dataUrl));
        setError(null);
      } catch (err) {
        console.error("Failed to encode role icon", err);
        setError(t("roleDisplay.iconPickerErrorProcess"));
      }
      setEditorSrc(null);
    },
    [onChange, t],
  );

  return (
    <Stack direction="row" alignItems="center" gap={1.5}>
      <Box
        sx={(theme) => ({
          width: 48,
          height: 48,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderRadius: radius("md"),
          border: `1px dashed ${theme.palette.nebula.line2}`,
          background: theme.palette.nebula.card2,
        })}
      >
        {previewSrc ? (
          <Box
            component="img"
            src={previewSrc}
            alt={t("roleDisplay.iconPickerAlt")}
            sx={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <Typography aria-hidden sx={(theme) => ({ fontSize: 20, color: theme.palette.nebula.dim })}>
            +
          </Typography>
        )}
      </Box>

      <Stack gap={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="center" gap={0.75}>
          <Button size="small" disabled={disabled} onClick={() => inputRef.current?.click()}>
            {previewSrc ? t("roleDisplay.iconPickerReplace") : t("roleDisplay.iconPickerChoose")}
          </Button>
          {previewSrc && !disabled && (
            <Button
              size="small"
              color="error"
              onClick={() => {
                setError(null);
                onChange(null);
              }}
            >
              {t("roleDisplay.iconPickerRemove")}
            </Button>
          )}
        </Stack>
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
          {t("roleDisplay.iconPickerHint", { size: formatBytes(budget) })}
        </Typography>
        {error && (
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.bad })}>
            {error}
          </Typography>
        )}
      </Stack>

      <Box
        component="input"
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleChange}
        sx={{ display: "none" }}
      />
      {editorSrc && (
        <Suspense fallback={null}>
          <ImageEditor
            src={editorSrc}
            cropShape="circle"
            targetWidth={ICON_SIZE}
            targetHeight={ICON_SIZE}
            maxBytes={budget}
            onConfirm={handleEditorConfirm}
            onCancel={() => setEditorSrc(null)}
          />
        </Suspense>
      )}
    </Stack>
  );
}
