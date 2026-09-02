import { useState } from "react";
import { Box, Switch, Typography } from "@mui/material";
import type { FancyProfile } from "@core/types";
import { ProfileCard, PencilGlyph, type ProfileCardModel, type ProfileCardTokens } from "@shared/profilecard";
import { useTranslation } from "react-i18next";
import { Stack } from "../primitives";

/**
 * The mock's caption, kept because it is also the page's promise: every noun on
 * it is a row in the editor beside this preview.
 */
const FOOTNOTE_KEY = "preview.footnote";

/**
 * Example content for the rows only a server can fill.
 *
 * Badges, shelves, roles and the activity row come off the connection, so a
 * profile editor opened before joining anywhere would draw a card with half its
 * rows missing - and the switches that hide those rows would appear to do
 * nothing. These stand in so the layout is visible, and they are labelled as
 * examples rather than passed off as yours.
 */
type PreviewT = ReturnType<typeof useTranslation<["nebulaSettings", "nebulaUser"]>>["t"];

const exampleContent = (
  t: PreviewT,
): Pick<ProfileCardModel, "badges" | "shelves" | "roles" | "activity" | "stats"> => ({
  badges: [
    {
      id: "x1",
      label: t("preview.exampleBadge"),
      glyph: { kind: "icon", name: "star" },
      tone: "#ecba55",
      source: "server",
    },
    {
      id: "x2",
      label: t("preview.exampleBadge"),
      glyph: { kind: "icon", name: "mic" },
      tone: "#41b4f9",
      source: "server",
    },
    {
      id: "x3",
      label: t("preview.exampleBadge"),
      glyph: { kind: "icon", name: "sparkle" },
      tone: "#a855f7",
      source: "server",
    },
    {
      id: "x4",
      label: t("preview.exampleBadge"),
      glyph: { kind: "icon", name: "check" },
      tone: "#3cd88e",
      source: "server",
    },
  ],
  shelves: [
    {
      id: "common",
      badges: [
        {
          id: "s1",
          label: t("preview.example"),
          glyph: { kind: "icon", name: "circle" },
          source: "server",
          shape: "dot",
        },
        {
          id: "s2",
          label: t("preview.example"),
          glyph: { kind: "icon", name: "diamond" },
          source: "server",
          shape: "diamond",
        },
        {
          id: "s3",
          label: t("preview.example"),
          glyph: { kind: "icon", name: "diamond" },
          source: "server",
          shape: "diamond",
        },
      ],
      overflow: 0,
    },
    {
      id: "special",
      label: t("preview.special"),
      badges: [
        {
          id: "s4",
          label: t("preview.example"),
          glyph: { kind: "icon", name: "circle" },
          tone: "#d9a441",
          source: "server",
        },
      ],
      overflow: 21,
    },
  ],
  roles: [
    { id: "admin", name: "admin", color: "#41b4f9" },
    { id: "salz", name: "salz" },
  ],
  activity: { title: t("preview.activityTitle"), detail: t("preview.activityDetail") },
  stats: [
    { id: "messages", value: "1.2k", label: t("nebulaUser:card.statMessages") },
    { id: "voice", value: "212 h", label: t("nebulaUser:card.statInVoice") },
    { id: "joined", value: "2018", label: t("preview.statJoined") },
  ],
});

const EMPTY: ReturnType<typeof exampleContent> = { badges: [], shelves: [], roles: [], activity: null, stats: [] };

interface ProfilePreviewProps {
  name: string;
  avatar: string | null;
  profile: FancyProfile;
  bio: string;
  tokens: ProfileCardTokens;
}

/**
 * The card as other people will see it.
 *
 * Not a drawing of the card - the card. Every row, every colour and every
 * fallback is resolved by the same component the conversation and the pointer
 * preview mount, so "as other people will see it" is a fact rather than a
 * second guess at the same rules.
 */
export function ProfilePreview({ name, avatar, profile, bio, tokens }: Readonly<ProfilePreviewProps>) {
  const { t } = useTranslation(["nebulaSettings", "nebulaUser"]);
  const [examples, setExamples] = useState(true);
  const filler = examples ? exampleContent(t) : EMPTY;

  const model: ProfileCardModel = {
    name,
    tintKey: name,
    avatar,
    profile,
    bio,
    presence: { tone: "online", label: t("nebulaUser:card.statInVoice") },
    verified: true,
    mutualServers: examples ? 2 : null,
    ...filler,
  };

  return (
    <Box
      sx={{
        // The card is the answer to every row in the editor, so it stays on
        // screen while the editor scrolls past it: the settings pane is the
        // scroller, and this column stops rising once it reaches its top edge.
        position: "sticky",
        top: 0,
        // Pinned and taller than the pane, the card's last rows could never be
        // reached, so past that height the preview scrolls on its own. The
        // 44px is the title bar - the pane runs from under it to the window's
        // bottom edge.
        maxHeight: "calc(100vh - 44px)",
        overflowY: "auto",
        // 320 of content, with a gutter either side for the sticker, which
        // hangs off the card's corner and would otherwise be clipped by the
        // scroll box. The negative margins keep the column where it sat.
        width: 344,
        mx: "-12px",
        px: "12px",
        flex: "none",
      }}
    >
      <Typography
        variant="overline"
        component="div"
        sx={{ mb: "10px", letterSpacing: "0.08em", fontSize: 10.5, fontWeight: 600 }}
      >
        {t("nebulaSettings:preview.livePreview")}
      </Typography>

      <ProfileCard
        model={model}
        tokens={tokens}
        width={310}
        footnote={t(FOOTNOTE_KEY)}
        message={{ onOpen: () => undefined }}
        volume={{ value: 100, onChange: () => undefined, onCommit: () => undefined }}
        trailing={{
          label: t("nebulaSettings:preview.editProfile"),
          icon: PencilGlyph,
          onClick: () => undefined,
        }}
      />

      <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "12px" }}>
        <Switch
          size="small"
          checked={examples}
          onChange={(event) => setExamples(event.target.checked)}
          slotProps={{ input: { "aria-label": t("nebulaSettings:preview.fillWithExamples") } }}
        />
        <Box>
          <Typography sx={{ fontSize: 11.5 }}>{t("nebulaSettings:preview.fillWithExamples")}</Typography>
          <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
            {t("nebulaSettings:preview.fillHint")}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}
