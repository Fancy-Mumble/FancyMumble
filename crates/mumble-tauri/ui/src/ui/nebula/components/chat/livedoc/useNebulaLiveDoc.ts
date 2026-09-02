import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { liveDocKey, useAppStore, type LiveDocAnnounceInfo, type LiveDocSessionInfo } from "@core/store";
import { PLUGIN_NAME_LIVE_DOC } from "@core/constants/pluginData";
import { newDocSlug } from "@core/features/chat/livedoc/newDocSlug";
import type { LiveDocDocLink } from "@core/types";
import type { LiveDocLaunchChoice } from "@standard/components/chat/livedoc/LiveDocLaunchDialog";

interface UseNebulaLiveDocOptions {
  /** The channel the conversation pane is showing, or null for none. */
  readonly channelId: number | null;
  /** A direct message has no channel to publish a document to. */
  readonly isDm: boolean;
  /** Reports a failure on the conversation's snackbar. */
  readonly onNotice: (message: string) => void;
}

/** Everything the conversation pane needs in order to host a Live Doc. */
export interface NebulaLiveDoc {
  /** Whether the server has the live-doc plugin loaded at all. */
  readonly available: boolean;
  /** The document open in this channel, if there is one. */
  readonly session: LiveDocSessionInfo | undefined;
  /** Someone else's open document, waiting to be joined. */
  readonly announce: LiveDocAnnounceInfo | undefined;
  readonly libraryOpen: boolean;
  readonly launchOpen: boolean;
  /** True while the conversation is kept visible beneath the document. */
  readonly chatVisible: boolean;
  /** A height the reader dragged the dock to, in px, or null for the default. */
  readonly splitPx: number | null;
  readonly setSplitPx: (px: number | null) => void;
  readonly toggleChatVisible: () => void;
  /** Whether anything at all is docked above the conversation. */
  readonly docked: boolean;
  /** True while the dock has the pane to itself and the chat is put away. */
  readonly hidesChat: boolean;
  readonly openLaunch: () => void;
  readonly openLaunchInFolder: ((folderId: string) => void) | undefined;
  readonly closeLaunch: () => void;
  readonly submitLaunch: (choice: LiveDocLaunchChoice) => Promise<void>;
  readonly openLibrary: () => void;
  readonly closeLibrary: () => void;
  readonly openLibraryDoc: (link: LiveDocDocLink) => void;
  readonly joinAnnounced: () => Promise<void>;
}

/**
 * The conversation's side of Live Docs.
 *
 * Nebula draws the dock and the entry points; the document itself, its ribbon
 * and its library are Standard's, exactly as the emoji picker and the poll
 * card are. What is worth owning here is the *state around* the panel - which
 * document belongs to this channel, whether the conversation stays visible
 * beneath it, and where a freshly created document gets filed - because all of
 * it is keyed on the channel the pane happens to be showing, and none of it
 * should survive a move to another one.
 */
export function useNebulaLiveDoc({ channelId, isDm, onNotice }: UseNebulaLiveDocOptions): NebulaLiveDoc {
  // Standard's strings, deliberately: the sidebar section a new document is
  // filed under has to be the *same* section in both packs, or a person who
  // switches design finds their documents split across two headings.
  const { t } = useTranslation("chat");
  const activeServerId = useAppStore((state) => state.activeServerId);
  const activeLiveDocs = useAppStore((state) => state.activeLiveDocs);
  const pendingLiveDocAnnounces = useAppStore((state) => state.pendingLiveDocAnnounces);
  const requestOpenLiveDoc = useAppStore((state) => state.requestOpenLiveDoc);
  const clearLiveDocAnnounce = useAppStore((state) => state.clearLiveDocAnnounce);
  // The plugin is in the registry only while the server has it loaded, so
  // gating every entry point on it makes them vanish when it is disabled.
  const available = useAppStore((state) => state.pluginInfos.has(PLUGIN_NAME_LIVE_DOC));

  const key = channelId !== null ? liveDocKey(activeServerId, channelId) : null;
  const session = key !== null ? activeLiveDocs.get(key) : undefined;
  const announce = key !== null ? pendingLiveDocAnnounces.get(key) : undefined;

  const [launchOpen, setLaunchOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [splitPx, setSplitPx] = useState<number | null>(null);
  // Where the next freshly created document is filed in the sidebar.
  // `null` means the default "My documents" section.
  const createTarget = useRef<string | null>(null);

  // A document fills the pane when it opens, and the reader asks for the
  // conversation back. Closing the document, or moving to another channel,
  // forgets that they did: the next one starts where the first one did.
  useEffect(() => {
    if (!session) setChatVisible(false);
  }, [session]);

  // The library is a browse view. Once a document is open the panel takes
  // over the dock, so there is nothing left for the library to show.
  useEffect(() => {
    if (session) setLibraryOpen(false);
  }, [session]);

  // A dragged height belongs to the split it was dragged on, not to the pane.
  useEffect(() => {
    if (!chatVisible && !libraryOpen) setSplitPx(null);
  }, [chatVisible, libraryOpen]);

  const openLaunch = useCallback(() => {
    if (channelId === null) return;
    createTarget.current = null;
    setLaunchOpen(true);
  }, [channelId]);

  // "New document in this folder" from the sidebar: remember the folder so
  // the created document is filed under it rather than the default section.
  const openLaunchInFolder = useCallback(
    (folderId: string) => {
      if (channelId === null) return;
      createTarget.current = folderId;
      setLaunchOpen(true);
    },
    [channelId],
  );

  const closeLaunch = useCallback(() => setLaunchOpen(false), []);
  const openLibrary = useCallback(() => setLibraryOpen(true), []);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const toggleChatVisible = useCallback(() => setChatVisible((visible) => !visible), []);

  const openLibraryDoc = useCallback(
    (link: LiveDocDocLink) => {
      const target = link.channel ?? channelId;
      if (target === null) return;
      // A library entry with no channel is a private document; reopening it
      // must not publish it to the channel that happens to be open.
      const mode = link.channel === null ? "private" : "publish";
      void requestOpenLiveDoc(target, link.slug, link.title, { silent: true, mode }).catch((error) =>
        console.warn("live-doc open from library failed:", error),
      );
    },
    [channelId, requestOpenLiveDoc],
  );

  const submitLaunch = useCallback(
    async (choice: LiveDocLaunchChoice) => {
      if (channelId === null) {
        onNotice(t("openDocumentNoChannel"));
        setLaunchOpen(false);
        return;
      }
      setLaunchOpen(false);
      const targetFolder = createTarget.current;
      createTarget.current = null;
      if (choice.seedMarkdown) {
        useAppStore.getState().setPendingLiveDocSeed(channelId, choice.seedMarkdown);
      }
      // A brand-new document gets a unique slug so two of the same name never
      // collapse onto one; an existing one keeps its title-derived slug, which
      // is what lets it rehydrate.
      const slug = choice.mode === "new" ? newDocSlug(choice.title) : choice.title;
      try {
        await requestOpenLiveDoc(channelId, slug, choice.title, { mode: choice.visibility });
        // File a new document straight away, so it stays reachable from the
        // library once it is closed. A published document keeps its channel;
        // a private one is channel-less, which is what draws its lock.
        if (choice.mode === "new") {
          const link: LiveDocDocLink = {
            slug,
            title: choice.title,
            channel: choice.visibility === "publish" ? channelId : null,
            owned: true,
          };
          const { useLiveDocSidebarStore } = await import("@core/features/chat/livedoc/sidebarStore");
          const { saveDocLink, saveDocToDefault } = useLiveDocSidebarStore.getState();
          if (targetFolder) saveDocLink(targetFolder, link);
          else saveDocToDefault(link, t("liveDoc.sidebar.defaultSection"));
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[Nebula] requestOpenLiveDoc threw:", error);
        onNotice(t("openDocumentFailed", { detail }));
      }
    },
    [channelId, onNotice, requestOpenLiveDoc, t],
  );

  const joinAnnounced = useCallback(async () => {
    if (!announce) return;
    await requestOpenLiveDoc(announce.channelId, announce.slug, announce.title, { silent: true });
    clearLiveDocAnnounce(announce.channelId, announce.appServerId);
  }, [announce, clearLiveDocAnnounce, requestOpenLiveDoc]);

  const docked = Boolean(session) || libraryOpen;

  return {
    available,
    session,
    announce,
    libraryOpen,
    launchOpen,
    chatVisible,
    splitPx,
    setSplitPx,
    toggleChatVisible,
    docked,
    // The library always leaves the conversation where it is; only a document
    // asks for the whole pane, and only until the reader asks for chat back.
    hidesChat: Boolean(session) && !chatVisible,
    openLaunch,
    // Filing into a folder is a sidebar action on a channel's document tree,
    // and a direct message has no tree to file into.
    openLaunchInFolder: isDm ? undefined : openLaunchInFolder,
    closeLaunch,
    submitLaunch,
    openLibrary,
    closeLibrary,
    openLibraryDoc,
    joinAnnounced,
  };
}
