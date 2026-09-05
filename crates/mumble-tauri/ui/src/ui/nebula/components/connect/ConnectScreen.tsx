import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Box, Button, CircularProgress, IconButton, Switch, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { TID } from "@core/testids";
import type { SavedServer, ServerPingResult } from "@core/types";
import type { ServerLivery } from "../../livery";
import {
  forgetCachedLivery,
  readCachedLivery,
  writeCachedLivery,
  type CachedLivery,
} from "../../liveryCache";
import {
  LIVERY_BUSY,
  LIVERY_TITLE_KEYS,
  LIVERY_TONE,
  resolveLivery,
  type LiveryStatus,
  type ProbeState,
} from "../../liveryStatus";
import { EditIcon, GripVerticalIcon } from "@ui/icons";
import { dropTarget, measureSlots, type DragSlot } from "../../dragOrder";
import { reorderIdentities, serverTint } from "../../selectors";
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

/**
 * Where this page's branding came from, as one dot on the address chip.
 *
 * Worth drawing because the three failure modes are otherwise indistinguishable
 * from success: a server with no branding, a server whose branding this client
 * has never fetched (a document only arrives over a connection, so a page for a
 * server nobody has connected to cannot have one), and a server that cannot be
 * reached to ask all render as the same unbranded page.
 *
 * It rides on the address chip deliberately. That chip is the one thing on this
 * screen a livery cannot restyle - which is what makes it the honest place to
 * report on the livery.
 */
/**
 * The address chip's own ground and ink.
 *
 * Named and exported so the contrast floor they have to clear can be asserted
 * against the worst banner a server could send, rather than eyeballed against
 * the one that happened to be on screen. See `ConnectScreen.test.tsx`.
 */
export const ADDRESS_CHIP = {
  /** Dark enough that even a white banner composites to a mid tone. */
  scrim: [10, 14, 24] as const,
  scrimAlpha: 0.66,
  ink: [255, 255, 255] as const,
  inkAlpha: 0.94,
};

/** Tones that read on the address chip's dark scrim, in either theme. */
const DOT_COLOURS: Record<"ok" | "warn" | "bad" | "muted", string> = {
  ok: "#3cd88e",
  warn: "#ecba55",
  bad: "#f57e7e",
  // Legible rather than loud: the resting states say "nothing to do here".
  muted: "#b9c6e2",
};

function LiveryDot({ status }: Readonly<{ status: LiveryStatus }>) {
  const { t } = useTranslation("nebulaConnect");
  const tone = LIVERY_TONE[status];
  return (
    <Box
      component="span"
      role="img"
      aria-label={t(LIVERY_TITLE_KEYS[status])}
      data-testid={TID.connectLiveryStatus}
      data-livery-status={status}
      sx={() => {
        // Fixed, not taken from the theme, for the same reason the chip around
        // it carries its own ground: it sits on a dark scrim over server
        // artwork, so the *viewer's* light or dark preference says nothing
        // about what is behind it. The light-theme tones are chosen to read on
        // a pale page and would all but vanish here.
        const colour = DOT_COLOURS[tone];
        return {
          width: 6,
          height: 6,
          flex: "0 0 auto",
          borderRadius: "50%",
          background: colour,
          // A halo on anything the user might want to act on, and none on the
          // two resting states, so a glance separates them without reading.
          boxShadow: tone === "muted" ? "none" : `0 0 0 2px ${alpha(colour, 0.24)}`,
          "@media (forced-colors: active)": { background: "CanvasText", boxShadow: "none" },
          animation: LIVERY_BUSY.has(status) ? "nebula-livery-probe 1.2s ease-in-out infinite" : undefined,
          "@keyframes nebula-livery-probe": {
            "0%, 100%": { opacity: 0.3 },
            "50%": { opacity: 1 },
          },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        };
      }}
    />
  );
}

/** Where the carried identity would land, drawn between two rows. */
function DropLine() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        height: 2,
        my: "-1px",
        flex: "none",
        borderRadius: "1px",
        background: theme.palette.nebula.accent,
      })}
    />
  );
}

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
  /**
   * Change what is saved for one identity - its label, address, name,
   * certificate or password.
   *
   * On the row rather than on the server as a whole, because an identity *is*
   * the saved record: there is nothing stored about a server that is not
   * stored on one of these.
   */
  onEditIdentity?: (identity: SavedServer) => void;
  /**
   * Put this server's identities in the order given, by id.
   *
   * Absent, the rows carry no grip and cannot be dragged: a screen with nobody
   * to remember the arrangement should not offer to rearrange anything.
   */
  onReorderIdentities?: (ids: readonly string[]) => void;
}

/** How far the pointer travels before a press on the grip becomes a drag. */
const DRAG_SLACK = 4;

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
  livery: liveLivery = null,
  identities,
  connecting,
  error,
  onConnect,
  onAddIdentity,
  onEditIdentity,
  onReorderIdentities,
}: Readonly<ConnectScreenProps>) {
  const { t } = useTranslation(["nebulaConnect", "server"]);
  const [ping, setPing] = useState<ServerPingResult | null>(null);
  /** What this address said last, from disk or from the fetch below. */
  const [cached, setCached] = useState<CachedLivery | null>(null);
  /** Where the out-of-band livery fetch has got to, and for which digest. */
  const [probe, setProbe] = useState<{ digest: string; state: ProbeState } | null>(null);
  /** The address-and-digest this screen has already asked for. */
  const requested = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Saved-server id the client connects to at launch, or null for none. */
  const [autoConnectId, setAutoConnectId] = useState<string | null>(null);

  /*
    Rearranging the rows runs its own pointer gesture rather than the browser's
    HTML5 drag, for the reason the server rail does: a drag started inside the
    webview never fires reliably, and it gives no way to keep the carried row
    in the list it came from. Only the grip starts one - a press anywhere else
    on a row still just picks that identity to arrive as.
  */
  const listRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ key: string; startY: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ key: string; y: number; slots: DragSlot[] } | null>(null);
  // One identity is an order already. Nothing to grip, and no room for the
  // grip's column to push the row's contents across for no reason.
  const canReorder = Boolean(onReorderIdentities) && identities.length > 1;

  const beginGesture = useCallback(
    (key: string) => (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // Stops the browser starting a text selection or its own drag from the
      // row, either of which cancels the pointer stream mid-gesture.
      event.preventDefault();
      gesture.current = { key, startY: event.clientY, moved: false };
    },
    [],
  );

  /** The rows as the user sees them, keyed by the id each one carries. */
  const measureRows = useCallback(() => {
    const rows = new Map<string, HTMLElement>();
    for (const row of listRef.current?.querySelectorAll<HTMLElement>("[data-identity-id]") ?? []) {
      const id = row.dataset.identityId;
      if (id) rows.set(id, row);
    }
    return rows;
  }, []);

  useEffect(() => {
    if (!canReorder) return;

    const move = (event: PointerEvent) => {
      const held = gesture.current;
      if (!held) return;
      // A few pixels of slack, so a click on the grip is still a click.
      if (!held.moved && Math.abs(event.clientY - held.startY) < DRAG_SLACK) return;
      if (!held.moved) {
        held.moved = true;
        // Measured once, as the drag starts: the indicator is drawn without
        // moving anything, so the rows the pointer is judged against stay
        // where they were and the drop target cannot chase itself.
        setDrag({ key: held.key, y: event.clientY, slots: measureSlots(measureRows()) });
        return;
      }
      setDrag((current) => (current ? { ...current, y: event.clientY } : current));
    };

    const end = () => {
      const held = gesture.current;
      gesture.current = null;
      if (!held?.moved) return;
      setDrag((current) => {
        if (current) onReorderIdentities?.(reorderIdentities(identities, current.key, dropTarget(current)));
        return null;
      });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [canReorder, identities, measureRows, onReorderIdentities]);

  /**
   * Move one identity a single place, for the keyboard.
   *
   * Phrased as the drop is - "land in front of that row" - rather than as a
   * pair of indices, so both paths end in the same call and there is only one
   * piece of list arithmetic to get right.
   */
  const nudge = useCallback(
    (id: string, delta: -1 | 1) => {
      const ids = identities.map((entry) => entry.id);
      const from = ids.indexOf(id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= ids.length) return;
      onReorderIdentities?.(reorderIdentities(identities, id, delta < 0 ? ids[to] : (ids[to + 1] ?? null)));
    },
    [identities, onReorderIdentities],
  );

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

  // A livery document only ever arrives over a connection, so a page for a
  // server nobody is connected to has nothing to show unless it remembers.
  useEffect(() => {
    setCached(null);
    setProbe(null);
    requested.current = null;
    if (!server) return;
    let active = true;
    void readCachedLivery(server.host, server.port)
      .then((entry) => {
        if (active) setCached(entry);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [server]);

  // What to draw, what to say about where it came from, and whether the
  // document still has to be fetched.
  const digest = ping?.livery_digest ?? null;
  const resolved = resolveLivery({
    live: liveLivery,
    cached,
    ping,
    // A probe recorded against a different digest says nothing about this one:
    // the operator changed the livery while this page was open.
    probe: probe && probe.digest === digest ? probe.state : "idle",
  });

  // Fetch it the way the user count is fetched - by asking, without joining.
  // `probe_livery` opens the control connection, sends one query and hangs up;
  // it never authenticates, so nothing here creates a session on the server.
  useEffect(() => {
    if (!server || !resolved.fetch || !digest) return;
    // Deduplicated on a token rather than cancelled by a cleanup, and the
    // difference is load-bearing. `resolved.fetch` goes false the instant the
    // line below records the attempt, which re-runs this effect; a cleanup
    // that invalidated the request in flight would throw away the answer when
    // it arrived and leave the page loading for ever. It did exactly that.
    const token = `${server.host}:${server.port}:${digest}`;
    if (requested.current === token) return;
    requested.current = token;
    setProbe({ digest, state: "running" });

    // No `have_keys`: this holds no art of its own, and a copy the digest has
    // already contradicted is not a safe thing to claim to hold.
    void invoke<ServerLivery | null>("probe_livery", {
      host: server.host,
      port: server.port,
    })
      .then((answer) => {
        // Superseded - the user moved to another server, or the operator
        // changed the livery while this was out.
        if (requested.current !== token) return;
        if (!answer?.digest) {
          setProbe({ digest, state: "failed" });
          return;
        }
        setCached({ digest: answer.digest, livery: answer, savedAt: Date.now() });
        setProbe({ digest, state: "idle" });
        // Keep it, so the next visit paints before the probe even starts.
        void writeCachedLivery(server.host, server.port, answer).catch(() => undefined);
      })
      .catch(() => {
        if (requested.current === token) setProbe({ digest, state: "failed" });
      });
  }, [server, resolved.fetch, digest]);

  // The server answered that it has no branding. Drop what we remember, or an
  // operator's removal would never reach a client that had already seen it.
  useEffect(() => {
    if (!server || !resolved.forget) return;
    void forgetCachedLivery(server.host, server.port).catch(() => undefined);
    setCached(null);
  }, [server, resolved.forget]);

  if (!server)
    return (
      <Stack sx={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 1 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{t("screen.pickTitle")}</Typography>
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
          {t("screen.pickBody")}
        </Typography>
      </Stack>
    );

  const identity = identities.find((entry) => entry.id === selected) ?? server;
  // The row the carried one would land in front of, or null for the end.
  const dropBefore = drag ? dropTarget(drag) : null;
  // Everything below draws whatever survived resolution - live from an open
  // connection, remembered from a previous visit, or nothing at all. Which of
  // those it was is the indicator's job to say, not this page's.
  const livery = resolved.livery;
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
          title={t(LIVERY_TITLE_KEYS[resolved.status])}
          sx={{
            position: "absolute",
            top: 14,
            right: 18,
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            px: "10px",
            py: "3px",
            borderRadius: radius("lg"),
            fontSize: 10,
            // Carries its own ground rather than a theme surface token, and
            // that is the whole point: this chip lies on the banner, and the
            // banner is a picture the *server* chose. A `card2` background
            // assumes the page behind it, so over a bright photo the address
            // went unreadable - on precisely the element that exists to stay
            // readable no matter what the server sent.
            //
            // Dark in both themes for the same reason. The viewer's theme says
            // nothing about the artwork underneath, so a light-mode chip would
            // be the same gamble in the other direction.
            background: `rgba(${ADDRESS_CHIP.scrim.join(",")},${ADDRESS_CHIP.scrimAlpha})`,
            backdropFilter: "blur(7px)",
            border: "1px solid rgba(255,255,255,.16)",
            color: `rgba(${ADDRESS_CHIP.ink.join(",")},${ADDRESS_CHIP.inkAlpha})`,
            // A busy photo defeats a flat scrim at small sizes; this is what
            // holds the glyph edges apart from the bokeh behind them.
            textShadow: "0 1px 2px rgba(0,0,0,.55)",
            // Under a forced palette the user has already said what they need,
            // and hand-picked colours are exactly what that setting overrides.
            "@media (forced-colors: active)": {
              background: "Canvas",
              color: "CanvasText",
              border: "1px solid CanvasText",
              backdropFilter: "none",
              textShadow: "none",
            },
          }}
        >
          <LiveryDot status={resolved.status} />
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
              <CircularProgress size={9} thickness={6} color="inherit" /> {t("status.checking")}
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
              {ping.max_user_count
                ? t("status.onlineOfMax", { users: ping.user_count ?? 0, max: ping.max_user_count })
                : t("status.online", { users: ping.user_count ?? 0 })}
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
              {t("status.offline")}
            </StatChip>
          )}
          {ping?.latency_ms != null && <StatChip>{t("status.latency", { ms: ping.latency_ms })}</StatChip>}
          {ping?.server_version && (
            <StatChip>{t("status.version", { version: ping.server_version })}</StatChip>
          )}
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
          <SectionLabel>{t("screen.joinAs")}</SectionLabel>
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
            {t("screen.newIdentity")}
          </Box>
        </Stack>

        <Box ref={listRef} sx={{ width: "100%", display: "flex", flexDirection: "column", gap: "7px" }}>
          {identities.map((entry) => {
            const active = entry.id === identity.id;
            const carried = drag?.key === entry.id;
            return (
              <Fragment key={entry.id}>
                {dropBefore === entry.id && <DropLine />}
                <Stack
                  data-identity-id={entry.id}
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
                    // The row stays in place while it is carried; what moves is
                    // the line saying where it would land.
                    opacity: carried ? 0.4 : 1,
                    background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
                    border: `1px solid ${active ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
                  })}
                >
                  {canReorder && (
                    <Box
                      component="button"
                      type="button"
                      data-testid={TID.connectIdentityHandle}
                      aria-label={t("nebulaConnect:screen.reorderIdentity", { username: entry.username })}
                      onPointerDown={beginGesture(entry.id)}
                      // A press on the grip is not a press on the row: picking
                      // an identity up is not the same as picking it.
                      onClick={(event: ReactMouseEvent) => event.stopPropagation()}
                      onKeyDown={(event: ReactKeyboardEvent) => {
                        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                        // Without this the list scrolls under the row being
                        // moved, which is the one thing the user is watching.
                        event.preventDefault();
                        nudge(entry.id, event.key === "ArrowUp" ? -1 : 1);
                      }}
                      sx={(theme) => ({
                        all: "unset",
                        flex: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 16,
                        alignSelf: "stretch",
                        ml: "-4px",
                        cursor: drag ? "grabbing" : "grab",
                        color: theme.palette.nebula.dim,
                        // A touch drag must move the row, not scroll the page.
                        touchAction: "none",
                        opacity: 0.75,
                        "&:hover, &:focus-visible": { opacity: 1, color: theme.palette.nebula.muted },
                        "&:focus-visible": {
                          outline: `2px solid ${theme.palette.nebula.accent}`,
                          outlineOffset: 1,
                          borderRadius: radius("sm"),
                        },
                      })}
                    >
                      <GripVerticalIcon width={14} height={14} />
                    </Box>
                  )}
                  <UserAvatar name={entry.username} size={34} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: active ? 600 : 500 }} noWrap>
                      {entry.username}
                    </Typography>
                    <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}>
                      {entry.cert_label
                        ? t("screen.certificate", { label: entry.cert_label })
                        : t("screen.noCertificate")}
                    </Typography>
                  </Box>
                  {onEditIdentity && (
                    <Tooltip title={t("server:edit.title")}>
                      <IconButton
                        aria-label={t("nebulaConnect:screen.editIdentity", { username: entry.username })}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditIdentity(entry);
                        }}
                        sx={{ flex: "none" }}
                      >
                        <EditIcon width={13} height={13} />
                      </IconButton>
                    </Tooltip>
                  )}
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
              </Fragment>
            );
          })}
          {drag && dropBefore === null && <DropLine />}
        </Box>

        <Stack direction="row" alignItems="center" gap={1.5} sx={{ width: "100%", mt: "18px" }}>
          <Button
            variant="contained"
            disabled={connecting}
            data-testid={TID.quickConnect}
            onClick={() => onConnect(identity)}
            sx={{ flex: 1, height: 42, borderRadius: radius("lg"), fontSize: 13, fontWeight: 600 }}
          >
            {connecting ? t("screen.connecting") : t("screen.connectAs", { username: identity.username })}
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
              slotProps={{ input: { "aria-label": t("screen.autoConnectAria") } }}
            />
            {t("screen.autoConnect")}
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
