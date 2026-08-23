/**
 * Livery admin tab: what this server says it looks like.
 *
 * # Why it is shaped like this
 *
 * The connect screen it edits is a *ladder*, not a switch. Most servers set a
 * few fields; very few set all of them. So every control here stands alone, the
 * form is never "incomplete", and the preview beside it shows exactly what the
 * current subset produces - including the unbranded case, which is a real
 * outcome rather than an empty state.
 *
 * The preview is the point of the page. A palette is the one part of the
 * document whose stored value and rendered value can differ, because clients
 * enforce a contrast floor, and an operator who cannot see that their `#0b0b0b`
 * came back legible discovers it from a support thread instead. The server's
 * own `?mode=` preview is what fills in the clamp notes, so the number the
 * operator is shown is the number the client will use.
 *
 * # Transport
 *
 * Everything goes through Tauri proxy commands rather than `fetch`: the
 * operator API is a different origin and the bearer must not live in the page.
 * The same reasoning as the file-server dashboard next door.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { SelectInput, TextArea, TextInput } from "../../components/elements/TextInput";
import {
  IMAGE_TYPES,
  LIMITS,
  TONES,
  checkOperatorApi,
  clearLiveryImage,
  diffLivery,
  isHexColour,
  liveryImage,
  previewLivery,
  readLivery,
  uploadLiveryImage,
  writeLivery,
  type LiveryDocument,
  type LiveryPalette,
  type LiveryPreview,
  type LiveryTag,
  type LiveryTone,
  type OperatorCreds,
} from "./liveryAdmin";
import styles from "./LiveryTab.module.css";

/** A colour the preview falls back to when the operator has named none. */
const FALLBACK = {
  dark: { surface: "#141d33", accent: "#41b4f9", text: "#f1f5ff" },
  light: { surface: "#fdfbf6", accent: "#1691dc", text: "#252a3c" },
} as const;

type Mode = "dark" | "light";

const EMPTY: LiveryDocument = { version: 0, digest: "" };

/** A label, its hint, and the control it names. */
function Row({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>
        {label}
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

/** How much of a capped field is left. Silent until it is worth knowing. */
function Count({ value, limit }: { readonly value: string; readonly limit: number }) {
  // Counted in code points, as the server counts characters rather than bytes,
  // so an operator writing in Japanese is not told they have used three times
  // what they have.
  const used = [...value].length;
  if (used < limit * 0.75) return null;
  return (
    <span className={used > limit ? `${styles.count} ${styles.countOver}` : styles.count}>
      {used} / {limit}
    </span>
  );
}

/** A `#rrggbb` field: a swatch, a text box, and what the clamp did to it. */
function ColourField({
  label,
  value,
  onChange,
  clampedTo,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly clampedTo?: string;
}) {
  const valid = value === "" || isHexColour(value);
  return (
    <Row label={label}>
      <div className={styles.swatchRow}>
        <input
          type="color"
          className={styles.swatch}
          aria-label={`${label} colour`}
          value={isHexColour(value) ? value : "#000000"}
          onChange={(event) => onChange(event.target.value)}
        />
        <TextInput
          mono
          size="small"
          placeholder="unset"
          aria-label={label}
          invalid={!valid}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {value !== "" && (
          <button type="button" className={styles.iconBtn} onClick={() => onChange("")}>
            ×
          </button>
        )}
      </div>
      {!valid && (
        <span className={`${styles.hint} ${styles.countOver}`}>
          Six hex digits, like #8a90ff. Anything else is refused.
        </span>
      )}
      {clampedTo && (
        // Information, not an error: the value was accepted and stored. What
        // changed is what gets painted.
        <span className={styles.clamped}>
          <span className={styles.clampedSwatch} style={{ background: clampedTo }} />
          Clients will lighten this to {clampedTo} so it stays legible on the surface behind it.
        </span>
      )}
    </Row>
  );
}

export function LiveryTab() {
  const { t } = useTranslation("settings");

  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);

  const [saved, setSaved] = useState<LiveryDocument>(EMPTY);
  const [draft, setDraft] = useState<LiveryDocument>(EMPTY);
  const [banner, setBanner] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [preview, setPreview] = useState<LiveryPreview | null>(null);

  const [mode, setMode] = useState<Mode>("dark");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "ok" | "error" | "plain" } | null>(
    null,
  );

  const bannerInput = useRef<HTMLInputElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  const creds: OperatorCreds = useMemo(() => ({ baseUrl, token }), [baseUrl, token]);
  const patch = useMemo(() => diffLivery(saved, draft), [saved, draft]);
  const dirty = Object.keys(patch).length > 0;

  // The address is remembered; the token is not. It is a credential with no
  // expiry, and writing it to the preferences file would leave it there long
  // after the person who typed it stopped being an operator.
  useEffect(() => {
    void getPreferences()
      .then((prefs) => setBaseUrl(prefs.liveryOperatorUrl ?? ""))
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (next: OperatorCreds) => {
      setBusy(true);
      try {
        const document = await readLivery(next);
        setSaved(document);
        setDraft(document);
        const [bannerSrc, iconSrc] = await Promise.all([
          document.banner_key ? liveryImage(next, "banner") : Promise.resolve(null),
          document.icon_key ? liveryImage(next, "icon") : Promise.resolve(null),
        ]);
        setBanner(bannerSrc);
        setIcon(iconSrc);
        setConnected(true);
        setStatus(null);
      } catch (reason) {
        setConnected(false);
        setStatus({ text: String(reason), kind: "error" });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Re-read the clamp whenever a colour or the mode changes, so what the page
  // promises and what a client paints cannot drift apart while editing.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void previewLivery(creds, mode)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, creds, mode, saved]);

  const connect = async () => {
    setBusy(true);
    try {
      const message = await checkOperatorApi(creds);
      await updatePreferences({ liveryOperatorUrl: baseUrl });
      await load(creds);
      setStatus({ text: message, kind: "ok" });
    } catch (reason) {
      setConnected(false);
      setStatus({ text: String(reason), kind: "error" });
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await writeLivery(creds, patch);
      await load(creds);
      setStatus({ text: "Saved. Connected clients repaint immediately.", kind: "ok" });
    } catch (reason) {
      // The operator API names the field and the rule it broke; showing that
      // verbatim is the whole reason the proxy passes it through.
      setStatus({ text: String(reason), kind: "error" });
      setBusy(false);
    }
  };

  const pickImage = async (which: "banner" | "icon", file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await uploadLiveryImage(creds, which, bytes);
      await load(creds);
      setStatus({ text: `${which === "banner" ? "Banner" : "Mark"} replaced.`, kind: "ok" });
    } catch (reason) {
      setStatus({ text: String(reason), kind: "error" });
      setBusy(false);
    }
  };

  const dropImage = async (which: "banner" | "icon") => {
    setBusy(true);
    try {
      await clearLiveryImage(creds, which);
      await load(creds);
      setStatus({ text: `${which === "banner" ? "Banner" : "Mark"} removed.`, kind: "ok" });
    } catch (reason) {
      setStatus({ text: String(reason), kind: "error" });
      setBusy(false);
    }
  };

  const palette: LiveryPalette = draft[mode] ?? {};
  const setPalette = (field: keyof LiveryPalette, value: string) =>
    setDraft((current) => {
      const next = { ...(current[mode] ?? {}) };
      if (value === "") delete next[field];
      else next[field] = value;
      return { ...current, [mode]: next };
    });

  const tags = draft.tags ?? [];
  const setTags = (next: LiveryTag[]) => setDraft((current) => ({ ...current, tags: next }));

  const clampedTo = (field: string) =>
    preview?.clamped.includes(field) ? preview.palette?.[field as keyof LiveryPalette] : undefined;

  const shown = {
    surface: isHexColour(palette.surface ?? "") ? palette.surface! : FALLBACK[mode].surface,
    // The clamped value, not the stored one: this preview exists to show what
    // will actually be painted.
    accent:
      preview?.palette?.accent && isHexColour(preview.palette.accent)
        ? preview.palette.accent
        : isHexColour(palette.accent ?? "")
          ? palette.accent!
          : FALLBACK[mode].accent,
    text: FALLBACK[mode].text,
  };

  const name = draft.display_name?.trim() || "your.server";

  return (
    <div className={styles.layout}>
      <div className={styles.panel}>
        <p className={styles.intro}>
          {t(
            "livery.intro",
            "What this server looks like on the connect screen. Every field is optional and each one stands alone: a server that sets only a tagline gets exactly that. Changes reach connected clients immediately.",
          )}
        </p>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t("livery.connection", "Operator API")}</h3>
          <Row
            label={t("livery.address", "Address")}
            hint={t("livery.addressHint", "Where the operator API listens. Remembered between sessions.")}
          >
            <TextInput
              mono
              placeholder="http://127.0.0.1:8081"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Row>
          <Row
            label={t("livery.token", "Token")}
            hint={t(
              "livery.tokenHint",
              "Needs the server-config scope. Never stored — retype it each session.",
            )}
          >
            <TextInput
              type="password"
              mono
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Row>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={busy || !baseUrl || !token}
              onClick={() => void connect()}
            >
              {connected ? t("livery.reload", "Reload") : t("livery.connect", "Connect")}
            </button>
          </div>
          {status && (
            <div
              className={`${styles.status} ${
                status.kind === "error"
                  ? styles.statusError
                  : status.kind === "ok"
                    ? styles.statusOk
                    : ""
              }`}
              role={status.kind === "error" ? "alert" : "status"}
            >
              {status.text}
            </div>
          )}
        </section>

        {connected && (
          <>
            <section className={styles.group}>
              <h3 className={styles.groupTitle}>{t("livery.identity", "Identity")}</h3>
              <Row
                label={t("livery.displayName", "Display name")}
                hint={t(
                  "livery.displayNameHint",
                  "Stands in for the host in headings. The address clients show beside it never changes.",
                )}
              >
                <TextInput
                  value={draft.display_name ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, display_name: event.target.value }))
                  }
                />
                <Count value={draft.display_name ?? ""} limit={LIMITS.displayName} />
              </Row>
              <Row label={t("livery.tagline", "Tagline")} hint={t("livery.taglineHint", "One line under the name.")}>
                <TextInput
                  value={draft.tagline ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, tagline: event.target.value }))
                  }
                />
                <Count value={draft.tagline ?? ""} limit={LIMITS.tagline} />
              </Row>
              <Row
                label={t("livery.motd", "Message")}
                hint={t("livery.motdHint", "Plain text. Markup is not supported and is shown as typed.")}
              >
                <TextArea
                  rows={3}
                  value={draft.motd ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, motd: event.target.value }))
                  }
                />
                <Count value={draft.motd ?? ""} limit={LIMITS.motd} />
              </Row>
              <Row
                label={t("livery.rulesUrl", "Rules link")}
                hint={t("livery.rulesUrlHint", "https:// only.")}
              >
                <TextInput
                  mono
                  placeholder="https://"
                  value={draft.rules_url ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, rules_url: event.target.value }))
                  }
                />
              </Row>
            </section>

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>{t("livery.artwork", "Artwork")}</h3>
              <Row
                label={t("livery.banner", "Banner")}
                hint={t("livery.bannerHint", "PNG, JPEG or WebP, up to 512 KiB. Saved immediately.")}
              >
                <div className={styles.assetRow}>
                  {banner ? (
                    <img className={styles.assetPreview} src={banner} alt="" />
                  ) : (
                    <div className={`${styles.assetPreview} ${styles.assetEmpty}`}>
                      {t("livery.noBanner", "No banner")}
                    </div>
                  )}
                  <div className={styles.assetActions}>
                    <input
                      ref={bannerInput}
                      type="file"
                      hidden
                      accept={IMAGE_TYPES.join(",")}
                      onChange={(event) => void pickImage("banner", event.target.files?.[0])}
                    />
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={busy}
                      onClick={() => bannerInput.current?.click()}
                    >
                      {t("livery.choose", "Choose…")}
                    </button>
                    {draft.banner_key && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnDanger}`}
                        disabled={busy}
                        onClick={() => void dropImage("banner")}
                      >
                        {t("livery.remove", "Remove")}
                      </button>
                    )}
                  </div>
                </div>
              </Row>

              {draft.banner_key && (
                <Row
                  label={t("livery.focus", "Banner focus")}
                  hint={t("livery.focusHint", "Where to anchor the image when it has to crop.")}
                >
                  <div className={styles.swatchRow}>
                    {(["banner_focus_x", "banner_focus_y"] as const).map((axis) => (
                      <label key={axis} className={styles.clamped}>
                        {axis.endsWith("x") ? "X" : "Y"}
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={draft[axis] ?? 50}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [axis]: Number(event.target.value),
                            }))
                          }
                        />
                        {draft[axis] ?? 50}%
                      </label>
                    ))}
                  </div>
                </Row>
              )}

              <Row
                label={t("livery.icon", "Mark")}
                hint={t("livery.iconHint", "Square. Up to 64 KiB. Saved immediately.")}
              >
                <div className={styles.assetRow}>
                  {icon ? (
                    <img
                      className={`${styles.assetPreview} ${styles.assetPreviewSquare}`}
                      src={icon}
                      alt=""
                    />
                  ) : (
                    <div
                      className={`${styles.assetPreview} ${styles.assetPreviewSquare} ${styles.assetEmpty}`}
                    >
                      {t("livery.noIcon", "None")}
                    </div>
                  )}
                  <div className={styles.assetActions}>
                    <input
                      ref={iconInput}
                      type="file"
                      hidden
                      accept={IMAGE_TYPES.join(",")}
                      onChange={(event) => void pickImage("icon", event.target.files?.[0])}
                    />
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={busy}
                      onClick={() => iconInput.current?.click()}
                    >
                      {t("livery.choose", "Choose…")}
                    </button>
                    {draft.icon_key && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnDanger}`}
                        disabled={busy}
                        onClick={() => void dropImage("icon")}
                      >
                        {t("livery.remove", "Remove")}
                      </button>
                    )}
                  </div>
                </div>
              </Row>
            </section>

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>
                {t("livery.tags", "Chips")} ({tags.length}/{LIMITS.tags})
              </h3>
              <p className={styles.intro}>
                {t(
                  "livery.tagsIntro",
                  "Shown beside the live user count. Toned rather than coloured, so they suit whichever theme the viewer picked.",
                )}
              </p>
              <div className={styles.tagList}>
                {tags.map((tag, index) => (
                  // Keyed by index, which is safe because every input below is
                  // controlled: removing a chip re-renders the ones after it
                  // with their own values rather than leaving stale DOM state.
                  <div className={styles.tagRow} key={index}>
                    <TextInput
                      size="small"
                      placeholder={t("livery.tagLabel", "Label")}
                      value={tag.label}
                      onChange={(event) =>
                        setTags(
                          tags.map((entry, at) =>
                            at === index ? { ...entry, label: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <SelectInput
                      size="small"
                      value={tag.tone}
                      onChange={(event) =>
                        setTags(
                          tags.map((entry, at) =>
                            at === index
                              ? { ...entry, tone: event.target.value as LiveryTone }
                              : entry,
                          ),
                        )
                      }
                    >
                      {TONES.map((tone) => (
                        <option key={tone} value={tone}>
                          {tone.toLowerCase()}
                        </option>
                      ))}
                    </SelectInput>
                    <TextInput
                      size="small"
                      mono
                      placeholder="https:// (optional)"
                      value={tag.href ?? ""}
                      onChange={(event) =>
                        setTags(
                          tags.map((entry, at) =>
                            at === index ? { ...entry, href: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={t("livery.removeTag", "Remove chip")}
                      onClick={() => setTags(tags.filter((_, at) => at !== index))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {tags.length < LIMITS.tags && (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => setTags([...tags, { label: "", tone: "NEUTRAL" }])}
                  >
                    {t("livery.addTag", "Add chip")}
                  </button>
                </div>
              )}
            </section>

            <section className={styles.group}>
              <h3 className={styles.groupTitle}>
                {t("livery.colours", "Colours")} — {mode}
              </h3>
              <p className={styles.intro}>
                {t(
                  "livery.coloursIntro",
                  "Set separately for each theme, because viewers choose light or dark, not the server. Anything left unset keeps the client's own colour.",
                )}
              </p>
              <ColourField
                label={t("livery.accent", "Accent")}
                value={palette.accent ?? ""}
                onChange={(next) => setPalette("accent", next)}
                clampedTo={clampedTo("accent")}
              />
              <ColourField
                label={t("livery.surface", "Surface")}
                value={palette.surface ?? ""}
                onChange={(next) => setPalette("surface", next)}
              />
              <ColourField
                label={t("livery.auraFrom", "Glow from")}
                value={palette.aura_from ?? ""}
                onChange={(next) => setPalette("aura_from", next)}
                clampedTo={clampedTo("aura_from")}
              />
              <ColourField
                label={t("livery.auraTo", "Glow to")}
                value={palette.aura_to ?? ""}
                onChange={(next) => setPalette("aura_to", next)}
                clampedTo={clampedTo("aura_to")}
              />
            </section>

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={busy || !dirty}
                onClick={() => void save()}
              >
                {dirty
                  ? `${t("livery.save", "Save")} (${Object.keys(patch).length})`
                  : t("livery.saved", "Saved")}
              </button>
              <button
                type="button"
                className={styles.btn}
                disabled={busy || !dirty}
                onClick={() => setDraft(saved)}
              >
                {t("livery.revert", "Revert")}
              </button>
              <span className={styles.spacer} />
              <span className={styles.count}>
                {t("livery.version", "version")} {saved.version}
              </span>
            </div>
          </>
        )}
      </div>

      {connected && (
        <aside className={styles.preview}>
          <div className={styles.previewHead}>
            <span className={styles.previewTitle}>{t("livery.preview", "Connect screen")}</span>
            <div className={styles.modeSwitch}>
              {(["dark", "light"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={
                    mode === option ? `${styles.modeButton} ${styles.modeButtonOn}` : styles.modeButton
                  }
                  onClick={() => setMode(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div
            className={styles.card}
            style={
              {
                "--livery-surface": shown.surface,
                "--livery-accent": shown.accent,
                "--livery-text": shown.text,
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
              <div className={styles.cardIcon} style={{ background: shown.accent }}>
                {icon ? <img src={icon} alt="" /> : name.slice(0, 1).toUpperCase()}
              </div>
              <div className={styles.cardName}>{name}</div>
              {draft.tagline && <div className={styles.cardTagline}>{draft.tagline}</div>}
              <div className={styles.cardChips}>
                <span className={styles.cardChip}>3/101 online</span>
                <span className={styles.cardChip}>14 ms</span>
                {tags
                  .filter((tag) => tag.label.trim())
                  .map((tag, index) => (
                    <span
                      className={styles.cardChip}
                      key={index}
                      style={tag.tone === "ACCENT" ? { color: shown.accent } : undefined}
                    >
                      {tag.label}
                    </span>
                  ))}
              </div>
              {draft.motd && <div className={styles.cardMotd}>{draft.motd}</div>}
              <div className={styles.cardCta}>Connect</div>
              <span className={styles.cardAddress}>mumble://your.server:64738</span>
            </div>
          </div>

          <p className={styles.previewNote}>
            {t(
              "livery.previewNote",
              "The address is drawn in the app's own colours on every server, so branding can never dress the part a person reads to decide whether to trust a connection.",
            )}
          </p>
          {preview && preview.clamped.length > 0 && (
            <p className={styles.previewNote}>
              {t("livery.clampNote", "Adjusted for legibility:")} {preview.clamped.join(", ")}.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}

export default LiveryTab;
