import { useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { getPreferences } from "@core/preferencesStorage";
import { Stack } from "../primitives";

interface TypingIndicatorProps {
  readonly channelId: number | null;
}

/** The three dots' bounce. Kept here rather than in the theme - nothing else
 *  in the pack animates on a loop, so it is this component's, not a token. */
const BOUNCE = {
  "@keyframes nebulaTypingBounce": {
    "0%, 60%, 100%": { opacity: 0.3, transform: "translateY(0)" },
    "30%": { opacity: 1, transform: "translateY(-3px)" },
  },
} as const;

/**
 * "Alice is typing…", above the composer.
 *
 * Standard paints a gradient strip to fade the line into the message list;
 * here the conversation already runs under translucent chrome, so the line
 * simply sits on the backdrop and takes no pointer.
 */
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
    <Stack
      direction="row"
      alignItems="center"
      gap={0.75}
      sx={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        height: 22,
        px: "24px",
        pointerEvents: "none",
      }}
    >
      <Stack direction="row" alignItems="center" gap={0.25} aria-hidden sx={{ flex: "none" }}>
        {[0, 0.2, 0.4].map((delay) => (
          <Box
            key={delay}
            sx={(theme) => ({
              ...BOUNCE,
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: theme.palette.nebula.muted,
              animation: "nebulaTypingBounce 1.4s ease-in-out infinite",
              animationDelay: `${delay}s`,
            })}
          />
        ))}
      </Stack>
      <Typography noWrap sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted, minWidth: 0 })}>
        {label}
      </Typography>
    </Stack>
  );
}
