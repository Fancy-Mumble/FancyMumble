/**
 * Audit Log admin tab (audit spec section 10): a Viewer half (dashboard +
 * dual-mode search over the server's hash-chained audit log) and a
 * Configuration half (the per-part collect/export toggles, retention and
 * OTLP settings, schema-driven exactly like the runtime server settings so
 * the audit plugin owns the schema).
 *
 * Both halves are gated server-side: ViewAudit / ConfigureAudit resolve to
 * root-channel Write today, the same gate the other admin tabs use.  A
 * server without the audit plugin never broadcasts `audit-config` and
 * answers queries with an empty/err response - the tab explains itself.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ShieldCheckIcon } from "../../icons";
import type {
  AuditConfigEvent,
  AuditEventPayload,
  AuditResponse,
  ServerSetting,
} from "../../types";
import { TID } from "../../testids";
import { AuditViewer } from "./AuditViewer";
import { useAuditStore } from "./auditStore";
import styles from "./AuditLogTab.module.css";

type Half = "viewer" | "config";

export function AuditLogTab() {
  const { t } = useTranslation("settings");
  const [half, setHalf] = useState<Half>("viewer");

  const config = useAuditStore((s) => s.config);
  const applyResponse = useAuditStore((s) => s.applyResponse);
  const applyEvent = useAuditStore((s) => s.applyEvent);
  const applyConfig = useAuditStore((s) => s.applyConfig);
  const loadConfig = useAuditStore((s) => s.loadConfig);

  useEffect(() => {
    void loadConfig();
    const subs = [
      listen<AuditResponse>("audit-response", (e) => applyResponse(e.payload)),
      listen<AuditEventPayload>("audit-event", (e) => applyEvent(e.payload.entry)),
      listen<AuditConfigEvent>("audit-config", (e) => applyConfig(e.payload.config)),
    ];
    return () => {
      for (const s of subs) void s.then((f) => f());
    };
  }, [loadConfig, applyResponse, applyEvent, applyConfig]);

  return (
    <div className={styles.panel} data-testid={TID.auditTab}>
      <div className={styles.halfSwitch}>
        <button
          type="button"
          className={`${styles.halfBtn}${half === "viewer" ? ` ${styles.halfBtnActive}` : ""}`}
          onClick={() => setHalf("viewer")}
        >
          {t("audit.halfViewer", { defaultValue: "Viewer" })}
        </button>
        <button
          type="button"
          className={`${styles.halfBtn}${half === "config" ? ` ${styles.halfBtnActive}` : ""}`}
          data-testid={TID.auditConfigHalf}
          onClick={() => setHalf("config")}
        >
          {t("audit.halfConfig", { defaultValue: "Configuration" })}
        </button>
      </div>

      {half === "viewer" ? (
        <AuditViewer advancedSqlAvailable={config?.advancedSqlAvailable ?? false} />
      ) : (
        <AuditConfigHalf />
      )}
    </div>
  );
}

/** Configuration half: chain status + the schema-driven toggle matrix. */
function AuditConfigHalf() {
  const { t } = useTranslation("settings");
  const config = useAuditStore((s) => s.config);
  const busy = useAuditStore((s) => s.configBusy);
  const configError = useAuditStore((s) => s.configError);
  const chain = useAuditStore((s) => s.chain);
  const saveConfig = useAuditStore((s) => s.saveConfig);
  const verifyChain = useAuditStore((s) => s.verifyChain);

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState(0);

  // A fresh snapshot (the server's re-broadcast after a save) supersedes
  // local edits.
  const revision = config?.revision ?? -1;
  useEffect(() => {
    setEdits({});
  }, [revision]);

  const groups = useMemo(() => {
    const map = new Map<string, ServerSetting[]>();
    for (const s of config?.settings ?? []) {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return [...map.entries()];
  }, [config]);

  if (!config) {
    return (
      <div className={styles.empty}>
        {t("audit.configUnavailable", {
          defaultValue:
            "Audit configuration isn't available. This server may not run the audit plugin, or you may not have permission to configure it.",
        })}
      </div>
    );
  }

  const valueOf = (s: ServerSetting): string => edits[s.key] ?? s.value ?? "";

  const changed: ServerSetting[] = config.settings
    .filter((s) => s.key in edits && (edits[s.key] ?? "") !== (s.value ?? ""))
    .map((s) => ({ ...s, value: edits[s.key] ?? "" }));

  const onSave = async () => {
    try {
      await saveConfig(changed);
      setEdits({});
      setSavedAt(Date.now());
    } catch {
      /* error already in store */
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.configIntro}>
        {t("audit.configIntro", {
          defaultValue:
            "Every part is an independent switch. Turning a part off stops new entries but never deletes history - deletion only happens through the retention policy, and every change here is itself an audit entry.",
        })}
      </div>

      <div className={styles.chainCard} data-testid={TID.auditChainCard}>
        <ShieldCheckIcon width={18} height={18} />
        <span>
          {t("audit.chainHeight", {
            defaultValue: "Hash chain: {{height}} entries",
            height: chain.height ?? config.chainHeight,
          })}
        </span>
        {chain.ok != null &&
          (chain.ok ? (
            <span className={styles.chainOk}>
              {t("audit.chainOk", { defaultValue: "verified - no tampering detected" })}
            </span>
          ) : (
            <span className={styles.chainBad}>
              {t("audit.chainBad", {
                defaultValue: "BROKEN: {{error}}",
                error: chain.error ?? "?",
              })}
            </span>
          ))}
        <button
          type="button"
          className={styles.btn}
          disabled={chain.verifying}
          data-testid={TID.auditVerifyChain}
          onClick={() => void verifyChain()}
        >
          {chain.verifying
            ? t("audit.verifying", { defaultValue: "Verifying…" })
            : t("audit.verify", { defaultValue: "Verify chain" })}
        </button>
      </div>

      {groups.map(([group, items]) => (
        <section key={group} className={styles.group}>
          <h3 className={styles.groupTitle}>{group}</h3>
          {items.map((s) => (
            <div key={s.key} className={styles.settingRow}>
              <div>
                <div className={styles.settingLabel}>{s.label || s.key}</div>
                {s.help && <div className={styles.settingHelp}>{s.help}</div>}
              </div>
              <AuditSettingField setting={s} value={valueOf(s)} onChange={(v) => setEdits((p) => ({ ...p, [s.key]: v }))} />
            </div>
          ))}
        </section>
      ))}

      <div className={styles.saveFooter}>
        {configError && <span className={styles.error}>{configError}</span>}
        {!configError && savedAt > 0 && changed.length === 0 && (
          <span className={styles.saved}>{t("audit.saved", { defaultValue: "Saved" })}</span>
        )}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={busy || changed.length === 0}
          data-testid={TID.auditConfigSave}
          onClick={() => void onSave()}
        >
          {busy
            ? t("audit.saving", { defaultValue: "Saving…" })
            : t("audit.saveChanges", { defaultValue: "Save changes" })}
          {changed.length > 0 ? ` (${changed.length})` : ""}
        </button>
      </div>
    </div>
  );
}

/** Minimal field factory for audit settings (bool / int / enum / string). */
function AuditSettingField({
  setting,
  value,
  onChange,
}: {
  readonly setting: ServerSetting;
  readonly value: string;
  readonly onChange: (v: string) => void;
}) {
  switch (setting.type) {
    case "bool": {
      const checked = value === "true" || value === "1";
      return (
        <label>
          <input
            type="checkbox"
            checked={checked}
            data-audit-setting={setting.key}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          />
        </label>
      );
    }
    case "int":
      return (
        <input
          type="number"
          className={styles.pillInput}
          value={value}
          data-audit-setting={setting.key}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "enum":
      return (
        <select
          className={styles.pillSelect}
          value={value}
          data-audit-setting={setting.key}
          onChange={(e) => onChange(e.target.value)}
        >
          {!setting.options.includes(value) && value !== "" && <option value={value}>{value}</option>}
          {setting.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    case "password":
      return (
        <input
          type="password"
          className={styles.pillInput}
          value={value}
          placeholder={setting.secret ? "•••••••• (unchanged)" : ""}
          autoComplete="new-password"
          data-audit-setting={setting.key}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          type="text"
          className={styles.pillInput}
          value={value}
          data-audit-setting={setting.key}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
