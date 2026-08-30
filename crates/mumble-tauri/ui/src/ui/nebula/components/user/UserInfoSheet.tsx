import { lazy, Suspense, type ReactNode } from "react";
import { Box, Button, IconButton, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { FancyProfile, UserEntry, UserStats } from "@core/types";
import { formatBandwidth, formatDuration, formatTimestamp } from "@core/utils/format";
import { maskSensitive } from "@core/utils/maskSensitive";
import { RichText, resolveProfilePaint, userTint } from "@shared/profilecard";
import { CloseIcon, PriorityIcon } from "@ui/icons";
import { nebulaCardTokens } from "../../profileStyle";
import type { UserMenuActions } from "../../selectors";
import { NEBULA_MONO, radius } from "../../tokens";
import { SectionLabel, Stack, StatChip, UserAvatar } from "../primitives";
import { StatusDot, type Status } from "../primitives/StatusDot";
import { BarStrip, RoundTripChart } from "./ConnectionCharts";
import type { ModerationAction } from "./UserMenu";
import type { UserLocation } from "./useUserLocation";
import {
  certificateLabel,
  codecLabel,
  joinedAt,
  osLabel,
  SAMPLE_WINDOW,
  type StatsSample,
} from "./userInfoModel";

/** Leaflet joins the bundle the first time a sheet has somewhere to show. */
const LocationMap = lazy(() => import("./LocationMap"));

/** The sheet's width - the mock's, and wide enough for two fact columns. */
export const SHEET_WIDTH = 560;

export interface UserInfoSheetProps {
  user: UserEntry;
  avatar: string | null;
  profile: FancyProfile | null;
  /** The visible part of the comment, as markup. */
  bio: string;
  channelName: string | null;
  talking: boolean;
  stats: UserStats | null;
  samples: readonly StatsSample[];
  location: UserLocation | null;
  reverseDns: string | null;
  groups: readonly string[];
  bans: { count: number; note: string } | null;
  /** The viewer holds Write on the root: the sheet says so, and shows the admin rows. */
  admin: boolean;
  /** Identifying details are masked, as everywhere else in the client. */
  streamerMode: boolean;
  actions: UserMenuActions;
  /** How tall the sheet may be before its body scrolls. */
  maxHeight?: number | string;
  onClose: () => void;
  onModerate: (action: ModerationAction) => void;
  onMove: () => void;
}

/**
 * Everything the server knows about one person, on one sheet.
 *
 * The profile card is what you open to see who someone is; this is what you
 * open to see how they are connected - the Mumble "User Information" dialog,
 * drawn as the mock draws it. Presentation only: the dialog gathers the
 * facts and this lays them out, which is what lets the sheet be previewed
 * and tested without a server behind it.
 *
 * Rows the server sends only to admins are marked as such rather than shown
 * blank to everyone else, and rows it did not send are absent: what the
 * server does not say, the sheet does not claim.
 */
export function UserInfoSheet({
  user,
  avatar,
  profile,
  bio,
  channelName,
  talking,
  stats,
  samples,
  location,
  reverseDns,
  groups,
  bans,
  admin,
  streamerMode,
  actions,
  maxHeight = "min(860px, 92vh)",
  onClose,
  onModerate,
  onMove,
}: Readonly<UserInfoSheetProps>) {
  const theme = useTheme();
  const { nebula } = theme.palette;
  const paint = resolveProfilePaint(profile, userTint(user.hash || user.name), nebulaCardTokens(nebula));

  const offline = user.session < 0;
  const muted = user.mute || user.self_mute || user.suppress;
  const deafened = user.deaf || user.self_deaf;
  const status: Status = offline ? "offline" : muted || deafened ? "muted" : "online";
  const presence = offline ? "Offline" : channelName ? `In voice · #${channelName}` : "Connected";
  const address = stats?.address ?? null;
  const place = location?.state === "located" ? location.place : undefined;
  const latest = samples[samples.length - 1];
  const loss = latest?.loss ?? null;
  const certificate = stats ? certificateLabel(stats.strong_certificate) : null;

  const moderation = [
    actions.canMuteDeafen && { key: "mute", label: user.mute ? "Unmute" : "Mute" },
    actions.canMuteDeafen && { key: "deafen", label: user.deaf ? "Undeafen" : "Deafen" },
    actions.canMove && { key: "move", label: "Move…" },
    actions.canKick && { key: "kick", label: "Kick", danger: true },
    actions.canBan && { key: "ban", label: "Ban", danger: true },
  ].filter((entry): entry is { key: string; label: string; danger?: boolean } => !!entry);

  return (
    <Box
      role="document"
      aria-label={`Information about ${user.name}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        width: SHEET_WIDTH,
        maxWidth: "100%",
        maxHeight,
        minHeight: 0,
        color: nebula.text,
      }}
    >
      {/* The banner and the identity row stay put; the facts scroll under them. */}
      <Box sx={{ flex: "none", position: "relative" }}>
        <Box sx={{ height: 96, ...paint.banner }} />
        <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 96, ...paint.bannerScrim }} />
        <Stack direction="row" alignItems="center" gap={1} sx={{ position: "absolute", top: 12, right: 12 }}>
          {admin && (
            <Box
              component="span"
              sx={{
                px: "10px",
                py: "4px",
                borderRadius: radius("md"),
                fontSize: 11,
                fontWeight: 600,
                color: "#fff",
                background: paint.bannerChrome,
                backdropFilter: "blur(6px)",
              }}
            >
              Viewing as admin
            </Box>
          )}
          <IconButton
            size="small"
            aria-label="Close"
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

        {/* Positioned, so the avatar and name paint over the scrim they overlap. */}
        <Stack
          direction="row"
          alignItems="flex-end"
          gap={1.5}
          sx={{ position: "relative", px: "22px", mt: "-26px", pb: "14px" }}
        >
          <Box sx={{ flex: "none", borderRadius: radius("lg"), boxShadow: `0 0 0 3px ${nebula.bg0}` }}>
            <UserAvatar name={user.name} src={avatar} size={56} square talking={talking} />
          </Box>
          <Box sx={{ minWidth: 0, pb: "2px" }}>
            <Stack direction="row" alignItems="center" gap={1}>
              <Typography sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }} noWrap>
                {user.name}
              </Typography>
              {user.priority_speaker && (
                <StatChip tone="accent" sx={{ fontSize: 10, letterSpacing: ".06em", py: "2px", px: "8px" }}>
                  <PriorityIcon width={10} height={10} />
                  PRIORITY
                </StatChip>
              )}
            </Stack>
            <Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: "4px" }}>
              <StatusDot status={status} />
              <Typography sx={{ fontSize: 12, color: nebula.muted }}>{presence}</Typography>
              {stats?.onlinesecs != null && (
                <Typography sx={{ fontSize: 12, color: nebula.accent, ml: "6px" }}>
                  {formatDuration(stats.onlinesecs)}
                </Typography>
              )}
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ overflowY: "auto", minHeight: 0, px: "22px", pb: "22px", display: "grid", gap: "12px" }}>
        {bio.trim() !== "" && (
          <Card title="About me">
            <RichText
              html={bio}
              linkColor={nebula.accent}
              style={{ fontSize: 12.5, lineHeight: 1.55, color: nebula.muted }}
            />
          </Card>
        )}

        <Box sx={{ display: "grid", gridTemplateColumns: stats ? "1fr 1fr" : "1fr", gap: "12px" }}>
          <Card title="Session">
            <Fact label="Session" value={String(user.session)} />
            {channelName && <Fact label="Channel" value={`#${channelName}`} />}
            <Fact label="Registered" value={user.user_id != null ? `Yes · id ${user.user_id}` : "No"} />
            {stats?.onlinesecs != null && (
              <Fact label="Joined" value={formatTimestamp(joinedAt(Date.now(), stats.onlinesecs))} />
            )}
            {stats?.idlesecs != null && <Fact label="Idle" value={formatDuration(stats.idlesecs)} />}
          </Card>
          {stats && certificate && (
            <Card title="Client">
              {stats.version && <Fact label="Version" value={stats.version} />}
              {osLabel(stats.os, stats.os_version) && (
                <Fact label="OS" value={osLabel(stats.os, stats.os_version) ?? ""} />
              )}
              <Fact label="Certificate" value={certificate.label} tone={certificate.tone} />
              <Fact label="Opus" value={stats.opus ? "Yes" : "No"} />
            </Card>
          )}
        </Box>

        {address && (
          <Card title="Network & location" chip={<StatChip tone="accent">ADMIN ONLY</StatChip>}>
            <Fact label="Address" value={streamerMode ? maskSensitive(address) : address} mono />
            {reverseDns && !streamerMode && <Fact label="Reverse DNS" value={reverseDns} mono />}
            {place && <Fact label="Location" value={place} />}
            {groups.length > 0 && <Fact label="Groups" value={groups.join(", ")} />}
            {location && !streamerMode && (
              <Box
                sx={{
                  position: "relative",
                  mt: "12px",
                  // Taller than the mock's frame by a little: the map pans and
                  // zooms, and a box this wide wants some height to do it in.
                  height: 176,
                  borderRadius: radius("md"),
                  overflow: "hidden",
                  background: `repeating-linear-gradient(-45deg,${nebula.line} 0 1px,transparent 1px 9px)`,
                  border: `1px solid ${nebula.line}`,
                }}
              >
                {location.state === "located" ? (
                  <Box sx={{ position: "absolute", inset: 0, isolation: "isolate" }}>
                    <Suspense fallback={null}>
                      <LocationMap
                        lat={location.lat}
                        lng={location.lng}
                        dark={theme.palette.mode === "dark"}
                        accent={nebula.accent}
                      />
                    </Suspense>
                  </Box>
                ) : (
                  <Typography
                    sx={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      color: nebula.dim,
                    }}
                  >
                    Finding location…
                  </Typography>
                )}
                {place && (
                  <Box
                    component="span"
                    sx={{
                      position: "absolute",
                      left: 10,
                      bottom: 10,
                      px: "10px",
                      py: "4px",
                      borderRadius: radius("md"),
                      fontSize: 11,
                      color: "#fff",
                      background: "rgba(10,14,26,.66)",
                      backdropFilter: "blur(6px)",
                    }}
                  >
                    {`${place.split(",")[0]} — approx. from IP`}
                  </Box>
                )}
              </Box>
            )}
          </Card>
        )}

        {stats && (
          <Card
            title="Connection quality"
            chip={
              <StatChip tone="ok" sx={{ py: "2px" }}>
                <StatusDot status="online" size={5} />
                LIVE
              </StatChip>
            }
          >
            <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: "6px" }}>
              <Caps>{`Round-trip · last ${SAMPLE_WINDOW} s`}</Caps>
              <Legend color={nebula.accent} label="UDP" />
              <Legend color={nebula.text} label="TCP" dashed />
              <Typography sx={{ ml: "auto", fontSize: 12.5, fontWeight: 600 }}>
                {latest ? `${latest.udpPing.toFixed(1)} ms` : "—"}
              </Typography>
            </Stack>
            <RoundTripChart samples={samples} />

            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", mt: "14px" }}>
              <Box>
                <Stack direction="row" alignItems="center" sx={{ mb: "6px" }}>
                  <Caps>Bandwidth</Caps>
                  <Typography sx={{ ml: "auto", fontSize: 12.5, fontWeight: 600 }}>
                    {stats.bandwidth != null ? formatBandwidth(stats.bandwidth * 8) : "—"}
                  </Typography>
                </Stack>
                <BarStrip
                  label="Bandwidth"
                  values={samples.map((sample) => sample.bandwidth)}
                  color={nebula.accent}
                  format={(value) => formatBandwidth(value * 8)}
                />
              </Box>
              <Box>
                <Stack direction="row" alignItems="center" sx={{ mb: "6px" }}>
                  <Caps>Packet loss</Caps>
                  <Typography sx={{ ml: "auto", fontSize: 12.5, fontWeight: 600 }}>
                    {loss != null ? `${loss.toFixed(2)}%` : "—"}
                  </Typography>
                </Stack>
                <BarStrip
                  label="Packet loss"
                  values={samples.map((sample) => sample.loss)}
                  color={nebula.warn}
                  format={(value) => `${value.toFixed(2)}%`}
                />
              </Box>
            </Box>

            <Table
              head={["", "Packets", "Avg ping", "Deviation"]}
              rows={[
                [
                  "TCP",
                  String(stats.tcp_packets),
                  `${stats.tcp_ping_avg.toFixed(1)} ms`,
                  `${stats.tcp_ping_var.toFixed(1)} ms`,
                ],
                [
                  "UDP",
                  String(stats.udp_packets),
                  `${stats.udp_ping_avg.toFixed(1)} ms`,
                  `${stats.udp_ping_var.toFixed(1)} ms`,
                ],
              ]}
            />
            {(stats.from_client || stats.from_server) && (
              <Table
                head={["", "Good", "Late", "Lost", "Resync"]}
                rows={[
                  stats.from_client && ["Inbound", ...packetRow(stats.from_client)],
                  stats.from_server && ["Outbound", ...packetRow(stats.from_server)],
                ].filter((row): row is string[] => !!row)}
              />
            )}

            <Stack
              direction="row"
              gap={3}
              sx={{ mt: "14px", pt: "12px", borderTop: `1px solid ${nebula.line}` }}
            >
              <Figure
                label="Bandwidth"
                value={stats.bandwidth != null ? formatBandwidth(stats.bandwidth * 8) : "—"}
              />
              <Figure label="Codec" value={codecLabel(stats.opus)} />
              {stats.onlinesecs != null && <Figure label="Online" value={formatDuration(stats.onlinesecs)} />}
            </Stack>
          </Card>
        )}

        {(moderation.length > 0 || bans) && (
          <Card title="Moderation" chip={<StatChip tone="accent">ADMIN ONLY</StatChip>}>
            <Fact label="Prior bans" value={bans ? `${bans.count} · ${bans.note}` : "None"} />
            {moderation.length > 0 && (
              <Stack direction="row" gap={1} sx={{ mt: "12px", flexWrap: "wrap" }}>
                {moderation.map((entry) => (
                  <Button
                    key={entry.key}
                    size="small"
                    variant="outlined"
                    onClick={() =>
                      entry.key === "move" ? onMove() : onModerate(entry.key as ModerationAction)
                    }
                    sx={{
                      px: "14px",
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: "none",
                      borderRadius: radius("md"),
                      color: entry.danger ? nebula.bad : nebula.text,
                      borderColor: entry.danger ? `${nebula.bad}88` : nebula.line2,
                      background: entry.danger ? "transparent" : nebula.card2,
                    }}
                  >
                    {entry.label}
                  </Button>
                ))}
              </Stack>
            )}
          </Card>
        )}
      </Box>
    </Box>
  );
}

function packetRow(packets: NonNullable<UserStats["from_client"]>): string[] {
  return [packets.good, packets.late, packets.lost, packets.resync].map(String);
}

/** One of the sheet's blocks: a raised card with a tracked-out title. */
function Card({ title, chip, children }: Readonly<{ title: string; chip?: ReactNode; children: ReactNode }>) {
  return (
    <Box
      sx={(theme) => ({
        p: "14px 16px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Stack direction="row" alignItems="center" gap={1.25} sx={{ mb: "10px" }}>
        <SectionLabel sx={{ fontSize: 10.5, letterSpacing: ".1em", fontWeight: 600, lineHeight: 1.4 }}>
          {title}
        </SectionLabel>
        {chip}
      </Stack>
      {children}
    </Box>
  );
}

function Caps({ children }: Readonly<{ children: string }>) {
  return (
    <Typography
      component="span"
      sx={(theme) => ({
        fontSize: 10,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        fontWeight: 600,
        color: theme.palette.nebula.dim,
      })}
    >
      {children}
    </Typography>
  );
}

/** A label on the left, its value on the right, as every row on the mock. */
function Fact({
  label,
  value,
  mono,
  tone,
}: Readonly<{ label: string; value: string; mono?: boolean; tone?: "ok" | "warn" }>) {
  return (
    <Stack direction="row" alignItems="baseline" gap={2} sx={{ py: "3px" }}>
      <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted, flex: "none" })}>
        {label}
      </Typography>
      <Typography
        sx={(theme) => ({
          ml: "auto",
          textAlign: "right",
          fontSize: mono ? 11.5 : 12,
          fontWeight: 500,
          fontFamily: mono ? NEBULA_MONO : "inherit",
          wordBreak: "break-all",
          color: tone ? theme.palette.nebula[tone] : theme.palette.nebula.text,
        })}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function Legend({ color, label, dashed }: Readonly<{ color: string; label: string; dashed?: boolean }>) {
  return (
    <Stack direction="row" alignItems="center" gap={0.5}>
      <Box
        component="span"
        aria-hidden
        sx={{
          width: 12,
          borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
          opacity: dashed ? 0.75 : 1,
        }}
      />
      <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>{label}</Typography>
    </Stack>
  );
}

function Table({ head, rows }: Readonly<{ head: readonly string[]; rows: readonly (readonly string[])[] }>) {
  return (
    <Box
      component="table"
      sx={(theme) => ({
        width: "100%",
        mt: "14px",
        borderCollapse: "collapse",
        fontSize: 12,
        "& th": {
          fontSize: 10,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: theme.palette.nebula.dim,
          textAlign: "right",
          pb: "6px",
        },
        "& td": { py: "4px", textAlign: "right" },
        "& th:first-of-type, & td:first-of-type": { textAlign: "left", color: theme.palette.nebula.muted },
      })}
    >
      <thead>
        <tr>
          {head.map((cell, index) => (
            <th key={index}>{cell}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, index) => (
              <td key={index}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Box>
  );
}

function Figure({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Box>
      <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>{label}</Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 700, mt: "2px" }}>{value}</Typography>
    </Box>
  );
}
