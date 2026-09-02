import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Switch, TextField, Typography, useTheme } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { useAppStore } from "@core/store";
import { dataUrlToBytes, serializeProfile } from "@core/profileFormat";
import {
  AVATAR_BORDERS,
  DECORATIONS,
  EFFECTS,
  NAMEPLATES,
  loadProfileData,
  migrateProfilesToIdentities,
  saveProfileData,
  type ProfileData,
} from "@core/features/settings/profileData";
import { randomThemeColors, resolveThemePalette } from "@core/utils/colorUtils";
import type { FancyProfile, ProfileSections } from "@core/types";
import { nebulaCardTokens } from "../../profileStyle";
import { RichTextField, Stack, UserAvatar } from "../primitives";
import { Banner, Field, GroupTitle, PageTitle, PillGroup, SegmentedGroup } from "./controls";
import { ExpandableRow } from "./ExpandableRow";
import { ProfilePreview } from "./ProfilePreview";
import { radius } from "../../tokens";

// The cropper carries a canvas and a drag model, and it is only on screen
// for the few seconds after a file is picked. Loading it with the page made
// every visit to Profile pay for a modal most visits never open.
const ImageEditor = lazy(() =>
  import("@standard/pages/settings/ImageEditor").then((module) => ({ default: module.ImageEditor })),
);

type CropKind = "avatar" | "banner" | "sticker";

/** What each picked image is cropped and squeezed down to before it is sent. */
const CROP_SIZES: Record<CropKind, { width: number; height: number; maxBytes: number }> = {
  avatar: { width: 128, height: 128, maxBytes: 100_000 },
  banner: { width: 400, height: 150, maxBytes: 80_000 },
  sticker: { width: 96, height: 96, maxBytes: 40_000 },
};

type Row = "colours" | "frame" | "sticker" | "nameplate" | "name" | "effect" | null;

const NAME_FONTS = [
  { id: "", labelKey: "profile.fontDefault", css: "inherit" },
  { id: "serif", labelKey: "profile.fontSerif", css: "Georgia, serif" },
  { id: "mono", labelKey: "profile.fontMono", css: '"Geist Mono","Space Mono",monospace' },
  { id: "cursive", labelKey: "profile.fontCursive", css: '"Brush Script MT","Segoe Script",cursive' },
] as const;

/** The rows the card draws only if the profile lets it, in the card's order. */
const SECTION_ROWS = [
  { key: "badges", labelKey: "profile.sectionBadges", hintKey: "profile.sectionBadgesHint" },
  { key: "shelves", labelKey: "profile.sectionShelves", hintKey: "profile.sectionShelvesHint" },
  { key: "identity", labelKey: "profile.sectionIdentity", hintKey: "profile.sectionIdentityHint" },
  { key: "status", labelKey: "settings:profile.sectionStatus", hintKey: "profile.sectionStatusHint" },
  { key: "bio", labelKey: "profile.aboutYou", hintKey: "profile.sectionBioHint" },
  { key: "mutual", labelKey: "profile.sectionMutual", hintKey: "profile.sectionMutualHint" },
  { key: "roles", labelKey: "profile.sectionRoles", hintKey: "profile.sectionRolesHint" },
  { key: "activity", labelKey: "profile.sectionActivity", hintKey: "profile.sectionActivityHint" },
  { key: "stats", labelKey: "profile.sectionStats", hintKey: "profile.sectionStatsHint" },
] as const satisfies readonly { key: keyof ProfileSections; labelKey: string; hintKey: string }[];

/**
 * A status shares one line with a name, and rides in the same comment as the
 * rest of the profile - shorter than a bio by a lot, on both counts.
 */
const STATUS_MAX = 240;

/**
 * How long an edit sits before it is sent to the server.
 *
 * Every keystroke in the status field is an edit, and the card is a comment
 * plus a texture - two round trips the server rate-limits. Long enough that
 * typing a sentence sends once, short enough that you see the change on your
 * own card before you have gone looking for it.
 */
const APPLY_DEBOUNCE_MS = 800;

/** The server's "your profile is too big" refusal, from `PermissionDenied`. */
const DENY_TEXT_TOO_LONG = 4;

const MAX_CARD_COLOURS = 5;
const NEW_CARD_COLOUR = "#6366f1";

/**
 * The identity the editor opens on.
 *
 * The connected one, because it is the profile other people are looking at
 * right now and so the one an edit is nearly always meant for. A label asked
 * for by the Identities page outranks it: that request was explicit. With
 * neither - nothing connected, nobody asked - the first certificate stands in,
 * and with no certificates at all the answer is `null`, which is the key the
 * profile lived under before identities existed.
 */
function pickIdentity(
  identities: readonly string[],
  requested: string | null | undefined,
  connected: string | null,
): string | null {
  if (requested && identities.includes(requested)) return requested;
  if (connected && identities.includes(connected)) return connected;
  return identities[0] ?? null;
}

/**
 * The identities in the order the picker draws them: the connected one first.
 *
 * It is the identity you are wearing, so it is the one you are looking for -
 * and putting it in front makes the first pill the profile the editor opened
 * on, rather than whichever certificate happened to be generated first.
 */
function orderIdentities(identities: readonly string[], connected: string | null): string[] {
  return connected && identities.includes(connected)
    ? [connected, ...identities.filter((label) => label !== connected)]
    : [...identities];
}

/** Resolve a catalogue entry's label, honouring each catalogue's own default. */
function labelOf(
  options: readonly { id: string; label: string }[],
  id: string | undefined,
  fallbackId = "none",
): string {
  return options.find((option) => option.id === (id ?? fallbackId))?.label ?? "None";
}

/**
 * The Profile page.
 *
 * The mock's organising idea is that every card decision is one row showing the
 * current pick, with the picker folded away behind "Change" - so the page reads
 * as a summary of your profile rather than a form. Every row writes straight
 * into the same `FancyProfile` the Standard settings edit, and the preview
 * beside them is the real card component, so what you are adjusting and what
 * other people will see are the same thing rather than two renderings of it.
 */
export function ProfileSettings({
  identity: requestedIdentity,
  onManageIdentities,
}: Readonly<{
  /** The identity to open on, when the Identities page sent the user here. */
  identity?: string | null;
  /** Opens the Identities page. Omitted, the "Manage identities" link is too. */
  onManageIdentities?: () => void;
}>) {
  const { t } = useTranslation(["nebulaSettings", "settings", "chat"]);
  const connectedIdentity = useAppStore((state) => state.connectedCertLabel);
  const [identities, setIdentities] = useState<string[]>([]);
  const [identity, setIdentity] = useState<string | null>(null);
  /** False until the certificate list is in and an identity has been picked. */
  const [identityReady, setIdentityReady] = useState(false);
  const [data, setData] = useState<ProfileData | null>(null);
  const [displayName, setDisplayName] = useState("");
  /** The server's refusal as it arrived, if one did. Worded at render. */
  const [denial, setDenial] = useState<{ tooLarge: boolean; reason: string | null } | null>(null);
  const [row, setRow] = useState<Row>("colours");
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const stickerInput = useRef<HTMLInputElement>(null);
  const tokens = nebulaCardTokens(useTheme().palette.nebula);

  /**
   * The identity `data` was read from - and so the one a save writes back to.
   *
   * Between picking another identity and its profile arriving, the page is
   * still showing the previous one, and an edit made in that moment belongs to
   * the profile on screen rather than to the one being loaded.
   */
  const loadedIdentity = useRef<string | null>(null);

  /**
   * The pending send.
   *
   * Deliberately not cleared on unmount: leaving the page is not a reason to
   * throw away the edit that was made just before it, and the send touches
   * nothing this component owns.
   */
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // No certificate store yet - or no backend at all, under a test - is
      // "no identities", not a failure: the profile then lives under the
      // pre-identity key, which is what `loadProfileData(null)` reads.
      const certs = await invoke<string[]>("list_certificates").catch(() => [] as string[]);
      // Standard's editor moves the one global profile into the per-identity
      // keys the first time it opens. A client whose owner only ever opens
      // Nebula has to make the same move, or their profile stays under a key
      // nothing reads.
      await migrateProfilesToIdentities(certs).catch(() => undefined);
      if (!active) return;
      setIdentities(certs);
      // Read rather than subscribe: connecting while this page is open must
      // not drag the editor off the identity the user chose on it.
      setIdentity(pickIdentity(certs, requestedIdentity, useAppStore.getState().connectedCertLabel));
      setIdentityReady(true);
    })();
    void getPreferences()
      .then((preferences) => {
        if (active) setDisplayName(preferences.defaultUsername ?? "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [requestedIdentity]);

  /**
   * Why an edit did not take.
   *
   * A profile the server thinks is too big is refused with a `PermissionDenied`
   * and nothing else - the page would otherwise go on looking saved while every
   * card in the client kept the old one, which is indistinguishable from the
   * bug where nothing was sent at all.
   */
  useEffect(() => {
    const unlisten = listen<{ deny_type: number | null; reason: string | null }>(
      "permission-denied",
      ({ payload }) => {
        // Stored rather than worded here so the effect owes nothing to `t` and
        // registers once, rather than tearing itself down on every render.
        if (payload.deny_type === DENY_TEXT_TOO_LONG || payload.reason)
          setDenial({ tooLarge: payload.deny_type === DENY_TEXT_TOO_LONG, reason: payload.reason });
      },
    );
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    // Loading before the pick is settled would read the wrong profile and then
    // read the right one, and the write-back in between would be the wrong one
    // saved under the right key.
    if (!identityReady) return;
    let active = true;
    // An unreadable profile store means "nothing saved yet", not "no page":
    // falling back to an empty profile lets the user create one.
    void loadProfileData(identity)
      .then((loaded) => {
        if (!active) return;
        loadedIdentity.current = identity;
        setData(loaded);
      })
      .catch(() => {
        if (!active) return;
        loadedIdentity.current = identity;
        setData({ profile: {}, bio: "", avatarDataUrl: null });
      });
    return () => {
      active = false;
    };
  }, [identity, identityReady]);

  /**
   * A picked file goes to the cropper, not straight into the profile.
   *
   * An avatar is a circle and a banner is a wide strip, and a photograph is
   * neither: sending the raw file made the server carry a full-resolution
   * image to be squashed differently by every surface that drew it. The
   * editor is Standard's - a crop frame is a picker, and there is nothing
   * about this one that Nebula would draw differently.
   *
   * Declared above the loading guard: a hook after an early return is not run
   * on the render that takes it, and React counts hooks rather than naming
   * them.
   */
  const [cropping, setCropping] = useState<{ src: string; kind: CropKind } | null>(null);

  if (!data) return null;
  const profile = data.profile;

  /**
   * Where an edit goes: the store, and - if this is the identity the server is
   * showing - the server.
   *
   * The store alone is not enough and never was. A registered account keeps its
   * profile server-side, so the connect-time auto-apply skips it entirely; an
   * edit that only reached local storage would sit there being the profile
   * nobody, including its owner, could see. Sending is guarded on the identity
   * the profile was loaded from, so editing one identity's card never rewrites
   * the card you are wearing.
   */
  const commit = (next: ProfileData) => {
    const identityLabel = loadedIdentity.current;
    // The complaint was about the profile as it was; this one has not been
    // refused yet, and leaving the banner up says otherwise.
    setDenial(null);
    setData(next);
    void saveProfileData(next, identityLabel);
    if (applyTimer.current) clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => void applyToServer(next, identityLabel), APPLY_DEBOUNCE_MS);
  };
  const patchProfile = (patch: Partial<FancyProfile>) => {
    commit({ ...data, profile: { ...profile, ...patch } });
  };
  const patchData = (patch: Partial<ProfileData>) => {
    commit({ ...data, ...patch });
  };
  const nameStyle = profile.nameStyle ?? {};
  const colours = profile.themeColors ?? [];
  const patchColours = (next: string[]) => patchProfile({ themeColors: next.length > 0 ? next : undefined });

  // Images arrive as data URLs, which is exactly what the profile format
  // stores - no upload, no temp file, and it round-trips through the same
  // serializer the Standard editor uses.
  const readImage = (file: File | undefined, kind: CropKind) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" && setCropping({ src: reader.result, kind });
    reader.readAsDataURL(file);
  };

  const applyError = denial && (denial.tooLarge ? t("settings:profile.tooLarge") : denial.reason);

  const toggleRow = (candidate: Exclude<Row, null>) => () =>
    setRow((current) => (current === candidate ? null : candidate));

  return (
    <Stack direction="row" gap={4.5} alignItems="flex-start" flexWrap="wrap" sx={{ maxWidth: 1040 }}>
      <Box sx={{ flex: 1, minWidth: 340, maxWidth: 620 }}>
        <PageTitle title={t("settings:profile.panelTitle")} hint={t("nebulaSettings:profile.pageHint")} />

        {applyError && <Banner tone="danger">{applyError}</Banner>}

        {identities.length > 0 && (
          <IdentityBar
            identities={orderIdentities(identities, connectedIdentity)}
            selected={identity}
            connected={connectedIdentity}
            onSelect={setIdentity}
            onManage={onManageIdentities}
          />
        )}

        <Field label={t("nebulaSettings:profile.displayName")} sx={{ maxWidth: 420 }}>
          <TextField
            fullWidth
            size="small"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={() => void updatePreferences({ defaultUsername: displayName })}
            slotProps={{ input: { "aria-label": t("nebulaSettings:profile.displayName") } }}
          />
        </Field>

        <Stack direction="row" gap={2} sx={{ mt: "16px", maxWidth: 420 }}>
          <Field label={t("nebulaSettings:profile.pronouns")} sx={{ flex: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder={t("nebulaSettings:profile.pronounsPlaceholder")}
              value={profile.pronouns ?? ""}
              onChange={(event) => patchProfile({ pronouns: event.target.value || undefined })}
              slotProps={{ input: { "aria-label": t("nebulaSettings:profile.pronouns") } }}
            />
          </Field>
          <Field label={t("nebulaSettings:profile.contact")} sx={{ flex: 1.4 }}>
            <TextField
              fullWidth
              size="small"
              placeholder={t("nebulaSettings:profile.contactPlaceholder")}
              value={profile.contact ?? ""}
              onChange={(event) => patchProfile({ contact: event.target.value || undefined })}
              slotProps={{ input: { "aria-label": t("nebulaSettings:profile.contact") } }}
            />
          </Field>
        </Stack>

        <Field label={t("settings:profile.sectionStatus")} sx={{ mt: "16px", maxWidth: 420 }}>
          <RichTextField
            ariaLabel={t("settings:profile.sectionStatus")}
            placeholder={t("nebulaSettings:profile.statusPlaceholder")}
            singleLine
            maxLength={STATUS_MAX}
            value={profile.status ?? ""}
            onChange={(html) => patchProfile({ status: html || undefined })}
          />
        </Field>

        <Field label={t("nebulaSettings:profile.aboutYou")} sx={{ mt: "16px", maxWidth: 420 }}>
          <RichTextField
            ariaLabel={t("nebulaSettings:profile.aboutYou")}
            placeholder={t("nebulaSettings:profile.bioPlaceholder")}
            tools={["bold", "italic", "underline", "strike", "colour", "image"]}
            value={data.bio}
            onChange={(html) => setData({ ...data, bio: html })}
            onCommit={() => commit(data)}
          />
        </Field>

        <Stack direction="row" gap={2} sx={{ mt: "22px" }}>
          <Field label={t("settings:profile.sectionAvatar")} sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" gap={1.5}>
              <UserAvatar
                name={displayName || t("nebulaSettings:profile.you")}
                src={data.avatarDataUrl}
                size={52}
              />
              <TextButton
                label={t("nebulaSettings:profile.editAvatar")}
                onClick={() => avatarInput.current?.click()}
              >
                {t("nebulaSettings:profile.edit")}
              </TextButton>
              {data.avatarDataUrl && (
                <TextButton
                  label={t("nebulaSettings:profile.removeAvatar")}
                  onClick={() => patchData({ avatarDataUrl: null })}
                >
                  {t("nebulaSettings:profile.clear")}
                </TextButton>
              )}
              <input
                ref={avatarInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  readImage(event.target.files?.[0], "avatar");
                  event.target.value = "";
                }}
              />
            </Stack>
          </Field>

          <Field label={t("settings:profile.sectionBanner")} sx={{ flex: 1.4 }}>
            <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
              <Box
                sx={(theme) => ({
                  width: 110,
                  height: 52,
                  borderRadius: radius("md"),
                  flex: "none",
                  background: profile.banner?.image
                    ? `center/cover url(${profile.banner.image})`
                    : (profile.banner?.color ?? theme.palette.nebula.card2),
                  border: `1px solid ${theme.palette.nebula.line2}`,
                })}
              />
              <TextButton
                label={t("nebulaSettings:profile.editBannerImage")}
                onClick={() => bannerInput.current?.click()}
              >
                {t("nebulaSettings:profile.image")}
              </TextButton>
              <ColourWell
                label={t("nebulaSettings:profile.bannerColour")}
                value={profile.banner?.color ?? "#2a3350"}
                onChange={(color) => patchProfile({ banner: { ...profile.banner, color } })}
              />
              {(profile.banner?.image || profile.banner?.color) && (
                <TextButton
                  label={t("nebulaSettings:profile.removeBanner")}
                  onClick={() => patchProfile({ banner: undefined })}
                >
                  {t("nebulaSettings:profile.clear")}
                </TextButton>
              )}
              <input
                ref={bannerInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  readImage(event.target.files?.[0], "banner");
                  event.target.value = "";
                }}
              />
            </Stack>
          </Field>
        </Stack>

        <GroupTitle hint={t("nebulaSettings:profile.cardStyleHint")}>
          {t("nebulaSettings:profile.cardStyle")}
        </GroupTitle>

        <ExpandableRow
          title={t("nebulaSettings:profile.cardColours")}
          value={
            colours.length === 0
              ? t("nebulaSettings:profile.windowColours")
              : t("nebulaSettings:profile.coloursSummary", { count: colours.length }) +
                (profile.cardGlass ? t("nebulaSettings:profile.glassSuffix") : "")
          }
          open={row === "colours"}
          onToggle={toggleRow("colours")}
          preview={
            <Box
              sx={(theme) => ({
                width: 24,
                height: 24,
                borderRadius: radius("md"),
                background:
                  colours.length > 0
                    ? resolveThemePalette(colours, profile.cardGlass ?? false).gradient
                    : theme.palette.nebula.card2,
                border: `1px solid ${theme.palette.nebula.line2}`,
              })}
            />
          }
        >
          <Typography sx={{ fontSize: 11.5, mb: "10px", color: "text.secondary" }}>
            {t("nebulaSettings:profile.coloursHint")}
          </Typography>
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            {colours.map((colour, index) => (
              <Stack key={`${colour}-${index}`} direction="row" alignItems="center" gap={0.5}>
                <ColourWell
                  label={t("nebulaSettings:profile.cardColour", { index: index + 1 })}
                  value={colour}
                  onChange={(next) => patchColours(colours.map((entry, at) => (at === index ? next : entry)))}
                />
                <TextButton
                  label={t("nebulaSettings:profile.removeCardColour", { index: index + 1 })}
                  onClick={() => patchColours(colours.filter((_, at) => at !== index))}
                >
                  ×
                </TextButton>
              </Stack>
            ))}
            {colours.length < MAX_CARD_COLOURS && (
              <TextButton
                label={t("nebulaSettings:profile.addCardColour")}
                onClick={() => patchColours([...colours, NEW_CARD_COLOUR])}
              >
                {t("nebulaSettings:profile.addColour")}
              </TextButton>
            )}
            <TextButton
              label={t("nebulaSettings:profile.randomiseCardColours")}
              onClick={() => patchColours(randomThemeColors())}
            >
              {t("nebulaSettings:profile.shuffle")}
            </TextButton>
            {colours.length > 0 && (
              <TextButton
                label={t("nebulaSettings:profile.clearCardColours")}
                onClick={() => patchColours([])}
              >
                {t("nebulaSettings:profile.clear")}
              </TextButton>
            )}
          </Stack>

          <Stack direction="row" alignItems="center" gap={1.25} sx={{ mt: "14px" }}>
            <Switch
              checked={!!profile.cardGlass}
              onChange={(event) => patchProfile({ cardGlass: event.target.checked })}
              slotProps={{ input: { "aria-label": t("nebulaSettings:profile.frostedGlass") } }}
            />
            <Typography sx={{ fontSize: 12 }}>{t("nebulaSettings:profile.frostedGlassHint")}</Typography>
          </Stack>

          <Field label={t("nebulaSettings:profile.customBackgroundCss")} sx={{ mt: "14px" }}>
            <TextField
              fullWidth
              size="small"
              placeholder="linear-gradient(160deg,#2b2420,#211c24)"
              value={profile.cardBackgroundCustom ?? ""}
              onChange={(event) =>
                patchProfile({
                  cardBackgroundCustom: event.target.value || undefined,
                  cardBackground: event.target.value ? "custom" : undefined,
                })
              }
              slotProps={{ input: { "aria-label": t("nebulaSettings:profile.customCardBackground") } }}
            />
          </Field>
        </ExpandableRow>

        <ExpandableRow
          title={t("nebulaSettings:profile.avatarFrame")}
          value={labelOf(AVATAR_BORDERS, profile.avatarBorder, "default")}
          open={row === "frame"}
          onToggle={toggleRow("frame")}
          preview={
            <Box
              sx={(theme) => ({
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: theme.palette.nebula.card2,
                border: AVATAR_BORDERS.find((border) => border.id === profile.avatarBorder)?.border,
              })}
            />
          }
        >
          <Stack direction="row" gap={1.125} flexWrap="wrap">
            {AVATAR_BORDERS.filter((border) => border.id !== "custom").map((border) => (
              <Swatch
                key={border.id}
                active={(profile.avatarBorder ?? "default") === border.id}
                label={border.label}
                // "default" is the absence of a choice, so it is stored as one -
                // matching how the Standard editor writes this field.
                onClick={() =>
                  patchProfile({ avatarBorder: border.id === "default" ? undefined : border.id })
                }
              >
                <Box
                  sx={(theme) => ({
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: theme.palette.nebula.card2,
                    border: border.border,
                    boxShadow: border.shadow,
                  })}
                />
              </Swatch>
            ))}
          </Stack>
          <Field label={t("nebulaSettings:profile.customFrameCss")} sx={{ mt: "14px" }}>
            <TextField
              fullWidth
              size="small"
              placeholder="3px solid #e8b84b"
              value={profile.avatarBorderCustom ?? ""}
              onChange={(event) =>
                patchProfile({
                  avatarBorderCustom: event.target.value || undefined,
                  avatarBorder: event.target.value ? "custom" : undefined,
                })
              }
              slotProps={{ input: { "aria-label": t("nebulaSettings:profile.customAvatarFrame") } }}
            />
          </Field>
        </ExpandableRow>

        <ExpandableRow
          title={t("nebulaSettings:profile.sticker")}
          value={
            profile.decoration === "custom"
              ? t("nebulaSettings:profile.yourOwnImage")
              : labelOf(DECORATIONS, profile.decoration)
          }
          open={row === "sticker"}
          onToggle={toggleRow("sticker")}
          preview={
            profile.decoration === "custom" && profile.decorationImage ? (
              <Box
                component="img"
                alt=""
                src={profile.decorationImage}
                sx={{ width: 24, height: 24, objectFit: "contain" }}
              />
            ) : (
              <Box sx={{ fontSize: 18, width: 24, textAlign: "center" }}>
                {DECORATIONS.find((item) => item.id === (profile.decoration ?? "none"))?.preview}
              </Box>
            )
          }
        >
          <PillGroup
            ariaLabel={t("nebulaSettings:profile.sticker")}
            value={profile.decoration ?? "none"}
            onChange={(id) => patchProfile({ decoration: id })}
            options={DECORATIONS.map((item) => ({ id: item.id, label: `${item.preview} ${item.label}` }))}
          />
          <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "14px" }}>
            <TextButton
              label={t("nebulaSettings:profile.uploadStickerImage")}
              onClick={() => stickerInput.current?.click()}
            >
              {t("nebulaSettings:profile.uploadImage")}
            </TextButton>
            {profile.decorationImage && (
              <TextButton
                label={t("nebulaSettings:profile.removeStickerImage")}
                onClick={() => patchProfile({ decorationImage: undefined, decoration: "none" })}
              >
                {t("nebulaSettings:profile.clear")}
              </TextButton>
            )}
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              {t("nebulaSettings:profile.stickerHint")}
            </Typography>
            <input
              ref={stickerInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                readImage(event.target.files?.[0], "sticker");
                event.target.value = "";
              }}
            />
          </Stack>
        </ExpandableRow>

        <ExpandableRow
          title={t("nebulaSettings:profile.nameplate")}
          value={labelOf(NAMEPLATES, profile.nameplate)}
          open={row === "nameplate"}
          onToggle={toggleRow("nameplate")}
          preview={
            <Box
              sx={(theme) => ({
                width: 34,
                height: 16,
                borderRadius: radius("md"),
                background:
                  NAMEPLATES.find((plate) => plate.id === (profile.nameplate ?? "none"))?.bg ??
                  theme.palette.nebula.card2,
              })}
            />
          }
        >
          <Stack direction="row" gap={1} flexWrap="wrap">
            {NAMEPLATES.map((plate) => {
              const active = (profile.nameplate ?? "none") === plate.id;
              return (
                <Box
                  key={plate.id}
                  component="button"
                  aria-pressed={active}
                  onClick={() => patchProfile({ nameplate: plate.id })}
                  sx={(theme) => ({
                    all: "unset",
                    cursor: "pointer",
                    px: "15px",
                    py: "5px",
                    borderRadius: radius("xl"),
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 400,
                    color: plate.id === "none" ? theme.palette.nebula.muted : "#fff",
                    background: plate.id === "none" ? theme.palette.nebula.card : plate.bg,
                    border: `1px solid ${plate.id === "none" ? theme.palette.nebula.line : "transparent"}`,
                    boxShadow: active ? `0 0 0 2px ${theme.palette.nebula.accentLine}` : "none",
                  })}
                >
                  {plate.label}
                </Box>
              );
            })}
          </Stack>
        </ExpandableRow>

        <ExpandableRow
          title={t("nebulaSettings:profile.nameStyle")}
          value={[
            t(
              NAME_FONTS.find((font) => font.id === (nameStyle.font ?? ""))?.labelKey ??
                "nebulaSettings:profile.fontDefault",
            ),
            nameStyle.gradient ? t("nebulaSettings:profile.styleGradient") : null,
            nameStyle.glow ? t("nebulaSettings:profile.styleGlow") : null,
            nameStyle.bold ? t("nebulaSettings:profile.styleBold") : null,
            nameStyle.italic ? t("nebulaSettings:profile.styleItalic") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          open={row === "name"}
          onToggle={toggleRow("name")}
          preview={
            <Box
              sx={{
                width: 24,
                textAlign: "center",
                fontSize: 15,
                fontFamily: NAME_FONTS.find((font) => font.id === (nameStyle.font ?? ""))?.css,
              }}
            >
              {(displayName || t("nebulaSettings:profile.you")).slice(0, 2)}
            </Box>
          }
        >
          <SegmentedGroup
            ariaLabel={t("nebulaSettings:profile.nameFont")}
            value={(nameStyle.font ?? "") as (typeof NAME_FONTS)[number]["id"]}
            onChange={(id) => patchProfile({ nameStyle: { ...nameStyle, font: id || undefined } })}
            options={NAME_FONTS.map((font) => ({ id: font.id, label: t(font.labelKey) }))}
          />
          <Stack direction="row" gap={2.5} sx={{ mt: "12px", flexWrap: "wrap" }}>
            <ToggleRow
              label={t("chat:liveDoc.toolbar.bold")}
              checked={nameStyle.bold !== false}
              onChange={(on) => patchProfile({ nameStyle: { ...nameStyle, bold: on ? undefined : false } })}
            />
            <ToggleRow
              label={t("chat:liveDoc.toolbar.italic")}
              checked={!!nameStyle.italic}
              onChange={(on) => patchProfile({ nameStyle: { ...nameStyle, italic: on || undefined } })}
            />
          </Stack>

          <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "14px", flexWrap: "wrap" }}>
            <ToggleRow
              label={t("nebulaSettings:profile.gradient")}
              checked={!!nameStyle.gradient}
              onChange={(on) =>
                patchProfile({
                  nameStyle: { ...nameStyle, gradient: on ? ["#5b6cd9", "#8a5cf0"] : undefined },
                })
              }
            />
            {nameStyle.gradient && (
              <>
                <ColourWell
                  label={t("nebulaSettings:profile.gradientStart")}
                  value={nameStyle.gradient[0]}
                  onChange={(colour) =>
                    patchProfile({
                      nameStyle: { ...nameStyle, gradient: [colour, nameStyle.gradient![1]] },
                    })
                  }
                />
                <ColourWell
                  label={t("nebulaSettings:profile.gradientEnd")}
                  value={nameStyle.gradient[1]}
                  onChange={(colour) =>
                    patchProfile({
                      nameStyle: { ...nameStyle, gradient: [nameStyle.gradient![0], colour] },
                    })
                  }
                />
              </>
            )}
          </Stack>

          <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "10px", flexWrap: "wrap" }}>
            <ToggleRow
              label={t("nebulaSettings:profile.glow")}
              checked={!!nameStyle.glow}
              onChange={(on) =>
                patchProfile({
                  nameStyle: { ...nameStyle, glow: on ? { color: "#8a5cf0", size: 8 } : undefined },
                })
              }
            />
            {nameStyle.glow && (
              <>
                <ColourWell
                  label={t("nebulaSettings:profile.glowColour")}
                  value={nameStyle.glow.color}
                  onChange={(colour) =>
                    patchProfile({ nameStyle: { ...nameStyle, glow: { ...nameStyle.glow!, color: colour } } })
                  }
                />
                <TextField
                  size="small"
                  type="number"
                  value={nameStyle.glow.size}
                  onChange={(event) =>
                    patchProfile({
                      nameStyle: {
                        ...nameStyle,
                        glow: { ...nameStyle.glow!, size: Number(event.target.value) || 0 },
                      },
                    })
                  }
                  sx={{ width: 88 }}
                  slotProps={{ input: { "aria-label": t("nebulaSettings:profile.glowSize") } }}
                />
              </>
            )}
          </Stack>

          <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "10px" }}>
            <ColourWell
              label={t("nebulaSettings:profile.nameColour")}
              value={nameStyle.color ?? "#ffffff"}
              onChange={(colour) => patchProfile({ nameStyle: { ...nameStyle, color: colour } })}
            />
            <Typography sx={{ fontSize: 11.5 }}>{t("nebulaSettings:profile.flatColour")}</Typography>
            {nameStyle.color && (
              <TextButton
                label={t("nebulaSettings:profile.clearNameColour")}
                onClick={() => patchProfile({ nameStyle: { ...nameStyle, color: undefined } })}
              >
                {t("nebulaSettings:profile.clear")}
              </TextButton>
            )}
          </Stack>
        </ExpandableRow>

        <ExpandableRow
          title={t("nebulaSettings:profile.profileEffect")}
          value={labelOf(EFFECTS, profile.effect)}
          open={row === "effect"}
          onToggle={toggleRow("effect")}
          preview={
            <Box sx={{ fontSize: 16, width: 24, textAlign: "center" }}>
              {EFFECTS.find((effect) => effect.id === (profile.effect ?? "none"))?.preview}
            </Box>
          }
        >
          <PillGroup
            ariaLabel={t("nebulaSettings:profile.profileEffect")}
            value={profile.effect ?? "none"}
            onChange={(id) => patchProfile({ effect: id })}
            options={EFFECTS.map((effect) => ({ id: effect.id, label: effect.label }))}
          />
        </ExpandableRow>

        <GroupTitle hint={t("nebulaSettings:profile.whatTheCardShowsHint")}>
          {t("nebulaSettings:profile.whatTheCardShows")}
        </GroupTitle>
        <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mt: "6px" }}>
          {SECTION_ROWS.map((section) => (
            <Stack
              key={section.key}
              direction="row"
              alignItems="center"
              gap={1}
              sx={{ width: 250 }}
              title={t(section.hintKey)}
            >
              <Switch
                checked={profile.sections?.[section.key] !== false}
                onChange={(event) =>
                  patchProfile({
                    sections: { ...profile.sections, [section.key]: event.target.checked },
                  })
                }
                slotProps={{
                  input: {
                    "aria-label": t("nebulaSettings:profile.showSection", { section: t(section.labelKey) }),
                  },
                }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 12 }}>{t(section.labelKey)}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>{t(section.hintKey)}</Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Box>

      <ProfilePreview
        name={displayName || "You"}
        avatar={data.avatarDataUrl}
        profile={profile}
        bio={data.bio}
        tokens={tokens}
      />

      {cropping && (
        <Suspense fallback={null}>
          <ImageEditor
            src={cropping.src}
            cropShape={cropping.kind === "banner" ? "rect" : "circle"}
            targetWidth={CROP_SIZES[cropping.kind].width}
            targetHeight={CROP_SIZES[cropping.kind].height}
            maxBytes={CROP_SIZES[cropping.kind].maxBytes}
            onConfirm={(dataUrl) => {
              const kind = cropping.kind;
              setCropping(null);
              if (kind === "avatar") patchData({ avatarDataUrl: dataUrl });
              else if (kind === "banner") patchProfile({ banner: { ...profile.banner, image: dataUrl } });
              else patchProfile({ decorationImage: dataUrl, decoration: "custom" });
            }}
            onCancel={() => setCropping(null)}
          />
        </Suspense>
      )}
    </Stack>
  );
}

/**
 * Send a profile to the server, if it is the one the server should be showing.
 *
 * The state is read here rather than captured when the edit was made, because
 * the debounce means those are up to a second apart and a disconnect in between
 * should cancel the send rather than fail it.
 *
 * A connection made without choosing a certificate reports no identity at all,
 * and comparing that against the identity the editor fell back to would refuse
 * to send for every such connection - silently, which is the failure this whole
 * path exists to end. So an absent `connectedCertLabel` matches anything.
 */
async function applyToServer(data: ProfileData, identityLabel: string | null): Promise<void> {
  const { status, connectedCertLabel } = useAppStore.getState();
  if (status !== "connected") return;
  if (connectedCertLabel !== null && connectedCertLabel !== identityLabel) return;
  try {
    await invoke("set_user_comment", { comment: serializeProfile(data.profile, data.bio) });
    await invoke("set_user_texture", {
      texture: data.avatarDataUrl ? dataUrlToBytes(data.avatarDataUrl) : [],
    });
  } catch (reason) {
    console.error("Apply profile error:", reason);
  }
}

/**
 * Which identity's profile is being edited.
 *
 * A profile is stored per identity, so "your profile" is a question before it
 * is a page - and getting the answer wrong is silent: you spend an evening on
 * a card nobody sees, because the certificate you connect with reads a
 * different one. So the row names the identity even when there is only one to
 * name, puts the connected one first and marks it, and says plainly when the
 * profile on screen is not the profile the server is showing.
 */
function IdentityBar({
  identities,
  selected,
  connected,
  onSelect,
  onManage,
}: Readonly<{
  identities: readonly string[];
  selected: string | null;
  connected: string | null;
  onSelect: (label: string) => void;
  onManage?: () => void;
}>) {
  const { t } = useTranslation("settings");
  const label = t("profile.identityLabel");
  return (
    <Field label={label} sx={{ mb: "20px" }}>
      <Stack direction="row" alignItems="center" gap={0.875} flexWrap="wrap">
        <Stack direction="row" gap={0.875} flexWrap="wrap" role="radiogroup" aria-label={label}>
          {identities.map((name) => {
            const active = name === selected;
            return (
              <Box
                key={name}
                component="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(name)}
                sx={(theme) => ({
                  all: "unset",
                  cursor: "pointer",
                  px: "13px",
                  py: "7px",
                  borderRadius: radius("md"),
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
                  background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
                  border: `1px solid ${active ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
                })}
              >
                {name}
                {name === connected && (
                  <Box
                    component="span"
                    sx={(theme) => ({
                      ml: "7px",
                      fontSize: 9.5,
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: theme.palette.nebula.accent,
                    })}
                  >
                    {t("identities.connectedBadge")}
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
        {onManage && (
          <TextButton label={t("profile.manageIdentities")} onClick={onManage}>
            {t("profile.manageIdentities")}
          </TextButton>
        )}
      </Stack>
      {connected !== null && selected !== connected && (
        <Banner tone="warn">{t("profile.viewingOtherIdentity")}</Banner>
      )}
    </Field>
  );
}

function TextButton({
  children,
  label,
  onClick,
}: Readonly<{ children: React.ReactNode; label: string; onClick: () => void }>) {
  return (
    <Box
      component="button"
      aria-label={label}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        px: "14px",
        py: "8px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card2,
        fontSize: 12,
        fontWeight: 500,
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      {children}
    </Box>
  );
}

/** A colour input drawn as a swatch - the native control is a grey button. */
function ColourWell({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: string; onChange: (colour: string) => void }>) {
  return (
    <Box
      component="input"
      type="color"
      aria-label={label}
      title={label}
      value={value}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        width: 34,
        height: 34,
        borderRadius: radius("md"),
        overflow: "hidden",
        border: `1px solid ${theme.palette.nebula.line2}`,
        "&::-webkit-color-swatch-wrapper": { padding: 0 },
        "&::-webkit-color-swatch": { border: "none" },
      })}
    />
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: Readonly<{ label: string; checked: boolean; onChange: (on: boolean) => void }>) {
  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Switch
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        slotProps={{ input: { "aria-label": label } }}
      />
      <Typography sx={{ fontSize: 12 }}>{label}</Typography>
    </Stack>
  );
}

function Swatch({
  active,
  label,
  onClick,
  children,
}: Readonly<{ active: boolean; label: string; onClick: () => void; children: React.ReactNode }>) {
  return (
    <Box
      component="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        width: 44,
        height: 44,
        borderRadius: radius("lg"),
        display: "grid",
        placeItems: "center",
        background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
        border: `1px solid ${active ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
      })}
    >
      {children}
    </Box>
  );
}
