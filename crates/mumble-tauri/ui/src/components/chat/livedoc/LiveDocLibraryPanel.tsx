/**
 * LiveDocLibraryPanel - standalone "My documents" view shown in the
 * chat top-half when the user wants to browse their saved documents
 * without a Live Doc being open.  Reuses the same sidebar tree as the
 * in-document rail, but rendered full-width with an empty hint pane.
 */

import { useTranslation } from "react-i18next";
import { FileTextIcon } from "../../../icons";
import type { LiveDocDocLink } from "../../../types";
import PanelCloseButton from "../PanelCloseButton";
import LiveDocSidebar from "./LiveDocSidebar";
import styles from "./LiveDocLibraryPanel.module.css";

interface LiveDocLibraryPanelProps {
  readonly onOpenDoc: (link: LiveDocDocLink) => void;
  readonly onCreateDoc: () => void;
  readonly onCreateDocInFolder?: (folderId: string) => void;
  readonly onClose: () => void;
}

export default function LiveDocLibraryPanel({
  onOpenDoc,
  onCreateDoc,
  onCreateDocInFolder,
  onClose,
}: LiveDocLibraryPanelProps) {
  const { t } = useTranslation("chat");
  return (
    <div className={styles.panel}>
      <PanelCloseButton onClose={onClose} label={t("liveDoc.sidebar.closeLibrary")} />
      <div className={styles.split}>
        <LiveDocSidebar
          currentSlug=""
          collapsed={false}
          onToggleCollapsed={() => {}}
          onOpenDoc={onOpenDoc}
          onCreateDoc={onCreateDoc}
          onCreateDocInFolder={onCreateDocInFolder}
          standalone
        />
        <div className={styles.hintPane}>
          <FileTextIcon width={40} height={40} aria-hidden="true" />
          <p className={styles.hintTitle}>{t("liveDoc.library.title")}</p>
          <p className={styles.hintText}>{t("liveDoc.library.hint")}</p>
          <button type="button" className={styles.createBtn} onClick={onCreateDoc}>
            {t("liveDoc.sidebar.newDocument")}
          </button>
        </div>
      </div>
    </div>
  );
}
