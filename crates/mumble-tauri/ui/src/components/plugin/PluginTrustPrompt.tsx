import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, resolvePluginTrust, resolvePluginTrustBulk } from "../../store";
import { Modal } from "../elements/Modal";
import type { PendingTrustPrompt } from "../../plugins/tier1/trust";
import {
  capabilityLabel,
  decodePluginInfo,
  TrustDecision,
  TrustScope,
} from "../../plugins/tier1/trust";
import { ChevronDownIcon, ChevronRightIcon } from "../../icons";
import { SplitButton } from "../elements/SplitButton";
import type { SplitButtonOption } from "../elements/SplitButton";
import styles from "./PluginTrustPrompt.module.css";

/** Mounted by `PluginInteractionLayer`.  Renders every queued plugin
 *  trust prompt in a single dialog as an accordion list with bulk
 *  Allow/Block actions, so the user no longer has to dismiss N
 *  individual modals one-at-a-time after first connecting to a server
 *  with several plugins. */
export default function PluginTrustPrompt() {
  const queue = useAppStore((s) => s.pluginTrustQueue);
  if (queue.length === 0) return null;
  return <TrustListDialog queue={queue} />;
}

function TrustListDialog({ queue }: { readonly queue: readonly PendingTrustPrompt[] }) {
  const { t } = useTranslation("common");
  const [expanded, setExpanded] = useState<string | null>(
    queue.length === 1 ? queue[0]!.pluginName : null,
  );

  const toggle = (name: string) =>
    setExpanded((prev) => (prev === name ? null : name));

  // Single atomic persist + setState for every queued plugin.  Looping
  // `resolvePluginTrust` instead races the in-memory tauri-plugin-store
  // cache and most of the parallel writes get silently dropped, which
  // is what made the dialog re-appear with one fewer plugin per click.
  const allowAll = (scope: TrustScope) => {
    const names = queue.map((p) => p.pluginName);
    void resolvePluginTrustBulk(names, TrustDecision.Allow, scope).catch((e) =>
      console.warn("[plugin-trust] bulk allow failed:", e),
    );
  };

  const blockAll = () => {
    const names = queue.map((p) => p.pluginName);
    void resolvePluginTrustBulk(names, TrustDecision.Deny).catch((e) =>
      console.warn("[plugin-trust] bulk deny failed:", e),
    );
  };

  const single = queue.length === 1;
  // With a single plugin the row is auto-expanded and already exposes
  // its own Block + Allow buttons; an additional "Block all / Allow all"
  // footer would be redundant noise, so we omit it.
  const allowAllOptions: [SplitButtonOption, ...SplitButtonOption[]] = [
    {
      label: t("pluginTrust.bulkAllowServer"),
      hint: t("pluginTrust.scopeServerHint"),
      onSelect: () => allowAll(TrustScope.Server),
    },
    {
      label: t("pluginTrust.bulkAllowOnce"),
      hint: t("pluginTrust.scopeOnceHint"),
      onSelect: () => allowAll(TrustScope.Once),
    },
    {
      label: t("pluginTrust.bulkAllowAlways"),
      hint: t("pluginTrust.scopeGlobalHint"),
      onSelect: () => allowAll(TrustScope.Global),
    },
  ];

  return (
    <Modal onClose={() => {}} closeOnEsc={false} closeOnOverlayClick={false} zIndex={250}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-trust-title"
      >
        <header className={styles.header}>
          <h2 id="plugin-trust-title" className={styles.title}>
            {single
              ? t("pluginTrust.singleTitle")
              : t("pluginTrust.multiTitle", { count: queue.length })}
          </h2>
          <p className={styles.subtitle}>
            {single
              ? t("pluginTrust.singleSubtitle")
              : t("pluginTrust.multiSubtitle")}
          </p>
        </header>

        <div className={styles.list}>
          {queue.map((p) => (
            <PluginRow
              key={p.pluginName}
              pending={p}
              open={expanded === p.pluginName}
              onToggle={() => toggle(p.pluginName)}
            />
          ))}
        </div>

        {!single && (
          <footer className={styles.footer}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={blockAll}
            >
              {t("pluginTrust.blockAll")}
            </button>
            <SplitButton options={allowAllOptions} variant="primary" />
          </footer>
        )}
      </div>
    </Modal>
  );
}

function PluginRow({
  pending,
  open,
  onToggle,
}: {
  readonly pending: PendingTrustPrompt;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const { t } = useTranslation("common");
  const info = decodePluginInfo(pending.registryEntry.infoJson);
  const declared = pending.manifest.capabilities ?? [];
  const isReprompt = pending.previous !== null;

  const allow = (scope: TrustScope) =>
    void resolvePluginTrust(pending.pluginName, TrustDecision.Allow, scope).catch((e) =>
      console.warn("[plugin-trust] allow failed:", e),
    );

  const deny = () =>
    void resolvePluginTrust(pending.pluginName, TrustDecision.Deny).catch((e) =>
      console.warn("[plugin-trust] deny failed:", e),
    );

  const allowOptions: [SplitButtonOption, ...SplitButtonOption[]] = [
    {
      label: t("pluginTrust.scopeServer"),
      hint: t("pluginTrust.scopeServerHint"),
      onSelect: () => allow(TrustScope.Server),
    },
    {
      label: t("pluginTrust.scopeOnce"),
      hint: t("pluginTrust.scopeOnceHint"),
      onSelect: () => allow(TrustScope.Once),
    },
    {
      label: t("pluginTrust.scopeAlways"),
      hint: t("pluginTrust.scopeGlobalHint"),
      onSelect: () => allow(TrustScope.Global),
    },
  ];

  const capCount = declared.length === 0
    ? t("pluginTrust.capNone")
    : t("pluginTrust.capCount", { count: declared.length });

  return (
    <section className={`${styles.row} ${open ? styles.rowOpen : ""}`}>
      <button
        type="button"
        className={styles.rowHeader}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={styles.rowChevron} aria-hidden="true">
          {open
            ? <ChevronDownIcon width={14} height={14} />
            : <ChevronRightIcon width={14} height={14} />}
        </span>
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>
            <strong>{pending.pluginName}</strong>
            <span className={styles.rowVersion}>v{pending.version}</span>
            {isReprompt && <span className={styles.rowBadge}>{t("pluginTrust.updatedBadge")}</span>}
          </span>
          {info.description && (
            <span className={styles.rowDesc}>{info.description}</span>
          )}
        </span>
        <span className={styles.rowMeta}>{capCount}</span>
      </button>

      {open && (
        <div className={styles.rowBody}>
          {isReprompt && (
            <div className={styles.warning}>
              {t("pluginTrust.repromptWarning")}
            </div>
          )}

          <section>
            <h3 className={styles.sectionTitle}>{t("pluginTrust.capabilitiesHeading")}</h3>
            <ul className={styles.capabilities}>
              {declared.length === 0 ? (
                <li className={styles.capability}>
                  {t("pluginTrust.capEmpty")}
                </li>
              ) : (
                declared.map((c) => (
                  <li key={c} className={styles.capability}>
                    {capabilityLabel(c)}
                  </li>
                ))
              )}
            </ul>
          </section>

          <details className={styles.advanced}>
            <summary>{t("pluginTrust.advancedSummary")}</summary>
            <div className={styles.advancedContent}>
              <span className={styles.advancedLabel}>{t("pluginTrust.fieldPlugin")}</span>
              <span className={styles.advancedValue}>{pending.pluginName}</span>

              <span className={styles.advancedLabel}>{t("pluginTrust.fieldVersion")}</span>
              <span className={styles.advancedValue}>{pending.version}</span>

              {info.author && (
                <>
                  <span className={styles.advancedLabel}>{t("pluginTrust.fieldAuthor")}</span>
                  <span className={styles.advancedValue}>{info.author}</span>
                </>
              )}

              {info.homepage && (
                <>
                  <span className={styles.advancedLabel}>{t("pluginTrust.fieldHomepage")}</span>
                  <span className={styles.advancedValue}>
                    <a href={info.homepage} target="_blank" rel="noreferrer">
                      {info.homepage}
                    </a>
                  </span>
                </>
              )}

              <span className={styles.advancedLabel}>{t("pluginTrust.fieldCapabilities")}</span>
              <span className={styles.advancedValue}>
                <div className={styles.tagList}>
                  {(declared as readonly string[]).map((c) => (
                    <span key={c} className={styles.tag}>{c}</span>
                  ))}
                </div>
              </span>

              {info.capabilityTags.length > 0 && (
                <>
                  <span className={styles.advancedLabel}>{t("pluginTrust.fieldTags")}</span>
                  <span className={styles.advancedValue}>
                    <div className={styles.tagList}>
                      {info.capabilityTags.map((t) => (
                        <span key={t} className={styles.tag}>{t}</span>
                      ))}
                    </div>
                  </span>
                </>
              )}

              {pending.previous && (
                <>
                  <span className={styles.advancedLabel}>{t("pluginTrust.fieldLastReviewed")}</span>
                  <span className={styles.advancedValue}>
                    v{pending.previous.version}
                    {" - "}
                    {new Date(pending.previous.decidedAt).toLocaleString()}
                  </span>
                </>
              )}

              <span className={styles.advancedLabel}>{t("pluginTrust.fieldSchema")}</span>
              <span className={styles.advancedValue}>
                v{pending.manifest.schema_version ?? 1}
              </span>

              <Fingerprint infoJson={pending.registryEntry.infoJson} />
            </div>
          </details>

          <div className={styles.rowActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={deny}
            >
              {t("pluginTrust.block")}
            </button>
            <SplitButton options={allowOptions} variant="primary" />
          </div>
        </div>
      )}
    </section>
  );
}

function Fingerprint({ infoJson }: { readonly infoJson: string | null }) {
  const { t } = useTranslation("common");
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  useEffect(() => {
    const encoded = new TextEncoder().encode(infoJson ?? "");
    void crypto.subtle.digest("SHA-256", encoded).then((buf) => {
      setFingerprint(
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      );
    });
  }, [infoJson]);
  if (!fingerprint) return null;
  return (
    <>
      <span className={styles.advancedLabel}>{t("pluginTrust.fieldFingerprint")}</span>
      <span className={`${styles.advancedValue} ${styles.fingerprint}`}>
        {fingerprint}
      </span>
    </>
  );
}
