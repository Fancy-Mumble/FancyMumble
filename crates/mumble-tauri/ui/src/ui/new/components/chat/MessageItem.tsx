import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import styles from "../../NewClientApp.module.css";
import LinkPreviews from "./LinkPreviews";

function initials(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase(); }
function messageText(body: string): string { const doc = new DOMParser().parseFromString(body, "text/html"); return doc.body.textContent ?? body; }
function formatTime(timestamp?: number | null): string { return timestamp ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp) : "now"; }

export default function MessageItem({ message }: { message: ChatMessage }) {
  const embeds = useAppStore((state) => message.message_id ? state.linkEmbeds.get(message.message_id) : undefined);
  const disableLinkPreviews = useAppStore((state) => state.disableLinkPreviews);
  const allowExternal = useAppStore((state) => state.enableExternalEmbeds);
  return <article className={`${styles.message} ${message.is_own ? styles.ownMessage : ""}`}>
    <span className={styles.avatar}>{initials(message.sender_name || "Server")}</span>
    <div><header><strong>{message.sender_name || "Server"}</strong><time>{formatTime(message.timestamp)}</time></header><p>{messageText(message.body)}</p>{!disableLinkPreviews && embeds && embeds.length > 0 && <LinkPreviews embeds={embeds} allowExternal={allowExternal} />}</div>
  </article>;
}
