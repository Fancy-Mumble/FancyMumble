import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Box, Button, CircularProgress, Switch, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import type { SavedServer, ServerPingResult } from "@core/types";
import type { ServerLivery } from "../../livery";
import { serverTint } from "../../selectors";
import { UserAvatar, Stack } from "../primitives";
import { SectionLabel, StatChip } from "../primitives";
import { radius } from "../../tokens";

/** How a livery tone maps onto the chip tones this pack already draws. */
const TAG_TONE = {
  NEUTRAL: undefined,
  OK: "ok",
  WARN: "warn",
  BAD: "bad",
  ACCENT: "accent",
} as const;

interface ConnectScreenProps {
  server: SavedServer | null;
  /**
   * What this server says it looks like, or null for the great majority that
   * say nothing.
   *
   * Every field is separately optional and each renders nothing when absent, so
   * a server that sent only a tagline gets exactly that. No branch below tests
   * "is this server branded" - there is no such state.
   */
  livery?: ServerLivery | null;
  /** Identities saved for the same host:port, offered as "join as". */
  identities: readonly SavedServer[];
  connecting: boolean;
  error: string | null;
  onConnect: (identity: SavedServer) => void;
  onAddIdentity: () => void;
}

/**
 * The server landing page.
 *
 * The mock treats connecting as an arrival, not a form: a banner, the server's
 * own name and stats, then a short list of identities to arrive as. Stats come
 * from a live UDP/TCP ping so the page is honest about whether the server is
 * even up before the user commits to a connection.
 */
export function ConnectScreen({
  server,
  livery = null,
  identities,
  connecting,
  error,
  onConnect,
  onAddIdentity,
}: Readonly<ConnectScreenProps>) {
  const [ping, setPing] = useState<ServerPingResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Saved-server id the client connects to at launch, or null for none. */
  const [autoConnectId, setAutoConnectId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getPreferences()
      .then((preferences) => {
        if (active) setAutoConnectId(preferences.autoConnectServerId ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPing(null);
    setSelected(server?.id ?? null);
    if (!server) return;
    let active = true;
    void invoke<ServerPingResult>("ping_server", { host: server.host, port: server.port })
      .then((result) => {
        if (active) setPing(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [server]);

  if (!server)
    return (
      <Stack sx={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 1 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Pick a server</Typography>
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
          Choose one from the list, or add a new address.
        </Typography>
      </Stack>
    );

  const identity = identities.find((entry) => entry.id === selected) ?? server;
  // The server's own name wins over the address, and the operator's chosen name
  // over both. Safe to honour before authentication only because the address
  // chip below cannot be replaced: something unforgeable stays on the screen.
  const name = livery?.displayName || server.label || server.host;
  // Keyed on the address, not the label, so renaming an identity does not
  // recolour the server - and so the sidebar tile agrees with this page.
  const tint = serverTint(`${server.host}:${server.port}`);

  return (
    <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, position: "relative" }}>
      <Box
        data-nebula-banner
        sx={{
          height: livery?.bannerSrc ? 210 : 150,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(120deg,${alpha(tint.from, 0.35)},${alpha(tint.to, 0.35)})`,
        }}
      >
        {livery?.bannerSrc ? (
          <Box
            component="img"
            src={livery.bannerSrc}
            alt=""
            /*
              Bytes the Rust side already fetched over the connection this
              client made, handed here as an object URL. Never a URL the server
              chose: that would let any server in a list learn the viewer's
              address from a browse.
            */
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: `${livery.bannerFocus?.x ?? 50}% ${livery.bannerFocus?.y ?? 50}%`,
              display: "block",
            }}
          />
        ) : (
          /*
            The server's own name, set huge and nearly transparent. A server with
            no branding still has an address, and the mock uses it as the banner
            artwork rather than leaving the strip an empty wash of colour.
          */
          <Typography
            aria-hidden
            noWrap
            sx={(theme) => ({
              maxWidth: "100%",
              px: "32px",
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: "0.05em",
              userSelect: "none",
              color:
                theme.palette.mode === "dark"
                  ? "rgba(255,255,255,.25)"
                  : alpha(theme.palette.nebula.text, 0.18),
            })}
          >
            {name}
          </Typography>
        )}
        <Box
          sx={(theme) => ({
            position: "absolute",
            inset: 0,
            background: `linear-gradient(180deg,transparent 40%,${theme.palette.nebula.bg0} 100%)`,
          })}
        />
        <Box
          component="span"
          sx={(theme) => ({
            position: "absolute",
            top: 14,
            right: 18,
            px: "10px",
            py: "3px",
            borderRadius: radius("lg"),
            background: theme.palette.nebula.card2,
            fontSize: 10,
            color: theme.palette.nebula.muted,
          })}
        >
          mumble://{server.host}:{server.port}
        </Box>
      </Box>

      <Stack
        sx={{ maxWidth: 620, mx: "auto", mt: "-48px", px: "32px", pb: "40px", position: "relative" }}
        alignItems="center"
      >
        <Box
          sx={(theme) => ({
            border: `3px solid ${theme.palette.nebula.bg0}`,
            borderRadius: radius("xl"),
            boxShadow: "0 10px 30px rgba(0,0,0,.3)",
          })}
        >
          {livery?.iconSrc ? (
            <Box
              component="img"
              src={livery.iconSrc}
              alt=""
              sx={{
                width: 72,
                height: 72,
                borderRadius: radius("xl"),
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <UserAvatar name={name} size={72} square gradient={tint} />
          )}
        </Box>
        <Typography variant="h1" sx={{ mt: "10px" }}>
          {name}
        </Typography>
        {livery?.tagline && (
          <Typography
            sx={(theme) => ({
              mt: "3px",
              fontSize: 12,
              textAlign: "center",
              color: theme.palette.nebula.muted,
            })}
          >
            {livery.tagline}
          </Typography>
        )}

        <Stack direction="row" gap={1} sx={{ mt: "12px", flexWrap: "wrap", justifyContent: "center" }}>
          {ping === null ? (
            <StatChip>
              <CircularProgress size={9} thickness={6} color="inherit" /> checking
            </StatChip>
          ) : ping.online ? (
            <StatChip tone="ok">
              <Box
                component="span"
                sx={(theme) => ({
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: theme.palette.nebula.ok,
                })}
              />
              {ping.user_count ?? 0}
              {ping.max_user_count ? `/${ping.max_user_count}` : ""} online
            </StatChip>
          ) : (
            <StatChip tone="dim">
              <Box
                component="span"
                sx={(theme) => ({
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: theme.palette.nebula.dim,
                })}
              />
              offline
            </StatChip>
          )}
          {ping?.latency_ms != null && <StatChip>{ping.latency_ms} ms</StatChip>}
          {ping?.server_version && <StatChip>Mumble {ping.server_version}</StatChip>}
          {livery?.tags.map((tag) => (
            <StatChip key={tag.label} tone={TAG_TONE[tag.tone]}>
              {tag.href ? (
                <Box
                  component="a"
                  href={tag.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  sx={{ color: "inherit", textDecoration: "none" }}
                >
                  {tag.label}
                </Box>
              ) : (
                tag.label
              )}
            </StatChip>
          ))}
        </Stack>

        {livery?.motd && (
          /*
            Plain text rendered as plain text. There is no markup field on a
            livery, deliberately: one would be a rendering engine handed to
            whoever runs the server.
          */
          <Box
            sx={(theme) => ({
              mt: "16px",
              width: "100%",
              px: "14px",
              py: "11px",
              borderRadius: radius("lg"),
              background: theme.palette.nebula.card,
              border: `1px solid ${theme.palette.nebula.line2}`,
              fontSize: 12,
              lineHeight: 1.55,
              textAlign: "left",
              color: theme.palette.nebula.muted,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            })}
          >
            {livery.motd}
          </Box>
        )}

        <Stack direction="row" alignItems="center" sx={{ width: "100%", mt: "20px", mb: "8px" }}>
          <SectionLabel>JOIN AS</SectionLabel>
          <Box
            component="button"
            onClick={onAddIdentity}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              ml: "auto",
              fontSize: 11.5,
              fontWeight: 500,
              color: theme.palette.nebula.accent,
            })}
          >
            + New identity
          </Box>
        </Stack>

        <Stack gap={0.875} sx={{ width: "100%" }}>
          {identities.map((entry) => {
            const active = entry.id === identity.id;
            return (
              <Stack
                key={entry.id}
                direction="row"
                alignItems="center"
                gap={1.375}
                onClick={() => setSelected(entry.id)}
                sx={(theme) => ({
                  px: "12px",
                  py: "10px",
                  borderRadius: radius("lg"),
                  cursor: "pointer",
                  textAlign: "left",
                  background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
                  border: `1px solid ${active ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
                })}
              >
                <UserAvatar name={entry.username} size={34} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: active ? 600 : 500 }} noWrap>
                    {entry.username}
                  </Typography>
                  <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}>
                    {entry.cert_label ? `certificate · ${entry.cert_label}` : "no certificate"}
                  </Typography>
                </Box>
                <Box
                  sx={(theme) => ({
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    flex: "none",
                    border: `${active ? 5 : 1.5}px solid ${
                      active ? theme.palette.nebula.accent : theme.palette.nebula.line2
                    }`,
                  })}
                />
              </Stack>
            );
          })}
        </Stack>

        <Stack direction="row" alignItems="center" gap={1.5} sx={{ width: "100%", mt: "18px" }}>
          <Button
            variant="contained"
            disabled={connecting}
            onClick={() => onConnect(identity)}
            sx={{ flex: 1, height: 42, borderRadius: radius("lg"), fontSize: 13, fontWeight: 600 }}
          >
            {connecting ? "Connecting…" : `Connect as ${identity.username}`}
          </Button>
          <Stack
            direction="row"
            alignItems="center"
            gap={1}
            sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}
          >
            <Switch
              // Auto-connect names an identity, not an address: the client has
              // to know which account to arrive as, so the switch follows the
              // identity currently selected above.
              checked={autoConnectId === identity.id}
              onChange={(event) => {
                const next = event.target.checked ? identity.id : null;
                setAutoConnectId(next);
                void updatePreferences({ autoConnectServerId: next });
              }}
              slotProps={{ input: { "aria-label": "Connect to this server automatically at launch" } }}
            />
            Auto-connect
          </Stack>
        </Stack>

        {error && (
          <Typography sx={(theme) => ({ mt: "12px", fontSize: 11.5, color: theme.palette.nebula.bad })}>
            {error}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
