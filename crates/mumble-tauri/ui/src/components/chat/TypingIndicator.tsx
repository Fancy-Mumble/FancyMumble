import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { getPreferences } from "../../preferencesStorage";
import styles from "./TypingIndicator.module.css";

interface TypingIndicatorProps {
  readonly channelId: number | null;
}

export default function TypingIndicator({ channelId }: TypingIndicatorProps) {
  const { t } = useTranslation("chat");
  const typingUsers = useAppStore((s) => s.typingUsers);
  const users = useAppStore((s) => s.users);
  const ownSession = useAppStore((s) => s.ownSession);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    getPreferences().then((prefs) => {
      setDisabled(prefs.disableTypingIndicators ?? false);
    });
  }, []);

  const typingNames = useMemo(() => {
    if (disabled || channelId == null) return [];
    const sessions = typingUsers.get(channelId);
    if (!sessions) return [];
    return [...sessions]
      .filter((s) => s !== ownSession)
      .map((s) => users.find((u) => u.session === s)?.name)
      .filter(Boolean) as string[];
  }, [typingUsers, channelId, users, ownSession, disabled]);

  if (typingNames.length === 0) return null;

  const label =
    typingNames.length === 1
      ? t("typing.one", { name: typingNames[0] })
      : typingNames.length === 2
        ? t("typing.two", { name1: typingNames[0], name2: typingNames[1] })
        : t("typing.many", { name: typingNames[0], count: typingNames.length - 1 });

  return (
    <div className={styles.typingBar}>
      <span className={styles.dots} aria-hidden="true">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
