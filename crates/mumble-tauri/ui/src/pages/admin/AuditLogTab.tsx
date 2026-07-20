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
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ActivityIcon, ListIcon, ShieldCheckIcon, SlidersIcon } from "../../icons";
import type {
  AuditConfigEvent,
  AuditEventPayload,
  AuditResponse,
  ServerSetting,
} from "../../types";
import { TID } from "../../testids";
import { SelectInput, TextInput } from "../../components/elements/TextInput";
import { Toggle } from "../settings/SharedControls";
import { AuditViewer } from "./AuditViewer";
import { PREF_PAGE, readEnumPref, writeEnumPref } from "./auditPrefs";
import { useAuditStore } from "./auditStore";
import styles from "./AuditLogTab.module.css";

/** Sub-pages of the audit tab, selected by the tab strip at the top. */
type AuditPage = "dashboard" | "results" | "config";

const AUDIT_PAGES = ["dashboard", "results", "config"] as const;

export function AuditLogTab() {
  const { t } = useTranslation("settings");
  // The sub-page you left off on is remembered across sessions.
  const [page, setPageState] = useState<AuditPage>(() =>
    readEnumPref<AuditPage>(PREF_PAGE, "dashboard", AUDIT_PAGES),
  );

  const setPage = (next: AuditPage) => {
    writeEnumPref(PREF_PAGE, next);
    setPageState(next);
  };

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

  const tabs: readonly { id: AuditPage; label: string; icon: ReactNode; testId: string }[] = [
    {
      id: "dashboard",
      label: t("audit.pageDashboard", { defaultValue: "Dashboard" }),
      icon: <ActivityIcon width={15} height={15} />,
      testId: TID.auditDashboardTab,
    },
    {
      id: "results",
      label: t("audit.pageResults", { defaultValue: "Results" }),
      icon: <ListIcon width={15} height={15} />,
      testId: TID.auditResultsTab,
    },
    {
      id: "config",
      label: t("audit.halfConfig", { defaultValue: "Configuration" }),
      icon: <SlidersIcon width={15} height={15} />,
      // Kept from the old Viewer/Config switch so existing e2e keeps working.
      testId: TID.auditConfigHalf,
    },
  ];

  return (
    <div className={styles.panel} data-testid={TID.auditTab}>
      <div className={styles.subTabs} role="tablist" data-testid={TID.auditSubTabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={page === tab.id}
            className={`${styles.subTab}${page === tab.id ? ` ${styles.subTabActive}` : ""}`}
            data-testid={tab.testId}
            onClick={() => setPage(tab.id)}
          >
            <span className={styles.subTabIcon}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {page === "config" ? (
        <AuditConfigHalf />
      ) : (
        <AuditViewer
          advancedSqlAvailable={config?.advancedSqlAvailable ?? false}
          view={page}
          onRan={() => setPage("results")}
        />
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
        // The wrapper keeps the per-key hook while the switch stays the control.
        <span data-audit-setting={setting.key}>
          <Toggle
            checked={checked}
            onChange={() => onChange(checked ? "false" : "true")}
            ariaLabel={setting.label || setting.key}
          />
        </span>
      );
    }
    case "int":
      return (
        <TextInput
          type="number"
          fieldSize="sm"
          value={value}
          aria-label={setting.label || setting.key}
          data-audit-setting={setting.key}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "enum":
      return (
        <SelectInput
          fieldSize="sm"
          value={value}
          aria-label={setting.label || setting.key}
          data-audit-setting={setting.key}
          onChange={(e) => onChange(e.target.value)}
        >
          {!setting.options.includes(value) && value !== "" && <option value={value}>{value}</option>}
          {setting.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </SelectInput>
      );
    case "password":
      return (
        <TextInput
          type="password"
          fieldSize="sm"
          value={value}
          placeholder={setting.secret ? "•••••••• (unchanged)" : ""}
          autoComplete="new-password"
          aria-label={setting.label || setting.key}
          data-audit-setting={setting.key}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <TextInput
          type="text"
          fieldSize="sm"
          value={value}
          aria-label={setting.label || setting.key}
          data-audit-setting={setting.key}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
