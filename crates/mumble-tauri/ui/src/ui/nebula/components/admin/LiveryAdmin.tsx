/**
 * Admin › Livery, in Nebula's language.
 *
 * # What the design is doing
 *
 * The connect screen this edits is a ladder, not a switch: most servers set a
 * few fields and very few set all of them. So the form is never "incomplete" -
 * every counter shows from the start rather than appearing as a warning, and
 * the colour section sits behind a switch because banner-and-nothing-else is a
 * common setup rather than a half-finished one.
 *
 * The preview column is the point of the page. A palette is the one part of the
 * document whose stored value and painted value can differ - clients enforce a
 * contrast floor - so the card shows the *clamped* colour, and the notice under
 * the palettes says what moved and that the stored value is untouched.
 *
 * The address under the server name is drawn on every server, in the viewer's
 * own colours, for the same reason it is in the protocol: `display_name` may
 * stand next to the address and never instead of it, so the page demonstrates
 * the rule it is editing under.
 *
 * # Transport
 *
 * Reading and saving go over the connection this client already has: the server
 * authorises a livery write against the session the frame arrived on - `Write`
 * on the root channel - so a connected admin already carries the identity the
 * handshake established. No credential is typed for either.
 *
 * Artwork is the exception. A banner is up to half a megabyte and the control
 * channel is the wrong pipe for it, so replacing an image goes through the
 * operator API instead. That used to mean typing its address and a token
 * before every session; now the same session identity bridges across, as a
 * short-lived ticket requested over the connection - `requestOperatorTicket`
 * asks for exactly the same `Write` on root this page's other writes already
 * lean on, and the operator API only ever sees the ticket, never the
 * connection. Typing an address and a token stays the fallback for a
 * deployment that has not published one, or a session without that
 * permission.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Box, Button, IconButton, Slider, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { useAppStore } from "@core/store";
import {
  IMAGE_TYPES,
  LIMITS,
  TONES,
  checkOperatorApi,
  clampHex,
  clearLiveryImage,
  currentLivery,
  diffLivery,
  fitLiveryImage,
  fromSnapshot,
  isHexColour,
  requestOperatorTicket,
  uploadLiveryImage,
  writeLiveryOverChannel,
  type LiveryDocument,
  type LiveryPalette,
  type LiverySnapshot,
  type LiveryTag,
  type LiveryTone,
  type OperatorCreds,
} from "@standard/pages/admin/liveryAdmin";
import { CloseIcon, Link2Icon } from "@ui/icons";
import { NEBULA_MONO, radius } from "../../tokens";
import { Stack } from "../primitives";
import { Banner, SegmentedGroup, SettingsCard } from "../settings/controls";
import { AdminPage } from "./controls";

type Mode = "dark" | "light";
type Slot = "accent" | "surface" | "aura";

const EMPTY: LiveryDocument = { version: 0, digest: "" };

/** What a client falls back to when the operator named nothing. */
const STOCK = {
  dark: { surface: "#151d38", accent: "#41b4f9", text: "#eef0fb" },
  light: { surface: "#f6f4f0", accent: "#5c62d8", text: "#26282e" },
} as const;

/** A tone's colour inside the *preview*, which is not the app's theme. */
const CHIP_PREVIEW: Record<LiveryTone, { background: string; border: string; color: string }> = {
  NEUTRAL: { background: "rgba(255,255,255,.08)", border: "transparent", color: "inherit" },
  OK: { background: "rgba(61,220,151,.14)", border: "rgba(61,220,151,.35)", color: "#3cd88e" },
  WARN: { background: "rgba(236,186,85,.14)", border: "rgba(236,186,85,.35)", color: "#ecba55" },
  BAD: { background: "rgba(245,126,126,.14)", border: "rgba(245,126,126,.35)", color: "#f57e7e" },
  ACCENT: { background: "", border: "", color: "" },
};

/** A tone's colour in the *editor*, which is the app's theme. */
const TONE_SWATCH: Record<
  LiveryTone,
  (nebula: { muted: string; ok: string; warn: string; bad: string; accent: string }) => string
> = {
  NEUTRAL: (nebula) => nebula.muted,
  OK: (nebula) => nebula.ok,
  WARN: (nebula) => nebula.warn,
  BAD: (nebula) => nebula.bad,
  ACCENT: (nebula) => nebula.accent,
};

/** Bytes as the mock writes them: "318 KiB". */
const kib = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KiB`;

/** A `data:` URI's decoded size, for the chip over the banner. */
function dataUriBytes(uri: string): number {
  const base64 = uri.slice(uri.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * The page is a form beside a 300px preview, not a table: past the mock's own
 * measure the fields stretch into a single line each and the banner card turns
 * into a letterbox nothing on the connect screen resembles.
 */
const PAGE_WIDTH = 1040;

/**
 * The floor both columns' header rows are held to.
 *
 * The left column opens on a word and the right one on a segmented switch, so
 * left to themselves the first field and the card it previews start on
 * different lines. 39 is the switch's own height - a 12px label on the body's
 * 1.55 leading, 6px of padding above and below, then the group's own 3px and
 * its rule - which is the taller of the two and so the one to match. A floor
 * rather than a height: if the switch ever outgrows this it should push the
 * row open, not spill out of it.
 */
const HEAD_HEIGHT = 39;

/**
 * How big the icon is drawn while it is being chosen.
 *
 * Larger than the 42px the connect card shows, on purpose: a server mark is
 * usually a glyph or a face, and at the size a viewer glances past it an
 * operator cannot tell a good crop from a bad one.
 */
const ICON_PREVIEW = 80;

/** What makes a card fill its side of the artwork row rather than its content. */
const CARD_COLUMN = { display: "flex", flexDirection: "column", boxSizing: "border-box" } as const;

/** Characters as the *server* counts them - code points, not UTF-16 units. */
const used = (value: string | undefined) => [...(value ?? "")].length;

export function LiveryAdmin() {
  const { t } = useTranslation("settings");

  // Only the artwork routes need these, and only when one is replaced. Both
  // are filled automatically by a ticket where the session allows it; the
  // manual form below is the fallback for a session or deployment that does
  // not.
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [askingForCreds, setAskingForCreds] = useState<null | ((creds: OperatorCreds) => void)>(null);
  // Why the manual form is showing, when it is: a denial the server gave a
  // reason for reads better than a blank card asking for a token out of
  // nowhere.
  const [ticketNotice, setTicketNotice] = useState<string | null>(null);
  const [bannerDragOver, setBannerDragOver] = useState(false);
  const [iconDragOver, setIconDragOver] = useState(false);

  const [saved, setSaved] = useState<LiveryDocument>(EMPTY);
  const [draft, setDraft] = useState<LiveryDocument>(EMPTY);
  const [banner, setBanner] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("dark");
  const [open, setOpen] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the last upload had to do to the operator's file, when it did
  // anything. Said rather than done quietly: the bytes on the server are not
  // the bytes they picked.
  const [note, setNote] = useState<string | null>(null);

  const bannerInput = useRef<HTMLInputElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  const patch = useMemo(() => diffLivery(saved, draft), [saved, draft]);
  const dirty = Object.keys(patch).length > 0;

  // The address is remembered; the token is not. A static operator token has no
  // expiry and no identity, so a copy in the preferences file outlives whoever
  // typed it.
  useEffect(() => {
    void getPreferences()
      .then((prefs) => setBaseUrl(prefs.liveryOperatorUrl ?? ""))
      .catch(() => undefined);
  }, []);

  /** Adopt what the connection reports, optionally keeping an edit in progress. */
  const adopt = useCallback((snapshot: LiverySnapshot | null, keepDraft: boolean) => {
    const document = fromSnapshot(snapshot);
    setSaved(document);
    if (!keepDraft) setDraft(document);
    setBanner(snapshot?.bannerSrc ?? null);
    setIcon(snapshot?.iconSrc ?? null);
  }, []);

  const load = useCallback(async () => {
    adopt(await currentLivery(), false);
  }, [adopt]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (reason) {
      // The operator API names the field and the rule it broke; that sentence
      // is the only part an operator can act on, so it is shown verbatim.
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  // Read once, then follow the server's own push, which arrives whenever
  // anybody changes the livery - this page saving included.
  useEffect(() => {
    void load().catch((reason) => setError(String(reason)));
    if (!("__TAURI_INTERNALS__" in globalThis)) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<{ livery: LiverySnapshot | null; serverId?: string | null }>(
      "server-livery",
      (event) => {
        if (cancelled) return;
        // Only the server this page administers. Every session pushes on the
        // one event name, so an unfiltered listener lets a background server's
        // document overwrite the editor the operator is typing into.
        const from = event.payload.serverId ?? null;
        if (from && from !== useAppStore.getState().activeServerId) return;
        adopt(event.payload.livery, false);
      },
    )
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [load, adopt]);

  /**
   * Get an operator credential, then do the thing that needed it.
   *
   * A remembered manual credential wins first, since an operator who typed
   * one meant it for this session. Otherwise a ticket is requested silently:
   * on a grant, `work` never sees a form at all. Only a session or
   * deployment the ticket cannot cover falls through to asking.
   */
  const withCreds = (work: (creds: OperatorCreds) => void) => {
    if (baseUrl && token) {
      work({ baseUrl, token });
      return;
    }
    setBusy(true);
    setError(null);
    void requestOperatorTicket(["server-config:write"])
      .then((ticket) => {
        if (ticket.token && ticket.baseUrl) {
          const resolved: OperatorCreds = { baseUrl: ticket.baseUrl, token: ticket.token };
          setBaseUrl(ticket.baseUrl);
          setToken(ticket.token);
          setTicketNotice(null);
          work(resolved);
          return;
        }
        setTicketNotice(
          ticket.deniedReason ??
            (ticket.token
              ? t("livery.ticketNoAddress", "this server has not published an operator API address")
              : t("livery.ticketDenied", "this connection cannot get an automatic upload credential")),
        );
        setAskingForCreds(() => work);
      })
      .catch(() => {
        setTicketNotice(
          t("livery.ticketUnreachable", "could not reach the server for an automatic upload credential"),
        );
        setAskingForCreds(() => work);
      })
      .finally(() => setBusy(false));
  };

  /** A file chosen through the picker or dropped onto a card. */
  const pickImage = (which: "banner" | "icon", file: File) => {
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError(t("livery.badImageType", "That file isn't a PNG, JPEG or WebP."));
      return;
    }
    withCreds(
      (creds) =>
        void run(async () => {
          // Fitted before it goes out: what an operator picks out of a folder
          // is a camera JPEG or a print-resolution export, and sending that
          // fails at the transport's buffer limit with a message about body
          // length rather than about artwork.
          const fitted = await fitLiveryImage(file, which);
          await uploadLiveryImage(creds, which, fitted.bytes);
          if (fitted.resized) {
            setNote(
              t("livery.resized", {
                defaultValue: "Resized to {{width}}×{{height}}, {{before}} → {{after}}.",
                width: fitted.width,
                height: fitted.height,
                before: kib(fitted.originalBytes),
                after: kib(fitted.bytes.length),
              }),
            );
          }
          await load();
        }),
    );
  };

  const palette: LiveryPalette = draft[mode] ?? {};
  const setColour = (field: keyof LiveryPalette, value: string) =>
    setDraft((current) => {
      const next = { ...(current[mode] ?? {}) };
      // An empty box means "stock", which is the *absence* of the field
      // rather than an empty string the server would reject.
      if (value === "") delete next[field];
      else next[field] = value;
      return { ...current, [mode]: next };
    });

  const tags = draft.tags ?? [];
  const setTags = (next: LiveryTag[]) => setDraft((current) => ({ ...current, tags: next }));
  const patchTag = (index: number, change: Partial<LiveryTag>) =>
    setTags(tags.map((entry, at) => (at === index ? { ...entry, ...change } : entry)));

  const coloursOn = Boolean(
    (draft.dark && Object.keys(draft.dark).length) || (draft.light && Object.keys(draft.light).length),
  );

  const shownSurface = isHexColour(palette.surface ?? "") ? palette.surface! : STOCK[mode].surface;
  const storedAccent = isHexColour(palette.accent ?? "") ? palette.accent! : STOCK[mode].accent;
  // What a client will actually paint, recomputed as the operator types - which
  // the server's own preview route cannot do: it answers about the *saved*
  // palette, so mid-edit it describes the colour they had before.
  const shownAccent = clampHex(storedAccent, shownSurface);
  const clamped = shownAccent === storedAccent ? [] : ["accent"];
  const auraFrom = isHexColour(palette.aura_from ?? "") ? palette.aura_from! : null;
  const auraTo = isHexColour(palette.aura_to ?? "") ? palette.aura_to! : auraFrom;
  const name = draft.display_name?.trim() || "your.server";
  const address = `mumble://${name}:64738`;

  const counter = (value: string | undefined, limit: number) => (
    <Box
      component="span"
      sx={(theme) => ({
        fontSize: 10.5,
        color: used(value) > limit ? theme.palette.nebula.bad : theme.palette.nebula.dim,
      })}
    >
      {used(value)}/{limit}
    </Box>
  );

  return (
    <AdminPage
      maxWidth={PAGE_WIDTH}
      title={t("livery.title", "Livery")}
      hint={t(
        "livery.lede",
        "How this server appears on the connect screen. Every field is optional — a tagline alone is a perfectly good livery.",
      )}
      toolbar={
        <>
          <Typography
            sx={(theme) => ({ alignSelf: "center", fontSize: 10.5, color: theme.palette.nebula.dim })}
          >
            {t("livery.saveMeta", "Only filled fields are sent")} · {t("livery.version", "version")}{" "}
            {saved.version} · {t("livery.digest", "digest")} {saved.digest || "—"}
          </Typography>
          <Button
            size="small"
            variant="contained"
            disabled={busy || !dirty}
            onClick={() =>
              void run(async () => {
                await writeLiveryOverChannel(patch);
                // The server pushes the new document to every client, this one
                // included, so the reload arrives on its own. Adopting the
                // draft now keeps the form from flickering back meanwhile.
                setSaved(draft);
              })
            }
          >
            {t("livery.save", "Save changes")}
          </Button>
        </>
      }
    >
      <Stack direction="row" gap={2.5} alignItems="flex-start" flexWrap="wrap">
        <Box sx={{ flex: "1 1 460px", minWidth: 380 }}>
          <Stack direction="row" alignItems="center" sx={{ minHeight: HEAD_HEIGHT, mb: "10px" }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
              {t("livery.identity", "Identity")}
            </Typography>
          </Stack>

          <Stack gap={1.5}>
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: "6px" }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                  {t("livery.displayName", "Display name")}
                </Typography>
                {counter(draft.display_name, LIMITS.displayName)}
              </Stack>
              <TextField
                fullWidth
                size="small"
                value={draft.display_name ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, display_name: event.target.value }))
                }
                slotProps={{ htmlInput: { "aria-label": t("livery.displayName", "Display name") } }}
              />
              <Typography sx={(theme) => ({ mt: "5px", fontSize: 11, color: theme.palette.nebula.muted })}>
                {t("livery.displayNameHint", "Shown next to")} {address}{" "}
                {t("livery.displayNameHintTail", "— never instead of it.")}
              </Typography>
            </Box>

            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: "6px" }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                  {t("livery.tagline", "Tagline")}
                </Typography>
                {counter(draft.tagline, LIMITS.tagline)}
              </Stack>
              <TextField
                fullWidth
                size="small"
                value={draft.tagline ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, tagline: event.target.value }))}
                slotProps={{ htmlInput: { "aria-label": t("livery.tagline", "Tagline") } }}
              />
            </Box>

            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: "6px" }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                  {t("livery.motd", "Message of the day")}
                </Typography>
                <Box component="span" sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
                  {t("livery.plainText", "plain text")} · {used(draft.motd)}/{LIMITS.motd}
                </Box>
              </Stack>
              <TextField
                fullWidth
                multiline
                minRows={2}
                size="small"
                value={draft.motd ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, motd: event.target.value }))}
                slotProps={{ htmlInput: { "aria-label": t("livery.motd", "Message of the day") } }}
              />
            </Box>
          </Stack>

          <Stack direction="row" alignItems="baseline" gap={1} sx={{ mt: "22px", mb: "10px" }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{t("livery.tags", "Tags")}</Typography>
            <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
              {tags.length} of {LIMITS.tags}
            </Typography>
          </Stack>

          <Stack gap={0.75}>
            {tags.map((tag, index) => (
              // Keyed by index, which is safe because every input is
              // controlled: removing a chip re-renders the ones after it with
              // their own values rather than leaving stale DOM state behind.
              <Stack key={index} direction="row" alignItems="center" gap={0.75}>
                <TextField
                  size="small"
                  sx={{ flex: "0 0 140px" }}
                  value={tag.label}
                  placeholder={t("livery.tagLabel", "Label")}
                  onChange={(event) => patchTag(index, { label: event.target.value })}
                  slotProps={{
                    htmlInput: { maxLength: LIMITS.tagLabel, "aria-label": t("livery.tagLabel", "Label") },
                  }}
                />
                <TextField
                  size="small"
                  sx={{ flex: 1, minWidth: 0 }}
                  value={tag.href ?? ""}
                  placeholder={t("livery.tagHref", "https:// (optional)")}
                  onChange={(event) => patchTag(index, { href: event.target.value })}
                  slotProps={{
                    htmlInput: { "aria-label": t("livery.tagHrefLabel", "Link") },
                    input: {
                      startAdornment: (
                        <Box
                          sx={(theme) => ({ mr: "6px", display: "flex", color: theme.palette.nebula.dim })}
                        >
                          <Link2Icon width={11} height={11} />
                        </Box>
                      ),
                    },
                  }}
                />
                <Stack direction="row" gap={0.375} sx={{ flex: "none" }}>
                  {TONES.map((tone) => (
                    <Box
                      key={tone}
                      component="button"
                      title={tone[0] + tone.slice(1).toLowerCase()}
                      aria-label={tone}
                      aria-pressed={tag.tone === tone}
                      onClick={() => patchTag(index, { tone })}
                      sx={(theme) => ({
                        all: "unset",
                        cursor: "pointer",
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: TONE_SWATCH[tone](theme.palette.nebula),
                        outline: tag.tone === tone ? `2px solid ${theme.palette.nebula.text}` : "none",
                        outlineOffset: 1,
                      })}
                    />
                  ))}
                </Stack>
                <IconButton
                  size="small"
                  sx={{ flex: "none" }}
                  aria-label={t("livery.removeTag", "Remove tag")}
                  onClick={() => setTags(tags.filter((_, at) => at !== index))}
                >
                  <CloseIcon width={12} height={12} />
                </IconButton>
              </Stack>
            ))}
            {tags.length < LIMITS.tags && (
              <Button
                size="small"
                variant="outlined"
                sx={{ alignSelf: "flex-start" }}
                onClick={() => setTags([...tags, { label: "", tone: "NEUTRAL" }])}
              >
                {t("livery.addTag", "+ Add tag")}
              </Button>
            )}
          </Stack>
          <Typography sx={(theme) => ({ mt: "7px", fontSize: 11, color: theme.palette.nebula.muted })}>
            {t("livery.tagsHint", "Tags carry a tone, not a colour — they adapt to each viewer's theme.")}
          </Typography>

          <Typography sx={{ fontSize: 12.5, fontWeight: 600, mt: "22px", mb: "10px" }}>
            {t("livery.artwork", "Artwork")}
          </Typography>

          {askingForCreds && (
            // Only images need this. Everything else on the page is authorised
            // by the connection itself, so the prompt appears where the
            // exception is rather than in front of the whole page.
            <SettingsCard sx={{ mb: "12px" }}>
              {ticketNotice && (
                <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.warn, mb: "5px" })}>
                  {ticketNotice}
                </Typography>
              )}
              <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "9px" })}>
                {t(
                  "livery.credsLead",
                  "Images are uploaded through the operator API, which needs its address and a token.",
                )}
              </Typography>
              <Stack gap={0.875}>
                <TextField
                  size="small"
                  placeholder="http://127.0.0.1:8081"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  slotProps={{ htmlInput: { "aria-label": t("livery.address", "Operator API") } }}
                />
                <TextField
                  size="small"
                  type="password"
                  placeholder={t("livery.token", "Token")}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  slotProps={{
                    htmlInput: { autoComplete: "off", "aria-label": t("livery.token", "Token") },
                  }}
                />
                <Stack direction="row" gap={0.75}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busy || !baseUrl || !token}
                    onClick={() =>
                      void run(async () => {
                        // Checked before the address is remembered, so a typo
                        // is not persisted as this server's operator API.
                        await checkOperatorApi({ baseUrl, token });
                        await updatePreferences({ liveryOperatorUrl: baseUrl });
                        const next = askingForCreds;
                        setAskingForCreds(null);
                        next({ baseUrl, token });
                      })
                    }
                  >
                    {t("livery.use", "Use")}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setAskingForCreds(null);
                      setTicketNotice(null);
                    }}
                  >
                    {t("livery.cancel", "Cancel")}
                  </Button>
                </Stack>
                <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
                  {t("livery.tokenHint", "Not stored — retyped each session.")}
                </Typography>
              </Stack>
            </SettingsCard>
          )}

          <Stack direction="row" gap={1.25} alignItems="stretch" flexWrap="wrap">
            <Box
              sx={(theme) => ({
                display: "flex",
                flex: "1 1 280px",
                borderRadius: radius("lg"),
                outline: bannerDragOver ? `2px solid ${theme.palette.nebula.accent}` : "none",
                outlineOffset: -2,
              })}
              onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setBannerDragOver(true);
              }}
              onDragLeave={() => setBannerDragOver(false)}
              onDrop={(event: React.DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setBannerDragOver(false);
                const file = event.dataTransfer.files[0];
                if (file) pickImage("banner", file);
              }}
            >
              <SettingsCard sx={{ p: 0, flex: 1, minWidth: 0, overflow: "hidden", ...CARD_COLUMN }}>
                {banner ? (
                  <Box sx={{ position: "relative", height: 96 }}>
                    <Box
                      component="img"
                      src={banner}
                      alt=""
                      sx={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        objectPosition: `${draft.banner_focus_x ?? 50}% ${draft.banner_focus_y ?? 50}%`,
                        display: "block",
                      }}
                    />
                    <Box
                      component="span"
                      sx={{
                        position: "absolute",
                        right: 8,
                        bottom: 8,
                        px: "7px",
                        py: "2px",
                        borderRadius: "999px",
                        fontSize: 10,
                        color: "#fff",
                        background: "rgba(0,0,0,.55)",
                      }}
                    >
                      {kib(dataUriBytes(banner))}
                    </Box>
                  </Box>
                ) : (
                  <Box
                    sx={(theme) => ({
                      height: 96,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11.5,
                      color: theme.palette.nebula.dim,
                      background: theme.palette.nebula.card2,
                    })}
                  >
                    {t("livery.noBanner", "No banner")}
                  </Box>
                )}
                <Box sx={{ p: "12px 14px", flex: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                      {t("livery.banner", "Banner")}
                    </Typography>
                    <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
                      PNG · JPEG · WebP · ≤ 512 KiB · {t("livery.dropHint", "drop to replace")}
                    </Typography>
                  </Stack>

                  {banner && (
                    <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "8px" }}>
                      <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}>
                        {t("livery.focusY", "Focus Y")}
                      </Typography>
                      <Slider
                        size="small"
                        min={0}
                        max={100}
                        value={draft.banner_focus_y ?? 50}
                        aria-label={t("livery.focusY", "Focus Y")}
                        onChange={(_, value) =>
                          setDraft((current) => ({ ...current, banner_focus_y: value as number }))
                        }
                        sx={{ flex: 1 }}
                      />
                      <Typography sx={{ fontSize: 10.5, width: 22, textAlign: "right" }}>
                        {draft.banner_focus_y ?? 50}
                      </Typography>
                    </Stack>
                  )}

                  <Stack direction="row" gap={0.75} sx={{ mt: "10px" }}>
                    <Box
                      component="input"
                      ref={bannerInput}
                      type="file"
                      hidden
                      accept={IMAGE_TYPES.join(",")}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        const file = event.target.files?.[0];
                        if (file) pickImage("banner", file);
                      }}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => bannerInput.current?.click()}
                    >
                      {t("livery.replace", "Replace")}
                    </Button>
                    {draft.banner_key && (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() =>
                          withCreds(
                            (creds) =>
                              void run(async () => {
                                await clearLiveryImage(creds, "banner");
                                await load();
                              }),
                          )
                        }
                      >
                        {t("livery.remove", "Remove")}
                      </Button>
                    )}
                  </Stack>
                </Box>
              </SettingsCard>
            </Box>

            <Box
              sx={(theme) => ({
                display: "flex",
                flex: "0 0 150px",
                borderRadius: radius("lg"),
                outline: iconDragOver ? `2px solid ${theme.palette.nebula.accent}` : "none",
                outlineOffset: -2,
              })}
              onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setIconDragOver(true);
              }}
              onDragLeave={() => setIconDragOver(false)}
              onDrop={(event: React.DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setIconDragOver(false);
                const file = event.dataTransfer.files[0];
                if (file) pickImage("icon", file);
              }}
            >
              <SettingsCard
                sx={{
                  textAlign: "center",
                  flex: 1,
                  minWidth: 0,
                  ...CARD_COLUMN,
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {draft.icon_key && (
                  // In the corner of the thing it clears rather than under it,
                  // which is where a second button reads as a second choice
                  // about the icon instead of a way to be rid of it.
                  <IconButton
                    size="small"
                    disabled={busy}
                    title={t("livery.removeIcon", "Remove icon")}
                    aria-label={t("livery.removeIcon", "Remove icon")}
                    sx={{ position: "absolute", top: 4, right: 4 }}
                    onClick={() =>
                      withCreds(
                        (creds) =>
                          void run(async () => {
                            await clearLiveryImage(creds, "icon");
                            await load();
                          }),
                      )
                    }
                  >
                    <CloseIcon width={12} height={12} />
                  </IconButton>
                )}
                {icon ? (
                  <Box
                    component="img"
                    src={icon}
                    alt=""
                    sx={{
                      width: ICON_PREVIEW,
                      height: ICON_PREVIEW,
                      flex: "none",
                      borderRadius: radius("lg"),
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <Box
                    sx={(theme) => ({
                      width: ICON_PREVIEW,
                      height: ICON_PREVIEW,
                      flex: "none",
                      mx: "auto",
                      borderRadius: radius("lg"),
                      display: "grid",
                      placeItems: "center",
                      fontSize: 30,
                      fontWeight: 700,
                      background: theme.palette.nebula.card2,
                      color: theme.palette.nebula.muted,
                    })}
                  >
                    {name.slice(0, 1).toUpperCase()}
                  </Box>
                )}
                <Typography sx={{ mt: "8px", fontSize: 12, fontWeight: 600 }}>
                  {t("livery.icon", "Icon")}
                </Typography>
                <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
                  ≤ 64 KiB
                </Typography>
                <Box
                  component="input"
                  ref={iconInput}
                  type="file"
                  hidden
                  accept={IMAGE_TYPES.join(",")}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0];
                    if (file) pickImage("icon", file);
                  }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  sx={{ mt: "10px" }}
                  onClick={() => iconInput.current?.click()}
                >
                  {t("livery.replace", "Replace")}
                </Button>
              </SettingsCard>
            </Box>
          </Stack>

          <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "22px", mb: "10px" }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
              {t("livery.colours", "App colours")}
            </Typography>
            <Typography sx={(theme) => ({ flex: 1, fontSize: 10.5, color: theme.palette.nebula.dim })}>
              {t("livery.coloursNote", "optional — banner alone is a common setup")}
            </Typography>
            <Box
              component="button"
              role="switch"
              aria-checked={coloursOn}
              aria-label={t("livery.colours", "App colours")}
              onClick={() =>
                setDraft((current) =>
                  coloursOn
                    ? { ...current, dark: {}, light: {} }
                    : { ...current, dark: { accent: STOCK.dark.accent } },
                )
              }
              sx={(theme) => ({
                all: "unset",
                cursor: "pointer",
                flex: "none",
                width: 32,
                height: 18,
                borderRadius: "999px",
                position: "relative",
                background: coloursOn ? theme.palette.nebula.accent : theme.palette.nebula.card2,
                transition: "background .15s",
              })}
            >
              <Box
                sx={{
                  position: "absolute",
                  top: 2,
                  left: coloursOn ? 16 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left .15s",
                }}
              />
            </Box>
          </Stack>

          {coloursOn && (
            <>
              <Stack direction="row" gap={1.25} flexWrap="wrap">
                {(["dark", "light"] as const).map((which) => {
                  const entry = draft[which] ?? {};
                  const rows: { slot: Slot; label: string; value: string; swatch: string | null }[] = [
                    {
                      slot: "accent",
                      label: t("livery.accent", "accent"),
                      value: entry.accent ?? "",
                      swatch: isHexColour(entry.accent ?? "") ? entry.accent! : null,
                    },
                    {
                      slot: "surface",
                      label: t("livery.surface", "surface"),
                      value: entry.surface ?? "",
                      swatch: isHexColour(entry.surface ?? "") ? entry.surface! : null,
                    },
                    {
                      slot: "aura",
                      label: t("livery.aura", "aura"),
                      value:
                        entry.aura_from && entry.aura_to
                          ? `${entry.aura_from} → ${entry.aura_to}`
                          : (entry.aura_from ?? ""),
                      swatch: isHexColour(entry.aura_from ?? "")
                        ? `linear-gradient(135deg,${entry.aura_from},${entry.aura_to ?? entry.aura_from})`
                        : null,
                    },
                  ];
                  return (
                    <SettingsCard key={which} sx={{ flex: "1 1 200px" }}>
                      <Typography sx={{ fontSize: 11.5, fontWeight: 600, mb: "8px" }}>
                        {which === "dark"
                          ? t("livery.darkMode", "Dark mode")
                          : t("livery.lightMode", "Light mode")}
                      </Typography>
                      <Stack gap={0.25}>
                        {rows.map((row) => (
                          <Box
                            key={row.slot}
                            component="button"
                            onClick={() => {
                              const same = open === row.slot && mode === which;
                              setMode(which);
                              setOpen(same ? null : row.slot);
                            }}
                            sx={(theme) => ({
                              all: "unset",
                              boxSizing: "border-box",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              width: "100%",
                              cursor: "pointer",
                              px: "8px",
                              py: "6px",
                              borderRadius: radius("md"),
                              fontSize: 11.5,
                              "&:hover": { background: theme.palette.nebula.hover },
                            })}
                          >
                            <Box
                              component="span"
                              sx={(theme) => ({
                                flex: "none",
                                width: 14,
                                height: 14,
                                borderRadius: radius("sm"),
                                background: row.swatch ?? "transparent",
                                border: row.swatch ? "none" : `1px dashed ${theme.palette.nebula.line2}`,
                              })}
                            />
                            {row.label}
                            <Box
                              component="span"
                              sx={(theme) => ({
                                ml: "auto",
                                fontFamily: NEBULA_MONO,
                                fontSize: 10.5,
                                color: theme.palette.nebula.dim,
                              })}
                            >
                              {row.value || t("livery.stock", "stock")}
                            </Box>
                          </Box>
                        ))}
                      </Stack>
                    </SettingsCard>
                  );
                })}
              </Stack>

              {open && (
                <SettingsCard sx={{ mt: "10px" }}>
                  <Stack direction="row" alignItems="center" sx={{ mb: "8px" }}>
                    <Typography sx={{ fontSize: 11.5, fontWeight: 600 }}>
                      {mode === "dark"
                        ? t("livery.darkMode", "Dark mode")
                        : t("livery.lightMode", "Light mode")}{" "}
                      · {open}
                    </Typography>
                    <IconButton
                      size="small"
                      sx={{ ml: "auto" }}
                      aria-label={t("livery.close", "Close")}
                      onClick={() => setOpen(null)}
                    >
                      <CloseIcon width={12} height={12} />
                    </IconButton>
                  </Stack>
                  {(open === "aura"
                    ? (["aura_from", "aura_to"] as const)
                    : ([open] as ("accent" | "surface")[])
                  ).map((field) => (
                    <Stack key={field} direction="row" alignItems="center" gap={0.75} sx={{ mb: "6px" }}>
                      <Box
                        component="input"
                        type="color"
                        aria-label={field}
                        value={isHexColour(palette[field] ?? "") ? palette[field]! : "#000000"}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          setColour(field, event.target.value)
                        }
                        sx={{
                          flex: "none",
                          width: 30,
                          height: 30,
                          padding: 0,
                          border: "none",
                          borderRadius: radius("md"),
                          background: "none",
                          cursor: "pointer",
                        }}
                      />
                      <TextField
                        size="small"
                        sx={{ flex: 1 }}
                        value={palette[field] ?? ""}
                        placeholder={t("livery.stock", "stock")}
                        onChange={(event) => setColour(field, event.target.value)}
                        slotProps={{
                          htmlInput: {
                            "aria-label": `${field} hex`,
                            style: { fontFamily: NEBULA_MONO },
                          },
                        }}
                      />
                      <IconButton
                        size="small"
                        aria-label={t("livery.clear", "Clear")}
                        onClick={() => setColour(field, "")}
                      >
                        <CloseIcon width={12} height={12} />
                      </IconButton>
                    </Stack>
                  ))}
                </SettingsCard>
              )}

              {clamped.length > 0 && (
                <Banner tone="warn" title={t("livery.clampLead", "Kept, but lightened for readability:")}>
                  <Stack direction="row" alignItems="center" gap={0.625} flexWrap="wrap">
                    <span>
                      {mode} {clamped.join(", ")} {t("livery.clampRenders", "renders as")}
                    </span>
                    <Box
                      component="span"
                      sx={{ width: 12, height: 12, borderRadius: radius("sm"), background: storedAccent }}
                    />
                    <span>→</span>
                    <Box
                      component="span"
                      sx={{ width: 12, height: 12, borderRadius: radius("sm"), background: shownAccent }}
                    />
                    <Box component="span" sx={{ fontFamily: NEBULA_MONO }}>
                      {shownAccent}
                    </Box>
                    <span>
                      {t("livery.clampTail", "so text stays legible. The stored value is unchanged.")}
                    </span>
                  </Stack>
                </Banner>
              )}
            </>
          )}

          {note && <Banner tone="info">{note}</Banner>}
          {error && <Banner tone="danger">{error}</Banner>}
        </Box>

        {/* The preview paints in the *server's* colours, not the app's, which
            is the whole point of it - so its palette comes from `shownSurface`
            and friends rather than from the Nebula theme. */}
        <Box sx={{ flex: "0 0 300px" }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ minHeight: HEAD_HEIGHT, mb: "10px" }}
          >
            <Typography
              sx={(theme) => ({
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.1em",
                color: theme.palette.nebula.dim,
              })}
            >
              {t("livery.previewTitle", "CONNECT PREVIEW")}
            </Typography>
            <SegmentedGroup
              ariaLabel={t("livery.previewTitle", "CONNECT PREVIEW")}
              value={mode}
              onChange={setMode}
              options={[
                { id: "dark", label: t("livery.dark", "Dark") },
                { id: "light", label: t("livery.light", "Light") },
              ]}
            />
          </Stack>

          <Box
            sx={{
              borderRadius: radius("xl"),
              overflow: "hidden",
              background: shownSurface,
              color: STOCK[mode].text,
              boxShadow: `0 0 0 1px ${auraFrom ? `${auraFrom}99` : `${shownAccent}99`}`,
            }}
            style={
              {
                "--pv-aura": auraFrom
                  ? `radial-gradient(300px 140px at 50% -4%,${auraFrom}40,transparent 60%)`
                  : "none",
              } as CSSProperties
            }
          >
            <Box sx={{ position: "relative", height: 84, background: `${shownAccent}22` }}>
              {banner ? (
                <Box
                  component="img"
                  src={banner}
                  alt=""
                  sx={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: `${draft.banner_focus_x ?? 50}% ${draft.banner_focus_y ?? 50}%`,
                    display: "block",
                  }}
                />
              ) : (
                <Box
                  sx={{ height: "100%", display: "grid", placeItems: "center", fontSize: 13, opacity: 0.7 }}
                >
                  {name}
                </Box>
              )}
            </Box>

            <Box
              sx={{
                p: "14px 16px 16px",
                textAlign: "center",
                background: "var(--pv-aura)",
                // Positioned so the mark, which pulls up into the banner with a
                // negative margin, paints over it: the banner strip above is
                // itself positioned, and a static sibling loses to it however
                // late it comes in the document.
                position: "relative",
              }}
            >
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  mx: "auto",
                  mt: "-34px",
                  mb: "8px",
                  borderRadius: radius("lg"),
                  display: "grid",
                  placeItems: "center",
                  fontSize: 17,
                  fontWeight: 700,
                  color: "#fff",
                  background: shownAccent,
                  overflow: "hidden",
                }}
              >
                {icon ? (
                  <Box
                    component="img"
                    src={icon}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  name.slice(0, 1).toUpperCase()
                )}
              </Box>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: "inherit" }}>{name}</Typography>
              <Typography sx={{ fontFamily: NEBULA_MONO, fontSize: 10, opacity: 0.65, color: "inherit" }}>
                {address}
              </Typography>
              {draft.tagline && (
                <Typography sx={{ mt: "7px", fontSize: 11.5, opacity: 0.85, color: "inherit" }}>
                  {draft.tagline}
                </Typography>
              )}

              {tags.some((tag) => tag.label.trim()) && (
                <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="center" sx={{ mt: "9px" }}>
                  {tags
                    .filter((tag) => tag.label.trim())
                    .map((tag, index) => {
                      const tone = CHIP_PREVIEW[tag.tone];
                      const accent = tag.tone === "ACCENT";
                      return (
                        <Box
                          key={index}
                          component="span"
                          sx={{
                            px: "8px",
                            py: "2px",
                            borderRadius: "999px",
                            fontSize: 10,
                            border: "1px solid",
                            background: accent ? `${shownAccent}28` : tone.background,
                            borderColor: accent ? `${shownAccent}66` : tone.border,
                            color: accent ? shownAccent : tone.color,
                          }}
                        >
                          {tag.label}
                        </Box>
                      );
                    })}
                </Stack>
              )}

              {draft.motd && (
                <Typography sx={{ mt: "9px", fontSize: 10.5, opacity: 0.7, color: "inherit" }}>
                  {draft.motd}
                </Typography>
              )}

              <Box
                sx={{
                  mt: "12px",
                  py: "8px",
                  borderRadius: radius("md"),
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#fff",
                  background: auraFrom ? `linear-gradient(90deg,${auraFrom},${auraTo})` : shownAccent,
                }}
              >
                {t("livery.connectAs", "Connect as")} ZewiWin
              </Box>
            </Box>
          </Box>

          {mode === "light" && !palette.surface && !palette.aura_from && (
            <Typography sx={(theme) => ({ mt: "9px", fontSize: 10.5, color: theme.palette.nebula.dim })}>
              {t("livery.lightStock", "Surface & aura not set for light — viewers get stock colours.")}
            </Typography>
          )}
        </Box>
      </Stack>
    </AdminPage>
  );
}
