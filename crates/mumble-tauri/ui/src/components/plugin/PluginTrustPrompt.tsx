import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useAppStore, resolvePluginTrust } from "../../store";
import type { PendingTrustPrompt } from "../../plugins/tier1/trust";
import { capabilityLabel, decodePluginInfo } from "../../plugins/tier1/trust";
import { SplitButton } from "../elements/SplitButton";
import type { SplitButtonOption } from "../elements/SplitButton";
import styles from "./PluginTrustPrompt.module.css";

/** Mounted by `PluginInteractionLayer`.  Shows the front-of-queue
 *  pending trust prompt; auto-advances as the user resolves them. */
export default function PluginTrustPrompt() {
  const pending = useAppStore((s) => s.pluginTrustQueue[0] ?? null);
  if (!pending) return null;
  return <TrustDialog pending={pending} />;
}

function computeFingerprint(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  return crypto.subtle.digest("SHA-256", encoded).then((buf) =>
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  );
}

function TrustDialog({ pending }: { readonly pending: PendingTrustPrompt }) {
  const info = decodePluginInfo(pending.registryEntry.infoJson);
  const declared = pending.manifest.capabilities ?? [];
  const isReprompt = pending.previous !== null;
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    void computeFingerprint(pending.registryEntry.infoJson ?? "").then(setFingerprint);
  }, [pending.registryEntry.infoJson]);

  const deny = () =>
    void resolvePluginTrust(pending.pluginName, "deny").catch((e) =>
      console.warn("[plugin-trust] deny failed:", e),
    );

  const allowOptions: [SplitButtonOption, ...SplitButtonOption[]] = [
    {
      label: "Allow once",
      hint: "This session only",
      onSelect: () =>
        void resolvePluginTrust(pending.pluginName, "allow", "once").catch((e) =>
          console.warn("[plugin-trust] allow failed:", e),
        ),
    },
    {
      label: "Allow for this server",
      hint: "Remembered for this server",
      onSelect: () =>
        void resolvePluginTrust(pending.pluginName, "allow", "server").catch((e) =>
          console.warn("[plugin-trust] allow failed:", e),
        ),
    },
    {
      label: "Always allow",
      hint: "Trusted on every server",
      onSelect: () =>
        void resolvePluginTrust(pending.pluginName, "allow", "global").catch((e) =>
          console.warn("[plugin-trust] allow failed:", e),
        ),
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
            Server wants to enable plugin
          </h2>
          <p className={styles.subtitle}>
            <strong>{pending.pluginName}</strong>
            {" "}
            <span style={{ opacity: 0.75 }}>v{pending.version}</span>
          </p>
        </header>

        <div className={styles.body}>
          {info.description && (
            <p className={styles.description}>{info.description}</p>
          )}

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
                <li className={styles.capability}>Nothing - manifest declares no capabilities</li>
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

              {fingerprint !== null && (
                <>
                  <span className={styles.advancedLabel}>Fingerprint</span>
                  <span className={`${styles.advancedValue} ${styles.fingerprint}`}>
                    {fingerprint}
                  </span>
                </>
              )}
            </div>
          </details>
        </div>

        <footer className={styles.footer}>
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={deny}>
            Block
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={deny}>
            Not now
          </button>

          <SplitButton options={allowOptions} variant="primary" />
        </footer>
      </div>
    </div>,
    document.body,
  );
}
