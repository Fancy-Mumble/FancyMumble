/**
 * What a channel is, on the sheet the mock draws for it.
 *
 * The sibling of the User information sheet, and deliberately built from the
 * same parts: the mock draws the two with one banner, one identity row and one
 * stack of cards, so they are assembled from the shared `InfoCard`/`InfoFact`
 * blocks rather than from a second set that would drift. What differs is the
 * subject - a room rather than a person - not the shape.
 *
 * Nebula had no per-channel surface at all: the header offered Server info and
 * nothing beneath it, which left the channel's own description unreadable and
 * `update_channel` uncalled anywhere in the pack. A description is the one
 * thing a room says about itself, and a server that lets you edit it from
 * Standard and not from here is one design silently losing a field.
 *
 * Membership is named here rather than counted. The header says "3 in voice ·
 * 5 members" and the roster lists the three; the two who belong and are
 * elsewhere are only knowable as key holders, and this is the surface with
 * room to say which of them holds a key and which is on a client that cannot
 * read the history at all.
 *
 * Rows the server did not send are absent rather than blank, as on the user
 * sheet: what the server does not say, the sheet does not claim. The counts
 * that can only be read off the loaded conversation are the sharp edge here -
 * the panel opens on a channel picked from the tree, which may not be the one
 * whose messages the store holds, and a "0 messages today" for a room nobody
 * has opened would be a lie the design has no way to qualify.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, IconButton, Radio, TextField, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { getPreferences } from "@core/preferencesStorage";
import { useChannelDescription } from "@core/lazyBlobs";
import { useOffloadQueue } from "@core/features/chat/offloadQueue";
import {
  hasAppearance,
  parseChannelDescription,
  serializeChannelDescription,
  type ChannelProfile,
} from "@core/channelProfile";
import type { ChannelEntry, FancyProfile } from "@core/types";
import { formatBytes, formatTimestamp } from "@core/utils/format";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { ChannelAttribute, hasChannelAttribute } from "@core/utils/channelAttributes";
import { CHANNEL_PERMISSIONS, PERM_KEY_OWNER, PERM_WRITE } from "@core/utils/permissions";
import { resolveProfilePaint, userTint } from "@shared/profilecard";
import { canDeleteMessages, hasPermission } from "@standard/components/sidebar/channel/ChannelEditorDialog";
import {
  CheckIcon,
  CloseIcon,
  EditIcon,
  HashIcon,
  ImageIcon,
  KeyIcon,
  RefreshCwIcon,
  TrashIcon,
  UploadIcon,
  WarningIcon,
} from "@ui/icons";
import { nebulaCardTokens } from "../../profileStyle";
import { NEBULA_MONO, radius } from "../../tokens";
import {
  InfoCard,
  InfoCaps,
  InfoFact,
  LinkGuard,
  RichTextField,
  SectionLabel,
  Stack,
  StatChip,
  UserAvatar,
} from "../primitives";
import { StatusDot } from "../primitives/StatusDot";

/** Standard's cropper, which only a sheet in edit mode ever opens. */
const ImageEditor = lazy(() =>
  import("@standard/pages/settings/ImageEditor").then((module) => ({ default: module.ImageEditor })),
);

/** How the takeover wipes: everything, or only the key. */
type TakeoverMode = "full_wipe" | "key_only";

/**
 * What a picked image is cropped and squeezed to before it is stored.
 *
 * Tighter than the profile card's, because these travel inside the channel
 * description rather than in a field of their own: the server's default
 * `image_message_length` is 128 KiB, and the description has to carry the
 * text as well as both pictures.
 */
const CROP_SIZES = {
  icon: { width: 128, height: 128, maxBytes: 32_000 },
  banner: { width: 640, height: 176, maxBytes: 64_000 },
} as const;

type CropKind = keyof typeof CROP_SIZES;

/**
 * The sheet's width - the mock's, and the user sheet's, because the two open
 * over the same shell and a channel that came up narrower would read as a
 * different kind of thing.
 */
const SHEET_WIDTH = 560;

interface ChannelInfoSheetProps {
  /** The channel being described. */
  readonly channelId: number;
  readonly onClose: () => void;
}

export function ChannelInfoSheet({ channelId, onClose }: Readonly<ChannelInfoSheetProps>) {
  const { t } = useTranslation(["nebulaChat", "sidebar", "chat", "common"]);
  const theme = useTheme();
  const { nebula } = theme.palette;
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const keyHolders = useAppStore((state) => state.keyHolders);
  const queryKeyHolders = useAppStore((state) => state.queryKeyHolders);

  const channel = channels.find((entry) => entry.id === channelId);
  const description = useChannelDescription(channel?.id, channel?.description_size);
  // The description carries the room's own look at its head; what is left is
  // the text it means to show, and the only part any surface renders.
  const { profile: appearance, body } = useMemo(
    () => parseChannelDescription(description ?? ""),
    [description],
  );

  // The holders are a round trip, and only a persisted channel has any: a
  // plain room's membership is exactly who is standing in it.
  //
  // Read off the protocol the server announced on the channel rather than off
  // the persistence state the shell fetches, because this panel opens on a
  // channel picked from the tree - which the shell may not have opened, and so
  // may never have asked about.
  const persisted = channel?.pchat_protocol != null && channel.pchat_protocol !== "none";
  useEffect(() => {
    if (persisted) void queryKeyHolders(channelId);
  }, [channelId, persisted, queryKeyHolders]);

  const occupants = useMemo(() => users.filter((user) => user.channel_id === channelId), [users, channelId]);
  const holders = useMemo(() => keyHolders[channelId] ?? [], [keyHolders, channelId]);
  const holderHashes = useMemo(() => new Set(holders.map((holder) => holder.cert_hash)), [holders]);
  // "Absent" is derived from who is standing here, not from the server's own
  // online flag: the flag says connected, and someone connected but sitting in
  // another room still belongs to this one.
  const hereHashes = useMemo(() => new Set(occupants.map((user) => user.hash).filter(Boolean)), [occupants]);
  const absent = useMemo(
    () => holders.filter((holder) => !hereHashes.has(holder.cert_hash)),
    [holders, hereHashes],
  );

  const canEdit = hasPermission(channel, PERM_WRITE);
  const canTakeOver = hasPermission(channel, PERM_KEY_OWNER) && persisted;

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAppearance, setDraftAppearance] = useState<ChannelProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [takeover, setTakeover] = useState<TakeoverMode | null>(null);
  const [cropping, setCropping] = useState<{ src: string; kind: CropKind } | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  // Every piece of local state is about *this* channel, so switching channels
  // under an open panel starts over rather than offering one room's draft as
  // an edit to another.
  useEffect(() => {
    setEditing(false);
    setTakeover(null);
  }, [channelId]);

  const startEditing = useCallback(() => {
    setDraftName(channel?.name ?? "");
    setDraftDescription(body);
    setDraftAppearance(appearance);
    setEditing(true);
  }, [channel?.name, body, appearance]);

  /** A picked file goes to the cropper, not straight into the description. */
  const readImage = useCallback((file: File | undefined, kind: CropKind) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCropping({ src: String(reader.result), kind });
    reader.readAsDataURL(file);
  }, []);

  const save = useCallback(async () => {
    if (!channel) return;
    setSaving(true);
    try {
      // Only what changed is sent. `update_channel` reads null as "leave it",
      // so passing both back unchanged would rewrite the description with
      // whatever this client happened to have fetched.
      const name = draftName !== channel.name ? draftName : null;
      // The icon and the banner ride inside the description, so what goes on
      // the wire is the two put back together - and only if that differs from
      // what the server already has.
      const composed = serializeChannelDescription(draftAppearance, draftDescription);
      const next = composed !== (description ?? "") ? composed : null;
      if (name !== null || next !== null) {
        await invoke("update_channel", { channelId: channel.id, name, description: next });
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [channel, draftName, draftDescription, draftAppearance, description]);

  const confirmTakeover = useCallback(async () => {
    if (!channel || !takeover) return;
    try {
      await invoke("key_takeover", { channelId: channel.id, mode: takeover });
    } finally {
      setTakeover(null);
    }
  }, [channel, takeover]);

  // The banner the sheet is being edited towards, so a picked image shows
  // before it is saved rather than only after the server has echoed it back.
  const shown = editing ? draftAppearance : appearance;

  // The channel's banner block is shaped like a profile's, which is what lets
  // the paint resolver treat the two the same: a photograph gets the fade a
  // user's banner gets, a flat colour gets the gloss, and a room that has set
  // neither falls back to a tint keyed on its own name and keeps it across
  // launches - the same treatment a person without a banner gets.
  const paint = resolveProfilePaint(
    hasAppearance(shown) ? ({ banner: shown.banner } as FancyProfile) : null,
    userTint(channel ? `#${channel.name}` : ""),
    nebulaCardTokens(nebula),
  );

  const members = occupants.length + absent.length;

  return (
    <Box
      role="document"
      aria-label={t("chat:header.channelInfo")}
      sx={{
        display: "flex",
        flexDirection: "column",
        width: SHEET_WIDTH,
        maxWidth: "100%",
        maxHeight: "min(860px, 92vh)",
        minHeight: 0,
        color: nebula.text,
      }}
    >
      {/* The banner and the identity row stay put; the facts scroll under them. */}
      <Box sx={{ flex: "none", position: "relative" }}>
        <Box sx={{ height: 96, ...paint.banner }} />
        <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 96, ...paint.bannerScrim }} />
        <Stack direction="row" alignItems="center" gap={1} sx={{ position: "absolute", top: 12, right: 12 }}>
          {canEdit && !editing && (
            <Button
              size="small"
              startIcon={<EditIcon width={11} height={11} />}
              onClick={startEditing}
              sx={{
                minWidth: 0,
                px: "10px",
                py: "4px",
                borderRadius: radius("md"),
                fontSize: 11,
                fontWeight: 600,
                color: "#fff",
                background: paint.bannerChrome,
                backdropFilter: "blur(6px)",
                "&:hover": { background: paint.bannerChrome },
              }}
            >
              {t("sidebar:channelInfoPanel.editChannelTitle")}
            </Button>
          )}
          <IconButton
            size="small"
            aria-label={t("nebulaChat:channelInfo.close")}
            onClick={onClose}
            sx={{
              color: "#fff",
              background: paint.bannerChrome,
              "&:hover": { background: paint.bannerChrome },
            }}
          >
            <CloseIcon width={12} height={12} />
          </IconButton>
        </Stack>

        {/* Positioned, so the tile and name paint over the scrim they overlap. */}
        <Stack
          direction="row"
          alignItems="flex-end"
          gap={1.5}
          sx={{ position: "relative", px: "22px", mt: "-26px", pb: "14px" }}
        >
          <Box
            aria-hidden
            sx={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              width: 56,
              height: 56,
              borderRadius: radius("lg"),
              background: nebula.accentSoft,
              color: nebula.accent,
              boxShadow: `0 0 0 3px ${nebula.bg0}`,
            }}
          >
            {shown?.icon ? (
              <Box
                component="img"
                src={shown.icon}
                alt=""
                sx={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <HashIcon width={26} height={26} strokeWidth={1.5} />
            )}
          </Box>
          <Box sx={{ minWidth: 0, pb: "2px" }}>
            <Stack direction="row" alignItems="center" gap={1}>
              <Typography sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }} noWrap>
                {channel?.name ?? t("sidebar:channelInfoPanel.noChannel")}
              </Typography>
              {channel && (
                <StatChip sx={{ fontSize: 10, letterSpacing: ".06em", py: "2px", px: "8px" }}>
                  {t(channelKind(channel))}
                </StatChip>
              )}
            </Stack>
            {channel && (
              <Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: "4px" }}>
                <StatusDot status={occupants.length > 0 ? "online" : "offline"} />
                <Typography sx={{ fontSize: 12, color: nebula.muted }}>
                  {t("nebulaChat:channelInfo.inVoice", { count: occupants.length })}
                </Typography>
                <Typography sx={{ fontSize: 12, color: nebula.dim }}>
                  {t("sidebar:channelInfoPanel.member", { count: members })}
                </Typography>
              </Stack>
            )}
          </Box>
        </Stack>
      </Box>

      {channel && (
        <Box sx={{ overflowY: "auto", minHeight: 0, px: "22px", pb: "22px", display: "grid", gap: "12px" }}>
          {editing ? (
            <InfoCard title={t("sidebar:channelInfoPanel.sectionChannel")}>
              <Stack gap={1.25}>
                <Box>
                  <SectionLabel>{t("nebulaChat:channelInfo.appearance")}</SectionLabel>
                  <Stack direction="row" gap={1.25} sx={{ mt: "8px" }}>
                    <ImageSlot
                      label={t("nebulaChat:channelInfo.icon")}
                      preview={draftAppearance?.icon}
                      width={56}
                      onPick={() => iconInput.current?.click()}
                      onClear={() => setDraftAppearance((prev) => ({ ...prev, icon: undefined }))}
                      empty={<HashIcon width={20} height={20} strokeWidth={1.5} />}
                    />
                    <ImageSlot
                      label={t("nebulaChat:channelInfo.banner")}
                      preview={draftAppearance?.banner?.image}
                      colour={draftAppearance?.banner?.color}
                      width={168}
                      onPick={() => bannerInput.current?.click()}
                      onClear={() => setDraftAppearance((prev) => ({ ...prev, banner: undefined }))}
                    />
                  </Stack>
                  <input
                    ref={iconInput}
                    type="file"
                    accept="image/*"
                    aria-label={t("nebulaChat:channelInfo.icon")}
                    style={{ display: "none" }}
                    onChange={(event) => {
                      readImage(event.target.files?.[0], "icon");
                      event.target.value = "";
                    }}
                  />
                  <input
                    ref={bannerInput}
                    type="file"
                    accept="image/*"
                    aria-label={t("nebulaChat:channelInfo.banner")}
                    style={{ display: "none" }}
                    onChange={(event) => {
                      readImage(event.target.files?.[0], "banner");
                      event.target.value = "";
                    }}
                  />
                </Box>
                <TextField
                  size="small"
                  fullWidth
                  label={t("sidebar:channelInfoPanel.editLabelName")}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                />
                <Box>
                  <SectionLabel>{t("sidebar:channelInfoPanel.editLabelDescription")}</SectionLabel>
                  <Box sx={{ mt: "6px" }}>
                    <RichTextField
                      value={draftDescription}
                      onChange={setDraftDescription}
                      placeholder={t("sidebar:channelInfoPanel.descriptionPlaceholder")}
                      ariaLabel={t("sidebar:channelInfoPanel.editLabelDescription")}
                      minHeight={90}
                      maxHeight={200}
                    />
                  </Box>
                </Box>
                <Stack direction="row" gap={1} sx={{ justifyContent: "flex-end" }}>
                  <Button size="small" disabled={saving} onClick={() => setEditing(false)}>
                    {t("common:actions.cancel")}
                  </Button>
                  <Button size="small" variant="contained" disabled={saving} onClick={() => void save()}>
                    {saving ? t("sidebar:channelInfoPanel.saving") : t("sidebar:channelInfoPanel.saveBtn")}
                  </Button>
                </Stack>
              </Stack>
            </InfoCard>
          ) : (
            <InfoCard title={t("sidebar:channelInfoPanel.editLabelDescription")}>
              <Description html={body} empty={t("sidebar:channelInfoPanel.noDescription")} />
            </InfoCard>
          )}

          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <InfoCard title={t("sidebar:channelInfoPanel.sectionChannel")}>
              <InfoFact label={t("sidebar:channelInfoPanel.labelChannelId")} value={channel.id} />
              <InfoFact
                label={t("nebulaChat:channelInfo.labelParent")}
                value={parentName(channels, channel, t("nebulaChat:channelInfo.root"))}
              />
              <InfoFact
                label={t("nebulaChat:channelInfo.labelMaxUsers")}
                value={
                  channel.max_users > 0 ? String(channel.max_users) : t("nebulaChat:channelInfo.unlimited")
                }
              />
              <InfoFact label={t("nebulaChat:channelInfo.labelPosition")} value={channel.position} />
              {persisted && (
                <InfoFact label={t("nebulaChat:channelInfo.labelKeysHeld")} value={holders.length} />
              )}
            </InfoCard>
            <InfoCard title={t("nebulaChat:channelInfo.sectionActivity")}>
              <InfoFact label={t("nebulaChat:channelInfo.labelMembers")} value={members} />
              <InfoFact label={t("nebulaChat:channelInfo.labelInVoice")} value={occupants.length} />
              <ConversationFacts channelId={channelId} />
            </InfoCard>
          </Box>

          <InfoCard
            title={t("nebulaChat:channelInfo.sectionMembers")}
            chip={
              <InfoCaps>
                {t("nebulaChat:channelInfo.memberCounts", {
                  online: occupants.length,
                  offline: absent.length,
                })}
              </InfoCaps>
            }
          >
            {members === 0 && (
              <Typography sx={{ fontSize: 12, color: nebula.muted }}>
                {t("sidebar:channelInfoPanel.noUsers")}
              </Typography>
            )}

            <Box component="ul" sx={{ listStyle: "none", m: "-4px -6px", p: 0 }}>
              {occupants.map((user) => (
                <MemberRow
                  key={user.session}
                  name={user.name}
                  session={user.session}
                  textureSize={user.texture_size}
                  meta={t("nebulaChat:channelInfo.memberHere")}
                  /* A key holder is marked; on a persisted channel so is
                     everyone who is not one, because that is a client that
                     cannot read a word of the history it is sitting in - a
                     fact about them, not about the room. */
                  holdsKey={!!user.hash && holderHashes.has(user.hash)}
                  legacy={persisted && (!user.hash || !holderHashes.has(user.hash))}
                />
              ))}
              {absent.map((holder) => (
                <MemberRow
                  key={holder.cert_hash}
                  name={holder.name}
                  meta={t(
                    holder.is_online
                      ? "nebulaChat:channelInfo.memberElsewhere"
                      : "nebulaChat:channelInfo.memberOffline",
                  )}
                  holdsKey
                  dimmed
                />
              ))}
            </Box>

            {canTakeOver && (
              <Box sx={{ mt: "12px" }}>
                {takeover === null ? (
                  <Button
                    size="small"
                    startIcon={<KeyIcon width={13} height={13} />}
                    onClick={() => setTakeover("full_wipe")}
                    sx={{ color: nebula.bad }}
                  >
                    {t("sidebar:channelInfoPanel.resetKeyOwnership")}
                  </Button>
                ) : (
                  <Stack gap={0.75}>
                    <SectionLabel>{t("sidebar:channelInfoPanel.takeoverModeLabel")}</SectionLabel>
                    <TakeoverChoice
                      checked={takeover === "full_wipe"}
                      onChoose={() => setTakeover("full_wipe")}
                      label={t("sidebar:channelInfoPanel.takeoverFullWipe")}
                      hint={t("sidebar:channelInfoPanel.takeoverFullWipeHint")}
                    />
                    <TakeoverChoice
                      checked={takeover === "key_only"}
                      onChoose={() => setTakeover("key_only")}
                      label={t("sidebar:channelInfoPanel.takeoverKeyOnly")}
                      hint={t("sidebar:channelInfoPanel.takeoverKeyOnlyHint")}
                    />
                    <Stack direction="row" gap={1} sx={{ justifyContent: "flex-end" }}>
                      <Button size="small" onClick={() => setTakeover(null)}>
                        {t("common:actions.cancel")}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        color="error"
                        onClick={() => void confirmTakeover()}
                      >
                        {t("sidebar:channelInfoPanel.confirmBtn")}
                      </Button>
                    </Stack>
                  </Stack>
                )}
              </Box>
            )}
          </InfoCard>

          <PermissionFacts channelId={channelId} />
          <OffloadFacts channelId={channelId} />
        </Box>
      )}

      {cropping && (
        <Suspense fallback={null}>
          <ImageEditor
            src={cropping.src}
            cropShape="rect"
            targetWidth={CROP_SIZES[cropping.kind].width}
            targetHeight={CROP_SIZES[cropping.kind].height}
            maxBytes={CROP_SIZES[cropping.kind].maxBytes}
            onCancel={() => setCropping(null)}
            onConfirm={(dataUrl) => {
              const kind = cropping.kind;
              setDraftAppearance((prev) =>
                kind === "icon"
                  ? { ...prev, icon: dataUrl }
                  : { ...prev, banner: { ...prev?.banner, image: dataUrl } },
              );
              setCropping(null);
            }}
          />
        </Suspense>
      )}
    </Box>
  );
}

/**
 * One picked picture, with the two things you can do to it.
 *
 * The profile settings draw the same row for an avatar and a banner; this is
 * that row at the size a card inside a sheet has room for, and it doubles as
 * the preview - a picked image shows here before it is saved anywhere.
 */
function ImageSlot({
  label,
  preview,
  colour,
  width,
  onPick,
  onClear,
  empty,
}: Readonly<{
  label: string;
  preview?: string;
  colour?: string;
  width: number;
  onPick: () => void;
  onClear: () => void;
  empty?: React.ReactNode;
}>) {
  const { t } = useTranslation(["nebulaChat", "common"]);
  const filled = !!preview || !!colour;
  return (
    <Box>
      <Box
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={onPick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onPick();
        }}
        sx={(theme) => ({
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width,
          height: 56,
          borderRadius: radius("md"),
          cursor: "pointer",
          overflow: "hidden",
          color: theme.palette.nebula.dim,
          // Quoted, because a data-URI is not always base64: an SVG one
          // carries characters an unquoted url() ends the token on.
          background: preview ? `center/cover url("${preview}")` : (colour ?? theme.palette.nebula.card2),
          border: `1px dashed ${theme.palette.nebula.line2}`,
          "&:hover": { borderColor: theme.palette.nebula.accent },
        })}
      >
        {!filled && (empty ?? <ImageIcon width={18} height={18} />)}
      </Box>
      <Stack direction="row" alignItems="center" gap={0.5} sx={{ mt: "4px" }}>
        <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>{label}</Typography>
        {filled && (
          <IconButton
            size="small"
            aria-label={t("nebulaChat:channelInfo.clearImage", { what: label })}
            onClick={onClear}
            sx={{ ml: "auto", p: "2px" }}
          >
            <TrashIcon width={11} height={11} />
          </IconButton>
        )}
      </Stack>
    </Box>
  );
}

/** The kinds the header chip can name, spelled as the keys that say them. */
type ChannelKind =
  | "nebulaChat:channelInfo.kindCategory"
  | "nebulaChat:channelInfo.kindPrivate"
  | "nebulaChat:channelInfo.kindTemporary"
  | "nebulaChat:channelInfo.kindHidden"
  | "nebulaChat:channelInfo.kindRestricted"
  | "nebulaChat:channelInfo.kindTextVoice";

/** Which of the room's kinds the header names, as the mock's one chip. */
function channelKind(channel: ChannelEntry): ChannelKind {
  if (hasChannelAttribute(channel, ChannelAttribute.Structural)) return "nebulaChat:channelInfo.kindCategory";
  if (channel.detached) return "nebulaChat:channelInfo.kindPrivate";
  if (channel.temporary) return "nebulaChat:channelInfo.kindTemporary";
  if (channel.hidden) return "nebulaChat:channelInfo.kindHidden";
  if (channel.is_enter_restricted) return "nebulaChat:channelInfo.kindRestricted";
  return "nebulaChat:channelInfo.kindTextVoice";
}

/** The name of the room this one hangs under, or the root's own label. */
function parentName(channels: readonly ChannelEntry[], channel: ChannelEntry, root: string): string {
  if (channel.parent_id == null) return root;
  return channels.find((entry) => entry.id === channel.parent_id)?.name ?? root;
}

/**
 * What the conversation itself says about the room - but only where the store
 * is holding it.
 *
 * The store keeps one conversation at a time and this sheet opens on a channel
 * picked from the tree, so the counts are either about this room or about
 * another one entirely. Where they would be about another, the rows are absent
 * rather than zero: a room nobody has opened has not had no messages today.
 */
function ConversationFacts({ channelId }: Readonly<{ channelId: number }>) {
  const { t } = useTranslation("nebulaChat");
  const messages = useAppStore((state) => state.messages);
  const loaded = useAppStore((state) => state.selectedChannel === channelId);
  const mine = useMemo(
    () => messages.filter((message) => message.channel_id === channelId),
    [messages, channelId],
  );

  if (!loaded) return null;

  const midnight = new Date().setHours(0, 0, 0, 0);
  const today = mine.filter((message) => (message.timestamp ?? 0) >= midnight).length;
  const pinned = mine.filter((message) => message.pinned).length;
  const last = mine.reduce((newest, message) => Math.max(newest, message.timestamp ?? 0), 0);

  return (
    <>
      <InfoFact label={t("channelInfo.labelMessagesToday")} value={today} />
      {last > 0 && <InfoFact label={t("channelInfo.labelLastMessage")} value={formatTimestamp(last)} />}
      <InfoFact label={t("channelInfo.labelPinned")} value={pinned} />
    </>
  );
}

/**
 * The channel's own description, as HTML somebody wrote - sanitised on the way
 * in, and wrapped in the link guard for the same reason the welcome text is:
 * without it a click navigates the app's own window away with no way back.
 */
function Description({ html, empty }: Readonly<{ html: string; empty: string }>) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  if (!clean)
    return (
      <Typography sx={(theme) => ({ fontSize: 12, fontStyle: "italic", color: theme.palette.nebula.dim })}>
        {empty}
      </Typography>
    );
  return (
    <LinkGuard>
      <Box
        sx={(theme) => ({
          maxHeight: 220,
          overflowY: "auto",
          fontSize: 12,
          lineHeight: 1.6,
          color: theme.palette.nebula.muted,
          wordBreak: "break-word",
          "& a": { color: theme.palette.nebula.accent, textDecoration: "none" },
          "& a:hover": { textDecoration: "underline" },
          "& img": { maxWidth: "100%", borderRadius: radius("md") },
        })}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </LinkGuard>
  );
}

/** One person the channel counts as its own, present or merely belonging. */
function MemberRow({
  name,
  session,
  textureSize,
  meta,
  holdsKey,
  legacy,
  dimmed,
}: Readonly<{
  name: string;
  session?: number;
  textureSize?: number | null;
  meta: string;
  holdsKey?: boolean;
  legacy?: boolean;
  dimmed?: boolean;
}>) {
  const { t } = useTranslation("sidebar");
  return (
    <Stack
      component="li"
      direction="row"
      alignItems="center"
      gap={1.125}
      sx={(theme) => ({
        px: "8px",
        py: "5px",
        borderRadius: radius("md"),
        opacity: dimmed ? 0.6 : 1,
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      <UserAvatar name={name} session={session ?? null} textureSize={textureSize ?? null} size={24} />
      <Typography sx={{ fontSize: 12, minWidth: 0 }} noWrap>
        {name}
      </Typography>
      {holdsKey && (
        <Box
          component="span"
          aria-label={t("channelInfoPanel.keyIconAriaLabel")}
          sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.ok })}
        >
          <KeyIcon width={12} height={12} />
        </Box>
      )}
      {legacy && (
        <Box
          component="span"
          aria-label={t("channelInfoPanel.legacyClientAriaLabel")}
          sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.warn })}
        >
          <WarningIcon width={12} height={12} />
        </Box>
      )}
      <Typography
        sx={(theme) => ({ ml: "auto", flex: "none", fontSize: 10.5, color: theme.palette.nebula.dim })}
      >
        {meta}
      </Typography>
    </Stack>
  );
}

/** One of the two ways a key takeover can go. */
function TakeoverChoice({
  checked,
  onChoose,
  label,
  hint,
}: Readonly<{ checked: boolean; onChoose: () => void; label: string; hint: string }>) {
  return (
    <Stack component="label" direction="row" alignItems="flex-start" gap={0.5} sx={{ cursor: "pointer" }}>
      <Radio size="small" checked={checked} onChange={onChoose} sx={{ p: "2px" }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 12.5 }}>{label}</Typography>
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>{hint}</Typography>
      </Box>
    </Stack>
  );
}

/** The developer-mode preference, which every dev section here hangs off. */
function useDeveloperMode(): boolean {
  const [developer, setDeveloper] = useState(false);

  useEffect(() => {
    getPreferences()
      .then((prefs) => setDeveloper(prefs.userMode === "developer"))
      .catch(() => setDeveloper(false));
  }, []);

  return developer;
}

/**
 * What the server actually granted, for the mode that wants to see it.
 *
 * The bitmask is the answer to "why can I not do that here", and reading it
 * off two chip rows - what was granted, and what was withheld - beats deriving
 * it from which buttons appeared. Developer mode only: a permission dump is a
 * debugging tool, not a fact about the room.
 */
function PermissionFacts({ channelId }: Readonly<{ channelId: number }>) {
  const { t } = useTranslation(["nebulaChat", "sidebar"]);
  const channels = useAppStore((state) => state.channels);
  const refreshState = useAppStore((state) => state.refreshState);
  const channel = channels.find((entry) => entry.id === channelId);
  const developer = useDeveloperMode();

  const mask = channel?.permissions ?? null;
  const granted = mask == null ? [] : CHANNEL_PERMISSIONS.filter((perm) => (mask & perm.bit) !== 0);
  const withheld = mask == null ? [] : CHANNEL_PERMISSIONS.filter((perm) => (mask & perm.bit) === 0);

  if (!developer || !channel) return null;

  return (
    <InfoCard
      title={t("nebulaChat:channelInfo.sectionPermissions")}
      chip={
        <Stack direction="row" alignItems="center" gap={1} sx={{ ml: "auto" }}>
          <StatChip tone="accent" sx={{ fontSize: 9.5, py: "2px", px: "8px" }}>
            {t("nebulaChat:channelInfo.developerMode")}
          </StatChip>
          <Tooltip title={t("sidebar:channelInfoPanel.refreshTitle")}>
            <IconButton
              size="small"
              aria-label={t("sidebar:channelInfoPanel.refreshAriaLabel")}
              onClick={() => void refreshState()}
            >
              <RefreshCwIcon width={12} height={12} />
            </IconButton>
          </Tooltip>
        </Stack>
      }
    >
      <InfoFact
        label={t("sidebar:channelInfoPanel.labelRaw")}
        value={mask == null ? "null" : `0x${mask.toString(16).toUpperCase().padStart(8, "0")}`}
        mono
      />
      <InfoFact
        label={t("sidebar:channelInfoPanel.labelCanDelete")}
        value={String(canDeleteMessages(channel))}
        mono
      />
      {mask != null && (
        <>
          <PermissionGroup
            label={t("nebulaChat:channelInfo.granted", { count: granted.length })}
            perms={granted}
            held
          />
          <PermissionGroup
            label={t("nebulaChat:channelInfo.withheld", { count: withheld.length })}
            perms={withheld}
          />
        </>
      )}
    </InfoCard>
  );
}

/** One half of the permission dump: what is held, or what is not. */
function PermissionGroup({
  label,
  perms,
  held,
}: Readonly<{ label: string; perms: readonly { bit: number; label: string }[]; held?: boolean }>) {
  if (perms.length === 0) return null;
  return (
    <Box sx={{ mt: "12px" }}>
      <Box sx={{ mb: "8px" }}>
        <InfoCaps>{label}</InfoCaps>
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
        {perms.map((perm) => (
          <StatChip
            key={perm.bit}
            tone={held ? "accent" : "dim"}
            title={`0x${perm.bit.toString(16).toUpperCase()}`}
            sx={(theme) => ({
              px: "8px",
              py: "3px",
              fontFamily: NEBULA_MONO,
              fontSize: 10.5,
              ...(held
                ? {}
                : { background: "transparent", border: `1px dashed ${theme.palette.nebula.line2}` }),
            })}
          >
            {held && <CheckIcon width={8} height={8} strokeWidth={2.4} />}
            {perm.label}
          </StatChip>
        ))}
      </Box>
    </Box>
  );
}

/**
 * What cold storage is doing to this channel, in developer mode.
 *
 * The offloader is invisible when it works - a heavy body leaves the heap
 * while it is out of view and is back before the reader reaches it - which
 * makes it exactly the sort of machinery that can quietly stop working, or
 * work far too eagerly, with nothing on screen to say so. These are the
 * numbers that say which.
 *
 * Per channel, because that is the surface this is on, and the question a
 * developer has here is about the conversation in front of them; the manager's
 * own figures are whole-client and go on the last row as such.
 */
function OffloadFacts({ channelId }: Readonly<{ channelId: number }>) {
  const { t } = useTranslation(["nebulaChat", "sidebar"]);
  const developer = useDeveloperMode();
  const messages = useAppStore((state) => state.messages);

  // The store holds one conversation at a time, and this panel opens on a
  // channel picked from the tree - which may not be that one. Filtering by the
  // messages' own channel is what tells the two cases apart.
  const mine = useMemo(
    () => messages.filter((message) => message.channel_id === channelId),
    [messages, channelId],
  );
  // Whether the store is holding *this* room's conversation, which is not the
  // same as whether it found any messages in it: an empty channel you have
  // open is loaded, and telling its reader to open it is nonsense.
  const loaded = useAppStore((state) => state.selectedChannel === channelId);
  const queue = useOffloadQueue(mine, developer && loaded);

  if (!developer) return null;

  const busy = queue.queued + queue.restoring;

  return (
    <InfoCard title={t("nebulaChat:offloadQueue.title")}>
      {loaded ? (
        <>
          <Stack direction="row" alignItems="center" gap={1}>
            <Box
              component="span"
              aria-hidden
              sx={(theme) => ({ display: "flex", color: theme.palette.nebula.dim })}
            >
              <UploadIcon width={13} height={13} />
            </Box>
            <Typography sx={{ fontSize: 12, fontWeight: 500 }}>
              {busy > 0
                ? t("nebulaChat:offloadQueue.inFlight", { count: busy })
                : t("nebulaChat:offloadQueue.nothingQueued")}
            </Typography>
            <StatChip
              tone="dim"
              sx={{ ml: "auto", px: "7px", py: "2px", fontFamily: NEBULA_MONO, fontSize: 10.5 }}
            >
              {t(busy > 0 ? "nebulaChat:offloadQueue.working" : "nebulaChat:offloadQueue.idle")}
            </StatChip>
          </Stack>
          <Box sx={{ mt: "8px" }}>
            <InfoFact label={t("nebulaChat:offloadQueue.heavy")} value={queue.heavy} mono />
            <InfoFact label={t("nebulaChat:offloadQueue.offloaded")} value={queue.offloaded} mono />
            <InfoFact label={t("nebulaChat:offloadQueue.queued")} value={queue.queued} mono />
            <InfoFact label={t("nebulaChat:offloadQueue.restoring")} value={queue.restoring} mono />
            <InfoFact
              label={t("nebulaChat:offloadQueue.saved")}
              value={formatBytes(queue.storedBytes)}
              mono
            />
            <InfoFact label={t("nebulaChat:offloadQueue.inline")} value={formatBytes(queue.liveBytes)} mono />
            <InfoFact
              label={t("nebulaChat:offloadQueue.appWide")}
              value={`${queue.appWide.offloaded} · ${queue.appWide.queued} · ${queue.appWide.loading}`}
              mono
            />
          </Box>
        </>
      ) : (
        <Typography sx={(theme) => ({ fontSize: 12, fontStyle: "italic", color: theme.palette.nebula.dim })}>
          {t("nebulaChat:offloadQueue.notLoaded")}
        </Typography>
      )}
    </InfoCard>
  );
}
