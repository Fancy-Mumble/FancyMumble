import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BanEntry } from "@core/types";
import { Field, TextInput } from "../../components/elements/TextInput";
import styles from "./AdminPanel.module.css";

const EMPTY_BAN: BanEntry = {
  address: "",
  mask: 32,
  name: "",
  hash: "",
  reason: "",
  start: "",
  duration: 0,
};

export function BanListTab() {
  const [bans, setBans] = useState<BanEntry[]>([]);
  const { t } = useTranslation("settings");
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState<BanEntry | null>(null);
  const [dirty, setDirty] = useState(false);

  // Listen for ban-list events and request the list on mount. The listener
  // registration must complete BEFORE the request goes out: `listen()` is an
  // async IPC round-trip, and a fast (local) server can answer before an
  // un-awaited registration commits. Tauri does not replay events to late
  // subscribers, so losing that race left the tab on "Loading..." forever.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    (async () => {
      const un = await listen<BanEntry[]>("ban-list", (event) => {
        setBans(event.payload);
        setLoading(false);
        setSelectedIdx(null);
        setEditing(null);
        setDirty(false);
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      setLoading(true);
      invoke("request_ban_list").catch(() => setLoading(false));
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    invoke("request_ban_list").catch(() => setLoading(false));
  }, []);

  const handleSelect = useCallback(
    (idx: number) => {
      setSelectedIdx(idx);
      setEditing({ ...bans[idx] });
      setDirty(false);
    },
    [bans],
  );

  const handleAdd = useCallback(() => {
    const newBan = { ...EMPTY_BAN };
    setBans((prev) => [...prev, newBan]);
    setSelectedIdx(bans.length);
    setEditing(newBan);
    setDirty(true);
  }, [bans.length]);

  const handleRemove = useCallback(() => {
    if (selectedIdx == null) return;
    const updated = bans.filter((_, i) => i !== selectedIdx);
    setBans(updated);
    setSelectedIdx(null);
    setEditing(null);
    setDirty(true);
  }, [bans, selectedIdx]);

  const patchEditing = useCallback((patch: Partial<BanEntry>) => {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const handleApplyEdit = useCallback(() => {
    if (selectedIdx == null || !editing) return;
    setBans((prev) => prev.map((b, i) => (i === selectedIdx ? { ...editing } : b)));
  }, [selectedIdx, editing]);

  const handleSave = useCallback(async () => {
    // Apply any in-progress edit first.
    const finalBans =
      selectedIdx != null && editing ? bans.map((b, i) => (i === selectedIdx ? { ...editing } : b)) : bans;
    try {
      await invoke("update_ban_list", { bans: finalBans });
      setDirty(false);
      // Refresh from server.
      handleRefresh();
    } catch (err) {
      console.error("Failed to update ban list:", err);
    }
  }, [bans, selectedIdx, editing, handleRefresh]);

  return (
    <>
      <h2 className={styles.panelTitle}>{t("banList.title")}</h2>

      <div className={styles.toolbar}>
        <button type="button" className={styles.refreshBtn} onClick={handleRefresh} disabled={loading}>
          {loading ? t("banList.loading") : t("banList.refresh")}
        </button>
        <button type="button" className={styles.addBtn} onClick={handleAdd}>
          {t("banList.addEntry")}
        </button>
        <button
          type="button"
          className={styles.removeBtn}
          onClick={handleRemove}
          disabled={selectedIdx == null}
        >
          {t("banList.remove")}
        </button>
        {dirty && (
          <button type="button" className={styles.saveBtn} onClick={handleSave}>
            {t("banList.saveChanges")}
          </button>
        )}
      </div>

      <div className={styles.splitView}>
        {/* Ban list */}
        <div className={styles.listPane}>
          {bans.length === 0 ? (
            <div className={styles.emptyRow}>{loading ? t("banList.loading") : t("banList.noBans")}</div>
          ) : (
            bans.map((b, i) => (
              <button
                type="button"
                key={`${b.address}-${b.hash}-${i}`}
                className={`${styles.listItem} ${selectedIdx === i ? styles.listItemActive : ""}`}
                onClick={() => handleSelect(i)}
              >
                <span className={styles.listItemTitle}>{b.name || b.address || t("banList.unknown")}</span>
                <span className={styles.listItemSub}>
                  {b.address}/{b.mask}
                  {b.reason ? ` - ${b.reason}` : ""}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Detail editor */}
        <div className={styles.detailPane}>
          {editing ? (
            <div className={styles.detailForm}>
              <Field label={t("banList.fieldUsername")}>
                <TextInput
                  type="text"
                  value={editing.name}
                  onChange={(e) => patchEditing({ name: e.target.value })}
                  onBlur={handleApplyEdit}
                />
              </Field>
              <Field label={t("banList.fieldAddress")}>
                <TextInput
                  type="text"
                  value={editing.address}
                  onChange={(e) => patchEditing({ address: e.target.value })}
                  onBlur={handleApplyEdit}
                />
              </Field>
              <Field label={t("banList.fieldMask")}>
                <TextInput
                  type="number"
                  min={0}
                  max={128}
                  value={editing.mask}
                  onChange={(e) => patchEditing({ mask: Number(e.target.value) })}
                  onBlur={handleApplyEdit}
                />
              </Field>
              <Field label={t("banList.fieldReason")}>
                <TextInput
                  type="text"
                  value={editing.reason}
                  onChange={(e) => patchEditing({ reason: e.target.value })}
                  onBlur={handleApplyEdit}
                />
              </Field>
              <Field label={t("banList.fieldHash")}>
                <TextInput
                  type="text"
                  value={editing.hash}
                  onChange={(e) => patchEditing({ hash: e.target.value })}
                  onBlur={handleApplyEdit}
                />
              </Field>
              <Field label={t("banList.fieldStart")}>
                <TextInput
                  type="text"
                  value={editing.start}
                  placeholder={t("banList.fieldStartPlaceholder")}
                  onChange={(e) => patchEditing({ start: e.target.value })}
                  onBlur={handleApplyEdit}
                />
              </Field>
              <Field label={t("banList.fieldDuration")}>
                <TextInput
                  type="number"
                  min={0}
                  value={editing.duration}
                  onChange={(e) => patchEditing({ duration: Number(e.target.value) })}
                  onBlur={handleApplyEdit}
                />
              </Field>
            </div>
          ) : (
            <div className={styles.detailEmpty}>{t("banList.selectEntry")}</div>
          )}
        </div>
      </div>
    </>
  );
}
