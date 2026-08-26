import extensionStyles from "./RichComposer.module.css";
import {
  Button,
  GifPicker,
  IconButton,
  MentionSuggestions,
  SlashSuggestions,
  useComposerAutocomplete,
} from "../../components";
import { encodeFileAttachmentMarker } from "@core/features/chat/fileAttachments";
import { uploadAttachment } from "@core/features/chat/useFileUpload";
import { useTypingIndicator } from "@core/features/chat/typing/useTypingIndicator";
import { useAppStore } from "@core/store";
import type { ChannelEntry } from "@core/types";
import { fileToDataUrl, fitImage } from "@core/utils/media";
import { open } from "@tauri-apps/plugin-dialog";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AttachIcon,
  BoldIcon,
  CodeIcon,
  EmojiPlusIcon,
  ImageIcon,
  Link2Icon,
  RadioIcon,
  SendIcon,
  UsersGroupIcon,
} from "@ui/icons";
import { useEffect, useRef, useState } from "react";
import { escapeHtml } from "../htmlText";

/** Human-readable byte limit, so multi-megabyte caps don't read as "10240 KiB". */
function formatByteLimit(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`;
}

export function RichComposer({
  channel,
  targetLabel,
  onSend,
}: {
  channel: ChannelEntry | null;
  targetLabel?: string;
  onSend: (html: string) => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"emoji" | "mention" | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const serverConfig = useAppStore((state) => state.serverConfig);
  // Matches the Standard client: 0 means "no dedicated image cap", so the
  // general message limit applies instead.
  const maxImageBytes =
    serverConfig.max_image_message_length > 0
      ? serverConfig.max_image_message_length
      : serverConfig.max_message_length;
  const fileServerConfig = useAppStore((state) => state.fileServerConfig);
  const users = useAppStore((state) => state.users);
  const { notifyTyping, resetTyping } = useTypingIndicator();
  const enabled = !!channel || !!targetLabel;
  const canShareFiles = !!channel && !!fileServerConfig?.canShareFiles;
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({
        placeholder: targetLabel
          ? `Message ${targetLabel}`
          : channel
            ? `Message #${channel.name}`
            : "Select a channel",
      }),
    ],
    content: "",
    editable: enabled,
    onUpdate: notifyTyping,
  });
  // `@` mentions and `/` commands read the caret, so they re-evaluate on every
  // document change and cursor move rather than on keystrokes alone.
  const autocomplete = useComposerAutocomplete(editor);
  const { refresh: refreshAutocomplete } = autocomplete;
  useEffect(() => {
    if (!editor) return;
    const update = () => refreshAutocomplete();
    editor.on("update", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("update", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor, refreshAutocomplete]);
  useEffect(() => {
    editor?.setEditable(enabled);
  }, [editor, enabled]);
  useEffect(() => {
    const onQuote = (event: Event) => {
      const detail = (event as CustomEvent<{ sender: string; body: string }>).detail;
      editor
        ?.chain()
        .focus()
        .insertContent(
          `<blockquote><p><strong>${escapeHtml(detail.sender)}</strong></p>${detail.body}</blockquote><p></p>`,
        )
        .run();
    };
    globalThis.addEventListener("new-ui:quote-message", onQuote);
    return () => globalThis.removeEventListener("new-ui:quote-message", onQuote);
  }, [editor]);
  const send = async () => {
    if (!editor || editor.isEmpty || !enabled || sending) return;
    // A `/command` line is executed by its plugin instead of being posted.
    if (autocomplete.submitSlashCommand()) {
      resetTyping();
      return;
    }
    setSending(true);
    try {
      await onSend(editor.getHTML());
      editor.commands.clearContent();
      resetTyping();
    } finally {
      setSending(false);
    }
  };
  const setLink = () => {
    const href = globalThis.prompt("Link URL");
    if (href) editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };
  const attachImage = async (file: File | undefined) => {
    if (!file || !editor) return;
    setAttachmentError(null);
    if (!file.type.startsWith("image/")) {
      setAttachmentError(
        "This first attachment pass supports images. Other files will use the file-server upload flow.",
      );
      return;
    }
    setSending(true);
    try {
      const alt = file.name.replace(/["<>]/g, "");
      // Inline images ride inside the text message, so they are bound by the
      // server's imagemessagelength - not the (much larger) file-server limit.
      const original = await fileToDataUrl(file);
      if (original.length <= maxImageBytes) {
        // Insert the node directly: a base64 <img> string round-tripped through
        // HTML parsing lands in the document as literal text.
        editor
          .chain()
          .focus()
          .insertContent({ type: "image", attrs: { src: original, alt } })
          .run();
        return;
      }
      if (canShareFiles) {
        // Re-encoding down to the inline cap would visibly wreck the image;
        // the file-server path keeps it intact, so point there instead.
        setAttachmentError(
          `That image is larger than the ${formatByteLimit(maxImageBytes)} inline limit. Use the paperclip to share it at full quality.`,
        );
        return;
      }
      // No file-server on this channel: recompressing is the only way to send
      // it at all, so do that but say so rather than silently degrading it.
      const fitted = await fitImage(file, maxImageBytes);
      editor
        .chain()
        .focus()
        .insertContent({ type: "image", attrs: { src: fitted, alt } })
        .run();
      setAttachmentError(
        `Image recompressed to fit this server's ${formatByteLimit(maxImageBytes)} inline limit.`,
      );
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };
  /** Attach a whole picker/clipboard selection, one inline image after another
   *  so each still gets the size handling above. */
  const attachImages = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) await attachImage(file);
  };
  /** Insert images carried by a paste. Returns true when the clipboard held
   *  any, so the caller can suppress the default (which would paste the
   *  screenshot's file name as text). */
  const pasteImages = (clipboard: DataTransfer | null): boolean => {
    const images = Array.from(clipboard?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return false;
    void (async () => {
      for (const image of images) await attachImage(image);
    })();
    return true;
  };
  const shareFile = async () => {
    if (!channel || !fileServerConfig?.canShareFiles || sending) return;
    setAttachmentError(null);
    const selected = await open({ multiple: false, directory: false });
    if (!selected) return;
    const filename = selected.split(/[\\/]/).pop() || "attachment";
    setSending(true);
    try {
      const info = await uploadAttachment({
        filePath: selected,
        channelId: channel.id,
        filename,
        uploadId: "",
        choice: { mode: "session" },
      });
      await onSend(encodeFileAttachmentMarker(info));
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };
  const emoji = ["😀", "😂", "❤️", "👍", "🎉", "👀", "🔥", "✅"];
  const formatActive = (mark: string) =>
    editor?.isActive(mark) ? extensionStyles.composerToolActive : undefined;
  return (
    <div className={extensionStyles.composer}>
      {showGifPicker && (
        <GifPicker
          onClose={() => setShowGifPicker(false)}
          onSelect={(gif) => {
            editor
              ?.chain()
              .focus()
              .insertContent({ type: "image", attrs: { src: gif.url, alt: gif.title } })
              .run();
            setShowGifPicker(false);
          }}
        />
      )}
      {picker && (
        <div className={extensionStyles.composerPicker}>
          {picker === "emoji"
            ? emoji.map((item) => (
                <Button
                  variant="bare"
                  key={item}
                  onClick={() => {
                    editor?.chain().focus().insertContent(item).run();
                    setPicker(null);
                  }}
                >
                  {item}
                </Button>
              ))
            : users
                .filter((user) => !channel || user.channel_id === channel.id)
                .map((user) => (
                  <Button
                    variant="bare"
                    key={user.session}
                    onClick={() => {
                      editor?.chain().focus().insertContent(`@${user.name} `).run();
                      setPicker(null);
                    }}
                  >
                    @{user.name}
                  </Button>
                ))}
        </div>
      )}
      {/* Formatting lives behind a toggle so the resting state is a single clean bar. */}
      {showFormatting && (
        <div className={extensionStyles.composerFormatBar}>
          <Button
            variant="bare"
            className={formatActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <b>B</b>
          </Button>
          <Button
            variant="bare"
            className={formatActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <i>I</i>
          </Button>
          <Button
            variant="bare"
            className={formatActive("underline")}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <u>U</u>
          </Button>
          <IconButton icon={<Link2Icon />} label="Add link" onClick={setLink} />
          <Button
            variant="bare"
            className={formatActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            • List
          </Button>
          <IconButton
            icon={<CodeIcon />}
            label="Code block"
            className={formatActive("codeBlock")}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          />
        </div>
      )}
      {/* Above the bar: growing upward keeps the input anchored in place. */}
      <SlashSuggestions
        entries={autocomplete.slashEntries}
        activeIndex={autocomplete.slashIndex}
        onPick={autocomplete.pickSlash}
      />
      <MentionSuggestions
        candidates={autocomplete.mentionCandidates}
        activeIndex={autocomplete.mentionIndex}
        onPick={autocomplete.pickMention}
      />
      {attachmentError && (
        <div className={extensionStyles.composerError} role="alert">
          {attachmentError}
        </div>
      )}
      <div className={extensionStyles.composerBar}>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void attachImages(event.target.files);
            event.target.value = "";
          }}
        />
        {channel && fileServerConfig?.canShareFiles ? (
          <IconButton
            icon={<AttachIcon />}
            label="Share file"
            className={extensionStyles.composerLead}
            disabled={sending}
            onClick={() => void shareFile()}
          />
        ) : (
          <IconButton
            icon={<ImageIcon />}
            label="Insert inline image"
            className={extensionStyles.composerLead}
            disabled={!enabled}
            onClick={() => fileInput.current?.click()}
          />
        )}
        <EditorContent
          editor={editor}
          className={extensionStyles.composerInput}
          onPaste={(event) => {
            if (pasteImages(event.clipboardData)) event.preventDefault();
          }}
          onKeyDown={(event) => {
            // An open suggestion list owns the arrows/Enter/Tab/Escape first.
            if (autocomplete.handleKeyDown(event)) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className={extensionStyles.composerActions}>
          {channel && fileServerConfig?.canShareFiles && (
            <IconButton
              icon={<ImageIcon />}
              label="Insert inline image"
              disabled={!enabled}
              onClick={() => fileInput.current?.click()}
            />
          )}
          <IconButton
            icon={<BoldIcon />}
            label="Formatting"
            aria-pressed={showFormatting}
            className={showFormatting ? extensionStyles.composerToolActive : undefined}
            onClick={() => setShowFormatting((value) => !value)}
          />
          <IconButton
            icon={<UsersGroupIcon />}
            label="Mention someone"
            onClick={() => setPicker((current) => (current === "mention" ? null : "mention"))}
          />
          <Button
            variant="bare"
            className={extensionStyles.composerGif}
            onClick={() => setShowGifPicker((value) => !value)}
          >
            GIF
          </Button>
          <IconButton
            icon={<EmojiPlusIcon />}
            label="Insert emoji"
            onClick={() => setPicker((current) => (current === "emoji" ? null : "emoji"))}
          />
          {channel && (
            <IconButton
              icon={<RadioIcon />}
              label="Create poll"
              onClick={() => globalThis.dispatchEvent(new CustomEvent("new-ui:create-poll"))}
            />
          )}
          <IconButton
            icon={<SendIcon />}
            label="Send message"
            className={extensionStyles.composerSend}
            onClick={() => void send()}
            disabled={!enabled || sending}
          />
        </div>
      </div>
    </div>
  );
}
