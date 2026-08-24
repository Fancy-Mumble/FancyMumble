import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { getSelectedUiDesign, getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import type { UiDesignId } from "@core/types";
import {
  loadPersonalization,
  PERSONALIZATION_DEFAULTS,
  savePersonalization,
  type BubbleStyle,
  type ChannelViewerStyle,
  type PersonalizationData,
} from "@standard/personalizationStorage";
import { applyTheme, THEMES, type ThemeId } from "@standard/themes";
import {
  bakeBackgroundVideo,
  captureAndStorePoster,
  clearChatBackgroundStore,
  extractBackgroundPoster,
  isStoreRef,
  onBakeProgress,
  pickChatBackground,
  probeVideoPlayback,
  processBackgroundImage,
  storedBackgroundUrl,
  storeRefName,
  toStoreRef,
  useResolvedBackgroundSource,
} from "@core/features/settings/chatBackground";
import { Stack } from "../primitives";
import { GroupTitle, PageTitle, SegmentedGroup, SliderRow } from "./controls";
import { radius } from "../../tokens";

const MESSAGE_STYLES: { id: BubbleStyle; label: string }[] = [
  { id: "bubbles", label: "Bubbles" },
  { id: "flat", label: "Flat" },
  { id: "compact", label: "Compact" },
];

const CHANNEL_VIEWERS: { id: ChannelViewerStyle; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "flat", label: "Flat" },
  { id: "modern", label: "Modern" },
];

const DESIGNS: { id: UiDesignId; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "aurora", label: "Aurora" },
  { id: "nebula", label: "Nebula" },
];

/**
 * The bake pipeline: at most one backend bake in flight, always finishing on
 * the most recently requested parameters.
 *
 * Module-level rather than component state so a bake keeps going - and its
 * result still lands in the record - after the settings page unmounts. The
 * generation counter retires results whose parameters the user has since
 * moved past; the chain keeps two bakes from deleting each other's output
 * files (the backend retires the previous `video-baked-*` when a new bake
 * finishes).
 */
let bakeChain: Promise<void> = Promise.resolve();
let bakeGeneration = 0;

function queueVideoBake(fileName: string, posterName: string | null, sigma: number, dim: number) {
  const generation = ++bakeGeneration;
  bakeChain = bakeChain.then(async () => {
    if (generation !== bakeGeneration) return;
    try {
      const baked = await bakeBackgroundVideo(fileName, sigma, dim);
      // The poster gets the same treatment, so the fallback still matches the
      // baked clip frame-for-look. Both are stamped with the parameters they
      // were computed for; a slider moved since makes them stale together.
      const poster = posterName ? await processBackgroundImage(posterName, sigma, dim) : null;
      if (generation !== bakeGeneration) return;
      const current = await loadPersonalization();
      if (current.chatBgVideo !== fileName || current.chatBgBlurSigma !== sigma || current.chatBgDim !== dim)
        return;
      await savePersonalization({
        ...current,
        chatBgVideoBaked: baked,
        chatBgVideoBakedSigma: sigma,
        chatBgVideoBakedDim: dim,
        chatBgBlurred: poster ? toStoreRef(poster) : null,
      });
    } catch {
      // Not bakeable (WebM, an exotic stream, a clip past the length cap):
      // the live CSS filter keeps rendering the current look instead.
    }
  });
}

/**
 * The Personalize page.
 *
 * Colour themes, message style and the chat background are app-wide rather than
 * Nebula's own, so this page writes the same personalization record Standard
 * does. The theme grid shows every bundled theme instead of the mock's three
 * cards - dropping eight themes to match an illustration would be a regression.
 */
export function PersonalizeSettings() {
  const [data, setData] = useState<PersonalizationData | null>(null);
  const [design, setDesign] = useState<UiDesignId>("nebula");
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [videoNotice, setVideoNotice] = useState<string | null>(null);
  const [bakePercent, setBakePercent] = useState<number | null>(null);
  const designOverride = getUiDesignOverride();
  const currentPreview = useResolvedBackgroundSource(data?.chatBgOriginal ?? null);

  // Bake progress, for the status line under the picker.
  useEffect(
    () =>
      onBakeProgress(({ done, total }) =>
        setBakePercent(total > 0 && done < total ? Math.round((done / total) * 100) : null),
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    void loadPersonalization()
      .then((loaded) => {
        if (active) setData(loaded);
      })
      .catch(() => {
        if (active) setData({ ...PERSONALIZATION_DEFAULTS });
      });
    void getSelectedUiDesign()
      .then((selected) => {
        if (active) setDesign(selected);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!data) return null;

  // Resolves once the record is on disk. A rejected write used to be dropped on
  // the floor, which is what made a failed pick look like a pick that worked:
  // the page kept the new value in state while nothing else in the app ever
  // heard about it, because the change event is only fired after the store
  // write succeeds.
  const patch = async (changes: Partial<PersonalizationData>) => {
    const next = { ...data, ...changes };
    setData(next);
    try {
      await savePersonalization(next);
      return true;
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : "Could not save that setting.");
      return false;
    }
  };

  /**
   * Pick a wallpaper - still or clip - through the one OS dialog.
   *
   * Nothing heavy crosses the webview: the backend stores (and, for images,
   * downscales) the pick and hands back a name. For a clip, the poster frame
   * is decoded backend-side by the bundled H.264 decoder; the webview only
   * captures one as a fallback for containers the backend cannot open. The
   * blur/dim bake then runs in the background while the raw clip already
   * plays under the equivalent live CSS filter.
   */
  const chooseBackground = async () => {
    setBackgroundBusy(true);
    setBackgroundError(null);
    setVideoNotice(null);
    try {
      const picked = await pickChatBackground();
      if (!picked) return;

      if (picked.kind === "image") {
        await patch({
          chatBgOriginal: toStoreRef(picked.fileName),
          chatBgBlurred: null,
          chatBgVideo: null,
          chatBgVideoBaked: null,
        });
        return;
      }

      let posterName = await extractBackgroundPoster(picked.fileName);
      if (!posterName) {
        // The backend cannot open this container (WebM); the webview is the
        // only decoder left, and its verdict is final.
        const src = await storedBackgroundUrl(picked.fileName);
        if (!src) throw new Error("That video could not be stored.");
        posterName = await captureAndStorePoster(src);
      }
      await patch({
        chatBgVideo: picked.fileName,
        chatBgOriginal: toStoreRef(posterName),
        chatBgBlurred: null,
        chatBgVideoBaked: null,
      });
      queueVideoBake(picked.fileName, posterName, data.chatBgBlurSigma, data.chatBgDim);

      // Advisory only: an unplayable wallpaper still shows its poster, but
      // saying so here beats a silently motionless background.
      void (async () => {
        const src = await storedBackgroundUrl(picked.fileName);
        if (!src) return;
        const verdict = await probeVideoPlayback(src);
        if (!verdict.playable)
          setVideoNotice(
            `${verdict.reason ?? "This system cannot play that video."} The still frame will show instead.`,
          );
      })();
    } catch (error) {
      // The pick cleared the previous wallpaper's files before failing, so the
      // record must not keep pointing at them.
      await clearChatBackgroundStore().catch(() => undefined);
      await patch({
        chatBgOriginal: null,
        chatBgBlurred: null,
        chatBgVideo: null,
        chatBgVideoBaked: null,
      });
      setBackgroundError(error instanceof Error ? error.message : "Could not use that file.");
    } finally {
      setBackgroundBusy(false);
    }
  };

  /** Forget the wallpaper: stored files, cached blobs, and the record. */
  const clearBackground = async () => {
    setVideoNotice(null);
    await clearChatBackgroundStore().catch(() => undefined);
    await patch({
      chatBgOriginal: null,
      chatBgBlurred: null,
      chatBgVideo: null,
      chatBgVideoBaked: null,
    });
  };

  /**
   * Commit a blur/dim slider.
   *
   * For an animated background the committed value re-runs the backend bake;
   * until it lands, the backdrop notices the parameter mismatch and renders
   * the raw clip under the live CSS filter, so the look is current either way.
   */
  const commitEffectSlider = async (changes: Partial<PersonalizationData>) => {
    const next = { ...data, ...changes };
    const saved = await patch(changes);
    if (saved && next.chatBgVideo) {
      const poster = isStoreRef(next.chatBgOriginal) ? storeRefName(next.chatBgOriginal) : null;
      queueVideoBake(next.chatBgVideo, poster, next.chatBgBlurSigma, next.chatBgDim);
    }
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title="Personalize" />

      <GroupTitle>Theme</GroupTitle>
      <Stack direction="row" gap={1.125} flexWrap="wrap" role="radiogroup" aria-label="Theme">
        {THEMES.map((theme) => {
          const active = data.theme === theme.id;
          return (
            <Box
              key={theme.id}
              component="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                applyTheme(theme.id as ThemeId);
                void patch({ theme: theme.id });
              }}
              sx={(muiTheme) => ({
                all: "unset",
                cursor: "pointer",
                width: 118,
                p: "7px",
                borderRadius: radius("md"),
                background: active ? muiTheme.palette.nebula.accentSoft : muiTheme.palette.nebula.card,
                border: `1px solid ${active ? muiTheme.palette.nebula.accentLine : muiTheme.palette.nebula.line}`,
              })}
            >
              <Box
                sx={{
                  height: 50,
                  borderRadius: radius("md"),
                  overflow: "hidden",
                  display: "flex",
                  border: "1px solid rgba(128,128,128,.2)",
                }}
              >
                {theme.swatches.map((swatch) => (
                  <Box key={swatch} sx={{ flex: 1, background: swatch }} />
                ))}
              </Box>
              <Typography
                sx={{ mt: "7px", fontSize: 12, fontWeight: active ? 600 : 500, textAlign: "center" }}
              >
                {theme.label}
              </Typography>
            </Box>
          );
        })}
      </Stack>

      <GroupTitle hint="Bubbles shows every message in a rounded card; Flat is one continuous river.">
        Message style
      </GroupTitle>
      <SegmentedGroup
        ariaLabel="Message style"
        options={MESSAGE_STYLES}
        value={data.bubbleStyle}
        onChange={(id) => void patch({ bubbleStyle: id })}
      />

      <GroupTitle>Chat background</GroupTitle>
      <Stack direction="row" gap={1.25} flexWrap="wrap">
        <BackgroundTile
          label="Default"
          active={!data.chatBgOriginal && !data.chatBgVideo}
          onClick={() => void clearBackground()}
        >
          <Box
            sx={(theme) => ({
              height: 64,
              borderRadius: radius("md"),
              border: `1.5px dashed ${theme.palette.nebula.line2}`,
              display: "grid",
              placeItems: "center",
              color: theme.palette.nebula.dim,
              fontSize: 16,
            })}
          >
            ∅
          </Box>
        </BackgroundTile>

        {(data.chatBgOriginal || data.chatBgVideo) && (
          <BackgroundTile
            label={data.chatBgVideo ? "Current (video)" : "Current"}
            active
            onClick={() => void chooseBackground()}
          >
            <Box
              sx={(theme) => ({
                height: 64,
                borderRadius: radius("md"),
                background: currentPreview
                  ? `center/cover url(${currentPreview})`
                  : theme.palette.nebula.card2,
                boxShadow: `0 0 0 2px ${theme.palette.nebula.accent}`,
              })}
            />
          </BackgroundTile>
        )}
      </Stack>

      <Box
        component="button"
        onClick={() => void chooseBackground()}
        sx={(theme) => ({
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "9px",
          mt: "10px",
          px: "12px",
          py: "9px",
          borderRadius: radius("md"),
          border: `1.5px dashed ${theme.palette.nebula.line2}`,
          fontSize: 11,
          color: theme.palette.nebula.dim,
          "&:hover": { borderColor: theme.palette.nebula.accentLine },
        })}
      >
        {backgroundBusy ? "Preparing background…" : "Choose an image or video — shown blurred behind chat"}
      </Box>

      {bakePercent !== null && (
        <Typography
          role="status"
          sx={(theme) => ({ mt: "8px", fontSize: 11.5, color: theme.palette.nebula.muted })}
        >
          Optimizing video — {bakePercent}% (the live preview shows meanwhile)
        </Typography>
      )}
      {videoNotice && (
        <Typography
          role="status"
          sx={(theme) => ({ mt: "8px", fontSize: 11.5, color: theme.palette.nebula.warn })}
        >
          {videoNotice}
        </Typography>
      )}

      {backgroundError && (
        <Typography
          role="alert"
          sx={(theme) => ({ mt: "8px", fontSize: 11.5, color: theme.palette.nebula.bad })}
        >
          {backgroundError}
        </Typography>
      )}

      <Stack direction="row" gap={3} sx={{ mt: "14px" }}>
        <SliderRow
          label="Blur"
          value={data.chatBgBlurSigma}
          display={`${data.chatBgBlurSigma}`}
          min={0}
          max={40}
          onChange={(value) => setData({ ...data, chatBgBlurSigma: value })}
          onCommit={(value) => void commitEffectSlider({ chatBgBlurSigma: value })}
        />
        <SliderRow
          label="Opacity"
          value={data.chatBgOpacity}
          display={`${Math.round(data.chatBgOpacity * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setData({ ...data, chatBgOpacity: value })}
          onCommit={(value) => void patch({ chatBgOpacity: value })}
        />
        <SliderRow
          label="Dim"
          value={data.chatBgDim}
          display={`${Math.round(data.chatBgDim * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setData({ ...data, chatBgDim: value })}
          onCommit={(value) => void commitEffectSlider({ chatBgDim: value })}
        />
      </Stack>

      <GroupTitle>Channel viewer</GroupTitle>
      <SegmentedGroup
        ariaLabel="Channel viewer"
        options={CHANNEL_VIEWERS}
        value={data.channelViewerStyle}
        onChange={(id) => void patch({ channelViewerStyle: id })}
      />

      <GroupTitle
        hint={
          designOverride
            ? `Pinned to "${designOverride}" by the development URL override.`
            : "Standard has the broadest feature coverage; Aurora and Nebula are design betas."
        }
      >
        Interface design
      </GroupTitle>
      <SegmentedGroup
        ariaLabel="Interface design"
        options={DESIGNS}
        value={design}
        onChange={(id) => {
          if (designOverride) return;
          setDesign(id);
          void setSelectedUiDesign(id);
        }}
      />
    </Box>
  );
}

function BackgroundTile({
  label,
  active,
  onClick,
  children,
}: Readonly<{ label: string; active: boolean; onClick: () => void; children: React.ReactNode }>) {
  return (
    <Box
      component="button"
      aria-pressed={active}
      onClick={onClick}
      sx={{ all: "unset", cursor: "pointer", width: 104 }}
    >
      {children}
      <Typography
        sx={(theme) => ({
          mt: "6px",
          fontSize: 11.5,
          textAlign: "center",
          fontWeight: active ? 600 : 400,
          color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
        })}
      >
        {label}
      </Typography>
    </Box>
  );
}
