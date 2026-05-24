import { AttachIcon, CloseIcon, EditIcon, FileIcon, FileTextIcon, GifIcon, ImageIcon, SendIcon } from "../../icons";
import { useState, useRef, useCallback, useMemo, useEffect, type ClipboardEvent } from "react";
import { useTranslation } from "react-i18next";
import MarkdownInput, { type MarkdownInputApi } from "./markdown/MarkdownInput";
import GifPicker from "./gif/GifPicker";
import MentionAutocomplete, { type MentionCandidate, handleMentionKey } from "./mention/MentionAutocomplete";
import styles from "./ChatView.module.css";
import { isMobile } from "../../utils/platform";
import { useAppStore } from "../../store";
import { formatUserMention, parseMentionTrigger, type MentionTrigger } from "../../utils/mentions";
import { getCachedUserAvatar } from "../../lazyBlobs";
import { useAclGroups } from "../../hooks/useAclGroups";

interface ChatComposerProps {
  readonly draft: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onPaste: (e: ClipboardEvent) => void;
  readonly onFileSelected: (file: File) => Promise<void>;
  readonly onGifSelect: (url: string, alt: string) => Promise<void>;
  /** Open the native file picker and upload via the file-server plugin.
   *  When omitted, the file-server attach button is hidden. */
  readonly onAttachFile?: () => Promise<void> | void;
  /** Open a Live Doc for the current channel.  When omitted, the menu
   *  item is hidden. */
  readonly onOpenLiveDoc?: () => Promise<void> | void;
  readonly disabled?: boolean;
  readonly hasPendingQuotes?: boolean;
  readonly isEditing?: boolean;
  readonly onCancelEdit?: () => void;
}

const MAX_CANDIDATES = 8;

function candidateInsertText(c: MentionCandidate): string {
  switch (c.kind) {
    case "user":
      return formatUserMention(c.session);
    case "role":
      return `<@&${c.name}>`;
    case "everyone":
      return "@everyone";
    case "here":
      return "@here";
  }
}

export default function ChatComposer({
  draft,
  onChange,
  onSend,
  onPaste,
  onFileSelected,
  onGifSelect,
  onAttachFile,
  onOpenLiveDoc,
  disabled = false,
  hasPendingQuotes = false,
  isEditing = false,
  onCancelEdit,
}: ChatComposerProps) {
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const { t } = useTranslation("chat");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const inputApi = useRef<MarkdownInputApi | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Width below which we drop the keyboard-shortcut hint from the
  // placeholder.  Roughly the point at which "Write a message... (Ctrl+B/I/U
  // for formatting)" stops fitting in the textarea on a single line.
  const NARROW_PLACEHOLDER_PX = 480;
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setIsNarrow(w > 0 && w < NARROW_PLACEHOLDER_PX);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const users = useAppStore((s) => s.users);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const ownSession = useAppStore((s) => s.ownSession);
  const roleGroups = useAclGroups();

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();

    if (trigger.kind === "user") {
      const allOthers = users.filter((u) => {
        if (u.session === ownSession) return false;
        return u.name.toLowerCase().includes(q);
      });
      // Show users in the current channel first, then everyone else.
      const inChannel = allOthers.filter(
        (u) => selectedChannel != null && u.channel_id === selectedChannel,
      );
      const elsewhere = allOthers.filter(
        (u) => selectedChannel == null || u.channel_id !== selectedChannel,
      );
      const ranked = [...inChannel, ...elsewhere];
      const userCandidates: MentionCandidate[] = ranked
        .slice(0, MAX_CANDIDATES)
        .map((u) => ({
          kind: "user",
          session: u.session,
          name: u.name,
          avatarUrl: getCachedUserAvatar(u.session, u.texture_size) ?? undefined,
        }));

      const roleCandidates: MentionCandidate[] = roleGroups
        .filter((g) => !g.name.startsWith("~") && g.name.toLowerCase().includes(q))
        .slice(0, MAX_CANDIDATES)
        .map((g) => ({ kind: "role", name: g.name }));

      const extras: MentionCandidate[] = [];
      if ("everyone".startsWith(q)) extras.push({ kind: "everyone" });
      if ("here".startsWith(q)) extras.push({ kind: "here" });
      return [...userCandidates, ...roleCandidates, ...extras];
    }

    if (trigger.kind === "role") {
      return roleGroups
        .filter((g) => !g.name.startsWith("~") && g.name.toLowerCase().includes(q))
        .slice(0, MAX_CANDIDATES)
        .map((g) => ({ kind: "role", name: g.name }));
    }

    return [];
  }, [trigger, users, selectedChannel, ownSession, roleGroups]);

  useEffect(() => {
    if (activeIndex >= candidates.length) setActiveIndex(0);
  }, [candidates.length, activeIndex]);

  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAttachMenu]);

  const hasMenu = Boolean(onAttachFile) || Boolean(onOpenLiveDoc);

  const handleAttachBtnClick = useCallback(() => {
    if (!hasMenu) {
      fileInputRef.current?.click();
      return;
    }
    setShowAttachMenu((open) => !open);
  }, [hasMenu]);

  const handlePickImage = useCallback(() => {
    setShowAttachMenu(false);
    fileInputRef.current?.click();
  }, []);

  const handlePickFile = useCallback(() => {
    setShowAttachMenu(false);
    void onAttachFile?.();
  }, [onAttachFile]);

  const handlePickLiveDoc = useCallback(() => {
    setShowAttachMenu(false);
    void onOpenLiveDoc?.();
  }, [onOpenLiveDoc]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      await onFileSelected(file);
    },
    [onFileSelected],
  );

  const handleSelectionChange = useCallback(
    (start: number, end: number) => {
      if (start !== end) {
        if (trigger) setTrigger(null);
        return;
      }
      const next = parseMentionTrigger(draft, start);
      if (
        next?.anchor === trigger?.anchor &&
        next?.query === trigger?.query &&
        next?.kind === trigger?.kind
      ) {
        return;
      }
      setTrigger(next);
      setActiveIndex(0);
    },
    [draft, trigger],
  );

  useEffect(() => {
    if (trigger && draft.charAt(trigger.anchor) !== "@") {
      setTrigger(null);
    }
  }, [draft, trigger]);

  const closePopup = useCallback(() => setTrigger(null), []);

  const insertCandidate = useCallback(
    (c: MentionCandidate) => {
      if (!trigger) return;
      const replacement = candidateInsertText(c);
      const queryLen = trigger.kind === "role" ? trigger.query.length + 2 : trigger.query.length + 1;
      const end = trigger.anchor + queryLen;
      inputApi.current?.replaceRange(trigger.anchor, end, `${replacement} `);
      setTrigger(null);
    },
    [trigger],
  );

  const handleKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!trigger || candidates.length === 0) return false;
      const action = handleMentionKey(e, { activeIndex, count: candidates.length });
      if (!action) return false;
      e.preventDefault();
      switch (action.kind) {
        case "move":
          setActiveIndex(action.index);
          return true;
        case "pick":
          insertCandidate(candidates[action.index]);
          return true;
        case "close":
          closePopup();
          return true;
      }
    },
    [trigger, candidates, activeIndex, insertCandidate, closePopup],
  );

  return (
    <div ref={wrapperRef} className={styles.composerWrapper}>
      {isEditing && (
        <div className={styles.editBanner}>
          <EditIcon width={14} height={14} />
          <span>{t("composer.editingMessage")}</span>
          <button type="button" className={styles.editBannerClose} onClick={onCancelEdit}>
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      )}
      {showGifPicker && (
        <GifPicker
          onSelect={onGifSelect}
          onClose={() => setShowGifPicker(false)}
        />
      )}
      <div className={styles.composer}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className={styles.hiddenFileInput}
          onChange={handleFileChange}
        />

        <div ref={attachMenuRef} className={styles.attachMenuWrap}>
          <button
            type="button"
            className={`${styles.attachBtn} ${showAttachMenu ? styles.attachBtnActive : ""}`}
            onClick={handleAttachBtnClick}
            disabled={disabled}
            title={onAttachFile ? t("composer.attachTooltipImageFile") : t("composer.attachTooltipImageOnly")}
          >
            <AttachIcon width={20} height={20} />
          </button>
          {showAttachMenu && (
            <div className={styles.attachMenu} role="menu">
              <button type="button" className={styles.attachMenuItem} role="menuitem" onClick={handlePickImage}>
                <ImageIcon width={15} height={15} />
                {t("composer.attachMenuImage")}
              </button>
              {onAttachFile && (
                <button type="button" className={styles.attachMenuItem} role="menuitem" onClick={handlePickFile}>
                  <FileIcon width={15} height={15} />
                  {t("composer.attachMenuFile")}
                </button>
              )}
              {onOpenLiveDoc && (
                <button
                  type="button"
                  className={styles.attachMenuItem}
                  role="menuitem"
                  onClick={handlePickLiveDoc}
                  title={t("composer.attachMenuLiveDocHint")}
                >
                  <FileTextIcon width={15} height={15} />
                  {t("composer.attachMenuLiveDoc")}
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className={`${styles.attachBtn} ${showGifPicker ? styles.attachBtnActive : ""}`}
          onClick={() => setShowGifPicker((s) => !s)}
          disabled={disabled}
          title={t("composer.gifPickerTooltip")}
        >
          <GifIcon width={20} height={20} />
        </button>

        <div className={styles.composerInputWrap}>
          {trigger && (
            <MentionAutocomplete
              candidates={candidates}
              activeIndex={activeIndex}
              onPick={insertCandidate}
              onActiveIndexChange={setActiveIndex}
            />
          )}

          <MarkdownInput
            value={draft}
            onChange={onChange}
            onSubmit={onSend}
            onPaste={onPaste}
            placeholder={isMobile || isNarrow ? t("composer.placeholderMobile") : t("composer.placeholderDesktop")}
            disabled={disabled}
            apiRef={inputApi}
            onSelectionChange={handleSelectionChange}
            onKeyDownCapture={handleKeyDownCapture}
          />
        </div>

        <button
          className={styles.sendBtn}
          onClick={onSend}
          disabled={(!draft.trim() && !hasPendingQuotes) || disabled}
        >
          <SendIcon width={20} height={20} />
        </button>
      </div>
    </div>
  );
}
