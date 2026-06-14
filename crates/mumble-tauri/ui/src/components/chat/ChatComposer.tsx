import { AttachIcon, CloseIcon, EditIcon, FileIcon, FileTextIcon, GifIcon, ImageIcon, SendIcon } from "../../icons";
import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense, type ClipboardEvent } from "react";
import { useTranslation } from "react-i18next";
import MarkdownInput, { type MarkdownInputApi } from "./markdown/MarkdownInput";
const GifPicker = lazy(() => import("./gif/GifPicker"));
import MentionAutocomplete, { type MentionCandidate, handleMentionKey, candidateInsertText } from "./mention/MentionAutocomplete";
import { useMentionCandidates } from "./mention/useMentionCandidates";
import styles from "./ChatView.module.css";
import { isMobile } from "../../utils/platform";
import { sendPluginInteraction, useAppStore } from "../../store";
import { parseMentionTrigger, type MentionTrigger } from "../../utils/mentions";
import SlashCommandMenu, { handleSlashKey } from "../plugin/SlashCommandMenu";
import { collectSlashCommands, filterSlashCommands } from "../../plugins/tier1/manifest";
import { extractSlashQuery, parseSlashLine } from "../../plugins/tier1/slashParser";
import { TID } from "../../testids";

interface ChatComposerProps {
  readonly draft: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onPaste: (e: ClipboardEvent) => void;
  /** Stage one or more picked image/video files into the attachment tray. */
  readonly onFilesSelected: (files: File[]) => void;
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

export default function ChatComposer({
  draft,
  onChange,
  onSend,
  onPaste,
  onFilesSelected,
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
  const pluginManifests = useAppStore((s) => s.pluginManifests);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const slashAllEntries = useMemo(
    () => collectSlashCommands(pluginManifests),
    [pluginManifests],
  );
  const slashQuery = extractSlashQuery(draft);
  const slashEntries = useMemo(
    () => (slashQuery === null ? [] : filterSlashCommands(slashAllEntries, slashQuery)),
    [slashAllEntries, slashQuery],
  );
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  useEffect(() => {
    if (slashActiveIndex >= slashEntries.length) setSlashActiveIndex(0);
  }, [slashEntries.length, slashActiveIndex]);
  const slashOpen = slashQuery !== null && slashEntries.length > 0;

  const mentionResolver = useCallback(
    (session: number) => users.find((u) => u.session === session)?.name,
    [users],
  );

  const candidates = useMentionCandidates(trigger?.kind ?? null, trigger?.query ?? "");

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
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      if (files.length > 0) onFilesSelected(files);
    },
    [onFilesSelected],
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

  const pickSlashEntry = useCallback(
    (entry: { command: { name: string } }) => {
      const trimmedStart = draft.length - draft.trimStart().length;
      const prefix = draft.slice(0, trimmedStart);
      onChange(`${prefix}/${entry.command.name} `);
      setSlashActiveIndex(0);
    },
    [draft, onChange],
  );

  const handleSlashSubmit = useCallback(() => {
    const parsed = parseSlashLine(draft, slashAllEntries);
    if (!parsed) return false;
    if (parsed.errors.length > 0) {
      console.warn("[chat] slash command rejected:", parsed.errors.join("; "));
      return false;
    }
    void sendPluginInteraction(parsed.pluginName, parsed.kind, selectedChannel).catch(
      (e) => console.warn("[chat] sendPluginInteraction failed:", e),
    );
    onChange("");
    return true;
  }, [draft, slashAllEntries, selectedChannel, onChange]);

  const handleSendIntercept = useCallback(() => {
    if (handleSlashSubmit()) return;
    onSend();
  }, [handleSlashSubmit, onSend]);

  const handleKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (slashOpen) {
        const action = handleSlashKey(e, {
          activeIndex: slashActiveIndex,
          count: slashEntries.length,
        });
        if (!action) return false;
        e.preventDefault();
        switch (action.kind) {
          case "move":
            setSlashActiveIndex(action.index);
            return true;
          case "pick":
            pickSlashEntry(slashEntries[action.index]);
            return true;
          case "close":
            onChange("");
            return true;
        }
      }
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
    [
      trigger,
      candidates,
      activeIndex,
      insertCandidate,
      closePopup,
      slashOpen,
      slashActiveIndex,
      slashEntries,
      pickSlashEntry,
      onChange,
    ],
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
        <Suspense fallback={null}>
          <GifPicker
            onSelect={onGifSelect}
            onClose={() => setShowGifPicker(false)}
          />
        </Suspense>
      )}
      <div className={styles.composer}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
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

        <div className={styles.composerInputWrap} data-testid={TID.chatComposerInput}>
          {slashOpen && (
            <SlashCommandMenu
              entries={slashEntries}
              activeIndex={slashActiveIndex}
              onPick={pickSlashEntry}
              onActiveIndexChange={setSlashActiveIndex}
            />
          )}
          {!slashOpen && trigger && (
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
            onSubmit={handleSendIntercept}
            onPaste={onPaste}
            placeholder={isMobile || isNarrow ? t("composer.placeholderMobile") : t("composer.placeholderDesktop")}
            disabled={disabled}
            apiRef={inputApi}
            onSelectionChange={handleSelectionChange}
            onKeyDownCapture={handleKeyDownCapture}
            mentionResolver={mentionResolver}
          />
        </div>

        <button
          className={styles.sendBtn}
          data-testid={TID.chatSend}
          onClick={handleSendIntercept}
          disabled={(!draft.trim() && !hasPendingQuotes) || disabled}
        >
          <SendIcon width={20} height={20} />
        </button>
      </div>
    </div>
  );
}
