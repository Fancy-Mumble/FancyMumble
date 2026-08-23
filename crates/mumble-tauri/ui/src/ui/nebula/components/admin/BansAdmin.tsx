import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Box, Button, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BanEntry } from "@core/types";
import { Field, SettingsCard } from "../settings/controls";
import { Stack } from "../primitives";
import { AdminPage, DetailPlaceholder, ListRow, SplitView } from "./controls";

const EMPTY_BAN: BanEntry = {
  address: "",
  mask: 32,
  name: "",
  hash: "",
  reason: "",
  start: "",
  duration: 0,
};

/**
 * The ban list.
 *
 * The whole list is sent back on save, which is what the server's
 * `update_ban_list` expects - so edits accumulate locally and "Save changes"
 * appears only once something has actually changed, rather than the page
 * writing on every keystroke and racing itself.
 */
export function BansAdmin() {
  const { t } = useTranslation("settings");
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<BanEntry | null>(null);
  const [dirty, setDirty] = useState(false);

  // The listener must be registered before the request goes out: `listen()` is
  // an async IPC round trip and a local server can answer faster than an
  // un-awaited registration commits. Tauri does not replay events to late
  // subscribers, so losing that race leaves the page loading for ever.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const off = await listen<BanEntry[]>("ban-list", (event) => {
        setBans(event.payload);
        setLoading(false);
        setSelected(null);
        setEditing(null);
        setDirty(false);
      });
      if (cancelled) return off();
      unlisten = off;
      setLoading(true);
      invoke("request_ban_list").catch(() => setLoading(false));
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    invoke("request_ban_list").catch(() => setLoading(false));
  }, []);

  const patch = (changes: Partial<BanEntry>) => {
    setEditing((prev) => (prev ? { ...prev, ...changes } : prev));
    setDirty(true);
  };

  // The list row shows the edited values, so the pane the user is not looking
  // at cannot disagree with the one they are.
  const commit = () => {
    if (selected == null || !editing) return;
    setBans((prev) => prev.map((ban, index) => (index === selected ? { ...editing } : ban)));
  };

  const save = async () => {
    const finalBans =
      selected != null && editing
        ? bans.map((ban, index) => (index === selected ? { ...editing } : ban))
        : bans;
    try {
      await invoke("update_ban_list", { bans: finalBans });
      setDirty(false);
      refresh();
    } catch (e) {
      console.error("Failed to update ban list:", e);
    }
  };

  return (
    <AdminPage
      title={t("banList.title")}
      toolbar={
        <>
          <Button size="small" variant="outlined" disabled={loading} onClick={refresh}>
            {loading ? t("banList.loading") : t("banList.refresh")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              const entry = { ...EMPTY_BAN };
              setBans((prev) => [...prev, entry]);
              setSelected(bans.length);
              setEditing(entry);
              setDirty(true);
            }}
          >
            {t("banList.addEntry")}
          </Button>
          <Button
            size="small"
            color="error"
            disabled={selected == null}
            onClick={() => {
              if (selected == null) return;
              setBans(bans.filter((_, index) => index !== selected));
              setSelected(null);
              setEditing(null);
              setDirty(true);
            }}
          >
            {t("banList.remove")}
          </Button>
          {dirty && (
            <Button size="small" variant="contained" onClick={() => void save()}>
              {t("banList.saveChanges")}
            </Button>
          )}
        </>
      }
    >
      <SplitView
        list={
          bans.length === 0 ? (
            <Box sx={(theme) => ({ p: "16px", fontSize: 12, color: theme.palette.nebula.muted })}>
              {loading ? t("banList.loading") : t("banList.noBans")}
            </Box>
          ) : (
            bans.map((ban, index) => (
              <ListRow
                key={`${ban.address}-${ban.hash}-${index}`}
                selected={selected === index}
                title={ban.name || ban.address || t("banList.unknown")}
                subtitle={`${ban.address}/${ban.mask}${ban.reason ? ` - ${ban.reason}` : ""}`}
                onClick={() => {
                  setSelected(index);
                  setEditing({ ...bans[index] });
                  setDirty(false);
                }}
              />
            ))
          )
        }
        detail={
          editing ? (
            <SettingsCard>
              <Stack gap={1.25}>
                <BanField label={t("banList.fieldUsername")} value={editing.name} onBlur={commit}>
                  {(props) => <TextField {...props} onChange={(e) => patch({ name: e.target.value })} />}
                </BanField>
                <BanField label={t("banList.fieldAddress")} value={editing.address} onBlur={commit}>
                  {(props) => <TextField {...props} onChange={(e) => patch({ address: e.target.value })} />}
                </BanField>
                <BanField label={t("banList.fieldMask")} value={editing.mask} onBlur={commit}>
                  {(props) => (
                    <TextField
                      {...props}
                      type="number"
                      slotProps={{ ...props.slotProps, htmlInput: { ...props.slotProps.htmlInput, min: 0, max: 128 } }}
                      onChange={(e) => patch({ mask: Number(e.target.value) })}
                    />
                  )}
                </BanField>
                <BanField label={t("banList.fieldReason")} value={editing.reason} onBlur={commit}>
                  {(props) => <TextField {...props} onChange={(e) => patch({ reason: e.target.value })} />}
                </BanField>
                <BanField label={t("banList.fieldHash")} value={editing.hash} onBlur={commit}>
                  {(props) => <TextField {...props} onChange={(e) => patch({ hash: e.target.value })} />}
                </BanField>
                <BanField
                  label={t("banList.fieldStart")}
                  value={editing.start}
                  onBlur={commit}
                  placeholder={t("banList.fieldStartPlaceholder")}
                >
                  {(props) => <TextField {...props} onChange={(e) => patch({ start: e.target.value })} />}
                </BanField>
                <BanField label={t("banList.fieldDuration")} value={editing.duration} onBlur={commit}>
                  {(props) => (
                    <TextField
                      {...props}
                      type="number"
                      slotProps={{ ...props.slotProps, htmlInput: { ...props.slotProps.htmlInput, min: 0 } }}
                      onChange={(e) => patch({ duration: Number(e.target.value) })}
                    />
                  )}
                </BanField>
              </Stack>
            </SettingsCard>
          ) : (
            <DetailPlaceholder>{t("banList.selectEntry")}</DetailPlaceholder>
          )
        }
      />
    </AdminPage>
  );
}

/**
 * One labelled input in the ban editor.
 *
 * The field takes a render prop rather than a `key of BanEntry`, because a
 * generic keyed version has to widen the value to `string | number` and then
 * cast the patch back - the caller writing `patch({ mask: Number(...) })`
 * keeps each field's own type intact.
 */
function BanField({
  label,
  value,
  placeholder,
  onBlur,
  children,
}: Readonly<{
  label: string;
  value: string | number;
  placeholder?: string;
  onBlur: () => void;
  children: (props: {
    fullWidth: true;
    size: "small";
    value: string | number;
    placeholder?: string;
    onBlur: () => void;
    slotProps: { htmlInput: { "aria-label": string } };
  }) => ReactNode;
}>) {
  return (
    <Field label={label}>
      {children({
        fullWidth: true,
        size: "small",
        value,
        placeholder,
        onBlur,
        slotProps: { htmlInput: { "aria-label": label } },
      })}
    </Field>
  );
}
