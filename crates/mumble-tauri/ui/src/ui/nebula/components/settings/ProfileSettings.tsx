import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Box, Switch, TextField, Typography, useTheme } from "@mui/material";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import {
  AVATAR_BORDERS,
  DECORATIONS,
  EFFECTS,
  NAMEPLATES,
  loadProfileData,
  saveProfileData,
  type ProfileData,
} from "@core/features/settings/profileData";
import { randomThemeColors, resolveThemePalette } from "@core/utils/colorUtils";
import type { FancyProfile, ProfileSections } from "@core/types";
import { nebulaCardTokens } from "../../profileStyle";
import { RichTextField, Stack, UserAvatar } from "../primitives";
import { Field, GroupTitle, PageTitle, PillGroup, SegmentedGroup } from "./controls";
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
  { id: "", label: "Default", css: "inherit" },
  { id: "serif", label: "Serif", css: "Georgia, serif" },
  { id: "mono", label: "Mono", css: '"Geist Mono","Space Mono",monospace' },
  { id: "cursive", label: "Cursive", css: '"Brush Script MT","Segoe Script",cursive' },
] as const;

/** The rows the card draws only if the profile lets it, in the card's order. */
const SECTION_ROWS: { key: keyof ProfileSections; label: string; hint: string }[] = [
  { key: "badges", label: "Badges", hint: "The chips under your name" },
  { key: "shelves", label: "Badge shelves", hint: "Your collection, one rail per tier" },
  { key: "identity", label: "Pronouns & contact", hint: "The line under the badges" },
  { key: "status", label: "Status", hint: "Your one-line status" },
  { key: "bio", label: "About you", hint: "Your description" },
  { key: "mutual", label: "Mutual servers", hint: "Servers you share with the viewer" },
  { key: "roles", label: "Roles", hint: "The groups the server puts you in" },
  { key: "activity", label: "Activity", hint: "What you are playing, or where you are" },
  { key: "stats", label: "Stats", hint: "Messages, time in voice, account" },
];

/**
 * A status shares one line with a name, and rides in the same comment as the
 * rest of the profile - shorter than a bio by a lot, on both counts.
 */
const STATUS_MAX = 240;

const MAX_CARD_COLOURS = 5;
const NEW_CARD_COLOUR = "#6366f1";

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
export function ProfileSettings() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [row, setRow] = useState<Row>("colours");
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const stickerInput = useRef<HTMLInputElement>(null);
  const tokens = nebulaCardTokens(useTheme().palette.nebula);

  useEffect(() => {
    let active = true;
    // An unreadable profile store means "nothing saved yet", not "no page":
    // falling back to an empty profile lets the user create one.
    void loadProfileData()
      .then((loaded) => {
        if (active) setData(loaded);
      })
      .catch(() => {
        if (active) setData({ profile: {}, bio: "", avatarDataUrl: null });
      });
    void getPreferences()
      .then((preferences) => {
        if (active) setDisplayName(preferences.defaultUsername ?? "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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

  const patchProfile = (patch: Partial<FancyProfile>) => {
    const next = { ...data, profile: { ...profile, ...patch } };
    setData(next);
    void saveProfileData(next);
  };
  const patchData = (patch: Partial<ProfileData>) => {
    const next = { ...data, ...patch };
    setData(next);
    void saveProfileData(next);
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

  const toggleRow = (candidate: Exclude<Row, null>) => () =>
    setRow((current) => (current === candidate ? null : candidate));

  return (
    <Stack direction="row" gap={4.5} flexWrap="wrap" sx={{ maxWidth: 1040 }}>
      <Box sx={{ flex: 1, minWidth: 340, maxWidth: 620 }}>
        <PageTitle
          title="Profile"
          hint="Everything on one page — each row shows your current pick; Change opens just that section."
        />

        <Field label="Display name" sx={{ maxWidth: 420 }}>
          <TextField
            fullWidth
            size="small"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={() => void updatePreferences({ defaultUsername: displayName })}
            slotProps={{ input: { "aria-label": "Display name" } }}
          />
        </Field>

        <Stack direction="row" gap={2} sx={{ mt: "16px", maxWidth: 420 }}>
          <Field label="Pronouns" sx={{ flex: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="she/her"
              value={profile.pronouns ?? ""}
              onChange={(event) => patchProfile({ pronouns: event.target.value || undefined })}
              slotProps={{ input: { "aria-label": "Pronouns" } }}
            />
          </Field>
          <Field label="Contact" sx={{ flex: 1.4 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="you@example.com"
              value={profile.contact ?? ""}
              onChange={(event) => patchProfile({ contact: event.target.value || undefined })}
              slotProps={{ input: { "aria-label": "Contact" } }}
            />
          </Field>
        </Stack>

        <Field label="Status" sx={{ mt: "16px", maxWidth: 420 }}>
          <RichTextField
            ariaLabel="Status"
            placeholder="have a nice day ✌"
            singleLine
            maxLength={STATUS_MAX}
            value={profile.status ?? ""}
            onChange={(html) => patchProfile({ status: html || undefined })}
          />
        </Field>

        <Field label="About you" sx={{ mt: "16px", maxWidth: 420 }}>
          <RichTextField
            ariaLabel="About you"
            placeholder="Drum & bass and ARAM enjoyer."
            tools={["bold", "italic", "underline", "strike", "colour", "image"]}
            value={data.bio}
            onChange={(html) => setData({ ...data, bio: html })}
            onCommit={() => void saveProfileData(data)}
          />
        </Field>

        <Stack direction="row" gap={2} sx={{ mt: "22px" }}>
          <Field label="Avatar" sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" gap={1.5}>
              <UserAvatar name={displayName || "You"} src={data.avatarDataUrl} size={52} />
              <TextButton label="Edit avatar" onClick={() => avatarInput.current?.click()}>
                Edit
              </TextButton>
              {data.avatarDataUrl && (
                <TextButton label="Remove avatar" onClick={() => patchData({ avatarDataUrl: null })}>
                  Clear
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

          <Field label="Banner" sx={{ flex: 1.4 }}>
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
              <TextButton label="Edit banner image" onClick={() => bannerInput.current?.click()}>
                Image
              </TextButton>
              <ColourWell
                label="Banner colour"
                value={profile.banner?.color ?? "#2a3350"}
                onChange={(color) => patchProfile({ banner: { ...profile.banner, color } })}
              />
              {(profile.banner?.image || profile.banner?.color) && (
                <TextButton label="Remove banner" onClick={() => patchProfile({ banner: undefined })}>
                  Clear
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

        <GroupTitle hint="Colours first: everything else on the card takes its ramp from them.">
          Card style
        </GroupTitle>

        <ExpandableRow
          title="Card colours"
          value={
            colours.length === 0
              ? "Window colours"
              : `${colours.length} colour${colours.length === 1 ? "" : "s"}${profile.cardGlass ? " · glass" : ""}`
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
            The first three colours rake down the card, the fourth becomes its border and the fifth its accent
            — the send button, the volume bar and every link on it.
          </Typography>
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            {colours.map((colour, index) => (
              <Stack key={`${colour}-${index}`} direction="row" alignItems="center" gap={0.5}>
                <ColourWell
                  label={`Card colour ${index + 1}`}
                  value={colour}
                  onChange={(next) => patchColours(colours.map((entry, at) => (at === index ? next : entry)))}
                />
                <TextButton
                  label={`Remove card colour ${index + 1}`}
                  onClick={() => patchColours(colours.filter((_, at) => at !== index))}
                >
                  ×
                </TextButton>
              </Stack>
            ))}
            {colours.length < MAX_CARD_COLOURS && (
              <TextButton label="Add card colour" onClick={() => patchColours([...colours, NEW_CARD_COLOUR])}>
                + Colour
              </TextButton>
            )}
            <TextButton label="Randomise card colours" onClick={() => patchColours(randomThemeColors())}>
              Shuffle
            </TextButton>
            {colours.length > 0 && (
              <TextButton label="Clear card colours" onClick={() => patchColours([])}>
                Clear
              </TextButton>
            )}
          </Stack>

          <Stack direction="row" alignItems="center" gap={1.25} sx={{ mt: "14px" }}>
            <Switch
              checked={!!profile.cardGlass}
              onChange={(event) => patchProfile({ cardGlass: event.target.checked })}
              slotProps={{ input: { "aria-label": "Frosted glass" } }}
            />
            <Typography sx={{ fontSize: 12 }}>Frosted glass over the card background</Typography>
          </Stack>

          <Field label="Custom background (CSS)" sx={{ mt: "14px" }}>
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
              slotProps={{ input: { "aria-label": "Custom card background" } }}
            />
          </Field>
        </ExpandableRow>

        <ExpandableRow
          title="Avatar frame"
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
          <Field label="Custom frame (CSS border)" sx={{ mt: "14px" }}>
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
              slotProps={{ input: { "aria-label": "Custom avatar frame" } }}
            />
          </Field>
        </ExpandableRow>

        <ExpandableRow
          title="Sticker"
          value={
            profile.decoration === "custom" ? "Your own image" : labelOf(DECORATIONS, profile.decoration)
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
            ariaLabel="Sticker"
            value={profile.decoration ?? "none"}
            onChange={(id) => patchProfile({ decoration: id })}
            options={DECORATIONS.map((item) => ({ id: item.id, label: `${item.preview} ${item.label}` }))}
          />
          <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "14px" }}>
            <TextButton label="Upload sticker image" onClick={() => stickerInput.current?.click()}>
              Upload image
            </TextButton>
            {profile.decorationImage && (
              <TextButton
                label="Remove sticker image"
                onClick={() => patchProfile({ decorationImage: undefined, decoration: "none" })}
              >
                Clear
              </TextButton>
            )}
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              Hangs off the card's top-right corner, like the mock's.
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
          title="Nameplate"
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
          title="Name style"
          value={[
            NAME_FONTS.find((font) => font.id === (nameStyle.font ?? ""))?.label ?? "Default",
            nameStyle.gradient ? "gradient" : null,
            nameStyle.glow ? "glow" : null,
            nameStyle.bold ? "bold" : null,
            nameStyle.italic ? "italic" : null,
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
              {(displayName || "You").slice(0, 2)}
            </Box>
          }
        >
          <SegmentedGroup
            ariaLabel="Name font"
            value={(nameStyle.font ?? "") as (typeof NAME_FONTS)[number]["id"]}
            onChange={(id) => patchProfile({ nameStyle: { ...nameStyle, font: id || undefined } })}
            options={NAME_FONTS.map((font) => ({ id: font.id, label: font.label }))}
          />
          <Stack direction="row" gap={2.5} sx={{ mt: "12px", flexWrap: "wrap" }}>
            <ToggleRow
              label="Bold"
              checked={nameStyle.bold !== false}
              onChange={(on) => patchProfile({ nameStyle: { ...nameStyle, bold: on ? undefined : false } })}
            />
            <ToggleRow
              label="Italic"
              checked={!!nameStyle.italic}
              onChange={(on) => patchProfile({ nameStyle: { ...nameStyle, italic: on || undefined } })}
            />
          </Stack>

          <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "14px", flexWrap: "wrap" }}>
            <ToggleRow
              label="Gradient"
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
                  label="Gradient start"
                  value={nameStyle.gradient[0]}
                  onChange={(colour) =>
                    patchProfile({
                      nameStyle: { ...nameStyle, gradient: [colour, nameStyle.gradient![1]] },
                    })
                  }
                />
                <ColourWell
                  label="Gradient end"
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
              label="Glow"
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
                  label="Glow colour"
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
                  slotProps={{ input: { "aria-label": "Glow size" } }}
                />
              </>
            )}
          </Stack>

          <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "10px" }}>
            <ColourWell
              label="Name colour"
              value={nameStyle.color ?? "#ffffff"}
              onChange={(colour) => patchProfile({ nameStyle: { ...nameStyle, color: colour } })}
            />
            <Typography sx={{ fontSize: 11.5 }}>Flat colour</Typography>
            {nameStyle.color && (
              <TextButton
                label="Clear name colour"
                onClick={() => patchProfile({ nameStyle: { ...nameStyle, color: undefined } })}
              >
                Clear
              </TextButton>
            )}
          </Stack>
        </ExpandableRow>

        <ExpandableRow
          title="Profile effect"
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
            ariaLabel="Profile effect"
            value={profile.effect ?? "none"}
            onChange={(id) => patchProfile({ effect: id })}
            options={EFFECTS.map((effect) => ({ id: effect.id, label: effect.label }))}
          />
        </ExpandableRow>

        <GroupTitle hint="Anything switched off here is hidden on every card of you, everywhere.">
          What the card shows
        </GroupTitle>
        <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mt: "6px" }}>
          {SECTION_ROWS.map((section) => (
            <Stack
              key={section.key}
              direction="row"
              alignItems="center"
              gap={1}
              sx={{ width: 250 }}
              title={section.hint}
            >
              <Switch
                checked={profile.sections?.[section.key] !== false}
                onChange={(event) =>
                  patchProfile({
                    sections: { ...profile.sections, [section.key]: event.target.checked },
                  })
                }
                slotProps={{ input: { "aria-label": `Show ${section.label}` } }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 12 }}>{section.label}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>{section.hint}</Typography>
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
