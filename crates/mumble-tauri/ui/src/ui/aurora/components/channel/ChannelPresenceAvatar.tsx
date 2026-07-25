import styles from "./ChannelList.module.css";

export interface ChannelPresenceAvatarProps {
  name: string;
  talking: boolean;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

export default function ChannelPresenceAvatar({ name, talking }: ChannelPresenceAvatarProps) {
  return <span className={`${styles.presenceAvatar} ${talking ? styles.presenceTalking : ""}`} title={name}>{initials(name)}</span>;
}
