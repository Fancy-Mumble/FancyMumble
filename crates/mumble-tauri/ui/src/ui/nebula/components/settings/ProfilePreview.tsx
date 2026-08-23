import { useState } from "react";
import { Box, Switch, Typography } from "@mui/material";
import type { FancyProfile } from "@core/types";
import {
  ProfileCard,
  PencilGlyph,
  type ProfileCardModel,
  type ProfileCardTokens,
} from "@shared/profilecard";
import { Stack } from "../primitives";

/**
 * The mock's caption, kept because it is also the page's promise: every noun on
 * it is a row in the editor beside this preview.
 */
const FOOTNOTE = "Banner · Frame · Nameplate · Sticker · Badges · Colours — all yours";

/**
 * Example content for the rows only a server can fill.
 *
 * Badges, shelves, roles and the activity row come off the connection, so a
 * profile editor opened before joining anywhere would draw a card with half its
 * rows missing - and the switches that hide those rows would appear to do
 * nothing. These stand in so the layout is visible, and they are labelled as
 * examples rather than passed off as yours.
 */
const EXAMPLE: Pick<ProfileCardModel, "badges" | "shelves" | "roles" | "activity" | "stats"> = {
  badges: [
    { id: "x1", label: "Example badge", glyph: { kind: "icon", name: "star" }, tone: "#ecba55", source: "server" },
    { id: "x2", label: "Example badge", glyph: { kind: "icon", name: "mic" }, tone: "#41b4f9", source: "server" },
    { id: "x3", label: "Example badge", glyph: { kind: "icon", name: "sparkle" }, tone: "#a855f7", source: "server" },
    { id: "x4", label: "Example badge", glyph: { kind: "icon", name: "check" }, tone: "#3cd88e", source: "server" },
  ],
  shelves: [
    {
      id: "common",
      badges: [
        { id: "s1", label: "Example", glyph: { kind: "icon", name: "circle" }, source: "server", shape: "dot" },
        { id: "s2", label: "Example", glyph: { kind: "icon", name: "diamond" }, source: "server", shape: "diamond" },
        { id: "s3", label: "Example", glyph: { kind: "icon", name: "diamond" }, source: "server", shape: "diamond" },
      ],
      overflow: 0,
    },
    {
      id: "special",
      label: "Special",
      badges: [
        { id: "s4", label: "Example", glyph: { kind: "icon", name: "circle" }, tone: "#d9a441", source: "server" },
      ],
      overflow: 21,
    },
  ],
  roles: [
    { id: "admin", name: "admin", color: "#41b4f9" },
    { id: "salz", name: "salz" },
  ],
  activity: { title: "Playing League of Legends", detail: "ARAM · 24 min" },
  stats: [
    { id: "messages", value: "1.2k", label: "Messages" },
    { id: "voice", value: "212 h", label: "In voice" },
    { id: "joined", value: "2018", label: "Joined" },
  ],
};

const EMPTY: typeof EXAMPLE = { badges: [], shelves: [], roles: [], activity: null, stats: [] };

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
  const [examples, setExamples] = useState(true);
  const filler = examples ? EXAMPLE : EMPTY;

  const model: ProfileCardModel = {
    name,
    tintKey: name,
    avatar,
    profile,
    bio,
    presence: { tone: "online", label: "In voice" },
    verified: true,
    mutualServers: examples ? 2 : null,
    ...filler,
  };

  return (
    <Box sx={{ width: 320, flex: "none" }}>
      <Typography
        variant="overline"
        component="div"
        sx={{ mb: "10px", letterSpacing: "0.08em", fontSize: 10.5, fontWeight: 600 }}
      >
        Live preview
      </Typography>

      <ProfileCard
        model={model}
        tokens={tokens}
        width={310}
        footnote={FOOTNOTE}
        message={{ onOpen: () => undefined }}
        volume={{ value: 100, onChange: () => undefined, onCommit: () => undefined }}
        trailing={{ label: "Edit profile", icon: PencilGlyph, onClick: () => undefined }}
      />

      <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "12px" }}>
        <Switch
          size="small"
          checked={examples}
          onChange={(event) => setExamples(event.target.checked)}
          slotProps={{ input: { "aria-label": "Fill with example content" } }}
        />
        <Box>
          <Typography sx={{ fontSize: 11.5 }}>Fill with example content</Typography>
          <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
            Badges, roles and activity come from the server you are on.
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}
