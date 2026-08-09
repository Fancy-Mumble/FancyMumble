import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { liveDocKey, useAppStore } from "@core/store";
import { useLiveDocSidebarStore } from "@core/features/chat/livedoc/sidebarStore";
import type { LiveDocDocLink, LiveDocFolder } from "@core/types";
import { Button, ModalSurface, TextField } from "../primitives";
import styles from "./WorkspaceSurface.module.css";

const DownloadsPanel = lazy(() => import("@ui/standard/components/chat/download/DownloadsPanel"));
const CalendarPanel = lazy(() => import("@ui/standard/components/chat/calendar/CalendarPanel"));
const RichPresencePanel = lazy(
  () => import("@ui/standard/components/chat/presence/RichPresencePanel"),
);
const LiveDocPanel = lazy(() => import("@ui/standard/components/chat/livedoc/LiveDocPanel"));

type WorkspaceTab = "documents" | "downloads" | "calendar" | "activity";

function collectDocuments(folder: LiveDocFolder): LiveDocDocLink[] {
  return [...folder.docs, ...folder.folders.flatMap(collectDocuments)];
}

export default function WorkspaceSurface({
  onClose,
  initialTab = "documents",
}: {
  onClose: () => void;
  initialTab?: WorkspaceTab;
}) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"private" | "publish">("private");
  const [status, setStatus] = useState<string | null>(null);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const selectedChannel = useAppStore((state) => state.selectedChannel);
  const activeLiveDocs = useAppStore((state) => state.activeLiveDocs);
  const requestOpenLiveDoc = useAppStore((state) => state.requestOpenLiveDoc);
  const index = useLiveDocSidebarStore((state) => state.index);
  const loaded = useLiveDocSidebarStore((state) => state.loaded);
  const load = useLiveDocSidebarStore((state) => state.load);
  const saveDocToDefault = useLiveDocSidebarStore((state) => state.saveDocToDefault);
  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);
  const documents = useMemo(() => index.sections.flatMap(collectDocuments), [index]);
  const activeDoc =
    selectedChannel == null ? undefined : activeLiveDocs.get(liveDocKey(activeServerId, selectedChannel));
  const openDocument = async (document: LiveDocDocLink) => {
    const channelId = document.channel ?? selectedChannel;
    if (channelId == null) {
      setStatus("Select a channel before opening a private document.");
      return;
    }
    try {
      await requestOpenLiveDoc(channelId, document.slug, document.title, {
        silent: true,
        mode: document.channel == null ? "private" : "publish",
      });
      setStatus(null);
    } catch (reason) {
      setStatus(String(reason));
    }
  };
  const createDocument = async () => {
    if (selectedChannel == null || !title.trim()) return;
    const slug = `${title
      .trim()
      .toLocaleLowerCase()
      .replaceAll(/[^a-z0-9_-]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")}-${Date.now().toString(36)}`;
    try {
      await requestOpenLiveDoc(selectedChannel, slug, title.trim(), { silent: true, mode: visibility });
      saveDocToDefault(
        {
          slug,
          title: title.trim(),
          channel: visibility === "publish" ? selectedChannel : null,
          owned: true,
        },
        "My documents",
      );
      setTitle("");
      setStatus(null);
    } catch (reason) {
      setStatus(String(reason));
    }
  };
  return (
    <ModalSurface
      title="Workspace"
      eyebrow="FILES, DOCUMENTS & CALENDAR"
      onClose={onClose}
      className={styles.surface}
    >
      <div className={styles.layout}>
        <nav>
          {(["documents", "downloads", "calendar", "activity"] as WorkspaceTab[]).map((item) => (
            <Button
              key={item}
              variant="bare"
              className={tab === item ? styles.active : undefined}
              onClick={() => setTab(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </Button>
          ))}
        </nav>
        <main>
          {status && <p className={styles.status}>{status}</p>}
          <Suspense fallback={<div className={styles.loading}>Loading workspace…</div>}>
            {tab === "downloads" && <DownloadsPanel />}
            {tab === "activity" && <RichPresencePanel />}
            {tab === "calendar" && <CalendarPanel />}
            {tab === "documents" &&
              (activeDoc ? (
                <div className={styles.documentEditor}>
                  <LiveDocPanel session={activeDoc} />
                </div>
              ) : (
                <div className={styles.documents}>
                  <header>
                    <div>
                      <h3>Collaborative documents</h3>
                      <p>Create a private draft or publish it to the selected channel.</p>
                    </div>
                  </header>
                  <section className={styles.create}>
                    <TextField
                      label="Document title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Meeting notes"
                    />
                    <label>
                      Visibility
                      <select
                        value={visibility}
                        onChange={(event) => setVisibility(event.target.value as "private" | "publish")}
                      >
                        <option value="private">Private until published</option>
                        <option value="publish">Publish to channel</option>
                      </select>
                    </label>
                    <Button
                      variant="primary"
                      disabled={!title.trim() || selectedChannel == null}
                      onClick={() => void createDocument()}
                    >
                      Create document
                    </Button>
                  </section>
                  <div className={styles.documentList}>
                    {documents.map((document) => (
                      <Button
                        variant="bare"
                        key={`${document.slug}-${document.channel}`}
                        onClick={() => void openDocument(document)}
                      >
                        <span>
                          <strong>{document.title}</strong>
                          <small>
                            {document.channel == null ? "Private" : `Channel #${document.channel}`} ·{" "}
                            {document.owned ? "Owned by you" : "Shared with you"}
                          </small>
                        </span>
                        <b>Open</b>
                      </Button>
                    ))}
                    {documents.length === 0 && <p>No saved document links yet.</p>}
                  </div>
                </div>
              ))}
          </Suspense>
        </main>
      </div>
    </ModalSurface>
  );
}
