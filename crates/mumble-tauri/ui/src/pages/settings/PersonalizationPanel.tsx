import { useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { PersonalizationData, BubbleStyle, FontSize, BgFit, ChannelViewerStyle } from "../../personalizationStorage";
import {
  MessageCircleIcon,
  AlignLeftIcon,
  AlignJustifyIcon,
  FolderIcon,
  ListIcon,
  SparklesIcon,
  FullscreenIcon,
  Grid2x2Icon,
} from "../../icons";
import { THEMES, applyTheme } from "../../themes";
import type { ThemeId } from "../../themes";
import { ImageEditor } from "./ImageEditor";
import { SliderField, Toggle } from "./SharedControls";
import { FONT_FAMILIES, applyFont } from "../../utils/fonts";
import { FileDropZone } from "../../components/elements/FileDropZone";
import styles from "./SettingsPage.module.css";
import panelStyles from "./PersonalizationPanel.module.css";

interface PersonalizationPanelProps {
  readonly data: PersonalizationData;
  readonly onChange: (patch: Partial<PersonalizationData>) => void;
  readonly isExpert: boolean;
}

/** Maximum dimension for the stored background (keep data-URL manageable). */
const MAX_BG_WIDTH = 1920;
const MAX_BG_HEIGHT = 1080;

type TFn = (key: string) => string;

function buildBubbleStyles(t: TFn): { id: BubbleStyle; label: string; icon: ReactNode }[] {
  return [
    { id: "bubbles", label: t("personalize.bubbleStyleBubbles"), icon: <MessageCircleIcon size={20} /> },
    { id: "flat", label: t("personalize.bubbleStyleFlat"), icon: <AlignLeftIcon size={20} /> },
    { id: "compact", label: t("personalize.bubbleStyleCompact"), icon: <AlignJustifyIcon size={20} /> },
  ];
}

function buildBgFitOptions(t: TFn): { id: BgFit; label: string; icon: ReactNode }[] {
  return [
    { id: "cover", label: t("personalize.bgFitCover"), icon: <FullscreenIcon size={20} /> },
    { id: "tile", label: t("personalize.bgFitTile"), icon: <Grid2x2Icon size={20} /> },
  ];
}

function buildChannelViewerStyles(t: TFn): { id: ChannelViewerStyle; label: string; icon: ReactNode }[] {
  return [
    { id: "classic", label: t("personalize.channelViewerClassic"), icon: <FolderIcon size={20} /> },
    { id: "flat", label: t("personalize.channelViewerFlat"), icon: <ListIcon size={20} /> },
    { id: "modern", label: t("personalize.channelViewerModern"), icon: <SparklesIcon size={20} /> },
  ];
}

function buildFontSizes(t: TFn): { id: FontSize; label: string }[] {
  return [
    { id: "small", label: t("personalize.fontSizeSmall") },
    { id: "medium", label: t("personalize.fontSizeMedium") },
    { id: "large", label: t("personalize.fontSizeLarge") },
  ];
}

/**
 * Extract the raw base64 string from a data-URL.
 * E.g. `data:image/jpeg;base64,/9j/4AAQ...` -> `/9j/4AAQ...`
 */
function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",")[1];
}

/** Wrap a base64 string as a JPEG data-URL. */
function base64ToDataUrl(base64: string): string {
  return `data:image/jpeg;base64,${base64}`;
}

/** Debounce delay for the blur slider (ms). */
const BLUR_DEBOUNCE_MS = 500;

export function PersonalizationPanel({ data, onChange, isExpert }: PersonalizationPanelProps) {
  const { t } = useTranslation("settings");
  const tStr = t as TFn;
  const bubbleStyles = buildBubbleStyles(tStr);
  const bgFitOptions = buildBgFitOptions(tStr);
  const channelViewerStyles = buildChannelViewerStyles(tStr);
  const fontSizes = buildFontSizes(tStr);

  const [editorImage, setEditorImage] = useState<string | null>(null);
  const [blurring, setBlurring] = useState(false);

  /** Monotonic counter to discard stale processing results. */
  const processGenRef = useRef(0);
  /** Debounce timer for blur/dim slider changes. */
  const processTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (processTimerRef.current) clearTimeout(processTimerRef.current);
    };
  }, []);

  const hasBackground = Boolean(data.chatBgOriginal);
  const blurEnabled = data.chatBgBlurSigma > 0;

  /** Fire the backend `process_background` command (blur + dim) and store
   *  the result.  Returns immediately; the caller should have already bumped
   *  `processGenRef` and set `setBlurring(true)`. */
  const runProcessing = useCallback(
    (original: string, sigma: number, dim: number, gen: number) => {
      const imageBase64 = dataUrlToBase64(original);
      invoke<string>("process_background", { imageBase64, sigma, dim })
        .then((processed) => {
          if (processGenRef.current === gen) {
            onChange({ chatBgBlurred: base64ToDataUrl(processed) });
          }
        })
        .catch((e) => console.error("Background processing failed:", e))
        .finally(() => {
          if (processGenRef.current === gen) setBlurring(false);
        });
    },
    [onChange],
  );

  /** Schedule a debounced reprocess of the background image. */
  const scheduleProcessing = useCallback(
    (original: string, sigma: number, dim: number) => {
      if (processTimerRef.current) clearTimeout(processTimerRef.current);

      // If neither blur nor dim is active, clear the processed image.
      if (sigma <= 0 && dim <= 0) {
        processGenRef.current++;
        setBlurring(false);
        onChange({ chatBgBlurred: null });
        return;
      }

      processTimerRef.current = setTimeout(() => {
        const gen = ++processGenRef.current;
        setBlurring(true);
        runProcessing(original, sigma, dim, gen);
      }, BLUR_DEBOUNCE_MS);
    },
    [onChange, runProcessing],
  );

  const handleFileChange = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => setEditorImage(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  // After crop/resize in ImageEditor, store the original and reprocess.
  const handleEditorConfirm = useCallback(
    (dataUrl: string) => {
      setEditorImage(null);
      onChange({ chatBgOriginal: dataUrl, chatBgBlurred: null });

      const needsProcessing = data.chatBgBlurSigma > 0 || data.chatBgDim > 0;
      if (needsProcessing) {
        const gen = ++processGenRef.current;
        setBlurring(true);
        runProcessing(dataUrl, data.chatBgBlurSigma, data.chatBgDim, gen);
      }
    },
    [data.chatBgBlurSigma, data.chatBgDim, onChange, runProcessing],
  );

  // Remove the background (also invalidate any in-flight processing).
  const handleRemove = useCallback(() => {
    processGenRef.current++;
    if (processTimerRef.current) clearTimeout(processTimerRef.current);
    setBlurring(false);
    onChange({
      chatBgOriginal: null,
      chatBgBlurred: null,
      chatBgBlurSigma: 0,
    });
  }, [onChange]);

  // Toggle blur on/off (non-blocking).
  const handleToggleBlur = useCallback(() => {
    if (blurEnabled) {
      processGenRef.current++;
      if (processTimerRef.current) clearTimeout(processTimerRef.current);
      setBlurring(false);
      onChange({ chatBgBlurSigma: 0, chatBgBlurred: null });

      // Re-process with dim only if needed.
      if (data.chatBgOriginal && data.chatBgDim > 0) {
        const gen = ++processGenRef.current;
        setBlurring(true);
        runProcessing(data.chatBgOriginal, 0, data.chatBgDim, gen);
      }
    } else {
      const sigma = 8;
      onChange({ chatBgBlurSigma: sigma });

      if (data.chatBgOriginal) {
        const gen = ++processGenRef.current;
        setBlurring(true);
        runProcessing(data.chatBgOriginal, sigma, data.chatBgDim, gen);
      }
    }
  }, [blurEnabled, data.chatBgOriginal, data.chatBgDim, onChange, runProcessing]);

  // Change blur sigma -- debounced.
  const handleBlurSigmaChange = useCallback(
    (sigma: number) => {
      onChange({ chatBgBlurSigma: sigma });
      if (!data.chatBgOriginal) return;
      scheduleProcessing(data.chatBgOriginal, sigma, data.chatBgDim);
    },
    [data.chatBgOriginal, data.chatBgDim, onChange, scheduleProcessing],
  );

  // Change dim -- debounced.
  const handleDimChange = useCallback(
    (dim: number) => {
      onChange({ chatBgDim: dim });
      if (!data.chatBgOriginal) return;
      scheduleProcessing(data.chatBgOriginal, data.chatBgBlurSigma, dim);
    },
    [data.chatBgOriginal, data.chatBgBlurSigma, onChange, scheduleProcessing],
  );

  // The image to show in the preview (blurred if available, otherwise original)
  const previewImage = data.chatBgBlurred ?? data.chatBgOriginal;

  const handleThemeChange = useCallback(
    (id: ThemeId) => {
      applyTheme(id);
      onChange({ theme: id });
    },
    [onChange],
  );

  const handleFontChange = useCallback(
    (id: string) => {
      applyFont(id);
      onChange({ fontFamily: id });
    },
    [onChange],
  );

  return (
    <>
      <h2 className={styles.panelTitle}>{t("personalize.panelTitle")}</h2>

      {/* -- Theme ------------------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("personalize.theme")}</h3>
        <p className={styles.fieldHint}>{t("personalize.themeHint")}</p>
        <div className={styles.optionGrid}>
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`${styles.optionCard} ${data.theme === theme.id ? styles.optionCardSelected : ""}`}
              onClick={() => handleThemeChange(theme.id)}
            >
              <span className={panelStyles.swatchGrid}>
                {theme.swatches.map((color) => (
                  <span
                    key={color}
                    className={panelStyles.swatch}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className={styles.optionLabel}>{theme.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* -- Chat Background --------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("personalize.chatBackground")}</h3>
        <p className={styles.fieldHint}>{t("personalize.chatBgHint")}</p>

        {/* Upload / Remove */}
        <FileDropZone
          accept="image/png,image/jpeg,image/webp"
          onFile={handleFileChange}
          label={t("personalize.bgDropLabel")}
          preview={
            hasBackground && previewImage ? (
              <img
                src={previewImage}
                alt="Chat background preview"
                style={{ opacity: data.chatBgOpacity }}
              />
            ) : undefined
          }
          onRemove={hasBackground ? handleRemove : undefined}
        />
      </section>

      {/* Blur & Appearance */}
      {hasBackground && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("personalize.bgEffects")}</h3>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>{t("personalize.blurBackground")}</label>
            <Toggle checked={blurEnabled} onChange={handleToggleBlur} disabled={blurring} />
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>{t("personalize.imageFit")}</label>
          </div>
          <div className={styles.optionGrid}>
            {bgFitOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`${styles.optionCard} ${data.chatBgFit === opt.id ? styles.optionCardSelected : ""}`}
                onClick={() => onChange({ chatBgFit: opt.id })}
              >
                <span className={styles.optionPreview}>{opt.icon}</span>
                <span className={styles.optionLabel}>{opt.label}</span>
              </button>
            ))}
          </div>

          {/* Advanced options - only shown in expert/developer mode */}
          {isExpert && (
            <>
              {blurEnabled && (
                <SliderField
                  label={t("personalize.blurStrength")}
                  hint={t("personalize.blurStrengthHint")}
                  min={1}
                  max={30}
                  step={1}
                  value={data.chatBgBlurSigma}
                  onChange={handleBlurSigmaChange}
                  format={(v) => `${v}`}
                />
              )}

              <SliderField
                label={t("personalize.imageOpacity")}
                hint={t("personalize.imageOpacityHint")}
                min={0.05}
                max={1}
                step={0.05}
                value={data.chatBgOpacity}
                onChange={(v) => onChange({ chatBgOpacity: v })}
                format={(v) => `${Math.round(v * 100)}%`}
              />

              <SliderField
                label={t("personalize.dimOverlay")}
                hint={t("personalize.dimOverlayHint")}
                min={0}
                max={0.9}
                step={0.05}
                value={data.chatBgDim}
                onChange={handleDimChange}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </>
          )}
        </section>
      )}

      {/* -- Message Style ----------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("personalize.messageStyle")}</h3>
        <p className={styles.fieldHint}>{t("personalize.messageStyleHint")}</p>
        <div className={styles.optionGrid}>
          {bubbleStyles.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.optionCard} ${data.bubbleStyle === s.id ? styles.optionCardSelected : ""}`}
              onClick={() => onChange({ bubbleStyle: s.id })}
            >
              <span className={styles.optionPreview}>{s.icon}</span>
              <span className={styles.optionLabel}>{s.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* -- Font -------------------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("personalize.font")}</h3>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>{t("personalize.fontSize")}</label>
          <div className={styles.optionGrid}>
            {fontSizes.map((fs) => (
              <button
                key={fs.id}
                type="button"
                className={`${styles.optionCard} ${data.fontSize === fs.id ? styles.optionCardSelected : ""}`}
                onClick={() => onChange({ fontSize: fs.id })}
              >
                <span className={styles.optionLabel}>{fs.label}</span>
              </button>
            ))}
          </div>
        </div>

        {isExpert && (
          <SliderField
            label={t("personalize.customFontSize")}
            hint={t("personalize.customFontSizeHint")}
            min={10}
            max={24}
            step={1}
            value={data.fontSizeCustomPx}
            onChange={(v) => onChange({ fontSizeCustomPx: v, fontSize: "large" })}
            format={(v) => `${v}px`}
          />
        )}

        <div className={styles.field}>
          <label className={styles.fieldLabel}>{t("personalize.fontFamily")}</label>
          <div className={styles.optionGrid}>
            {FONT_FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`${styles.optionCard} ${data.fontFamily === f.id ? styles.optionCardSelected : ""}`}
                style={{ fontFamily: f.css }}
                onClick={() => handleFontChange(f.id)}
              >
                <span className={styles.optionLabel}>{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* -- Message List ------------------------------------------ */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("personalize.messageList")}</h3>
        <div className={styles.fieldRow}>
          <div>
            <label className={styles.fieldLabel}>{t("personalize.compactMode")}</label>
            <p className={styles.fieldHint}>{t("personalize.compactModeHint")}</p>
          </div>
          <Toggle
            checked={data.compactMode}
            onChange={() => onChange({ compactMode: !data.compactMode })}
          />
        </div>
        <div className={styles.fieldRow}>
          <div>
            <label className={styles.fieldLabel}>{t("personalize.alwaysShowMessageActions")}</label>
            <p className={styles.fieldHint}>{t("personalize.alwaysShowMessageActionsHint")}</p>
          </div>
          <Toggle
            checked={data.alwaysShowMessageActions}
            onChange={() => onChange({ alwaysShowMessageActions: !data.alwaysShowMessageActions })}
          />
        </div>
      </section>

      {/* -- Channel Viewer ---------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("personalize.channelViewer")}</h3>
        <p className={styles.fieldHint}>{t("personalize.channelViewerHint")}</p>
        <div className={styles.optionGrid}>
          {channelViewerStyles.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.optionCard} ${data.channelViewerStyle === s.id ? styles.optionCardSelected : ""}`}
              onClick={() => onChange({ channelViewerStyle: s.id })}
            >
              <span className={styles.optionPreview}>{s.icon}</span>
              <span className={styles.optionLabel}>{s.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* -- Image editor overlay ---------------------------------- */}
      {editorImage && (
        <ImageEditor
          src={editorImage}
          cropShape="rect"
          targetWidth={MAX_BG_WIDTH}
          targetHeight={MAX_BG_HEIGHT}
          maxBytes={800_000}
          onConfirm={handleEditorConfirm}
          onCancel={() => setEditorImage(null)}
        />
      )}
    </>
  );
}

