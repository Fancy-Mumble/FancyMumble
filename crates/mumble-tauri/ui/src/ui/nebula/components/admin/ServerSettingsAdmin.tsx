import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactElement,
} from "react";
import { Box, Button, MenuItem, Switch, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import * as Flags from "country-flag-icons/react/3x2";
import { useServerSettingsStore } from "@core/features/admin/serverSettingsStore";
import { isRichTextSetting, isWelcomeSetting } from "@core/features/admin/serverSettingKinds";
import { COUNTRIES, countryName } from "@core/utils/countries";
import type { ServerSetting, ServerSettingsEvent } from "@core/types";
import { NEBULA_MONO, radius } from "../../tokens";
import { HtmlSourceField, LinkGuard, RichTextField, Stack } from "../primitives";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { richTextSurvives } from "../primitives/richText";
import { Banner, EmptyState, GroupTitle } from "../settings/controls";
import { AdminPage } from "./controls";

interface FieldProps {
  readonly setting: ServerSetting;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

type FieldComponent = (props: FieldProps) => ReactElement;

const FLAG_REGISTRY = Flags as unknown as Record<
  string,
  ComponentType<{ style?: CSSProperties; title?: string }>
>;

/** The row draws the setting's label, so each control labels only itself. */
const labelOf = (setting: ServerSetting) => setting.label || setting.key;
const originalValue = (setting: ServerSetting) => setting.value ?? "";

function CountryFlag({ code }: Readonly<{ code: string }>) {
  const Svg = code ? FLAG_REGISTRY[code.toUpperCase()] : undefined;
  if (!Svg) return null;
  return (
    <Svg
      style={{ width: 22, height: 16, borderRadius: radius("sm"), objectFit: "cover", flex: "0 0 auto" }}
      title={countryName(code)}
    />
  );
}

function StringField({ setting, value, onChange }: FieldProps) {
  return (
    <TextField
      fullWidth
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { "aria-label": labelOf(setting) } }}
    />
  );
}

function PasswordField({ setting, value, onChange }: FieldProps) {
  return (
    <TextField
      fullWidth
      size="small"
      type="password"
      value={value}
      // A secret is never sent back by the server, so an empty box means
      // "unchanged" rather than "empty" - the placeholder says which.
      placeholder={setting.secret ? "•••••••• (unchanged)" : ""}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        htmlInput: { "aria-label": labelOf(setting), autoComplete: "new-password" },
      }}
    />
  );
}

function CodeField({ setting, value, onChange }: FieldProps) {
  return (
    <TextField
      fullWidth
      multiline
      minRows={8}
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        htmlInput: { "aria-label": labelOf(setting), spellCheck: false, style: { fontFamily: NEBULA_MONO } },
      }}
    />
  );
}

/**
 * How long a welcome text may get.
 *
 * Every connecting client is sent this in its `ServerSync`, so it is paid for
 * on every join rather than once - generous enough for a page of house rules,
 * short enough that it is not where somebody pastes a picture. The editor
 * offers no image button for the same reason.
 */
const HTML_MAX_LENGTH = 16_000;

/**
 * A setting whose value is markup, in the two ways markup gets edited.
 *
 * **Rich text** is the same editor Nebula writes bios and channel descriptions
 * with, widened to the document preset - a welcome screen has headings, lists
 * and centred text, and the bio schema silently dropped all three.
 *
 * **HTML** is the source, and it is not a power-user affordance: an editor is a
 * schema, and a document it has no node for comes back out of it *smaller*. A
 * welcome text written by hand years ago can hold markup no WYSIWYG here can
 * represent, and offering only the editor would flatten it the first time
 * somebody fixed a typo - silently, in a field showing what looked like their
 * own document. So the source view is where such a value opens, and says why.
 *
 * The check runs against the value the server sent rather than against what is
 * being typed: an operator who chose rich text keeps it, and one editing source
 * is not thrown into the editor the moment their markup happens to simplify.
 */
/** The three ways to look at a markup setting. */
type HtmlMode = "rich" | "source" | "preview";

function HtmlField({ setting, value, onChange }: FieldProps) {
  const { t } = useTranslation("settings");
  const original = originalValue(setting);
  const survives = useMemo(() => richTextSurvives(original, "document"), [original]);
  const [mode, setMode] = useState<HtmlMode>(survives ? "rich" : "source");

  const lossy = t("serverSettings.richTextLossy");
  // A document the editor cannot hold falls back to source however the mode
  // was left, so nothing can put an operator in front of a lossy copy.
  const shown: HtmlMode = mode === "rich" && !survives ? "source" : mode;

  return (
    <Stack gap={0.75}>
      <Stack direction="row" gap={0.5} sx={{ alignSelf: "flex-end" }}>
        <ModeButton
          on={shown === "rich"}
          // Not merely unselected: choosing it would rewrite the document, and
          // an operator cannot be expected to know that from a toolbar.
          disabled={!survives}
          title={survives ? undefined : lossy}
          onClick={() => setMode("rich")}
        >
          {t("serverSettings.modeRich")}
        </ModeButton>
        <ModeButton on={shown === "source"} onClick={() => setMode("source")}>
          {t("serverSettings.modeSource")}
        </ModeButton>
        <ModeButton on={shown === "preview"} onClick={() => setMode("preview")}>
          {t("serverSettings.modePreview")}
        </ModeButton>
      </Stack>

      {shown === "rich" && (
        <RichTextField
          value={value}
          onChange={onChange}
          ariaLabel={labelOf(setting)}
          preset="document"
          maxLength={HTML_MAX_LENGTH}
          tools={["bold", "italic", "underline", "strike", "heading", "lists", "align", "colour"]}
          minHeight={160}
          maxHeight={420}
        />
      )}
      {shown === "source" && (
        <HtmlSourceField value={value} onChange={onChange} ariaLabel={labelOf(setting)} />
      )}
      {shown === "preview" && <HtmlPreview html={value} label={labelOf(setting)} />}

      {!survives && shown !== "preview" && (
        <Typography sx={(theme) => ({ fontSize: 11, lineHeight: 1.5, color: theme.palette.nebula.muted })}>
          {lossy}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * The markup as a connecting client will see it.
 *
 * Rendered through the same allow-list every surface in this app renders
 * untrusted HTML through, so this is not an approximation of the welcome
 * screen - it *is* what will be shown, and anything the sanitiser drops is
 * missing here too, which is worth learning before saving rather than after.
 *
 * It earns its place most where the editor cannot go: a document laid out with
 * tables is edited as source, and reading angle brackets is no way to tell
 * whether a change landed where it was meant to.
 */
function HtmlPreview({ html, label }: Readonly<{ html: string; label: string }>) {
  const { t } = useTranslation("settings");
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  return (
    <Box
      aria-label={t("serverSettings.previewOf", { label })}
      sx={(theme) => ({
        minHeight: 160,
        maxHeight: 420,
        overflowY: "auto",
        p: "13px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        fontSize: 12.5,
        lineHeight: 1.5,
        wordBreak: "break-word",
        "& a": { color: theme.palette.nebula.accent },
        "& img": { maxWidth: "100%" },
        "& table": { borderCollapse: "collapse" },
      })}
    >
      {clean ? (
        // A click here must not navigate the app's own window to the server's
        // link, which is what the guard is for wherever this markup is shown.
        <LinkGuard>
          <Box dangerouslySetInnerHTML={{ __html: clean }} />
        </LinkGuard>
      ) : (
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {t("serverSettings.previewEmpty")}
        </Typography>
      )}
    </Box>
  );
}

/** One of the two editing modes, drawn as a small segmented control. */
function ModeButton({
  on,
  disabled = false,
  title,
  onClick,
  children,
}: Readonly<{
  on: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        px: "8px",
        py: "2px",
        borderRadius: radius("sm"),
        fontSize: 11,
        fontWeight: 600,
        color: on ? theme.palette.nebula.accent : theme.palette.nebula.muted,
        background: on ? theme.palette.nebula.accentSoft : "transparent",
        "&:disabled": { cursor: "not-allowed", color: theme.palette.nebula.dim },
        "&:hover:not(:disabled)": {
          color: on ? theme.palette.nebula.accent : theme.palette.nebula.text,
        },
        "&:focus-visible": {
          outline: `2px solid ${theme.palette.nebula.accentLine}`,
          outlineOffset: 1,
        },
      })}
    >
      {children}
    </Box>
  );
}

function BoolField({ setting, value, onChange }: FieldProps) {
  const checked = value === "true" || value === "1";
  return (
    <Switch
      checked={checked}
      onChange={() => onChange(checked ? "false" : "true")}
      slotProps={{ input: { "aria-label": labelOf(setting) } }}
    />
  );
}

function IntField({ setting, value, onChange }: FieldProps) {
  return (
    <TextField
      fullWidth
      size="small"
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { "aria-label": labelOf(setting) } }}
    />
  );
}

function EnumField({ setting, value, onChange }: FieldProps) {
  return (
    <TextField
      select
      fullWidth
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { "aria-label": labelOf(setting) } }}
    >
      {/* A value the server sent that is not in its own option list is still
          the current value; dropping it would silently rewrite the setting. */}
      {!setting.options.includes(value) && value !== "" && <MenuItem value={value}>{value}</MenuItem>}
      {setting.options.map((option) => (
        <MenuItem key={option} value={option}>
          {option}
        </MenuItem>
      ))}
    </TextField>
  );
}

function CountryField({ setting, value, onChange }: FieldProps) {
  const lower = value.toLowerCase();
  const known = COUNTRIES.some((country) => country.code === lower);
  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <CountryFlag code={value} />
      <TextField
        select
        fullWidth
        size="small"
        value={lower}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { "aria-label": labelOf(setting) } }}
      >
        <MenuItem value="">-</MenuItem>
        {!known && value !== "" && <MenuItem value={lower}>{value}</MenuItem>}
        {COUNTRIES.map((country) => (
          <MenuItem key={country.code} value={country.code}>
            {country.name}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

/** Maps a setting's declared `type` onto the control that edits it. */
const FIELD_FACTORY: Record<string, FieldComponent> = {
  string: StringField,
  text: CodeField,
  html: HtmlField,
  bool: BoolField,
  int: IntField,
  enum: EnumField,
  country: CountryField,
  password: PasswordField,
};

/**
 * The control for one setting.
 *
 * Keyed on the declared type, except that a server which says only "text" for a
 * value that has always been markup still gets the editor - see
 * `isRichTextSetting`. An unknown type falls back to a text box rather than
 * vanishing, so a setting added server-side appears without a client release.
 */
function fieldFor(setting: ServerSetting): FieldComponent {
  if (isRichTextSetting(setting)) return HtmlField;
  return FIELD_FACTORY[setting.type] ?? StringField;
}

/**
 * The way out of this box, for a greeting that wants to be more than one text.
 *
 * This field is one string, sent to everybody who connects. The Welcome message
 * editor draws greetings that turn on who is arriving - client version, whether
 * they have an account, how long they have had one - and lays them out as a
 * screen rather than a paragraph; whenever one of those matches, it is sent
 * *instead* of this text, which is the half an operator cannot guess from here.
 *
 * It is said next to the field rather than left to the sidebar because this is
 * where somebody who wants a better welcome message goes looking, and a page
 * they never open cannot tell them it exists.
 */
function WelcomeEditorHint({ onOpen }: Readonly<{ onOpen: () => void }>) {
  const { t } = useTranslation("settings");
  return (
    <Banner tone="info" title={t("serverSettings.welcomeEditorTitle")}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
        <Box sx={{ minWidth: 0 }}>{t("serverSettings.welcomeEditorHint")}</Box>
        <Button
          size="small"
          variant="text"
          onClick={onOpen}
          sx={{ flex: "0 0 auto", fontSize: 11.5, whiteSpace: "nowrap" }}
        >
          {t("serverSettings.welcomeEditorOpen")}
        </Button>
      </Stack>
    </Banner>
  );
}

/**
 * Server settings.
 *
 * The form is built from the schema the server advertises rather than written
 * out here, so a setting added server-side appears without a client release; an
 * unknown type falls back to a text box rather than vanishing.
 *
 * Only changed settings are sent. That matters most for secrets, which the
 * server never sends back - treating a blank box as a new value would clear
 * every password on the page on the first save.
 */
export function ServerSettingsAdmin({
  /**
   * Opens the Welcome message editor, when this operator has that page.
   *
   * Absent rather than disabled where they do not: a pointer to a page that
   * would bounce them back to Users is worse than no pointer at all.
   */
  onOpenWelcomeEditor,
}: Readonly<{ onOpenWelcomeEditor?: () => void }> = {}) {
  const { t } = useTranslation("settings");
  const snapshot = useServerSettingsStore((state) => state.snapshot);
  const busy = useServerSettingsStore((state) => state.busy);
  const save = useServerSettingsStore((state) => state.save);
  const load = useServerSettingsStore((state) => state.load);
  const setSnapshot = useServerSettingsStore((state) => state.setSnapshot);
  const loadError = useServerSettingsStore((state) => state.error);

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void load().finally(() => setLoaded(true));
    const off = listen<ServerSettingsEvent>("server-settings", (event) =>
      setSnapshot(event.payload.settings),
    );
    return () => {
      void off.then((stop) => stop());
    };
  }, [load, setSnapshot]);

  // A fresh snapshot - the server's re-broadcast after a save, or another
  // admin's change - supersedes anything typed against the old one.
  const revision = snapshot?.revision ?? -1;
  useEffect(() => setEdits({}), [revision]);

  const groups = useMemo(() => {
    const map = new Map<string, ServerSetting[]>();
    for (const setting of snapshot?.settings ?? []) {
      const list = map.get(setting.group) ?? [];
      list.push(setting);
      map.set(setting.group, list);
    }
    return [...map.entries()];
  }, [snapshot]);

  const changed: ServerSetting[] = (snapshot?.settings ?? [])
    .filter((setting) => {
      if (!(setting.key in edits)) return false;
      const value = edits[setting.key] ?? "";
      // A secret is only "changed" when something was actually typed.
      if (setting.secret) return value.length > 0;
      return value !== originalValue(setting);
    })
    .map((setting) => ({ ...setting, value: edits[setting.key] ?? "" }));

  const onSave = async () => {
    setError(null);
    try {
      await save(changed);
      setEdits({});
      setSavedAt(Date.now());
    } catch (e) {
      setError(String(e));
    }
  };

  if (!snapshot) {
    return (
      <AdminPage title={t("adminTabs.serverSettings", { defaultValue: "Server settings" })}>
        {loaded && loadError && <Banner tone="danger">{loadError}</Banner>}
        <EmptyState>
          {loaded
            ? t("serverSettings.unavailable", {
                defaultValue:
                  "Server settings aren't available. This server may not support runtime settings, or you may not have permission to change them.",
              })
            : t("serverSettings.loading", { defaultValue: "Loading server settings…" })}
        </EmptyState>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title={t("adminTabs.serverSettings", { defaultValue: "Server settings" })}
      hint={t("serverSettings.intro", {
        defaultValue:
          "Change server settings at runtime. Changes apply immediately and are saved on the server.",
      })}
      toolbar={
        <>
          {!error && savedAt > 0 && changed.length === 0 && (
            <Typography
              sx={(theme) => ({ alignSelf: "center", fontSize: 11, color: theme.palette.nebula.ok })}
            >
              {t("serverSettings.saved", { defaultValue: "Saved" })}
            </Typography>
          )}
          <Button
            size="small"
            variant="contained"
            disabled={busy || changed.length === 0}
            onClick={() => void onSave()}
          >
            {busy
              ? t("serverSettings.saving", { defaultValue: "Saving…" })
              : t("serverSettings.save", { defaultValue: "Save changes" })}
            {changed.length > 0 ? ` (${changed.length})` : ""}
          </Button>
        </>
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}

      {groups.map(([group, items]) => (
        <Box key={group}>
          <GroupTitle>{group}</GroupTitle>
          <Stack gap={1.5}>
            {items.map((setting) => {
              const Field = fieldFor(setting);
              return (
                <Stack
                  key={setting.key}
                  direction="row"
                  alignItems="flex-start"
                  gap={2}
                  sx={(theme) => ({
                    py: "10px",
                    borderBottom: `1px solid ${theme.palette.nebula.line}`,
                  })}
                >
                  <Box sx={{ flex: "0 0 240px", minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                      {setting.label || setting.key}
                    </Typography>
                    {setting.help && (
                      <Typography
                        sx={(theme) => ({
                          mt: "3px",
                          fontSize: 11,
                          lineHeight: 1.5,
                          color: theme.palette.nebula.muted,
                        })}
                      >
                        {setting.help}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Field
                      setting={setting}
                      value={edits[setting.key] ?? originalValue(setting)}
                      onChange={(value) => setEdits((prev) => ({ ...prev, [setting.key]: value }))}
                    />
                    {onOpenWelcomeEditor && isWelcomeSetting(setting) && (
                      <WelcomeEditorHint onOpen={onOpenWelcomeEditor} />
                    )}
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        </Box>
      ))}
    </AdminPage>
  );
}
