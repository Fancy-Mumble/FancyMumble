import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { ModalSurface } from "../primitives";
import MessageItem from "./MessageItem";
import styles from "../../AuroraClientExtensions.module.css";

export function TypingStatus({ channelId }: { channelId: number | null }) {
  const sessions = useAppStore((state) =>
    channelId === null ? undefined : state.typingUsers.get(channelId),
  );
  const users = useAppStore((state) => state.users);
  const ownSession = useAppStore((state) => state.ownSession);
  const names = [...(sessions ?? [])]
    .filter((session) => session !== ownSession)
    .flatMap((session) => users.find((user) => user.session === session)?.name ?? []);
  if (names.length === 0) return null;
  return (
    <div className={styles.typingStatus}>
      <i />
      <span>
        {names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0, 2).join(" and ")} are typing…`}
      </span>
    </div>
  );
}

export function PinnedMessagesPanel({ messages, onClose }: { messages: ChatMessage[]; onClose: () => void }) {
  const pinned = messages.filter((message) => message.pinned);
  return (
    <ModalSurface
      title="Pinned messages"
      eyebrow="CHANNEL BOOKMARKS"
      onClose={onClose}
      className={styles.pinnedSurface}
    >
      <div className={styles.pinnedMessages}>
        {pinned.length === 0 ? (
          <div className={styles.directoryState}>Nothing has been pinned in this channel.</div>
        ) : (
          pinned.map((message, index) => <MessageItem key={message.message_id ?? index} message={message} />)
        )}
      </div>
    </ModalSurface>
  );
}
