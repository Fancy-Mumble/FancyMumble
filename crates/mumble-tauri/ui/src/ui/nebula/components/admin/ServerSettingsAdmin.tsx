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
import { COUNTRIES, countryName } from "@core/utils/countries";
import type { ServerSetting, ServerSettingsEvent } from "@core/types";
import { NEBULA_MONO, radius } from "../../tokens";
import { Stack } from "../primitives";
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
  bool: BoolField,
  int: IntField,
  enum: EnumField,
  country: CountryField,
  password: PasswordField,
};

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
export function ServerSettingsAdmin() {
  const { t } = useTranslation("settings");
  const snapshot = useServerSettingsStore((state) => state.snapshot);
  const busy = useServerSettingsStore((state) => state.busy);
  const save = useServerSettingsStore((state) => state.save);
  const load = useServerSettingsStore((state) => state.load);
  const setSnapshot = useServerSettingsStore((state) => state.setSnapshot);

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
              const Field = FIELD_FACTORY[setting.type] ?? StringField;
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
