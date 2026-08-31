import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { getSelectedUiDesign, getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import type { ServerSwitcher, UiDesignId } from "@core/types";
import {
  loadPersonalization,
  PERSONALIZATION_DEFAULTS,
  savePersonalization,
  type BubbleStyle,
  type ChannelViewerStyle,
  type FontSize,
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
import { GroupTitle, PageTitle, SegmentedGroup, SliderRow, ToggleCard } from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";
import { radius } from "../../tokens";

const MESSAGE_STYLES = [
  { id: "bubbles", labelKey: "settings:personalize.bubbleStyleBubbles" },
  { id: "flat", labelKey: "settings:personalize.bubbleStyleFlat" },
  { id: "compact", labelKey: "settings:personalize.bubbleStyleCompact" },
] as const satisfies readonly { id: BubbleStyle; labelKey: string }[];

/**
 * The three stored text sizes.
 *
 * "Large" is the custom pixel value rather than a size of its own - that is
 * what the record means, and `chatFontSizePx` reads it the same way - so the
 * expert slider below writes both fields and the pill follows it.
 */
const TEXT_SIZES = [
  { id: "small", labelKey: "settings:personalize.fontSizeSmall" },
  { id: "medium", labelKey: "settings:personalize.fontSizeMedium" },
  { id: "large", labelKey: "settings:personalize.fontSizeLarge" },
] as const satisfies readonly { id: FontSize; labelKey: string }[];

/** Where the servers are listed. All three draw the same set. */
const SERVER_SWITCHERS = [
  { id: "rail", labelKey: "nebulaSettings:personalize.serverSwitcherRail" },
  { id: "titlebar", labelKey: "nebulaSettings:personalize.serverSwitcherTitlebar" },
  { id: "both", labelKey: "nebulaSettings:personalize.serverSwitcherBoth" },
] as const satisfies readonly { id: ServerSwitcher; labelKey: string }[];

const CHANNEL_VIEWERS = [
  { id: "classic", labelKey: "settings:personalize.channelViewerClassic" },
  { id: "flat", labelKey: "settings:personalize.channelViewerFlat" },
  { id: "modern", labelKey: "settings:personalize.channelViewerModern" },
] as const satisfies readonly { id: ChannelViewerStyle; labelKey: string }[];

const DESIGNS = [
  { id: "standard", labelKey: "nebulaSettings:personalize.designStandard" },
  { id: "aurora", labelKey: "nebulaSettings:personalize.designAurora" },
  { id: "nebula", labelKey: "nebulaSettings:personalize.designNebula" },
] as const satisfies readonly { id: UiDesignId; labelKey: string }[];

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

/**
 * Whether the record's bake is usable for the parameters now in force.
 *
 * The same test `ChatBackdrop` applies when it chooses which file to play: a
 * bake stamped with different blur/dim values is yesterday's look, so it counts
 * as missing.
 */
function isBakeCurrent(data: PersonalizationData): boolean {
  return (
    data.chatBgVideoBaked != null &&
    data.chatBgVideoBakedSigma === data.chatBgBlurSigma &&
    data.chatBgVideoBakedDim === data.chatBgDim
  );
}

function queueVideoBake(
  fileName: string,
  posterName: string | null,
  sigma: number,
  dim: number,
  onFailed?: (reason: string) => void,
) {
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
    } catch (error) {
      // Not bakeable (WebM, an exotic stream, H.264 the bundled decoder will
      // not take, a clip past the length cap): the live CSS filter keeps
      // rendering the current look instead.
      //
      // Said out loud rather than swallowed, because the fallback is the
      // expensive path - a clip playing under a live blur costs several times
      // what the baked file does, for as long as the wallpaper is on screen -
      // and a wallpaper that quietly never optimizes looks exactly like one
      // that did.
      if (generation === bakeGeneration)
        onFailed?.(error instanceof Error ? error.message : String(error));
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
  const { t } = useTranslation(["nebulaSettings", "settings"]);
  const [data, setData] = useState<PersonalizationData | null>(null);
  const { prefs, set } = usePreferenceSettings();
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
        if (!active) return;
        setData(loaded);
        // A wallpaper set before the bake could handle its codec - or while it
        // was failing - is stuck on the live-filter path, which costs several
        // times what the baked file does for as long as it is on screen.
        // Nothing else ever revisits that decision, so opening this page is
        // where it gets another go.
        if (loaded.chatBgVideo && !isBakeCurrent(loaded))
          queueVideoBake(
            loaded.chatBgVideo,
            isStoreRef(loaded.chatBgOriginal) ? storeRefName(loaded.chatBgOriginal) : null,
            loaded.chatBgBlurSigma,
            loaded.chatBgDim,
            reportBakeFailure,
          );
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
      setBackgroundError(
        error instanceof Error ? error.message : t("nebulaSettings:personalize.saveFailed"),
      );
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
        if (!src) throw new Error(t("nebulaSettings:personalize.videoNotStored"));
        posterName = await captureAndStorePoster(src);
      }
      await patch({
        chatBgVideo: picked.fileName,
        chatBgOriginal: toStoreRef(posterName),
        chatBgBlurred: null,
        chatBgVideoBaked: null,
      });
      queueVideoBake(
        picked.fileName,
        posterName,
        data.chatBgBlurSigma,
        data.chatBgDim,
        reportBakeFailure,
      );

      // Advisory only: an unplayable wallpaper still shows its poster, but
      // saying so here beats a silently motionless background.
      void (async () => {
        const src = await storedBackgroundUrl(picked.fileName);
        if (!src) return;
        const verdict = await probeVideoPlayback(src);
        if (!verdict.playable)
          setVideoNotice(
            t("nebulaSettings:personalize.videoNotice", {
              reason: verdict.reason ?? t("nebulaSettings:personalize.videoUnplayable"),
            }),
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
      setBackgroundError(
        error instanceof Error ? error.message : t("nebulaSettings:personalize.fileUnusable"),
      );
    } finally {
      setBackgroundBusy(false);
    }
  };

  /**
   * Say that the clip could not be optimized.
   *
   * The wallpaper still plays and still looks right - what is lost is the
   * cheap path, so this is a notice rather than an error.
   */
  const reportBakeFailure = (reason: string) => {
    setVideoNotice(t("nebulaSettings:personalize.bakeFailed", { reason }));
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
      queueVideoBake(
        next.chatBgVideo,
        poster,
        next.chatBgBlurSigma,
        next.chatBgDim,
        reportBakeFailure,
      );
    }
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("settings:personalize.panelTitle")} />

      <GroupTitle>{t("settings:personalize.theme")}</GroupTitle>
      <Stack
        direction="row"
        gap={1.125}
        flexWrap="wrap"
        role="radiogroup"
        aria-label={t("settings:personalize.theme")}
      >
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

      <GroupTitle hint={t("nebulaSettings:personalize.messageStyleHint")}>
        {t("nebulaSettings:personalize.messageStyle")}
      </GroupTitle>
      <SegmentedGroup
        ariaLabel={t("nebulaSettings:personalize.messageStyle")}
        options={MESSAGE_STYLES.map((option) => ({ id: option.id, label: t(option.labelKey) }))}
        value={data.bubbleStyle}
        onChange={(id) => void patch({ bubbleStyle: id })}
      />

      <GroupTitle hint={t("nebulaSettings:personalize.textSizeHint")}>
        {t("nebulaSettings:personalize.textSize")}
      </GroupTitle>
      <SegmentedGroup
        ariaLabel={t("nebulaSettings:personalize.textSize")}
        options={TEXT_SIZES.map((option) => ({ id: option.id, label: t(option.labelKey) }))}
        value={data.fontSize}
        onChange={(id) => void patch({ fontSize: id })}
      />
      {/*
        Expert-only, as in Standard: it is the same choice as the pills above,
        offered a pixel at a time, and a page that asks the question twice at
        every level of detail is a page nobody reads.
      */}
      {prefs !== null && prefs.userMode !== "normal" && (
        <Box sx={{ mt: "14px", maxWidth: 320 }}>
          <SliderRow
            label={t("nebulaSettings:personalize.customSize")}
            value={data.fontSizeCustomPx}
            display={t("nebulaSettings:personalize.customSizePx", { value: data.fontSizeCustomPx })}
            min={10}
            max={24}
            step={1}
            onChange={(value) => setData({ ...data, fontSizeCustomPx: value, fontSize: "large" })}
            onCommit={(value) => void patch({ fontSizeCustomPx: value, fontSize: "large" })}
          />
        </Box>
      )}

      <GroupTitle>{t("nebulaSettings:personalize.messageList")}</GroupTitle>
      <Stack gap={1}>
        <ToggleCard
          title={t("nebulaSettings:personalize.compactMode")}
          hint={t("nebulaSettings:personalize.compactModeHint")}
          checked={data.compactMode}
          onChange={() => void patch({ compactMode: !data.compactMode })}
        />
        <ToggleCard
          title={t("settings:personalize.alwaysShowMessageActions")}
          hint={t("nebulaSettings:personalize.alwaysShowActionsHint")}
          checked={data.alwaysShowMessageActions}
          onChange={() => void patch({ alwaysShowMessageActions: !data.alwaysShowMessageActions })}
        />
      </Stack>

      <GroupTitle>{t("nebulaSettings:personalize.chatBackground")}</GroupTitle>
      <Stack direction="row" gap={1.25} flexWrap="wrap">
        <BackgroundTile
          label={t("nebulaSettings:personalize.backgroundDefault")}
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
            label={
              data.chatBgVideo
                ? t("nebulaSettings:personalize.backgroundCurrentVideo")
                : t("nebulaSettings:personalize.backgroundCurrent")
            }
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
        {backgroundBusy
          ? t("nebulaSettings:personalize.backgroundPreparing")
          : t("nebulaSettings:personalize.backgroundChoose")}
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
          label={t("nebulaSettings:personalize.blur")}
          value={data.chatBgBlurSigma}
          display={`${data.chatBgBlurSigma}`}
          min={0}
          max={40}
          onChange={(value) => setData({ ...data, chatBgBlurSigma: value })}
          onCommit={(value) => void commitEffectSlider({ chatBgBlurSigma: value })}
        />
        <SliderRow
          label={t("nebulaSettings:personalize.opacity")}
          value={data.chatBgOpacity}
          display={t("nebulaSettings:personalize.percent", {
            value: Math.round(data.chatBgOpacity * 100),
          })}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setData({ ...data, chatBgOpacity: value })}
          onCommit={(value) => void patch({ chatBgOpacity: value })}
        />
        <SliderRow
          label={t("nebulaSettings:personalize.dim")}
          value={data.chatBgDim}
          display={t("nebulaSettings:personalize.percent", { value: Math.round(data.chatBgDim * 100) })}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setData({ ...data, chatBgDim: value })}
          onCommit={(value) => void commitEffectSlider({ chatBgDim: value })}
        />
      </Stack>

      <GroupTitle hint={t("nebulaSettings:personalize.serverListHint")}>
        {t("nebulaSettings:personalize.serverList")}
      </GroupTitle>
      <SegmentedGroup
        ariaLabel={t("nebulaSettings:personalize.serverList")}
        options={SERVER_SWITCHERS.map((option) => ({ id: option.id, label: t(option.labelKey) }))}
        value={prefs?.serverSwitcher ?? "rail"}
        onChange={(id) => set({ serverSwitcher: id })}
      />

      <GroupTitle>{t("nebulaSettings:personalize.channelViewer")}</GroupTitle>
      <SegmentedGroup
        ariaLabel={t("nebulaSettings:personalize.channelViewer")}
        options={CHANNEL_VIEWERS.map((option) => ({ id: option.id, label: t(option.labelKey) }))}
        value={data.channelViewerStyle}
        onChange={(id) => void patch({ channelViewerStyle: id })}
      />

      <GroupTitle
        hint={
          designOverride
            ? t("nebulaSettings:personalize.designPinned", { design: designOverride })
            : t("nebulaSettings:personalize.designHint")
        }
      >
        {t("settings:personalize.uiDesign")}
      </GroupTitle>
      <SegmentedGroup
        ariaLabel={t("settings:personalize.uiDesign")}
        options={DESIGNS.map((option) => ({ id: option.id, label: t(option.labelKey) }))}
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
