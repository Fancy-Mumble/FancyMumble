/**
 * Admin › Livery, transcribed from the "Fancy Mumble 2026 v2" mock.
 *
 * # What the design is doing
 *
 * The connect screen this edits is a ladder, not a switch: most servers set a
 * few fields and very few set all of them. So the form is never "incomplete",
 * every counter shows from the start rather than appearing as a warning, and
 * the colour section sits behind a switch because banner-and-nothing-else is a
 * common setup rather than a half-finished one.
 *
 * The preview column is the point of the page. A palette is the one part of the
 * document whose stored value and painted value can differ - clients enforce a
 * contrast floor - so the card shows the *clamped* colour, and the notice under
 * the palettes says what moved and that the stored value is untouched.
 *
 * The address under the server name in the preview is drawn on every server, in
 * the viewer's own colours. It is in the design for the same reason it is in
 * the protocol: `display_name` may stand next to the address and never instead
 * of it, so the page demonstrates the rule it is editing under.
 *
 * # Transport
 *
 * Reading and saving go over the connection this client already has: the server
 * authorises a livery write against the session the frame arrived on, `Write`
 * on the root channel, so an admin who is connected already carries an identity
 * the handshake established. No credential is typed for either.
 *
 * Artwork is the exception. A banner is up to half a megabyte and the control
 * channel is the wrong pipe for it, so replacing an image still goes through
 * the operator API and asks for its address and token at that moment - and only
 * at that moment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { useAppStore } from "@core/store";
import { listen } from "@tauri-apps/api/event";
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
  uploadLiveryImage,
  writeLiveryOverChannel,
  type LiveryDocument,
  type LiveryPalette,
  type LiverySnapshot,
  type LiveryTag,
  type LiveryTone,
  type OperatorCreds,
} from "./liveryAdmin";
import styles from "./LiveryTab.module.css";

type Mode = "dark" | "light";
type Slot = "accent" | "surface" | "aura";

const EMPTY: LiveryDocument = { version: 0, digest: "" };

/** What a client falls back to when the operator named nothing. */
const STOCK = {
  dark: { surface: "#151d38", accent: "#41b4f9", text: "#eef0fb" },
  light: { surface: "#f6f4f0", accent: "#5c62d8", text: "#26282e" },
} as const;

const CHIP_CLASS: Record<LiveryTone, string> = {
  NEUTRAL: "",
  OK: styles.chipOk,
  WARN: styles.chipWarn,
  BAD: styles.chipBad,
  ACCENT: styles.chipAccent,
};

const TONE_CLASS: Record<LiveryTone, string> = {
  NEUTRAL: "",
  OK: styles.toneOk,
  WARN: styles.toneWarn,
  BAD: styles.toneBad,
  ACCENT: styles.toneAccent,
};

/** What a chip looks like inside the preview, which is not the app's theme. */
const CHIP_PREVIEW: Record<LiveryTone, { background: string; border: string; color: string }> = {
  NEUTRAL: { background: "rgba(255,255,255,.08)", border: "transparent", color: "inherit" },
  OK: { background: "rgba(61,220,151,.14)", border: "rgba(61,220,151,.35)", color: "#3cd88e" },
  WARN: { background: "rgba(236,186,85,.14)", border: "rgba(236,186,85,.35)", color: "#ecba55" },
  BAD: { background: "rgba(245,126,126,.14)", border: "rgba(245,126,126,.35)", color: "#f57e7e" },
  ACCENT: { background: "", border: "", color: "" },
};

function LinkIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      <path d="M6 8a3 3 0 0 0 4.2.2l2-2A3 3 0 0 0 8 2l-1 1M8 6a3 3 0 0 0-4.2-.2l-2 2A3 3 0 0 0 6 12l1-1" />
    </svg>
  );
}

/** Bytes as the mock writes them: "318 KiB". */
function kib(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/** A `data:` URI's decoded size, for the chip over the banner. */
function dataUriBytes(uri: string): number {
  const base64 = uri.slice(uri.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Characters, as the server counts them - not UTF-16 units. */
function used(value: string | undefined): number {
  return [...(value ?? "")].length;
}

export function LiveryTab() {
  const { t } = useTranslation("settings");

  // Only the artwork routes need these, and only when one is replaced.
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [askingForCreds, setAskingForCreds] = useState<null | (() => void)>(null);

  const [saved, setSaved] = useState<LiveryDocument>(EMPTY);
  const [draft, setDraft] = useState<LiveryDocument>(EMPTY);
  const [banner, setBanner] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("dark");
  const [open, setOpen] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the last upload had to do to the operator's file, when it did
  // anything. The bytes on the server are not the bytes they picked, so it is
  // said rather than done quietly.
  const [resized, setResized] = useState<string | null>(null);

  const bannerInput = useRef<HTMLInputElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  const creds: OperatorCreds = useMemo(() => ({ baseUrl, token }), [baseUrl, token]);
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

  /// Adopt what the connection reports, keeping any edit in progress.
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
    setResized(null);
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

  /**
   * Replace one image with a chosen file, scaled to what the server stores.
   *
   * Fitted before it goes out: what an operator picks out of a folder is a
   * camera JPEG or a print-resolution export, and sending that fails at the
   * transport's buffer limit with a message about body length rather than
   * about artwork.
   */
  const replaceImage = (which: "banner" | "icon", file: File) =>
    void run(async () => {
      const fitted = await fitLiveryImage(file, which);
      await uploadLiveryImage(creds, which, fitted.bytes);
      if (fitted.resized) {
        setResized(
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
    });

  // Read once, then follow the server's own push, which arrives whenever
  // anybody changes the livery - including this page saving.
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

  /// Ask for the operator credential, then do the thing that needed it.
  const withCreds = (work: () => void) => {
    if (baseUrl && token) work();
    else setAskingForCreds(() => work);
  };

  const palette: LiveryPalette = draft[mode] ?? {};
  const setColour = (field: keyof LiveryPalette, value: string) =>
    setDraft((current) => {
      const next = { ...(current[mode] ?? {}) };
      if (value === "") delete next[field];
      else next[field] = value;
      return { ...current, [mode]: next };
    });

  const tags = draft.tags ?? [];
  const setTags = (next: LiveryTag[]) => setDraft((current) => ({ ...current, tags: next }));
  const patchTag = (index: number, change: Partial<LiveryTag>) =>
    setTags(tags.map((entry, at) => (at === index ? { ...entry, ...change } : entry)));

  const coloursOn = Boolean(
    (draft.dark && Object.keys(draft.dark).length) ||
      (draft.light && Object.keys(draft.light).length),
  );

  const shownSurface = isHexColour(palette.surface ?? "") ? palette.surface! : STOCK[mode].surface;
  const storedAccent = isHexColour(palette.accent ?? "") ? palette.accent! : STOCK[mode].accent;
  // What a client will actually paint. Recomputed as the operator types, which
  // the server's own preview route cannot do: it answers about the saved
  // palette, so mid-edit it describes the colour they had before.
  const shownAccent = clampHex(storedAccent, shownSurface);
  const clamped = shownAccent === storedAccent ? [] : ["accent"];
  const auraFrom = isHexColour(palette.aura_from ?? "") ? palette.aura_from! : null;
  const auraTo = isHexColour(palette.aura_to ?? "") ? palette.aura_to! : auraFrom;
  const name = draft.display_name?.trim() || "your.server";
  const address = `mumble://${name}:64738`;

  return (
    <div className={styles.page}>
      <div className={styles.form}>
        <h2 className={styles.title}>{t("livery.title", "Livery")}</h2>
        <p className={styles.lede}>
          {t(
            "livery.lede",
            "How this server appears on the connect screen. Every field is optional — a tagline alone is a perfectly good livery.",
          )}
        </p>

        <div className={styles.section}>{t("livery.identity", "Identity")}</div>
        <div className={styles.fields}>
          <div>
            <div className={styles.fieldHead}>
              <span>{t("livery.displayName", "Display name")}</span>
              <span
                className={
                  used(draft.display_name) > LIMITS.displayName
                    ? styles.fieldMetaOver
                    : styles.fieldMeta
                }
              >
                {used(draft.display_name)}/{LIMITS.displayName}
              </span>
            </div>
            <input
              className={styles.input}
              value={draft.display_name ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, display_name: event.target.value }))
              }
            />
            <div className={styles.hint}>
              {t("livery.displayNameHint", "Shown next to")} {address}{" "}
              {t("livery.displayNameHintTail", "— never instead of it.")}
            </div>
          </div>

          <div>
            <div className={styles.fieldHead}>
              <span>{t("livery.tagline", "Tagline")}</span>
              <span
                className={
                  used(draft.tagline) > LIMITS.tagline ? styles.fieldMetaOver : styles.fieldMeta
                }
              >
                {used(draft.tagline)}/{LIMITS.tagline}
              </span>
            </div>
            <input
              className={styles.input}
              value={draft.tagline ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, tagline: event.target.value }))
              }
            />
          </div>

          <div>
            <div className={styles.fieldHead}>
              <span>{t("livery.motd", "Message of the day")}</span>
              <span
                className={used(draft.motd) > LIMITS.motd ? styles.fieldMetaOver : styles.fieldMeta}
              >
                {t("livery.plainText", "plain text")} · {used(draft.motd)}/{LIMITS.motd}
              </span>
            </div>
            <textarea
              className={styles.textarea}
              rows={2}
              value={draft.motd ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, motd: event.target.value }))}
            />
          </div>
        </div>

        <div className={styles.sectionRow}>
          <span className={styles.sectionTitle}>{t("livery.tags", "Tags")}</span>
          <span className={styles.sectionCount}>
            {tags.length} of {LIMITS.tags}
          </span>
        </div>
        <div className={styles.tagList}>
          {tags.map((tag, index) => (
            // Keyed by index, which is safe because every input is controlled:
            // removing a chip re-renders the ones after it with their own
            // values rather than leaving stale DOM state behind.
            <div className={styles.tagRow} key={index}>
              <span className={`${styles.chip} ${CHIP_CLASS[tag.tone]}`}>
                <input
                  className={styles.chipInput}
                  value={tag.label}
                  placeholder={t("livery.tagLabel", "Label")}
                  aria-label={t("livery.tagLabel", "Label")}
                  maxLength={LIMITS.tagLabel}
                  onChange={(event) => patchTag(index, { label: event.target.value })}
                />
              </span>
              <span className={styles.tagHref}>
                <LinkIcon />
                <input
                  className={styles.tagHrefInput}
                  value={tag.href ?? ""}
                  placeholder={t("livery.tagHref", "https:// (optional)")}
                  aria-label={t("livery.tagHrefLabel", "Link")}
                  onChange={(event) => patchTag(index, { href: event.target.value })}
                />
              </span>
              <span className={styles.tones}>
                {TONES.map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    title={tone[0] + tone.slice(1).toLowerCase()}
                    aria-label={tone}
                    aria-pressed={tag.tone === tone}
                    className={`${styles.tone} ${TONE_CLASS[tone]} ${
                      tag.tone === tone ? styles.toneOn : ""
                    }`}
                    onClick={() => patchTag(index, { tone })}
                  />
                ))}
              </span>
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={t("livery.removeTag", "Remove tag")}
                onClick={() => setTags(tags.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </div>
          ))}
          {tags.length < LIMITS.tags && (
            <button
              type="button"
              className={styles.addTag}
              onClick={() => setTags([...tags, { label: "", tone: "NEUTRAL" }])}
            >
              {t("livery.addTag", "+ Add tag")}
            </button>
          )}
        </div>
        <div className={styles.hint}>
          {t(
            "livery.tagsHint",
            "Tags carry a tone, not a colour — they adapt to each viewer's theme.",
          )}
        </div>

        <div className={styles.section}>{t("livery.artwork", "Artwork")}</div>
        {askingForCreds && (
          // Only images need this. Everything else on the page is authorised by
          // the connection itself, so the prompt appears where the exception
          // is rather than in front of the whole page.
          <div className={styles.credsPrompt}>
            <div className={styles.credsLead}>
              {t(
                "livery.credsLead",
                "Images are uploaded through the operator API, which needs its address and a token.",
              )}
            </div>
            <input
              className={styles.input}
              placeholder="http://127.0.0.1:8081"
              aria-label={t("livery.address", "Operator API")}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <input
              className={styles.input}
              type="password"
              autoComplete="off"
              placeholder={t("livery.token", "Token")}
              aria-label={t("livery.token", "Token")}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <div className={styles.assetActions}>
              <button
                type="button"
                className={styles.assetBtn}
                disabled={busy || !baseUrl || !token}
                onClick={() =>
                  void run(async () => {
                    await checkOperatorApi({ baseUrl, token });
                    await updatePreferences({ liveryOperatorUrl: baseUrl });
                    const next = askingForCreds;
                    setAskingForCreds(null);
                    next();
                  })
                }
              >
                {t("livery.use", "Use")}
              </button>
              <button
                type="button"
                className={`${styles.assetBtn} ${styles.assetBtnGhost}`}
                onClick={() => setAskingForCreds(null)}
              >
                {t("livery.cancel", "Cancel")}
              </button>
            </div>
            <div className={styles.hint}>
              {t("livery.tokenHint", "Not stored — retyped each session.")}
            </div>
          </div>
        )}
        <div className={styles.assets}>
          <div className={styles.bannerCard}>
            {banner ? (
              <div className={styles.bannerImage}>
                <img
                  src={banner}
                  alt=""
                  style={{
                    objectPosition: `${draft.banner_focus_x ?? 50}% ${draft.banner_focus_y ?? 50}%`,
                  }}
                />
                <span className={styles.sizeChip}>{kib(dataUriBytes(banner))}</span>
              </div>
            ) : (
              <div className={styles.bannerEmpty}>{t("livery.noBanner", "No banner")}</div>
            )}
            <div className={styles.assetBody}>
              <div className={styles.assetHead}>
                <span>{t("livery.banner", "Banner")}</span>
                <span className={styles.assetSpec}>PNG · JPEG · WebP · ≤ 512 KiB</span>
              </div>
              {banner && (
                <div className={styles.focusRow}>
                  <span className={styles.focusLabel}>{t("livery.focusY", "Focus Y")}</span>
                  <input
                    className={styles.focusSlider}
                    type="range"
                    min={0}
                    max={100}
                    aria-label={t("livery.focusY", "Focus Y")}
                    value={draft.banner_focus_y ?? 50}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        banner_focus_y: Number(event.target.value),
                      }))
                    }
                  />
                  <span className={styles.focusValue}>{draft.banner_focus_y ?? 50}</span>
                </div>
              )}
              <div className={styles.assetActions}>
                <input
                  ref={bannerInput}
                  type="file"
                  hidden
                  accept={IMAGE_TYPES.join(",")}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) replaceImage("banner", file);
                  }}
                />
                <button
                  type="button"
                  className={styles.assetBtn}
                  disabled={busy}
                  onClick={() => withCreds(() => bannerInput.current?.click())}
                >
                  {t("livery.replace", "Replace")}
                </button>
                {draft.banner_key && (
                  <button
                    type="button"
                    className={`${styles.assetBtn} ${styles.assetBtnGhost}`}
                    disabled={busy}
                    onClick={() =>
                      withCreds(() =>
                        void run(async () => {
                          await clearLiveryImage(creds, "banner");
                          await load();
                        }),
                      )
                    }
                  >
                    {t("livery.remove", "Remove")}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={styles.iconCard}>
            {icon ? (
              <img className={styles.iconImage} src={icon} alt="" />
            ) : (
              <span className={`${styles.iconImage} ${styles.iconEmpty}`}>
                {name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className={styles.iconLabel}>{t("livery.icon", "Icon")}</div>
            <div className={styles.iconSpec}>≤ 64 KiB</div>
            <input
              ref={iconInput}
              type="file"
              hidden
              accept={IMAGE_TYPES.join(",")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) replaceImage("icon", file);
              }}
            />
            <button
              type="button"
              className={styles.assetBtn}
              disabled={busy}
              onClick={() => withCreds(() => iconInput.current?.click())}
            >
              {t("livery.replace", "Replace")}
            </button>
            {draft.icon_key && (
              <button
                type="button"
                className={`${styles.assetBtn} ${styles.assetBtnGhost}`}
                disabled={busy}
                onClick={() =>
                  withCreds(() =>
                    void run(async () => {
                      await clearLiveryImage(creds, "icon");
                      await load();
                    }),
                  )
                }
              >
                {t("livery.remove", "Remove")}
              </button>
            )}
          </div>
        </div>

        <div className={styles.sectionRow}>
          <span className={styles.sectionTitle}>{t("livery.colours", "App colours")}</span>
          <span className={styles.sectionNote}>
            {t("livery.coloursNote", "optional — banner alone is a common setup")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={coloursOn}
            aria-label={t("livery.colours", "App colours")}
            className={`${styles.toggle} ${coloursOn ? styles.toggleOn : ""}`}
            onClick={() =>
              setDraft((current) =>
                coloursOn
                  ? { ...current, dark: {}, light: {} }
                  : { ...current, dark: { accent: STOCK.dark.accent } },
              )
            }
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        {coloursOn && (
          <>
            <div className={styles.palettes}>
              {(["dark", "light"] as const).map((which) => {
                const entry = draft[which] ?? {};
                const rows: {
                  slot: Slot;
                  label: string;
                  value: string;
                  swatch: string | null;
                }[] = [
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
                  <div className={styles.paletteCard} key={which}>
                    <div className={styles.paletteTitle}>
                      {which === "dark"
                        ? t("livery.darkMode", "Dark mode")
                        : t("livery.lightMode", "Light mode")}
                    </div>
                    <div className={styles.paletteRows}>
                      {rows.map((row) => (
                        <button
                          type="button"
                          className={styles.paletteRow}
                          key={row.slot}
                          onClick={() => {
                            const same = open === row.slot && mode === which;
                            setMode(which);
                            setOpen(same ? null : row.slot);
                          }}
                        >
                          <span
                            className={`${styles.paletteSwatch} ${
                              row.swatch
                                ? row.slot === "surface"
                                  ? styles.paletteSwatchSurface
                                  : ""
                                : styles.paletteSwatchUnset
                            }`}
                            style={row.swatch ? { background: row.swatch } : undefined}
                          />
                          {row.label}
                          <span className={styles.paletteValue}>
                            {row.value || t("livery.stock", "stock")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {open && (
              <div className={styles.editor}>
                <div className={styles.editorHead}>
                  {mode === "dark"
                    ? t("livery.darkMode", "Dark mode")
                    : t("livery.lightMode", "Light mode")}{" "}
                  · {open}
                  <button
                    type="button"
                    className={styles.tagRemove}
                    style={{ marginLeft: "auto" }}
                    aria-label={t("livery.close", "Close")}
                    onClick={() => setOpen(null)}
                  >
                    ×
                  </button>
                </div>
                {(open === "aura"
                  ? (["aura_from", "aura_to"] as const)
                  : ([open] as ("accent" | "surface")[])
                ).map((field) => (
                  <div className={styles.editorField} key={field}>
                    <input
                      type="color"
                      className={styles.editorSwatch}
                      aria-label={field}
                      value={isHexColour(palette[field] ?? "") ? palette[field]! : "#000000"}
                      onChange={(event) => setColour(field, event.target.value)}
                    />
                    <input
                      className={styles.editorHex}
                      placeholder={t("livery.stock", "stock")}
                      aria-label={`${field} hex`}
                      value={palette[field] ?? ""}
                      onChange={(event) => setColour(field, event.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.tagRemove}
                      aria-label={t("livery.clear", "Clear")}
                      onClick={() => setColour(field, "")}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {clamped.length > 0 && (
              <div className={styles.notice}>
                <span className={styles.noticeDot} />
                <span>
                  <span className={styles.noticeLead}>
                    {t("livery.clampLead", "Kept, but lightened for readability:")}
                  </span>{" "}
                  {mode} {clamped.join(", ")} {t("livery.clampRenders", "renders as")}{" "}
                  <span className={styles.noticePair}>
                    <span className={styles.noticeSwatch} style={{ background: storedAccent }} />
                    →
                    <span className={styles.noticeSwatch} style={{ background: shownAccent }} />{" "}
                    {shownAccent}
                  </span>{" "}
                  {t("livery.clampTail", "so text stays legible. The stored value is unchanged.")}
                </span>
              </div>
            )}
          </>
        )}

        {resized && (
          <div className={styles.notice}>
            <span className={styles.noticeDot} />
            <span>{resized}</span>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.saveRow}>
          <button
            type="button"
            className={styles.save}
            disabled={busy || !dirty}
            onClick={() =>
              void run(async () => {
                await writeLiveryOverChannel(patch);
                // The server pushes the new document to every client, this one
                // included, so the reload arrives on its own. Adopting the
                // draft now keeps the form from flickering back in the meantime.
                setSaved(draft);
              })
            }
          >
            {t("livery.save", "Save changes")}
          </button>
          <span className={styles.saveMeta}>
            {t("livery.saveMeta", "Only filled fields are sent")} · {t("livery.version", "version")}{" "}
            {saved.version} · {t("livery.digest", "digest")} {saved.digest || "—"}
          </span>
        </div>
      </div>

      <aside className={styles.preview}>
        <div className={styles.previewHead}>
          <span className={styles.previewEyebrow}>
            {t("livery.previewTitle", "CONNECT PREVIEW")}
          </span>
          <div className={styles.modeSwitch}>
            {(["dark", "light"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.modeTab} ${mode === option ? styles.modeTabOn : ""}`}
                onClick={() => setMode(option)}
              >
                {option === "dark" ? t("livery.dark", "Dark") : t("livery.light", "Light")}
              </button>
            ))}
          </div>
        </div>

        <div
          className={styles.card}
          style={
            {
              "--pv-surface": shownSurface,
              "--pv-text": STOCK[mode].text,
              "--pv-ring": auraFrom ? `${auraFrom}99` : `${shownAccent}99`,
              "--pv-cta": auraFrom ? `linear-gradient(90deg,${auraFrom},${auraTo})` : shownAccent,
              "--pv-aura": auraFrom
                ? `radial-gradient(300px 140px at 50% -4%,${auraFrom}40,transparent 60%)`
                : "none",
            } as React.CSSProperties
          }
        >
          <div className={styles.cardBanner}>
            {banner ? (
              <img
                src={banner}
                alt=""
                style={{
                  objectPosition: `${draft.banner_focus_x ?? 50}% ${draft.banner_focus_y ?? 50}%`,
                }}
              />
            ) : (
              <span className={styles.cardBannerName}>{name}</span>
            )}
            <span className={styles.cardScrim} />
          </div>
          <div className={styles.cardBody}>
            <span className={styles.cardIcon} style={{ background: shownAccent }}>
              {icon ? <img src={icon} alt="" /> : name.slice(0, 1).toUpperCase()}
            </span>
            <div className={styles.cardName}>{name}</div>
            <div className={styles.cardAddress}>{address}</div>
            {draft.tagline && <div className={styles.cardTagline}>{draft.tagline}</div>}
            {tags.some((tag) => tag.label.trim()) && (
              <div className={styles.cardChips}>
                {tags
                  .filter((tag) => tag.label.trim())
                  .map((tag, index) => {
                    const tone = CHIP_PREVIEW[tag.tone];
                    const accent = tag.tone === "ACCENT";
                    return (
                      <span
                        className={styles.cardChip}
                        key={index}
                        style={{
                          background: accent ? `${shownAccent}28` : tone.background,
                          borderColor: accent ? `${shownAccent}66` : tone.border,
                          color: accent ? shownAccent : tone.color,
                        }}
                      >
                        {tag.label}
                      </span>
                    );
                  })}
              </div>
            )}
            {draft.motd && <div className={styles.cardMotd}>{draft.motd}</div>}
            <div className={styles.cardCta}>{t("livery.connectAs", "Connect as")} ZewiWin</div>
          </div>
        </div>

        {mode === "light" && !palette.surface && !palette.aura_from && (
          <p className={styles.previewNote}>
            {t(
              "livery.lightStock",
              "Surface & aura not set for light — viewers get stock colours.",
            )}
          </p>
        )}
      </aside>
    </div>
  );
}

export default LiveryTab;
