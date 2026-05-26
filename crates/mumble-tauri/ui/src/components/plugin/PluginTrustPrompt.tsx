import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useAppStore, resolvePluginTrust } from "../../store";
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
  const [expanded, setExpanded] = useState<string | null>(
    queue.length === 1 ? queue[0]!.pluginName : null,
  );

  const toggle = (name: string) =>
    setExpanded((prev) => (prev === name ? null : name));

  // Snapshot the queue before iterating: each `resolvePluginTrust`
  // call mutates `pluginTrustQueue`, so reading state mid-loop would
  // race with the React re-render.
  const allowAll = (scope: TrustScope) => {
    const names = queue.map((p) => p.pluginName);
    for (const name of names) {
      void resolvePluginTrust(name, TrustDecision.Allow, scope).catch((e) =>
        console.warn("[plugin-trust] bulk allow failed:", e),
      );
    }
  };

  const blockAll = () => {
    const names = queue.map((p) => p.pluginName);
    for (const name of names) {
      void resolvePluginTrust(name, TrustDecision.Deny).catch((e) =>
        console.warn("[plugin-trust] bulk deny failed:", e),
      );
    }
  };

  const single = queue.length === 1;
  const allowAllOptions: [SplitButtonOption, ...SplitButtonOption[]] = [
    {
      label: single ? "Allow for this server" : "Allow all for this server",
      hint: "Remembered for this server",
      onSelect: () => allowAll(TrustScope.Server),
    },
    {
      label: single ? "Allow once" : "Allow all once",
      hint: "This session only",
      onSelect: () => allowAll(TrustScope.Once),
    },
    {
      label: single ? "Always allow" : "Always allow all",
      hint: "Trusted on every server",
      onSelect: () => allowAll(TrustScope.Global),
    },
  ];

  return createPortal(
    <div
      className={styles.scrim}
      role="dialog"
      aria-modal="true"
      aria-labelledby="plugin-trust-title"
    >
      <div className={styles.dialog}>
        <header className={styles.header}>
          <h2 id="plugin-trust-title" className={styles.title}>
            {single
              ? "Server wants to enable plugin"
              : `Server wants to enable ${queue.length} plugins`}
          </h2>
          <p className={styles.subtitle}>
            {single
              ? "Review the plugin and choose whether to allow it."
              : "Expand a plugin to review what it can do, then decide individually or use the buttons below to apply the same choice to all."}
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

        <footer className={styles.footer}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={blockAll}
          >
            {single ? "Block" : "Block all"}
          </button>
          <SplitButton options={allowAllOptions} variant="primary" />
        </footer>
      </div>
    </div>,
    document.body,
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
      label: "Allow for this server",
      hint: "Remembered for this server",
      onSelect: () => allow(TrustScope.Server),
    },
    {
      label: "Allow once",
      hint: "This session only",
      onSelect: () => allow(TrustScope.Once),
    },
    {
      label: "Always allow",
      hint: "Trusted on every server",
      onSelect: () => allow(TrustScope.Global),
    },
  ];

  const capCount = declared.length === 0
    ? "no capabilities"
    : `${declared.length} ${declared.length === 1 ? "capability" : "capabilities"}`;

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
            {isReprompt && <span className={styles.rowBadge}>updated</span>}
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
              This plugin's version or capability set changed since you
              last reviewed it. Re-confirm before re-enabling.
            </div>
          )}

          <section>
            <h3 className={styles.sectionTitle}>This plugin will be able to</h3>
            <ul className={styles.capabilities}>
              {declared.length === 0 ? (
                <li className={styles.capability}>
                  Nothing - manifest declares no capabilities
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
            <summary>Advanced</summary>
            <div className={styles.advancedContent}>
              <span className={styles.advancedLabel}>Plugin</span>
              <span className={styles.advancedValue}>{pending.pluginName}</span>

              <span className={styles.advancedLabel}>Version</span>
              <span className={styles.advancedValue}>{pending.version}</span>

              {info.author && (
                <>
                  <span className={styles.advancedLabel}>Author</span>
                  <span className={styles.advancedValue}>{info.author}</span>
                </>
              )}

              {info.homepage && (
                <>
                  <span className={styles.advancedLabel}>Homepage</span>
                  <span className={styles.advancedValue}>
                    <a href={info.homepage} target="_blank" rel="noreferrer">
                      {info.homepage}
                    </a>
                  </span>
                </>
              )}

              <span className={styles.advancedLabel}>Capabilities</span>
              <span className={styles.advancedValue}>
                <div className={styles.tagList}>
                  {(declared as readonly string[]).map((c) => (
                    <span key={c} className={styles.tag}>{c}</span>
                  ))}
                </div>
              </span>

              {info.capabilityTags.length > 0 && (
                <>
                  <span className={styles.advancedLabel}>Tags</span>
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
                  <span className={styles.advancedLabel}>Last reviewed</span>
                  <span className={styles.advancedValue}>
                    v{pending.previous.version}
                    {" - "}
                    {new Date(pending.previous.decidedAt).toLocaleString()}
                  </span>
                </>
              )}

              <span className={styles.advancedLabel}>Schema</span>
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
              Block
            </button>
            <SplitButton options={allowOptions} variant="primary" />
          </div>
        </div>
      )}
    </section>
  );
}

function Fingerprint({ infoJson }: { readonly infoJson: string | null }) {
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
      <span className={styles.advancedLabel}>Fingerprint</span>
      <span className={`${styles.advancedValue} ${styles.fingerprint}`}>
        {fingerprint}
      </span>
    </>
  );
}
