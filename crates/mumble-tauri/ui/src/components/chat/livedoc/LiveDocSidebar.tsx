/**
 * LiveDocSidebar - the collapsible document-library rail shown on the
 * left of the Live Doc view.  Lists the user's sections, folders and
 * saved document links (persisted in file-server private storage) and
 * lets them open any saved document.  Fully contained within the
 * live-doc view.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  FileTextIcon,
  FolderIcon,
  PlusIcon,
} from "../../../icons";
import type { LiveDocDocLink } from "../../../types";
import { useAppStore } from "../../../store";
import PromptDialog from "../../elements/PromptDialog";
import { openPrompt } from "../../elements/promptDialogStore";
import { useLiveDocSidebarStore } from "./sidebarStore";
import LiveDocSidebarTree from "./LiveDocSidebarTree";
import styles from "./LiveDocSidebar.module.css";

interface LiveDocSidebarProps {
  readonly currentSlug: string;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onOpenDoc: (link: LiveDocDocLink) => void;
  /** Optional "create a new document" action shown in the header. */
  readonly onCreateDoc?: () => void;
  /** Optional "create a new document under this folder" action shown on
   *  each folder/section row. */
  readonly onCreateDocInFolder?: (folderId: string) => void;
  /** Called when a saved document link is renamed and that document is the
   *  one currently open, so the editor title can update live. */
  readonly onRenameActiveDoc?: (slug: string, title: string) => void;
  /** When true the sidebar is shown on its own (document library view):
   *  the collapse control is replaced by a close button. */
  readonly standalone?: boolean;
  readonly onClose?: () => void;
}

export default function LiveDocSidebar({
  currentSlug,
  collapsed,
  onToggleCollapsed,
  onOpenDoc,
  onCreateDoc,
  onCreateDocInFolder,
  onRenameActiveDoc,
  standalone = false,
  onClose,
}: LiveDocSidebarProps) {
  const { t } = useTranslation("chat");
  const load = useLiveDocSidebarStore((s) => s.load);
  const loaded = useLiveDocSidebarStore((s) => s.loaded);
  const available = useLiveDocSidebarStore((s) => s.available);
  const reason = useLiveDocSidebarStore((s) => s.reason);
  const index = useLiveDocSidebarStore((s) => s.index);
  const addSection = useLiveDocSidebarStore((s) => s.addSection);

  // The file-server credentials needed to read private storage arrive
  // asynchronously after connecting.  Reload whenever they become available
  // so an early load (which fell back to an empty in-memory index) is
  // corrected once the user's registered session is ready.
  const credsReady = useAppStore(
    (s) => !!(s.fileServerConfig?.registered && s.fileServerConfig?.sessionJwt),
  );

  useEffect(() => {
    if (!loaded || credsReady) void load();
  }, [loaded, credsReady, load]);

  const onAddSection = () => {
    void openPrompt({
      title: t("liveDoc.sidebar.newSection"),
      label: t("liveDoc.sidebar.newSectionPrompt"),
    }).then((name) => {
      if (name?.trim()) addSection(name);
    });
  };

  if (collapsed && !standalone) {
    return (
      <div className={`${styles.sidebar} ${styles.collapsed}`}>
        <div className={styles.header}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onToggleCollapsed}
            title={t("liveDoc.sidebar.expand")}
            aria-label={t("liveDoc.sidebar.expand")}
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.sidebar} ${standalone ? styles.standalone : ""}`}>
      <div className={styles.header}>
        <FolderIcon width={15} height={15} aria-hidden="true" />
        <span className={styles.headerTitle}>{t("liveDoc.sidebar.title")}</span>
        {onCreateDoc && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onCreateDoc}
            title={t("liveDoc.sidebar.newDocument")}
            aria-label={t("liveDoc.sidebar.newDocument")}
          >
            <FileTextIcon width={16} height={16} />
          </button>
        )}
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onAddSection}
          title={t("liveDoc.sidebar.newSection")}
          aria-label={t("liveDoc.sidebar.newSection")}
        >
          <PlusIcon width={16} height={16} />
        </button>
        {standalone ? (
          onClose && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              title={t("liveDoc.sidebar.closeLibrary")}
              aria-label={t("liveDoc.sidebar.closeLibrary")}
            >
              <CloseIcon width={16} height={16} />
            </button>
          )
        ) : (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onToggleCollapsed}
            title={t("liveDoc.sidebar.collapse")}
            aria-label={t("liveDoc.sidebar.collapse")}
          >
            <ChevronLeftIcon width={16} height={16} />
          </button>
        )}
      </div>
      <div className={styles.body}>
        {!available && loaded && reason === "guest" && (
          <div className={styles.warning} role="status">
            ⚠ {t("liveDoc.sidebar.guestHint")}
          </div>
        )}
        {!available && loaded && reason === "error" && (
          <div className={styles.warning} role="alert">
            ⚠ {t("liveDoc.sidebar.errorHint", { defaultValue: "Couldn't load your documents from the server." })}{" "}
            <button type="button" className={styles.retryBtn} onClick={() => void load()}>
              {t("liveDoc.sidebar.retry", { defaultValue: "Retry" })}
            </button>
          </div>
        )}
        <LiveDocSidebarTree
          sections={index.sections}
          currentSlug={currentSlug}
          onOpenDoc={onOpenDoc}
          onCreateDocInFolder={onCreateDocInFolder}
          onRenameActiveDoc={onRenameActiveDoc}
        />
      </div>
      <PromptDialog />
    </div>
  );
}
