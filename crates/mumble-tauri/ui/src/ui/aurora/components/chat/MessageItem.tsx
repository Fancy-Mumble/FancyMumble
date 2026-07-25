import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import DOMPurify from "dompurify";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { getReactions, hasReacted } from "@core/features/chat/reaction/reactionStore";
import { getReadersForMessage } from "@core/features/chat/readreceipt/readReceiptStore";
import { FANCY_FILE_MARKER_RE } from "@core/features/chat/fileAttachments";
import { CheckIcon, CopyIcon, EditIcon, PinIcon, QuoteIcon, TrashIcon } from "@ui/icons";
import WatchStartButton from "@ui/standard/components/chat/watch/WatchStartButton";
import WatchTogetherCard from "@ui/standard/components/chat/watch/WatchTogetherCard";
import styles from "../../AuroraClientApp.module.css";
import extensionStyles from "./MessageItem.module.css";
import LinkPreviews from "./LinkPreviews";
import { Button, IconButton } from "../primitives";
import { PollCard } from "./PollSurfaces";
import { FileAttachmentMarker } from "./FileAttachmentCard";

function initials(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase(); }
function formatTime(timestamp?: number | null): string { return timestamp ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp) : "now"; }

type MessageItemProps = {
  message: ChatMessage;
  selected?: boolean;
  selectionMode?: boolean;
  onToggleSelection?: (messageId: string) => void;
};

export default function MessageItem({ message, selected = false, selectionMode = false, onToggleSelection }: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const embeds = useAppStore((state) => message.message_id ? state.linkEmbeds.get(message.message_id) : undefined);
  const disableLinkPreviews = useAppStore((state) => state.disableLinkPreviews);
  const allowExternal = useAppStore((state) => state.enableExternalEmbeds);
  const reactionVersion = useAppStore((state) => state.reactionVersion);
  const readReceiptVersion = useAppStore((state) => state.readReceiptVersion);
  const ownSession = useAppStore((state) => state.ownSession);
  const users = useAppStore((state) => state.users);
  const messages = useAppStore((state) => state.messages);
  const reactions = message.message_id ? getReactions(message.message_id) : [];
  const messageIds = messages.flatMap((item) => item.message_id ? [item.message_id] : []);
  const readers = message.message_id ? getReadersForMessage(message.channel_id, message.message_id, messageIds) : [];
  void reactionVersion; void readReceiptVersion;
  const safeBody = DOMPurify.sanitize(message.body, { USE_PROFILES: { html: true }, ADD_ATTR: ["target", "rel"] });
  const pollId = /<!--\s*FANCY_POLL:([^\s]+)\s*-->/.exec(message.body)?.[1];
  const filePayload = FANCY_FILE_MARKER_RE.exec(message.body)?.[1];
  const watchSessionId = /<!--\s*FANCY_WATCH:([^\s]+)\s*-->/.exec(message.body)?.[1];
  const toggleReaction = async (emoji: string) => {
    if (!message.message_id || ownSession === null) return;
    const ownHash = users.find((user) => user.session === ownSession)?.hash ?? "";
    await useAppStore.getState().sendReaction(message.channel_id, message.message_id, emoji, ownHash && hasReacted(message.message_id, emoji, ownHash) ? "remove" : "add");
  };
  const saveEdit = async () => { if (!message.message_id || !editBody.trim()) return; await useAppStore.getState().editMessage(message.channel_id, message.message_id, editBody.trim()); setEditing(false); };
  const remove = async () => { if (!message.message_id) return; await useAppStore.getState().deletePchatMessages(message.channel_id, { messageIds: [message.message_id] }); setConfirmDelete(false); };
  const quote = () => globalThis.dispatchEvent(new CustomEvent("new-ui:quote-message", { detail: { sender: message.sender_name, body: safeBody } }));
  const copy = () => navigator.clipboard.writeText(new DOMParser().parseFromString(message.body, "text/html").body.textContent ?? message.body);
  const select = () => { if (message.message_id) onToggleSelection?.(message.message_id); setContextMenu(null); };
  const openContextMenu = (event: MouseEvent<HTMLElement>) => { if (!message.message_id) return; event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }); };
  const startLongPress = (event: PointerEvent<HTMLElement>) => {
    if (!message.message_id || event.pointerType === "mouse") return;
    const { clientX: x, clientY: y } = event;
    longPressTimer.current = globalThis.setTimeout(() => { setContextMenu({ x, y }); longPressTimer.current = null; }, 520);
  };
  const cancelLongPress = () => { if (longPressTimer.current != null) globalThis.clearTimeout(longPressTimer.current); longPressTimer.current = null; };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    globalThis.addEventListener("click", close);
    globalThis.addEventListener("blur", close);
    return () => { globalThis.removeEventListener("click", close); globalThis.removeEventListener("blur", close); };
  }, [contextMenu]);

  return <article className={`${styles.message} ${message.is_own ? styles.ownMessage : ""} ${selected ? extensionStyles.messageSelected : ""}`} onContextMenu={openContextMenu} onPointerDown={startLongPress} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerMove={cancelLongPress}>
    {selectionMode && message.message_id && <button type="button" className={extensionStyles.messageSelect} aria-label={selected ? "Deselect message" : "Select message"} aria-pressed={selected} onClick={select}>{selected && <CheckIcon />}</button>}
    <span className={styles.avatar}>{initials(message.sender_name || "Server")}</span>
    <div className={extensionStyles.messageContent}><header><strong>{message.sender_name || "Server"}</strong><time>{formatTime(message.timestamp)}</time>{message.edited_at && <small>edited</small>}{message.pinned && <small>pinned</small>}</header>
      {editing ? <div className={extensionStyles.messageEdit}><textarea value={editBody} onChange={(event) => setEditBody(event.target.value)} autoFocus /><Button onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" onClick={() => void saveEdit()}>Save</Button></div> : pollId ? <PollCard pollId={pollId} /> : filePayload ? <FileAttachmentMarker payload={filePayload} /> : watchSessionId ? <WatchTogetherCard sessionId={watchSessionId} mountKey={`new-ui-${message.message_id ?? message.timestamp}`} /> : <div className={extensionStyles.messageBody} dangerouslySetInnerHTML={{ __html: safeBody }} />}
      {!watchSessionId && <WatchStartButton body={message.body} channelId={message.channel_id} />}
      {!disableLinkPreviews && embeds && embeds.length > 0 && <LinkPreviews embeds={embeds} allowExternal={allowExternal} />}
      {reactions.length > 0 && <div className={extensionStyles.reactionRow}>{reactions.map((reaction) => <Button variant="bare" key={reaction.emoji} title={[...reaction.reactorHashNames.values()].join(", ")} onClick={() => void toggleReaction(reaction.emoji)}>{reaction.emoji} {reaction.reactorHashes.size}</Button>)}</div>}
      {message.is_own && readers.length > 0 && <small className={extensionStyles.readers} title={readers.map((reader) => reader.name).join(", ")}>Read by {readers.length}</small>}
      <div className={extensionStyles.messageActions}><Button variant="bare" onClick={() => void toggleReaction("👍")}>👍</Button><Button variant="bare" onClick={() => void toggleReaction("❤️")}>❤️</Button><IconButton icon={<QuoteIcon />} label="Quote message" onClick={quote} /><IconButton icon={<CopyIcon />} label="Copy message" onClick={() => void copy()} />{message.message_id && <IconButton icon={<PinIcon />} label={message.pinned ? "Unpin message" : "Pin message"} onClick={() => void useAppStore.getState().pinMessage(message.channel_id, message.message_id!, !!message.pinned)} />}{message.is_own && message.message_id && <><IconButton icon={<EditIcon />} label="Edit message" onClick={() => setEditing(true)} /><IconButton icon={<TrashIcon />} label="Delete message" onClick={() => setConfirmDelete(true)} /></>}</div>
      {confirmDelete && <div className={extensionStyles.deleteMessageConfirm}><span>Delete this message?</span><Button variant="danger" onClick={() => void remove()}>Delete</Button><Button onClick={() => setConfirmDelete(false)}>Cancel</Button></div>}
    </div>
    {contextMenu && <div className={extensionStyles.messageContextMenu} style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()} role="menu">
      <Button variant="bare" leadingIcon={<QuoteIcon />} onClick={() => { quote(); setContextMenu(null); }}>Quote</Button>
      <Button variant="bare" leadingIcon={<CopyIcon />} onClick={() => { void copy(); setContextMenu(null); }}>Copy text</Button>
      <Button variant="bare" leadingIcon={<CheckIcon />} onClick={select}>{selected ? "Deselect" : "Select"}</Button>
      {message.message_id && <Button variant="bare" leadingIcon={<PinIcon />} onClick={() => { void useAppStore.getState().pinMessage(message.channel_id, message.message_id!, !!message.pinned); setContextMenu(null); }}>{message.pinned ? "Unpin" : "Pin"}</Button>}
      {message.is_own && <><Button variant="bare" leadingIcon={<EditIcon />} onClick={() => { setEditing(true); setContextMenu(null); }}>Edit</Button><Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => { setConfirmDelete(true); setContextMenu(null); }}>Delete</Button></>}
    </div>}
  </article>;
}
