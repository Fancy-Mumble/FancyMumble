import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography, useTheme } from "@mui/material";
import { getSelectedUiDesign, getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import type { ServerSwitcher, UiDesignId } from "@core/types";
import {
  CHAT_BG_RECENTS_MAX,
  loadPersonalization,
  PERSONALIZATION_DEFAULTS,
  savePersonalization,
  type BubbleStyle,
  type ChannelViewerStyle,
  type ChatBackgroundEntry,
  type FontSize,
  type PersonalizationData,
} from "@standard/personalizationStorage";
import { applyColorMode, applyTheme, type ThemeId } from "@standard/themes";
import type { ColorMode } from "@standard/personalizationStorage";
import { NEBULA_THEMES } from "../../themeCatalog";
import { nebulaScheme, schemeSwatches } from "../../themeScheme";
import { nebulaChannelViewer } from "../../useChannelViewer";
import {
  bakeBackgroundVideo,
  captureAndStorePoster,
  extractBackgroundPoster,
  isStoreRef,
  onBakeProgress,
  pickChatBackground,
  probeVideoPlayback,
  processBackgroundImage,
  pruneChatBackgrounds,
  storedBackgroundUrl,
  storeRefName,
  toStoreRef,
  useResolvedBackgroundSource,
} from "@core/features/settings/chatBackground";
import {
  activeBackground,
  forgetBackground,
  hasBackground,
  isSameBackground,
  rememberBackground,
  referencedFiles,
  showBackground,
  updateBackground,
} from "@core/features/settings/chatBackgroundRecents";
import { CloseIcon } from "@ui/icons";
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

/**
 * The two layouts Nebula's channel column actually draws.
 *
 * Standard offers a third, "classic", which is its tree with no occupants
 * under it at all - a shape Nebula's rows are not built for. Offering it here
 * would be offering a choice this design cannot honour, so the picker stops at
 * what it can do, and `nebulaChannelViewer` reads a record Standard left
 * behind as the nearer of these two.
 */
const CHANNEL_VIEWERS = [
  { id: "flat", labelKey: "settings:personalize.channelViewerFlat" },
  { id: "modern", labelKey: "settings:personalize.channelViewerModern" },
] as const satisfies readonly { id: ChannelViewerStyle; labelKey: string }[];

/**
 * Light, dark, or whatever the platform says.
 *
 * A choice of its own because the design sheet draws every theme in both
 * schemes - the names are brands, not modes - so "Rose" no longer implies dark
 * any more than "Light" implies light.
 */
const COLOR_MODES = [
  { id: "system", labelKey: "nebulaSettings:personalize.modeSystem" },
  { id: "light", labelKey: "nebulaSettings:personalize.modeLight" },
  { id: "dark", labelKey: "nebulaSettings:personalize.modeDark" },
] as const satisfies readonly { id: ColorMode; labelKey: string }[];

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
      const shown: PersonalizationData = {
        ...current,
        chatBgVideoBaked: baked,
        chatBgVideoBakedSigma: sigma,
        chatBgVideoBakedDim: dim,
        chatBgBlurred: poster ? toStoreRef(poster) : null,
      };
      // The shelf's copy of this wallpaper still points at the files the bake
      // just superseded, and the prune below deletes exactly the files nothing
      // points at - so it has to learn the new names first, or it would keep
      // the old ones alive and lose the new ones on the next pass.
      const next: PersonalizationData = {
        ...shown,
        chatBgRecents: updateBackground(current.chatBgRecents, activeBackground(shown)),
      };
      await savePersonalization(next);
      await pruneChatBackgrounds(referencedFiles(next)).catch(() => undefined);
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
      if (generation === bakeGeneration) onFailed?.(error instanceof Error ? error.message : String(error));
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
  const muiTheme = useTheme();
  const designOverride = getUiDesignOverride();
  // The scheme the cards preview in: whatever the window is wearing right now,
  // which is what the theme factory resolved from the same two inputs.
  const resolvedMode = muiTheme.palette.mode === "light" ? "light" : "dark";

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

  const shown = activeBackground(data);
  // A wallpaper set before the shelf existed - or by Standard's own editor,
  // which knows nothing about it - is on screen without being on the shelf.
  // It still gets a tile, so the picker never draws a background the user can
  // see but not switch back to, and the next pick remembers it properly.
  const shelf =
    hasBackground(shown) && !data.chatBgRecents.some((entry) => isSameBackground(entry, shown))
      ? [shown, ...data.chatBgRecents]
      : data.chatBgRecents;

  // Resolves once the record is on disk. A rejected write used to be dropped on
  // the floor, which is what made a failed pick look like a pick that worked:
  // the page kept the new value in state while nothing else in the app ever
  // heard about it, because the change event is only fired after the store
  // write succeeds.
  const patch = async (changes: Partial<PersonalizationData>): Promise<PersonalizationData | null> => {
    const next = { ...data, ...changes };
    setData(next);
    try {
      await savePersonalization(next);
      return next;
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : t("nebulaSettings:personalize.saveFailed"));
      return null;
    }
  };

  /**
   * Put a wallpaper on screen: a fresh pick, one off the shelf, or - for
   * `null` - no wallpaper at all.
   *
   * The record is the only thing that changes. A wallpaper coming back off the
   * shelf is already stored down to its poster and its bake, so switching
   * costs a store write and a blob read, never a re-copy or a re-decode.
   *
   * The prune runs after the write, never before: it deletes precisely the
   * files the saved record no longer names, which is how a wallpaper let go -
   * or a pick that fell over half way - actually leaves the disk.
   */
  const selectBackground = async (entry: ChatBackgroundEntry | null, remember = false) => {
    setVideoNotice(null);
    setBackgroundError(null);
    const saved = await patch({
      ...showBackground(entry),
      chatBgRecents:
        entry && remember ? rememberBackground(data.chatBgRecents, entry) : data.chatBgRecents,
    });
    if (!saved) return null;
    await pruneChatBackgrounds(referencedFiles(saved)).catch(() => undefined);
    // A clip off the shelf carries the bake it was last seen under, which is
    // yesterday's look if the sliders have moved since. Same repair the page
    // does on open, at the other moment a stale bake can come into view.
    if (saved.chatBgVideo && !isBakeCurrent(saved))
      queueVideoBake(
        saved.chatBgVideo,
        isStoreRef(saved.chatBgOriginal) ? storeRefName(saved.chatBgOriginal) : null,
        saved.chatBgBlurSigma,
        saved.chatBgDim,
        reportBakeFailure,
      );
    return saved;
  };

  /**
   * Take a wallpaper off the shelf for good, deleting its files.
   *
   * The shelf is the only thing keeping those files alive, so this is where a
   * wallpaper is actually thrown away - what the "Default" tile used to do
   * back when the store held one picture and "not showing it" and "not having
   * it" were the same state.
   */
  const forgetBackgroundEntry = async (entry: ChatBackgroundEntry) => {
    const wasShown = isSameBackground(entry, activeBackground(data));
    const saved = await patch({
      ...(wasShown ? showBackground(null) : {}),
      chatBgRecents: forgetBackground(data.chatBgRecents, entry),
    });
    if (saved) await pruneChatBackgrounds(referencedFiles(saved)).catch(() => undefined);
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
        await selectBackground(
          {
            original: toStoreRef(picked.fileName),
            blurred: null,
            video: null,
            videoBaked: null,
            videoBakedSigma: 0,
            videoBakedDim: 0,
          },
          true,
        );
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
      const saved = await selectBackground(
        {
          original: toStoreRef(posterName),
          blurred: null,
          video: picked.fileName,
          videoBaked: null,
          videoBakedSigma: 0,
          videoBakedDim: 0,
        },
        true,
      );
      // The bake is `selectBackground`'s to start: a fresh pick has no bake at
      // all, which is the same "stale bake" it repairs for a clip taken back
      // off the shelf.
      if (!saved) return;

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
      // A pick only ever adds files now, so the wallpaper that was on screen
      // is exactly where it was - the record keeps it, and the only thing to
      // clean up is whatever this pick managed to store before falling over.
      await loadPersonalization()
        .then((current) => pruneChatBackgrounds(referencedFiles(current)))
        .catch(() => undefined);
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
      queueVideoBake(next.chatBgVideo, poster, next.chatBgBlurSigma, next.chatBgDim, reportBakeFailure);
    }
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("settings:personalize.panelTitle")} />

      <GroupTitle>{t("settings:personalize.theme")}</GroupTitle>
      {/*
        Each card previews the theme in the scheme that is actually in force, so
        the grid answers "what will my window look like" rather than "what
        colours does this theme own" - which matters now that every theme has
        two schemes and the swatches would otherwise show only one of them.
      */}
      <Stack
        direction="row"
        gap={1.125}
        flexWrap="wrap"
        role="radiogroup"
        aria-label={t("settings:personalize.theme")}
      >
        {NEBULA_THEMES.map((theme) => {
          const active = data.theme === theme.id;
          const preview = nebulaScheme(theme.id, resolvedMode);
          const swatches = preview ? schemeSwatches(preview) : [];
          return (
            <Box
              key={theme.id}
              component="button"
              role="radio"
              aria-checked={active}
              title={`${theme.audience} — ${theme.note}`}
              onClick={() => {
                applyTheme(theme.id as ThemeId);
                void patch({ theme: theme.id as ThemeId });
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
                {swatches.map((swatch, at) => (
                  <Box key={`${swatch}-${at}`} sx={{ flex: 1, background: swatch }} />
                ))}
              </Box>
              <Typography
                sx={{ mt: "7px", fontSize: 12, fontWeight: active ? 600 : 500, textAlign: "center" }}
              >
                {theme.name}
              </Typography>
            </Box>
          );
        })}
      </Stack>

      <GroupTitle hint={t("nebulaSettings:personalize.colorModeHint")}>
        {t("nebulaSettings:personalize.colorMode")}
      </GroupTitle>
      <SegmentedGroup
        ariaLabel={t("nebulaSettings:personalize.colorMode")}
        options={COLOR_MODES.map((option) => ({ id: option.id, label: t(option.labelKey) }))}
        value={data.colorMode}
        onChange={(id) => {
          applyColorMode(id);
          void patch({ colorMode: id });
        }}
      />

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

      <GroupTitle hint={t("nebulaSettings:personalize.chatBackgroundHint", { max: CHAT_BG_RECENTS_MAX })}>
        {t("nebulaSettings:personalize.chatBackground")}
      </GroupTitle>
      <Stack direction="row" gap={1.25} flexWrap="wrap">
        <BackgroundTile
          label={t("nebulaSettings:personalize.backgroundDefault")}
          active={!hasBackground(shown)}
          onClick={() => void selectBackground(null)}
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

        {shelf.map((entry) => (
          <SavedBackgroundTile
            key={entry.video ?? entry.original ?? ""}
            entry={entry}
            active={isSameBackground(entry, shown)}
            onSelect={() => void selectBackground(entry)}
            onForget={() => void forgetBackgroundEntry(entry)}
          />
        ))}
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
          {t("nebulaSettings:personalize.bakingVideo", { percent: bakePercent })}
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
        value={nebulaChannelViewer(data.channelViewerStyle)}
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

/**
 * One wallpaper on the shelf.
 *
 * Resolves its own preview, because a shelf of five is five blob reads and a
 * hook cannot be called in a loop by the page.
 */
function SavedBackgroundTile({
  entry,
  active,
  onSelect,
  onForget,
}: Readonly<{
  entry: ChatBackgroundEntry;
  active: boolean;
  onSelect: () => void;
  onForget: () => void;
}>) {
  const { t } = useTranslation(["nebulaSettings"]);
  const preview = useResolvedBackgroundSource(entry.original);
  const labelKey = active
    ? entry.video
      ? "nebulaSettings:personalize.backgroundCurrentVideo"
      : "nebulaSettings:personalize.backgroundCurrent"
    : entry.video
      ? "nebulaSettings:personalize.backgroundSavedVideo"
      : "nebulaSettings:personalize.backgroundSaved";

  return (
    <BackgroundTile
      label={t(labelKey)}
      active={active}
      onClick={onSelect}
      onForget={onForget}
      forgetLabel={t("nebulaSettings:personalize.backgroundForget")}
    >
      <Box
        sx={(theme) => ({
          height: 64,
          borderRadius: radius("md"),
          background: preview ? `center/cover url(${preview})` : theme.palette.nebula.card2,
          boxShadow: active ? `0 0 0 2px ${theme.palette.nebula.accent}` : "none",
          border: active ? "none" : `1px solid ${theme.palette.nebula.line}`,
        })}
      />
    </BackgroundTile>
  );
}

function BackgroundTile({
  label,
  active,
  onClick,
  onForget,
  forgetLabel,
  children,
}: Readonly<{
  label: string;
  active: boolean;
  onClick: () => void;
  onForget?: () => void;
  forgetLabel?: string;
  children: React.ReactNode;
}>) {
  return (
    <Box sx={{ position: "relative", width: 104 }}>
      <Box
        component="button"
        aria-pressed={active}
        onClick={onClick}
        sx={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
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
      {/*
        A sibling of the tile rather than a child of it: a button inside a
        button is not markup a browser will honour, and the click has to reach
        exactly one of the two.
      */}
      {onForget && (
        <Box
          component="button"
          type="button"
          aria-label={forgetLabel}
          title={forgetLabel}
          onClick={onForget}
          sx={(theme) => ({
            all: "unset",
            position: "absolute",
            top: 5,
            right: 5,
            display: "grid",
            placeItems: "center",
            width: 18,
            height: 18,
            borderRadius: "50%",
            cursor: "pointer",
            color: theme.palette.nebula.text,
            background: "rgba(0,0,0,.55)",
            opacity: 0.7,
            "&:hover, &:focus-visible": { opacity: 1, background: "rgba(0,0,0,.75)" },
          })}
        >
          <CloseIcon width={10} height={10} />
        </Box>
      )}
    </Box>
  );
}
