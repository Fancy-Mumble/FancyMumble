/**
 * DocumentsSection - the "Live documents" panel of the File server admin tab.
 *
 * LiveDocs are persisted by the live-doc plugin to a *separate* document store
 * on the file server (not the uploaded-files blob storage), so they need their
 * own listing.  This is a presentational component: the parent (FileServerTab)
 * owns the data, the unified search filter, and the shared bulk selection, so
 * an admin can select & delete files and documents together.
 */

import { useTranslation } from "react-i18next";
import { formatBytes } from "../../utils/format";
import { FileTextIcon, TrashIcon } from "../../icons";
import type { DocumentSummary, UserEntry } from "../../types";
import styles from "./FileServerTab.module.css";

/** Owner cell: the creator's name with an online dot when that user (matched
 *  by cert hash) is currently connected. */
function DocOwnerCell({ doc, connectedByHash }: { doc: DocumentSummary; connectedByHash: Map<string, UserEntry> }) {
  const { t } = useTranslation("settings");
  const entry = doc.owner_cert_hash ? connectedByHash.get(doc.owner_cert_hash) : undefined;
  const name = entry?.name ?? doc.owner_name;
  if (!name) {
    return <span className={styles.ownerUnknown}>{t("fileServer.unknownOwner", { defaultValue: "Unknown" })}</span>;
  }
  const online = entry != null;
  return (
    <span className={styles.ownerCell}>
      <span className={`${styles.ownerDot} ${online ? styles.online : styles.offline}`} aria-hidden="true" />
      <span className={styles.ownerName} title={doc.owner_cert_hash ?? undefined}>{name}</span>
    </span>
  );
}

interface DocumentsSectionProps {
  readonly docs: DocumentSummary[];
  readonly connectedByHash: Map<string, UserEntry>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly searchActive: boolean;
  readonly isSelected: (name: string) => boolean;
  readonly onToggle: (name: string) => void;
  readonly allSelected: boolean;
  readonly onToggleAll: (on: boolean) => void;
  readonly onDelete: (doc: DocumentSummary) => void;
  readonly deletingName: string | null;
}

export function DocumentsSection({
  docs, connectedByHash, loading, error, searchActive,
  isSelected, onToggle, allSelected, onToggleAll, onDelete, deletingName,
}: DocumentsSectionProps) {
  const { t } = useTranslation("settings");

  return (
    <section className={styles.docsSection}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <FileTextIcon width={18} height={18} /> {t("fileServer.docs.title", { defaultValue: "Live documents" })}
        </h3>
      </div>

      <p className={styles.docsCaption}>
        {t("fileServer.docs.noExpiry", {
          defaultValue: "Documents are kept until removed - unlike uploaded files, they have no automatic expiry.",
        })}
      </p>

      {docs.length === 0 ? (
        <p className={styles.empty}>
          {loading
            ? t("fileServer.loading", { defaultValue: "Loading…" })
            : error
              ? t("fileServer.docs.error", { defaultValue: "Could not load documents" })
              : searchActive
                ? t("fileServer.docs.noMatch", { defaultValue: "No documents match your search." })
                : t("fileServer.docs.empty", { defaultValue: "No documents persisted yet." })}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thCheck}>
                  <input
                    type="checkbox"
                    aria-label={t("fileServer.selectAllDocs", { defaultValue: "Select all documents" })}
                    checked={allSelected}
                    onChange={(e) => onToggleAll(e.target.checked)}
                  />
                </th>
                <th>{t("fileServer.docs.col.name", { defaultValue: "Document" })}</th>
                <th>{t("fileServer.col.owner", { defaultValue: "Owner" })}</th>
                <th className={styles.num}>{t("fileServer.docs.col.revisions", { defaultValue: "Revisions" })}</th>
                <th className={styles.num}>{t("fileServer.docs.col.size", { defaultValue: "Size" })}</th>
                <th>{t("fileServer.docs.col.updated", { defaultValue: "Updated" })}</th>
                <th className={styles.thActions}>{t("fileServer.col.actions", { defaultValue: "Actions" })}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.name} className={isSelected(d.name) ? styles.rowSelected : undefined}>
                  <td className={styles.tdCheck}>
                    <input
                      type="checkbox"
                      aria-label={t("fileServer.selectRow", { defaultValue: "Select" })}
                      checked={isSelected(d.name)}
                      onChange={() => onToggle(d.name)}
                    />
                  </td>
                  <td className={styles.nameCell}>
                    <span className={styles.fileName} title={d.name}>{d.name}</span>
                  </td>
                  <td><DocOwnerCell doc={d} connectedByHash={connectedByHash} /></td>
                  <td className={styles.num}>{d.revision_count}</td>
                  <td className={styles.num}>{formatBytes(d.size_bytes)}</td>
                  <td className={styles.dateCell}>{new Date(d.updated_at).toLocaleString()}</td>
                  <td className={styles.actionsCell}>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.deleteBtn}`}
                      onClick={() => onDelete(d)}
                      disabled={deletingName === d.name}
                      title={t("fileServer.docs.delete", { defaultValue: "Delete document" })}
                    >
                      <TrashIcon width={15} height={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default DocumentsSection;
