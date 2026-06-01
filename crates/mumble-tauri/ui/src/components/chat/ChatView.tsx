import { ChevronDownIcon, HandIcon, MessageCircleIcon } from "../../icons";
import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useAppStore, liveDocKey } from "../../store";
import type { ChatMessage, TimeFormat, LiveDocDocLink } from "../../types";
import { getPreferences } from "../../preferencesStorage";
import { loadPersonalization, type PersonalizationData } from "../../personalizationStorage";
import ChatHeader from "./ChatHeader";
import type { BroadcastInfo } from "./ChatHeader";
import MobileCallControls from "./mobile/MobileCallControls";
const PinnedMessagesPanel = lazy(() => import("./pinned/PinnedMessagesPanel"));
const DownloadsPanel = lazy(() => import("./download/DownloadsPanel"));
import UploadProgressItem, { type UploadPlaceholder } from "./upload/UploadProgressItem";
import PendingMessageItem from "./pending/PendingMessageItem";
import ChatComposer from "./ChatComposer";
import { usePolls } from "./poll/usePolls";
import { useReactions } from "./reaction/useReactions";
const MessageContextMenu = lazy(() => import("./message/MessageContextMenu"));
const MobileMessageActionSheet = lazy(() => import("./mobile/MobileMessageActionSheet"));
import MessageSelectionBar from "./message/MessageSelectionBar";
import ConfirmDialog from "../elements/ConfirmDialog";
import Toast from "../elements/Toast";
import type { FileShareChoice } from "./file/FileShareDialog";
const FileShareDialog = lazy(() => import("./file/FileShareDialog"));
import { encodeFileAttachmentMarker, decodeFileAttachmentPayload, previewKindForFilename, FANCY_FILE_MARKER_RE, type FileAttachmentInfo } from "./file/FileAttachmentCard";
import { usePersistentChat } from "../security/PersistentChatOverlays";
import { BannerStack } from "../security/InfoBanner";
import { useUserAvatars } from "../../lazyBlobs";
import ChatMessageList from "./ChatMessageList";
import QuotePreviewStrip from "./quote/QuotePreviewStrip";
import PendingAttachmentsStrip from "./pending/PendingAttachmentsStrip";
import type { PendingAttachment } from "./pending/PendingAttachmentsStrip";
import { useDragDropAttachments } from "./useDragDropAttachments";
import MentionPopover from "./mention/MentionPopover";
import { useChatSend } from "./useChatSend";
import { useChatScroll } from "./useChatScroll";
import { useMessageSelection } from "./message/useMessageSelection";
import { useReadReceipts } from "./readreceipt/useReadReceipts";
import { useTypingIndicator } from "./typing/useTypingIndicator";
import TypingIndicator from "./typing/TypingIndicator";
import { isMobile } from "../../utils/platform";
import { htmlToMarkdown } from "./markdown/MarkdownInput";
import type { MessageScope } from "../../messageOffload";
import { useScreenShare } from "./stream/useScreenShare";
import ScreenShareViewer, { BroadcastBanner, WebRtcErrorBanner } from "./stream/ScreenShareViewer";
const LiveDocPanel = lazy(() => import("./livedoc/LiveDocPanel"));
const LiveDocLaunchDialog = lazy(() => import("./livedoc/LiveDocLaunchDialog"));
const LiveDocLibraryPanel = lazy(() => import("./livedoc/LiveDocLibraryPanel"));
import LiveDocBanner from "./livedoc/LiveDocBanner";
import { useLiveDocSidebarStore } from "./livedoc/sidebarStore";
import type { LiveDocLaunchChoice } from "./livedoc/LiveDocLaunchDialog";
import {
  useLiveDocDropStore,
  resolveDropTarget,
  type LiveDocDropMode,
} from "./livedoc/liveDocDropStore";

/** Build a URL-safe, *unique* slug for a brand-new document so two docs
 *  that share a title (e.g. the default "Untitled") never collapse onto
 *  the same server-side document or the same sidebar entry. */
function newDocSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const rand = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${rand}` : `doc-${rand}`;
}
import ActiveWatchBanner from "./watch/ActiveWatchBanner";
import styles from "./ChatView.module.css";
import { Lightbox, type LightboxHandle } from "../elements/Lightbox";

const PollCreator = lazy(() => import("./poll/PollCreator"));
const EmojiPicker = lazy(() => import("../elements/EmojiPicker"));
const StreamFocusView = lazy(() => import("./stream/StreamFocusView"));
const MultiStreamGrid = lazy(() => import("./stream/MultiStreamGrid"));

/**
 * Minimum Fancy Mumble server version required for screen sharing.
 * Encoded as (major << 48) | (minor << 32) | (patch << 16).
 * 0.2.12 = (0 << 48) | (2 << 32) | (12 << 16)
 */
const SCREEN_SHARE_MIN_VERSION = 2 * 2 ** 32 + 12 * 2 ** 16;


interface ChatViewProps {
  readonly onChannelInfoToggle?: () => void;
  readonly onChannelSearch?: () => void;
  readonly scrollToMessageId?: string | null;
  readonly onScrollConsumed?: () => void;
  /**
   * True when this `ChatView` is hosted inside a DM popout window.
   * Suppresses features that don't make sense in the popout context:
   *   - the "Pop out DM" header button (we are already a popout)
   *   - screen-share controls (popout is DM-only and would create a
   *     parallel WebRTC peer connection from a second webview)
   */
  readonly inPopout?: boolean;
}

/** Compute chat header label and member count based on the active mode. */
function computeHeader(
  isDmMode: boolean,
  dmPartner: { name: string } | undefined,
  channel: { name: string } | undefined,
  memberCount: number,
  fallbackDm: string,
  fallbackChannel: string,
): [string, number] {
  if (isDmMode) return [dmPartner?.name ?? fallbackDm, 0];
  return [channel?.name ?? fallbackChannel, memberCount];
}

/** Find the first poppable image source in a message body, or null if none. */
function findPopOutImageSrc(body: string): string | null {
  const inline = /<img[^>]+src="([^"]+)"/i.exec(body);
  if (inline?.[1]) return inline[1];
  const fileMatch = FANCY_FILE_MARKER_RE.exec(body);
  if (fileMatch) {
    const info: FileAttachmentInfo | null = decodeFileAttachmentPayload(fileMatch[1]);
    if (info && previewKindForFilename(info.filename) === "image" && info.mode === "public") {
      return info.url;
    }
  }
  return null;
}

export default function ChatView({ onChannelInfoToggle, onChannelSearch, scrollToMessageId, onScrollConsumed, inPopout = false }: ChatViewProps) {
  const { t } = useTranslation("chat");
  const channels = useAppStore((s) => s.channels);
  const users = useAppStore((s) => s.users);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const currentChannel = useAppStore((s) => s.currentChannel);
  const messages = useAppStore((s) => s.messages);
  const joinChannel = useAppStore((s) => s.joinChannel);
  const ownSession = useAppStore((s) => s.ownSession);
  const selectUser = useAppStore((s) => s.selectUser);
  const toggleSilenceChannel = useAppStore((s) => s.toggleSilenceChannel);
  const silencedChannels = useAppStore((s) => s.silencedChannels);
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const sfuAvailable = useAppStore((s) => s.serverConfig.webrtc_sfu_available);
  const webrtcError = useAppStore((s) => s.webrtcError);
  const pinMessage = useAppStore((s) => s.pinMessage);
  const clearUnseenPins = useAppStore((s) => s.clearUnseenPins);
  const unseenPinIds = useAppStore((s) => s.unseenPinIds);
  const clearWebRtcError = useCallback(() => useAppStore.setState({ webrtcError: null }), []);

  // DM state
  const selectedDmUser = useAppStore((s) => s.selectedDmUser);
  const dmMessages = useAppStore((s) => s.dmMessages);
  const pendingMessages = useAppStore((s) => s.pendingMessages);

  const isDmMode = selectedDmUser !== null;
  const dmPartner = isDmMode ? users.find((u) => u.session === selectedDmUser) : undefined;

  const [draft, setDraft] = useState("");
  const [pendingQuotes, setPendingQuotes] = useState<ChatMessage[]>([]);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [showDownloadsPanel, setShowDownloadsPanel] = useState(false);
  const {
    polls, pollMessages, showPollCreator, openPollCreator, closePollCreator,
    handlePollCreate, handlePollVote,
  } = usePolls();

  // Time display preferences (loaded once from persistent storage).
  const [timeFormat, setTimeFormat] = useState<TimeFormat>("auto");
  const [convertToLocalTime, setConvertToLocalTime] = useState(true);
  const [systemUses24h, setSystemUses24h] = useState<boolean | undefined>(undefined);

  const [personalization, setPersonalization] = useState<PersonalizationData>({
    chatBgOriginal: null,
    chatBgBlurred: null,
    chatBgBlurSigma: 0,
    chatBgOpacity: 0.25,
    chatBgDim: 0.5,
    chatBgFit: "cover",
    bubbleStyle: "bubbles",
    fontSize: "medium",
    fontSizeCustomPx: 14,
    fontFamily: "system",
    compactMode: false,
    channelViewerStyle: "modern",
    theme: "dark",
    alwaysShowMessageActions: false,
  });

  useEffect(() => {
    getPreferences().then((prefs) => {
      setTimeFormat(prefs.timeFormat);
      setConvertToLocalTime(prefs.convertToLocalTime);
    });
    loadPersonalization().then(setPersonalization).catch(() => { /* keep defaults */ });
    invoke<"12h" | "24h" | null>("get_system_clock_format")
      .then((fmt) => {
        if (fmt !== null) setSystemUses24h(fmt === "24h");
      })
      .catch(() => { /* leave undefined - fall back to Intl */ });
  }, []);

  /** Build the `MessageScope` for the current chat mode. */
  const currentScope = useCallback((): MessageScope | null => {
    if (isDmMode && selectedDmUser !== null) return { scope: "dm", scopeId: String(selectedDmUser) };
    if (selectedChannel !== null) return { scope: "channel", scopeId: String(selectedChannel) };
    return null;
  }, [isDmMode, selectedDmUser, selectedChannel]);

  const channel = channels.find((c) => c.id === selectedChannel);
  const memberCount = users.filter(
    (u) => u.channel_id === selectedChannel,
  ).length;
  const isInChannel = currentChannel === selectedChannel;

  /** Map session -> avatar data-URL for message avatars (lazy-fetched). */
  const avatarBySession = useUserAvatars(users);

  /** Map session -> UserEntry for quick lookup. */
  const userBySession = useMemo(() => {
    const map = new Map<number, (typeof users)[number]>();
    for (const u of users) {
      map.set(u.session, u);
    }
    return map;
  }, [users]);

  /** Map cert-hash -> UserEntry for resolving stored messages after reconnect. */
  const userByHash = useMemo(() => {
    const map = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.hash) map.set(u.hash, u);
    }
    return map;
  }, [users]);

  /** Map cert-hash -> avatar data-URL for hash-based avatar lookup. */
  const avatarByHash = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      if (u.hash) {
        const url = avatarBySession.get(u.session);
        if (url) map.set(u.hash, url);
      }
    }
    return map;
  }, [users, avatarBySession]);

  // Persistent chat hook (banners, key verification, custodian prompt).
  const persistent = usePersistentChat(
    isDmMode ? null : selectedChannel,
    channel?.name ?? t("header.unknown"),
  );

  /** Merge real messages with local-only poll messages for rendering. */
  const allMessages = useMemo(() => {
    if (isDmMode) {
      return dmMessages;
    }
    const channelPolls = pollMessages.filter(
      (m) => m.channel_id === selectedChannel,
    );
    return [...messages, ...channelPolls];
  }, [isDmMode, dmMessages, messages, pollMessages, selectedChannel]);

  /** Pending optimistic messages scoped to the current channel / DM. */
  const scopedPending = useMemo(() => {
    if (isDmMode) {
      return pendingMessages.filter((p) => p.dmSession === selectedDmUser);
    }
    return pendingMessages.filter((p) => p.channelId === selectedChannel);
  }, [pendingMessages, isDmMode, selectedDmUser, selectedChannel]);

  const hasNewPins = selectedChannel !== null
    && (unseenPinIds.get(selectedChannel)?.size ?? 0) > 0;

  const channelUnseenPinSet = useMemo(
    () => (selectedChannel !== null
      ? unseenPinIds.get(selectedChannel) ?? new Set<string>()
      : new Set<string>()),
    [unseenPinIds, selectedChannel],
  );

  // Ordered message IDs for read-receipt watermark comparison.
  const allMessageIds = useMemo(
    () => allMessages.map((m) => m.message_id).filter((id): id is string => id != null),
    [allMessages],
  );

  // Auto-send read receipts and query on channel switch.
  const lastMessageId = allMessageIds[allMessageIds.length - 1];
  useReadReceipts(
    isDmMode ? null : selectedChannel,
    lastMessageId,
  );

  // Send typing indicators with debouncing.
  const { notifyTyping, resetTyping } = useTypingIndicator();

  // --- Extracted hooks ---------------------------------------------

  const {
    messagesContainerRef, bottomSentinelRef, messagesInnerRef,
    newMsgCount, lastReadIdx, restoringKeys, handleScrollToBottom,
  } = useChatScroll({ allMessages, selectedChannel, selectedDmUser, currentScope });

  const lightboxRef = useRef<LightboxHandle>(null);

  const handleEdit = useCallback((msg: ChatMessage) => {
    setEditingMessage(msg);
    setDraft(htmlToMarkdown(msg.body));
  }, []);

  const handlePin = useCallback((msg: ChatMessage) => {
    if (!msg.message_id) return;
    const channelId = msg.channel_id ?? selectedChannel ?? 0;
    pinMessage(channelId, msg.message_id, !!msg.pinned);
  }, [selectedChannel, pinMessage]);

  const activeServerId = useAppStore((s) => s.activeServerId);
  const sessions = useAppStore((s) => s.sessions);
  const handlePopOutDm = useCallback(() => {
    if (!isDmMode || !dmPartner) return;
    const session = sessions.find((s) => s.id === activeServerId);
    const payload = {
      server_id: activeServerId ?? "",
      server_label: session?.label ?? session?.host ?? null,
      user_session: dmPartner.session,
      user_name: dmPartner.name,
      user_hash: dmPartner.hash ?? null,
    };
    invoke("open_dm_popout", { payload }).catch((err) => {
      console.error("Failed to open DM popout:", err);
    });
  }, [isDmMode, dmPartner, sessions, activeServerId]);

  const handlePopOutImage = useCallback((msg: ChatMessage, src: string) => {
    const captionRaw = msg.body
      .replaceAll(/<!--[\s\S]*?-->/g, "")
      .replaceAll(/<img\b[^>]*>/gi, "")
      .replaceAll(/<br\s*\/?>/gi, "\n")
      .replaceAll(/<[^>]*>/g, "")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&")
      .trim();
    const caption = captionRaw.length > 0 ? captionRaw.slice(0, 280) : null;
    const senderAvatar = msg.sender_hash ? avatarByHash.get(msg.sender_hash) ?? null : null;
    const payload = {
      src,
      sender_name: msg.sender_name || null,
      sender_avatar: senderAvatar,
      caption,
      timestamp_ms: msg.timestamp ?? null,
    };
    invoke("open_image_popout", { payload }).catch((err) => {
      console.error("Failed to open image popout:", err);
    });
  }, [avatarByHash]);

  const handleOpenPinnedPanel = useCallback(() => {
    setShowPinnedPanel(true);
    if (selectedChannel !== null) clearUnseenPins(selectedChannel);
  }, [selectedChannel, clearUnseenPins]);

  const handleClosePinnedPanel = useCallback(() => {
    setShowPinnedPanel(false);
  }, []);

  const markDownloadsSeen = useAppStore((s) => s.markDownloadsSeen);
  const unseenDownloadCount = useAppStore((s) => s.unseenDownloadCount);
  const handleOpenDownloadsPanel = useCallback(() => {
    setShowDownloadsPanel(true);
    markDownloadsSeen();
  }, [markDownloadsSeen]);
  const handleCloseDownloadsPanel = useCallback(() => {
    setShowDownloadsPanel(false);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingMessage(null);
    setDraft("");
  }, []);

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
    if (value) notifyTyping();
  }, [notifyTyping]);

  useEffect(() => {
    setEditingMessage(null);
    setShowPinnedPanel(false);
    setUploadPlaceholders([]);
  }, [selectedChannel, selectedDmUser]);

  const {
    canDelete, selectionMode, selectedMsgIds,
    msgContextMenu, deleteConfirm, isDeleting, toast,
    toggleMsgSelection, enterSelectionMode, exitSelectionMode,
    handleMessageContextMenu, handleSingleDelete, handleBulkDelete, confirmDelete,
    handleTouchStart, cancelLongPress,
    handleCite, handleCopyText,
    handleScrollToMessage, removePendingQuote,
    closeContextMenu, clearDeleteConfirm, clearToast, showToast,
  } = useMessageSelection({
    selectedChannel, selectedDmUser,
    channel, messagesContainerRef, setPendingQuotes,
  });

  // Scroll to and highlight a message when navigating from search results.
  useEffect(() => {
    if (!scrollToMessageId || messages.length === 0) return;
    let attempts = 0;
    const tryScroll = () => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(
        `[data-msg-id="${CSS.escape(scrollToMessageId)}"]`,
      );
      if (el) {
        handleScrollToMessage(scrollToMessageId);
        onScrollConsumed?.();
        return;
      }
      if (attempts < 8) {
        attempts++;
        setTimeout(tryScroll, 150);
      } else {
        onScrollConsumed?.();
      }
    };
    requestAnimationFrame(tryScroll);
  }, [scrollToMessageId, messages, handleScrollToMessage, messagesContainerRef, onScrollConsumed]);

  const { sending, handleSend, sendMediaFile, handlePaste, handleGifSelect } = useChatSend({
    pendingQuotes,
    clearQuotes: () => setPendingQuotes([]),
    draft,
    clearDraft: () => setDraft(""),
    editingMessage,
    onEditComplete: cancelEdit,
    showToast,
  });

  const fileServerConfig = useAppStore((s) => s.fileServerConfig);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const sendMessageAction = useAppStore((s) => s.sendMessage);
  const sendDmAction = useAppStore((s) => s.sendDm);
  const [isUploading, setIsUploading] = useState(false);
  const [shareDialog, setShareDialog] = useState<{ filePath: string; filename: string } | null>(null);
  const [uploadPlaceholders, setUploadPlaceholders] = useState<UploadPlaceholder[]>([]);


  const activeLiveDocs = useAppStore((s) => s.activeLiveDocs);
  const pendingLiveDocAnnounces = useAppStore((s) => s.pendingLiveDocAnnounces);
  const requestOpenLiveDoc = useAppStore((s) => s.requestOpenLiveDoc);
  const clearLiveDocAnnounce = useAppStore((s) => s.clearLiveDocAnnounce);

  const liveDocLookupKey =
    selectedChannel != null ? liveDocKey(activeServerId, selectedChannel) : null;
  const activeLiveDoc = liveDocLookupKey != null ? activeLiveDocs.get(liveDocLookupKey) : undefined;
  const pendingLiveDocAnnounce =
    liveDocLookupKey != null ? pendingLiveDocAnnounces.get(liveDocLookupKey) : undefined;

  const [showLiveDocLaunch, setShowLiveDocLaunch] = useState(false);
  const [showLiveDocLibrary, setShowLiveDocLibrary] = useState(false);
  // Folder/section the next freshly-created document should be filed
  // under in the sidebar.  `null` = the default "My documents" section.
  const liveDocCreateTargetRef = useRef<string | null>(null);
  const saveDocLink = useLiveDocSidebarStore((s) => s.saveDocLink);
  const saveDocToDefault = useLiveDocSidebarStore((s) => s.saveDocToDefault);
  const [liveDocCompactChat, setLiveDocCompactChat] = useState(false);
  // Reset compact-chat toggle whenever the live doc closes or the channel changes.
  useEffect(() => {
    if (!activeLiveDoc) setLiveDocCompactChat(false);
  }, [activeLiveDoc]);
  // The library is a standalone browse view; once a document is open the
  // panel takes over, so dismiss the library.
  useEffect(() => {
    if (activeLiveDoc) setShowLiveDocLibrary(false);
  }, [activeLiveDoc]);
  const toggleLiveDocCompactChat = useCallback(() => {
    setLiveDocCompactChat((v) => !v);
  }, []);

  const handleOpenLiveDoc = useCallback(() => {
    if (selectedChannel === null) return;
    liveDocCreateTargetRef.current = null;
    setShowLiveDocLaunch(true);
  }, [selectedChannel]);

  // "New document in this folder" from the sidebar: remember the target
  // folder so the launch handler files the created doc there.
  const handleCreateDocInFolder = useCallback(
    (folderId: string) => {
      if (selectedChannel === null) return;
      liveDocCreateTargetRef.current = folderId;
      setShowLiveDocLaunch(true);
    },
    [selectedChannel],
  );

  const handleOpenDocLibrary = useCallback(() => {
    setShowLiveDocLibrary(true);
  }, []);

  const handleOpenLibraryDoc = useCallback(
    (link: LiveDocDocLink) => {
      const channelId = link.channel ?? selectedChannel;
      if (channelId === null) return;
      const mode = link.channel === null ? "private" : "publish";
      void requestOpenLiveDoc(channelId, link.slug, link.title, { silent: true, mode }).catch(
        (e) => console.warn("live-doc open from library failed:", e),
      );
    },
    [requestOpenLiveDoc, selectedChannel],
  );

  const handleLiveDocLaunchSubmit = useCallback(
    async (choice: LiveDocLaunchChoice) => {
      console.log("[ChatView] handleLiveDocLaunchSubmit:", { selectedChannel, choice });
      if (selectedChannel === null) {
        console.warn("[ChatView] live-doc submit aborted: no channel selected");
        showToast({ message: "Cannot open document: no channel selected.", variant: "error" });
        setShowLiveDocLaunch(false);
        return;
      }
      setShowLiveDocLaunch(false);
      const targetFolderId = liveDocCreateTargetRef.current;
      liveDocCreateTargetRef.current = null;
      if (choice.seedMarkdown) {
        useAppStore.getState().setPendingLiveDocSeed(selectedChannel, choice.seedMarkdown);
      }
      // A brand-new document gets a unique slug so it never collides with
      // another doc of the same title; opening an existing one keeps using
      // its title-derived slug for rehydration.
      const slug = choice.mode === "new" ? newDocSlug(choice.title) : choice.title;
      try {
        await requestOpenLiveDoc(selectedChannel, slug, choice.title, {
          mode: choice.visibility,
        });
        // File the freshly-created document into the sidebar so it stays in
        // "My documents" and can be reopened later.  Published docs keep
        // their channel; private docs are channel-less (lock icon).
        if (choice.mode === "new") {
          const link: LiveDocDocLink = {
            slug,
            title: choice.title,
            channel: choice.visibility === "publish" ? selectedChannel : null,
            owned: true,
          };
          if (targetFolderId) {
            saveDocLink(targetFolderId, link);
          } else {
            saveDocToDefault(link, t("liveDoc.sidebar.defaultSection"));
          }
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error("[ChatView] requestOpenLiveDoc threw:", e);
        showToast({ message: `Failed to open document: ${detail}`, variant: "error" });
      }
    },
    [selectedChannel, requestOpenLiveDoc, showToast, saveDocLink, saveDocToDefault, t],
  );

  const handleJoinLiveDoc = useCallback(async () => {
    if (!pendingLiveDocAnnounce) return;
    await requestOpenLiveDoc(
      pendingLiveDocAnnounce.channelId,
      pendingLiveDocAnnounce.slug,
      pendingLiveDocAnnounce.title,
      { silent: true },
    );
    clearLiveDocAnnounce(
      pendingLiveDocAnnounce.channelId,
      pendingLiveDocAnnounce.appServerId,
    );
  }, [pendingLiveDocAnnounce, requestOpenLiveDoc, clearLiveDocAnnounce]);

  const handleAttachFile = useCallback(async () => {
    if (selectedChannel === null) return;
    if (!fileServerConfig) {
      showToast({
        message: "File sharing is not enabled on this server.",
        variant: "error",
      });
      return;
    }
    if (!fileServerConfig.canShareFiles) {
      showToast({
        message: "You don't have permission to share files in this channel.",
        variant: "error",
      });
      return;
    }
    if (isUploading) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: false, directory: false });
      if (typeof picked !== "string") return;
      const filename = picked.replaceAll("\\", "/").split("/").pop() ?? "file";
      setShareDialog({ filePath: picked, filename });
    } catch (e) {
      console.error("file picker failed:", e);
      const detail = e instanceof Error ? e.message : String(e);
      showToast({ message: `File picker failed: ${detail}`, variant: "error" });
    }
  }, [fileServerConfig, selectedChannel, isUploading, showToast]);

  const performUpload = useCallback(async (
    filePath: string,
    filename: string,
    choice: FileShareChoice,
  ) => {
    if (selectedChannel === null) return;
    const placeholderId = globalThis.crypto?.randomUUID?.() ?? `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setUploadPlaceholders((prev) => [...prev, { id: placeholderId, filename, state: "uploading" }]);
    // Scroll to show the placeholder after React re-renders.
    requestAnimationFrame(() => {
      const el = messagesContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    setIsUploading(true);
    let unlisten: (() => void) | undefined;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ uploadId: string; bytesSent: number; totalBytes: number }>(
        "upload-progress",
        (event) => {
          if (event.payload.uploadId !== placeholderId) return;
          // Cap at 99: the stream is fully consumed but the server is still
          // processing/responding. We never show 100% until the placeholder is
          // removed on success, so the user can see "still in progress".
          const pct =
            event.payload.totalBytes > 0
              ? Math.min(99, Math.round((event.payload.bytesSent / event.payload.totalBytes) * 100))
              : 0;
          setUploadPlaceholders((prev) =>
            prev.map((p) => (p.id === placeholderId ? { ...p, progress: pct } : p)),
          );
        },
      );
      const resp = await uploadFile({
        filePath,
        channelId: selectedChannel,
        mode: choice.mode,
        password: choice.password,
        filename,
        uploadId: placeholderId,
      });
      const info: FileAttachmentInfo = {
        url: resp.download_url,
        filename,
        sizeBytes: resp.size_bytes,
        mode: resp.access_mode,
        expiresAt: resp.expires_at,
      };
      const marker = encodeFileAttachmentMarker(info);
      const body = choice.message ? `${choice.message}\n${marker}` : marker;
      if (selectedDmUser !== null) {
        await sendDmAction(selectedDmUser, body);
      } else {
        await sendMessageAction(selectedChannel, body);
      }
      setUploadPlaceholders((prev) => prev.filter((p) => p.id !== placeholderId));
    } catch (e) {
      console.error("file upload failed:", e);
      const detail = e instanceof Error ? e.message : String(e);
      // A cancelled upload is silently discarded - the placeholder is already
      // removed by handleCancelUpload, so there is nothing to show.
      if (detail === "upload cancelled") return;
      setUploadPlaceholders((prev) =>
        prev.map((p) =>
          p.id === placeholderId ? { ...p, state: "error" as const, errorMessage: detail } : p,
        ),
      );
    } finally {
      unlisten?.();
      setIsUploading(false);
    }
  }, [selectedChannel, selectedDmUser, uploadFile, sendMessageAction, sendDmAction, messagesContainerRef]);

  const handleShareDialogSubmit = useCallback((choice: FileShareChoice) => {
    const ctx = shareDialog;
    setShareDialog(null);
    if (ctx) void performUpload(ctx.filePath, ctx.filename, choice);
  }, [shareDialog, performUpload]);

  const handleShareDialogCancel = useCallback(() => setShareDialog(null), []);

  // -- Drag-drop preview ----------------------------------------------
  const canDropAttachments = isDmMode || selectedChannel !== null;

  const liveDocDropMode: LiveDocDropMode = (() => {
    if (!activeLiveDoc) return "none";
    return liveDocCompactChat ? "half" : "max";
  })();

  const resolveDragTarget = useCallback(
    (x: number, y: number) =>
      resolveDropTarget({
        mode: liveDocDropMode,
        point: { x, y },
        liveDocRect: useLiveDocDropStore.getState().getRect?.() ?? null,
      }),
    [liveDocDropMode],
  );

  const handleLiveDocFiles = useCallback(async (items: PendingAttachment[]) => {
    const insertImages = useLiveDocDropStore.getState().insertImages;
    if (!insertImages) return;
    const files: File[] = [];
    for (const att of items) {
      if (!att.isImage) continue;
      try {
        let file = att.file;
        if (!file && att.path) {
          const res = await fetch(convertFileSrc(att.path));
          const blob = await res.blob();
          file = new File([blob], att.name, { type: blob.type || "image/png" });
        }
        if (file) files.push(file);
      } catch (e) {
        console.error("read live-doc image failed:", e);
      }
    }
    if (files.length > 0) insertImages(files);
  }, []);

  const {
    attachments: pendingAttachments,
    setAttachments: setPendingAttachments,
    dragTarget,
    removeAttachment,
  } = useDragDropAttachments({
    enabled: canDropAttachments,
    resolveTarget: resolveDragTarget,
    onLiveDocFiles: handleLiveDocFiles,
  });

  useEffect(() => {
    useLiveDocDropStore.getState().setDragOver(dragTarget === "livedoc");
  }, [dragTarget]);

  const sendPendingAttachments = useCallback(async () => {
    if (pendingAttachments.length === 0) return;
    const remaining = [...pendingAttachments];
    setPendingAttachments([]);
    for (const att of remaining) {
      if (att.isImage) {
        try {
          let file = att.file;
          if (!file && att.path) {
            const res = await fetch(convertFileSrc(att.path));
            const blob = await res.blob();
            file = new File([blob], att.name, { type: blob.type || "image/png" });
          }
          if (file) await sendMediaFile(file);
        } catch (e) {
          console.error("send image attachment failed:", e);
          showToast({
            message: `Failed to send ${att.name}: ${e instanceof Error ? e.message : String(e)}`,
            variant: "error",
          });
        }
      } else if (att.path) {
        setShareDialog({ filePath: att.path, filename: att.name });
        return;
      } else {
        showToast({
          message: `Cannot share ${att.name}: missing file path.`,
          variant: "error",
        });
      }
    }
  }, [pendingAttachments, setPendingAttachments, sendMediaFile, showToast]);

  const handleSendAndResetTyping = useCallback(async () => {
    // Send any pending drag-dropped attachments first, then the text message.
    await sendPendingAttachments();
    await handleSend();
    resetTyping();
  }, [handleSend, resetTyping, sendPendingAttachments]);

  const handleDismissUpload = useCallback((id: string) => {
    setUploadPlaceholders((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleCancelUpload = useCallback((id: string) => {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("cancel_upload", { uploadId: id }),
    );
    setUploadPlaceholders((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const {
    emojiPicker, handleReaction, handleMoreReactions,
    closeEmojiPicker, handleEmojiSelect,
    getMessageReactions, toggleReaction,
  } = useReactions();

  const screenShare = useScreenShare();

  // Determine which screen share panel to show (own broadcast or watching someone).
  // watchingSession takes priority: a broadcaster can watch another stream.
  // If the watched stream is currently displayed in a detached popout window,
  // suppress the in-chat panel so we do not run two viewer peer connections
  // for the same broadcaster.  When the popout closes, the popped-out set
  // clears and the in-chat viewer (or banner) reappears automatically.
  const poppedOutStreamSessions = useAppStore((s) => s.poppedOutStreamSessions);
  let activeScreenShare: { session: number; isOwn: boolean; stream: MediaStream | null } | null = null;
  if (screenShare.watchingSession !== null
      && !poppedOutStreamSessions.has(screenShare.watchingSession)) {
    activeScreenShare = { session: screenShare.watchingSession, isOwn: false, stream: null };
  } else if (screenShare.isBroadcasting) {
    activeScreenShare = { session: ownSession!, isOwn: true, stream: screenShare.localStream };
  }

  // Other users broadcasting in the current channel (for the notification banner).
  // Sessions whose stream is already open in a detached popout window are
  // excluded so the user does not see a redundant "watch" prompt.
  const channelBroadcasters = useMemo(() => {
    if (screenShare.broadcastingSessions.size === 0) return [];
    return users
      .filter((u) => u.channel_id === selectedChannel
        && screenShare.broadcastingSessions.has(u.session)
        && u.session !== ownSession
        && !poppedOutStreamSessions.has(u.session))
      .map((u) => ({ session: u.session, name: u.name }));
  }, [users, selectedChannel, screenShare.broadcastingSessions, ownSession, poppedOutStreamSessions]);

  // Show StreamFocusView when watching someone, or broadcasting with others.
  // Using a single instance keeps layout state stable across swap transitions.
  const showFocusView = activeScreenShare !== null && (
    !activeScreenShare.isOwn || channelBroadcasters.length > 0
  );

  // Secondary panels for the unified focus view.
  const focusViewSecondaries = useMemo(() => {
    if (!activeScreenShare) return [];
    const secondaries: { session: number; name: string }[] = [];
    if (!activeScreenShare.isOwn && screenShare.isBroadcasting && ownSession !== null) {
      const ownName = users.find((u) => u.session === ownSession)?.name ?? "You";
      secondaries.push({ session: ownSession, name: `${ownName} (you)` });
    }
    for (const b of channelBroadcasters) {
      if (b.session !== activeScreenShare.session) {
        secondaries.push(b);
      }
    }
    return secondaries;
  }, [activeScreenShare, screenShare.isBroadcasting, ownSession, users, channelBroadcasters]);

  const handleFocusWatch = useCallback((session: number) => {
    if (session === ownSession) {
      screenShare.stopWatching();
    } else {
      screenShare.watchBroadcast(session);
    }
  }, [ownSession, screenShare.stopWatching, screenShare.watchBroadcast]);

  // Compute header values before any early returns (hooks can't be conditional).
  const [headerName, headerMemberCount] = computeHeader(
    isDmMode, dmPartner, channel, memberCount,
    t("header.directMessage"), t("header.unknown"),
  );
  const showJoinButton = !isDmMode && !isInChannel;

  // Build broadcastInfo for the header when a stream is active.
  const broadcastInfo = useMemo((): BroadcastInfo | undefined => {
    if (!activeScreenShare) return undefined;
    const broadcaster = users.find((u) => u.session === activeScreenShare.session);
    const name = broadcaster?.name ?? "User";
    const avatar = avatarBySession.get(activeScreenShare.session) ?? null;
    const viewers = broadcaster
      ? users.filter((u) => u.channel_id === broadcaster.channel_id).length - 1
      : users.length - 1;
    return {
      broadcasterName: name,
      avatarUrl: avatar,
      viewerCount: viewers,
      isOwnBroadcast: activeScreenShare.isOwn,
      channelName: channel?.name ?? t("header.unknown"),
      onClose: activeScreenShare.isOwn ? screenShare.stopSharing : screenShare.stopWatching,
    };
  }, [activeScreenShare, users, avatarBySession, screenShare.stopSharing, screenShare.stopWatching]);

  // Empty state - no channel or DM selected.
  if (selectedChannel === null && !isDmMode) {
    return (
      <main className={styles.main}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}><MessageCircleIcon width={40} height={40} /></div>
          <p>{t("page.selectChannel")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={[
      styles.main,
      activeScreenShare || liveDocCompactChat ? styles.compactChat : "",
      activeLiveDoc && !liveDocCompactChat ? styles.hiddenChat : "",
    ].join(" ")}>
      {!inPopout && (
        selectionMode ? (
          <MessageSelectionBar
            count={selectedMsgIds.size}
            onDelete={handleBulkDelete}
            onCancel={exitSelectionMode}
          />
        ) : (
          <ChatHeader
            channelName={headerName}
            memberCount={headerMemberCount}
          isInChannel={isDmMode || isInChannel}
          isDm={isDmMode}
          isPersisted={persistent.isPersisted}
          onJoin={showJoinButton ? () => joinChannel(selectedChannel!) : undefined}
          onChannelInfoToggle={onChannelInfoToggle}
          onChannelSearch={onChannelSearch}
          keyTrustLevel={persistent.trustLevel}
          onVerifyClick={persistent.onVerifyClick}
          onPollCreate={openPollCreator}
          isSilenced={selectedChannel !== null && silencedChannels.has(selectedChannel)}
          onToggleSilence={selectedChannel !== null ? () => toggleSilenceChannel(selectedChannel) : undefined}
          isScreenSharing={screenShare.isBroadcasting}
          onToggleScreenShare={
            !inPopout && !isMobile && serverFancyVersion != null && serverFancyVersion >= SCREEN_SHARE_MIN_VERSION
              ? (screenShare.isBroadcasting ? screenShare.stopSharing : screenShare.startSharing)
              : undefined
          }
          screenShareDisabledReason={
            screenShare.isBroadcastingFromOtherTab
              ? t("screenShare.alreadySharingOtherServer")
              : undefined
          }
          sfuAvailable={sfuAvailable}
          broadcastInfo={broadcastInfo}
          hasNewPins={hasNewPins}
          onPinnedMessages={handleOpenPinnedPanel}
          hasNewDownloads={unseenDownloadCount > 0}
          onDownloads={handleOpenDownloadsPanel}
          onOpenDocLibrary={handleOpenDocLibrary}
          onPopOutDm={inPopout ? undefined : handlePopOutDm}
        />
        )
      )}

      {showPinnedPanel && (
        <Suspense fallback={null}>
          <PinnedMessagesPanel
            messages={allMessages}
            unseenIds={channelUnseenPinSet}
            onClose={handleClosePinnedPanel}
            onNavigate={handleScrollToMessage}
            onUnpin={handlePin}
          />
        </Suspense>
      )}

      {showDownloadsPanel && (
        <Suspense fallback={null}>
          <DownloadsPanel onClose={handleCloseDownloadsPanel} />
        </Suspense>
      )}

      <MobileCallControls />

      {/* Live Doc panel - replaces chat top half similar to screen share. */}
      {activeLiveDoc && (
        <Suspense fallback={null}>
          <LiveDocPanel
            session={activeLiveDoc}
            compactChat={liveDocCompactChat}
            onToggleCompactChat={toggleLiveDocCompactChat}
            onCreateDoc={selectedChannel !== null && !isDmMode ? handleOpenLiveDoc : undefined}
            onCreateDocInFolder={
              selectedChannel !== null && !isDmMode ? handleCreateDocInFolder : undefined
            }
          />
        </Suspense>
      )}

      {/* Standalone document library (browse saved docs without one open). */}
      {showLiveDocLibrary && !activeLiveDoc && (
        <Suspense fallback={null}>
          <LiveDocLibraryPanel
            onOpenDoc={handleOpenLibraryDoc}
            onCreateDoc={handleOpenLiveDoc}
            onCreateDocInFolder={handleCreateDocInFolder}
            onClose={() => setShowLiveDocLibrary(false)}
          />
        </Suspense>
      )}

      {/* Discovery banner for someone else's open Live Doc. */}
      {pendingLiveDocAnnounce && !activeLiveDoc && (
        <LiveDocBanner announce={pendingLiveDocAnnounce} onJoin={handleJoinLiveDoc} />
      )}

      {/* Solo own broadcast preview (no other broadcasters) */}
      {activeScreenShare?.isOwn && activeScreenShare.stream && !showFocusView && (
        <ScreenShareViewer
          isOwnBroadcast
          localStream={activeScreenShare.stream}
          channelId={selectedChannel ?? 0}
          ownSession={ownSession ?? 0}
        />
      )}

      {/* Unified focus view: single instance keeps layout stable across swaps */}
      {showFocusView && activeScreenShare && (
        <Suspense fallback={null}>
          <StreamFocusView
            isOwnBroadcast={activeScreenShare.isOwn}
            localStream={activeScreenShare.isOwn ? activeScreenShare.stream : null}
            session={activeScreenShare.isOwn ? undefined : activeScreenShare.session}
            ownBroadcastStream={screenShare.isBroadcasting ? screenShare.localStream : null}
            otherBroadcasters={focusViewSecondaries}
            onWatch={handleFocusWatch}
          />
        </Suspense>
      )}

      {/* Multi-stream grid: shown when 2+ broadcasters and we are not sharing or watching */}
      {!activeScreenShare && channelBroadcasters.length > 1 && (
        <Suspense fallback={null}>
          <MultiStreamGrid
            broadcasters={channelBroadcasters}
            onWatch={screenShare.watchBroadcast}
          />
        </Suspense>
      )}

      {/* Single broadcaster notification banner */}
      {!activeScreenShare && channelBroadcasters.length === 1 && (
        <BroadcastBanner
          broadcasters={channelBroadcasters}
          onWatch={screenShare.watchBroadcast}
          sfuAvailable={sfuAvailable}
        />
      )}

      {/* WebRTC error inline banner - same style as broadcast banner */}
      {webrtcError && (
        <WebRtcErrorBanner message={webrtcError} onDismiss={clearWebRtcError} />
      )}

      {/* Chat column: groups the messages + composer so the file-drag
           overlay (position:absolute, inset:0) is scoped to the chat's
           own portion and never spills over the live-doc panel above. */}
      <div className={styles.chatColumn}>
      {/* Messages wrapper: position:relative so the key-share banner
           can overlay the scroll viewport without scrolling with it */}
      <div className={styles.messagesWrapper}>
        {persistent.keyShareBanner && (
          <div className={styles.fixedKeyShareBanner}>
            {persistent.keyShareBanner}
          </div>
        )}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          className={[
            styles.messages,
            personalization.bubbleStyle === "flat" ? styles.flatStyle : "",
            personalization.bubbleStyle === "compact" ? styles.compactStyle : "",
            personalization.compactMode ? styles.compactLayout : "",
          ].join(" ")}
          data-has-bg={personalization.chatBgOriginal ? "" : undefined}
          style={{
            ...(personalization.chatBgOriginal ? {
              "--chat-bg-image": `url(${personalization.chatBgBlurred ?? personalization.chatBgOriginal})`,
              "--chat-bg-opacity": String(personalization.chatBgOpacity),
              "--chat-bg-size": personalization.chatBgFit === "tile" ? "auto" : "cover",
              "--chat-bg-repeat": personalization.chatBgFit === "tile" ? "repeat" : "no-repeat",
            } : {}),
            "--chat-font-size": personalization.fontSize === "small" ? "12px"
              : personalization.fontSize === "large" ? `${personalization.fontSizeCustomPx}px`
              : "14px",
          } as React.CSSProperties}
        >
          <div ref={messagesInnerRef} className={styles.messagesInner}>
          {/* All banners in a single sticky container */}
          <BannerStack>
            {persistent.banner}
            {persistent.signalBridgeErrorBanner}
            {persistent.disputeBanner}
            {persistent.revokedBanner}
          </BannerStack>

          <ActiveWatchBanner />

          {allMessages.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}><HandIcon width={40} height={40} /></div>
              <p>No messages yet. Say hello!</p>
            </div>
          ) : (
            <ChatMessageList
              allMessages={allMessages}
              userBySession={userBySession}
              avatarBySession={avatarBySession}
              userByHash={userByHash}
              avatarByHash={avatarByHash}
              convertToLocalTime={convertToLocalTime}
              bubbleStyle={personalization.bubbleStyle}
              lastReadIdx={lastReadIdx}
              selectionMode={selectionMode}
              canDelete={canDelete}
              selectedMsgIds={selectedMsgIds}
              restoringKeys={restoringKeys}
              polls={polls}
              ownSession={ownSession}
              timeFormat={timeFormat}
              systemUses24h={systemUses24h}
              selectUser={selectUser}
              handleMessageContextMenu={handleMessageContextMenu}
              toggleMsgSelection={toggleMsgSelection}
              handleCite={handleCite}
              handleTouchStart={handleTouchStart}
              cancelLongPress={cancelLongPress}
              handleReaction={handleReaction}
              handleMoreReactions={handleMoreReactions}
              handleCopyText={handleCopyText}
              handleSingleDelete={handleSingleDelete}
              handlePollVote={handlePollVote}
              handleScrollToMessage={handleScrollToMessage}
              handleOpenLightbox={(src) => lightboxRef.current?.open(src)}
              getMessageReactions={getMessageReactions}
              onToggleReaction={toggleReaction}
              onAddReaction={handleMoreReactions}
              alwaysShowMessageActions={personalization.alwaysShowMessageActions}
            />
          )}
          {uploadPlaceholders.map((p) => (
            <UploadProgressItem key={p.id} placeholder={p} onDismiss={handleDismissUpload} onCancel={handleCancelUpload} />
          ))}
          {scopedPending.map((p) => (
            <PendingMessageItem key={p.pendingId} pending={p} />
          ))}
          {/* Bottom sentinel - scroll target for auto-scroll */}
          <div ref={bottomSentinelRef} aria-hidden="true" style={{ height: 0, overflow: "hidden" }} />
        </div>
        </div>
      </div>

      {/* "New messages" pill - shown when user scrolled up and messages arrive */}
      {newMsgCount > 0 && (
        <button
          className={styles.newMessagesPill}
          onClick={handleScrollToBottom}
        >
          <ChevronDownIcon width={16} height={16} aria-hidden="true" />
          {newMsgCount} new {newMsgCount === 1 ? "message" : "messages"}
        </button>
      )}

      {/* Pending quote preview strip */}
      <QuotePreviewStrip quotes={pendingQuotes} onRemove={removePendingQuote} />

      {/* Drag-drop preview strip (above composer) */}
      <PendingAttachmentsStrip
        attachments={pendingAttachments}
        onRemove={removeAttachment}
        onSend={() => void sendPendingAttachments()}
        disabled={sending || isUploading}
      />

      {/* Drag overlay shown while user drags a file over the chat window */}
      {dragTarget === "chat" && canDropAttachments && (
        <div className={styles.dragOverlay} aria-hidden="true">
          <div className={styles.dragOverlayInner}>
            <span>{t("dragDrop.overlayHint")}</span>
          </div>
        </div>
      )}

      <div className={styles.composerWrapper}>
        <TypingIndicator channelId={isDmMode ? null : selectedChannel} />

        <ChatComposer
          draft={draft}
          onChange={handleDraftChange}
          onSend={handleSendAndResetTyping}
          onPaste={handlePaste}
          onFileSelected={sendMediaFile}
          onGifSelect={handleGifSelect}
          onAttachFile={handleAttachFile}
          onOpenLiveDoc={selectedChannel !== null && !isDmMode ? handleOpenLiveDoc : undefined}
          disabled={sending || persistent.sendBlocked}
          hasPendingQuotes={pendingQuotes.length > 0}
          isEditing={editingMessage !== null}
          onCancelEdit={cancelEdit}
        />
      </div>
      </div>

      {showPollCreator && (
        <Suspense fallback={null}>
          <PollCreator
            onSubmit={handlePollCreate}
            onClose={closePollCreator}
          />
        </Suspense>
      )}

      {/* Persistent chat dialogs (key verification, custodian prompt) */}
      {persistent.dialogs}

      {/* Message context menu (right-click on desktop, bottom sheet on mobile) */}
      {msgContextMenu && !isMobile && (
        <Suspense fallback={null}>
          <MessageContextMenu
            menu={msgContextMenu}
            canDelete={canDelete}
            onClose={closeContextMenu}
            onDelete={handleSingleDelete}
            onSelectMode={enterSelectionMode}
            onReaction={handleReaction}
            onMoreReactions={handleMoreReactions}
            onCite={handleCite}
            onCopyText={handleCopyText}
            onEdit={handleEdit}
            onPin={handlePin}
            onPopOutImage={handlePopOutImage}
            popOutImageSrc={findPopOutImageSrc(msgContextMenu.message.body)}
            reactions={msgContextMenu.message.message_id ? getMessageReactions(msgContextMenu.message.message_id) : []}
            avatarByHash={avatarByHash}
            allMessageIds={allMessageIds}
            channelId={selectedChannel ?? undefined}
          />
        </Suspense>
      )}
      {msgContextMenu && isMobile && (
        <Suspense fallback={null}>
          <MobileMessageActionSheet
            message={msgContextMenu.message}
            canDelete={canDelete}
            onClose={closeContextMenu}
            onDelete={handleSingleDelete}
            onSelectMode={enterSelectionMode}
            onReaction={handleReaction}
            onMoreReactions={handleMoreReactions}
            onCite={handleCite}
            onCopyText={handleCopyText}
            onEdit={handleEdit}
            onPin={handlePin}
            onPopOutImage={handlePopOutImage}
            popOutImageSrc={findPopOutImageSrc(msgContextMenu.message.body)}
            reactions={msgContextMenu.message.message_id ? getMessageReactions(msgContextMenu.message.message_id) : []}
            allMessageIds={allMessageIds}
            channelId={selectedChannel ?? undefined}
            avatarByHash={avatarByHash}
          />
        </Suspense>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <ConfirmDialog
          title="Delete messages"
          body={
            deleteConfirm.ids.length === 1
              ? "Are you sure you want to delete this message? This action cannot be undone."
              : `Are you sure you want to delete ${deleteConfirm.ids.length} messages? This action cannot be undone.`
          }
          confirmLabel="Delete"
          danger
          isConfirming={isDeleting}
          onConfirm={confirmDelete}
          onCancel={clearDeleteConfirm}
        />
      )}

      {toast && <Toast {...toast} onDismiss={clearToast} />}

      {shareDialog !== null && (
        <Suspense fallback={null}>
          <FileShareDialog
            open={shareDialog !== null}
            filename={shareDialog?.filename ?? ""}
            canSharePublic={fileServerConfig?.canShareFilesPublic ?? true}
            onSubmit={handleShareDialogSubmit}
            onCancel={handleShareDialogCancel}
          />
        </Suspense>
      )}

      {showLiveDocLaunch && (
        <Suspense fallback={null}>
          <LiveDocLaunchDialog
            open={showLiveDocLaunch}
            onSubmit={handleLiveDocLaunchSubmit}
            onCancel={() => setShowLiveDocLaunch(false)}
          />
        </Suspense>
      )}

      {/* Emoji picker overlay */}
      {emojiPicker && (
        <Suspense fallback={null}>
          <EmojiPicker
            anchorX={emojiPicker.x}
            anchorY={emojiPicker.y}
            onSelect={handleEmojiSelect}
            onClose={closeEmojiPicker}
          />
        </Suspense>
      )}

      <Lightbox
        ref={lightboxRef}
        allMessages={allMessages}
        selectedChannel={selectedChannel}
        selectedDmUser={selectedDmUser}
        currentScope={currentScope}
        timeFormat={timeFormat}
        convertToLocalTime={convertToLocalTime}
        systemUses24h={systemUses24h}
      />
      <MentionPopover />
    </main>
  );
}
