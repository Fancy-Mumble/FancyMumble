import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import type { ServerPingResult } from "@core/types";
import { serverTint, type ServerRailEntry } from "../../selectors";
import { UserAvatar } from "../primitives";
import { radius } from "../../tokens";

/** One person in the channel you are in, as the card needs them. */
export interface RailCardOccupant {
  session: number;
  name: string;
  talking: boolean;
  muted: boolean;
}

export interface ServerRailCardProps {
  entry: ServerRailEntry;
  icon?: string;
  banner?: string;
  ping?: ServerPingResult;
  /** The channel you are in on this server, when you are on it. */
  channelName?: string | null;
  /** The name you arrived as. */
  ownName?: string | null;
  occupants?: readonly RailCardOccupant[];
  /** Distance from the top of the rail to the tile this card belongs to. */
  top: number;
  onOpen: () => void;
  onCancel?: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/** A reading with a border round it, in the three tones the card uses. */
function Chip({
  children,
  tone = "quiet",
}: Readonly<{ children: React.ReactNode; tone?: "quiet" | "ok" | "warn" }>) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        px: "9px",
        py: "3px",
        borderRadius: "11px",
        fontSize: 10.5,
        fontVariantNumeric: "tabular-nums",
        ...(tone === "ok"
          ? {
              background: "rgba(60,216,142,.14)",
              border: "1px solid rgba(60,216,142,.3)",
              color: theme.palette.nebula.ok,
            }
          : tone === "warn"
            ? {
                background: theme.palette.nebula.card,
                border: "1px solid " + theme.palette.nebula.line2,
                color: theme.palette.nebula.warn,
              }
            : {
                background: theme.palette.nebula.card,
                border: "1px solid " + theme.palette.nebula.line2,
                color: theme.palette.nebula.muted,
              }),
      })}
    >
      {children}
    </Box>
  );
}
/** The address, over the banner, in the tone of the connection. */
function AddressPill({ host, status }: Readonly<{ host: string; status: ServerRailEntry["status"] }>) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        position: "absolute",
        right: 9,
        top: 8,
        display: "flex",
        alignItems: "center",
        gap: "5px",
        px: "8px",
        py: "2px",
        borderRadius: "11px",
        background: "rgba(6,9,16,.6)",
        backdropFilter: "blur(8px)",
        fontFamily: "Geist Mono, monospace",
        fontSize: 9.5,
        fontWeight: 500,
        color: "#cfd9ea",
        "& > span": {
          width: 5,
          height: 5,
          borderRadius: "50%",
          background:
            status === "connected"
              ? theme.palette.nebula.ok
              : status === "connecting"
                ? theme.palette.nebula.warn
                : theme.palette.nebula.dim,
        },
      })}
    >
      <span />
      mumble://{host}
    </Box>
  );
}

/** The full-width action at the foot of the card. */
function CardAction({
  label,
  onClick,
  quiet = false,
}: Readonly<{ label: string; onClick: () => void; quiet?: boolean }>) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        mt: "10px",
        width: "100%",
        py: "8px",
        textAlign: "center",
        cursor: "pointer",
        borderRadius: radius("md"),
        fontSize: 12,
        fontWeight: 600,
        ...(quiet
          ? { border: "1px solid " + theme.palette.nebula.line2, color: theme.palette.nebula.muted }
          : { background: theme.palette.nebula.accent, color: theme.palette.nebula.onAccent }),
        "&:hover": quiet ? { background: theme.palette.nebula.hover } : {},
        "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
      })}
    >
      {label}
    </Box>
  );
}
/**
 * A peek at one server, without going there.
 *
 * The card answers a different question in each state, so it does not keep a
 * fixed set of rows: a server you are on says who is around you, one you are
 * not says what is waiting and offers the way in, and one still being reached
 * says only how far it has got, because nothing else is known yet.
 */
export function ServerRailCard({
  entry,
  icon,
  banner,
  ping,
  channelName,
  ownName,
  occupants = [],
  top,
  onOpen,
  onCancel,
  onPointerEnter,
  onPointerLeave,
}: Readonly<ServerRailCardProps>) {
  const { t } = useTranslation(["nebulaSidebar", "nebulaConnect"]);
  const { group, status, unread } = entry;
  const here = status === "connected" && Boolean(channelName);

  return (
    <Box
      role="dialog"
      aria-label={group.label}
      data-testid="nebula-server-rail-card"
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      sx={(theme) => ({
        position: "absolute",
        left: 64,
        top,
        width: 272,
        zIndex: 40,
        borderRadius: radius("xl"),
        overflow: "hidden",
        background: theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
        border: "1px solid " + theme.palette.nebula.line2,
        boxShadow: theme.palette.nebula.shadow,
        backdropFilter: "blur(22px) saturate(1.2)",
      })}
    >
      <Box sx={{ height: 76, position: "relative", overflow: "hidden" }}>
        {banner ? (
          <Box
            component="img"
            src={banner}
            alt=""
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.85 }}
          />
        ) : (
          <Box
            aria-hidden
            sx={{
              width: "100%",
              height: "100%",
              background:
                "linear-gradient(135deg," + serverTint(group.key).from + "," + serverTint(group.key).to + ")",
              opacity: 0.55,
            }}
          />
        )}
        <Box
          aria-hidden
          sx={(theme) => ({
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg,transparent 28%," + theme.palette.nebula.bg0 + ")",
          })}
        />
        <AddressPill host={group.host} status={status} />
      </Box>

      <Box sx={{ px: "14px", pb: "14px", mt: "-24px", position: "relative" }}>
        <Box
          sx={(theme) => ({
            width: 46,
            height: 46,
            borderRadius: radius("lg"),
            overflow: "hidden",
            border: "2px solid " + theme.palette.nebula.bg0,
          })}
        >
          <UserAvatar name={group.label} size={42} square src={icon} gradient={serverTint(group.key)} />
        </Box>
        <Typography sx={{ fontSize: 14.5, fontWeight: 600, mt: "8px" }}>{group.label}</Typography>

        <Box sx={{ display: "flex", gap: "5px", flexWrap: "wrap", mt: "8px" }}>
          {status === "connecting" ? (
            <Chip tone="warn">{t("nebulaSidebar:servers.connecting")}</Chip>
          ) : (
            ping?.online && (
              <Chip tone="ok">
                {ping.max_user_count
                  ? t("nebulaConnect:status.onlineOfMax", {
                      users: ping.user_count ?? 0,
                      max: ping.max_user_count,
                    })
                  : t("nebulaConnect:status.online", { users: ping.user_count ?? 0 })}
              </Chip>
            )
          )}
          {ping?.latency_ms != null && status !== "connecting" && (
            <Chip>{t("nebulaConnect:status.latency", { ms: ping.latency_ms })}</Chip>
          )}
          {ping?.server_version && status !== "connecting" && (
            <Chip>{t("nebulaConnect:status.version", { version: ping.server_version })}</Chip>
          )}
          {group.identities.length > 0 && status === "connecting" && (
            <Chip>{t("nebulaSidebar:servers.identities", { count: group.identities.length })}</Chip>
          )}
        </Box>

        <Box
          aria-hidden
          sx={(theme) => ({ height: "1px", background: theme.palette.nebula.line, mt: "12px", mb: "10px" })}
        />

        <CardBody
          entry={entry}
          here={here}
          channelName={channelName}
          ownName={ownName}
          occupants={occupants}
          unread={unread}
          onOpen={onOpen}
          onCancel={onCancel}
        />
      </Box>
    </Box>
  );
}
/** The part of the card that differs by what the server is doing. */
function CardBody({
  entry,
  here,
  channelName,
  ownName,
  occupants,
  unread,
  onOpen,
  onCancel,
}: Readonly<{
  entry: ServerRailEntry;
  here: boolean;
  channelName?: string | null;
  ownName?: string | null;
  occupants: readonly RailCardOccupant[];
  unread: number;
  onOpen: () => void;
  onCancel?: () => void;
}>) {
  const { t } = useTranslation(["nebulaSidebar", "common"]);
  if (entry.status === "connecting") {
    return (
      <>
        <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Box
            aria-hidden
            sx={(theme) => ({
              width: 10,
              height: 10,
              borderRadius: "50%",
              border: "1.5px solid " + theme.palette.nebula.warn,
              borderTopColor: "transparent",
              animation: "nebula-card-spin .9s linear infinite",
              "@keyframes nebula-card-spin": { to: { transform: "rotate(360deg)" } },
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            })}
          />
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {t("nebulaSidebar:servers.handshaking")}
          </Typography>
        </Box>
        {onCancel && <CardAction label={t("common:actions.cancel")} onClick={onCancel} quiet />}
      </>
    );
  }

  if (here) {
    return (
      <>
        <Typography
          sx={(theme) => ({
            fontFamily: "Geist Mono, monospace",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: ".09em",
            color: theme.palette.nebula.dim,
            mb: "7px",
          })}
        >
          {/* Uppercased here rather than in the translation, so a translator
              writes the sentence in normal case and every language gets the
              mock's caps treatment. */}
          {(ownName
            ? t("nebulaSidebar:card.youreInAs", { channel: channelName, name: ownName })
            : t("nebulaSidebar:card.youreIn", { channel: channelName })
          ).toUpperCase()}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {occupants.map((person) => (
            <Box key={person.session} sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <UserAvatar name={person.name} session={person.session} size={22} talking={person.talking} />
              <Typography sx={{ fontSize: 11.5 }}>{person.name}</Typography>
              <Typography
                sx={(theme) => ({
                  ml: "auto",
                  fontSize: 9.5,
                  color: person.muted ? theme.palette.nebula.bad : theme.palette.nebula.dim,
                })}
              >
                {person.muted
                  ? t("nebulaSidebar:card.muted")
                  : person.talking
                    ? t("nebulaSidebar:card.speaking")
                    : ""}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography sx={(theme) => ({ mt: "10px", fontSize: 10.5, color: theme.palette.nebula.dim })}>
          {t("nebulaSidebar:servers.connectedHere")}
        </Typography>
      </>
    );
  }

  const count = entry.group.identities.length;
  return (
    <>
      {unread > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: "7px", mb: "6px" }}>
          <Box
            sx={(theme) => ({
              minWidth: 17,
              height: 17,
              px: "4px",
              borderRadius: "9px",
              display: "grid",
              placeItems: "center",
              background: theme.palette.nebula.bad,
              color: theme.palette.nebula.bg0,
              fontSize: 9,
              fontWeight: 700,
            })}
          >
            {unread > 99 ? "99+" : unread}
          </Box>
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.bad })}>
            {t("nebulaSidebar:card.unread")}
          </Typography>
        </Box>
      )}
      <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
        {(count > 0
          ? t("nebulaSidebar:card.identitiesSummary", { count })
          : t("nebulaSidebar:card.noIdentitySaved")) +
          (entry.session ? "" : t("nebulaSidebar:card.notConnectedSuffix"))}
      </Typography>
      <CardAction
        label={
          entry.session
            ? t("nebulaSidebar:servers.switchTo", { server: entry.group.label })
            : t("nebulaSidebar:servers.connectTo", { server: entry.group.label })
        }
        onClick={onOpen}
      />
    </>
  );
}
