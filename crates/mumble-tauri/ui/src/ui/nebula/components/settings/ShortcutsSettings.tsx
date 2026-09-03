import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Button, MenuItem, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import {
  DEFAULT_SHORTCUTS,
  applyChangedShortcut,
  loadShortcuts,
  saveShortcuts,
  type ShortcutBindings,
} from "@core/features/settings/shortcutHelpers";
import {
  applyUserShortcut,
  clearUserShortcut,
  loadUserShortcuts,
  saveUserShortcuts,
  type UserShortcut,
} from "@core/features/settings/userShortcuts";
import { Stack } from "../primitives";
import {
  Banner,
  EmptyState,
  GroupRule,
  GroupTitle,
  PageTitle,
  SettingsCard,
  ShortcutRecorder,
} from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";
import { radius } from "../../tokens";

/** The bindings, grouped as the page presents them. */
const GROUPS = [
  {
    titleKey: "shortcuts.groupVoiceGlobal",
    bindings: [
      { key: "pushToTalk", labelKey: "shortcuts.pushToTalk" },
      { key: "toggleMute", labelKey: "shortcuts.toggleMute" },
      { key: "toggleDeafen", labelKey: "shortcuts.toggleDeafen" },
      { key: "voicePriority", labelKey: "shortcuts.voicePriority" },
      { key: "toggleGameOverlay", labelKey: "shortcuts.toggleGameOverlay" },
    ],
  },
  {
    titleKey: "shortcuts.groupVoiceApp",
    bindings: [{ key: "toggleActivationMode", labelKey: "shortcuts.toggleActivationMode" }],
  },
  {
    titleKey: "shortcuts.groupNavigation",
    bindings: [
      { key: "moveChannelUp", labelKey: "shortcuts.moveChannelUp" },
      { key: "moveChannelDown", labelKey: "shortcuts.moveChannelDown" },
      { key: "jumpToRootChannel", labelKey: "shortcuts.jumpToRootChannel" },
      { key: "toggleChannelSidebar", labelKey: "shortcuts.toggleChannelSidebar" },
      { key: "toggleMemberPanel", labelKey: "shortcuts.toggleMemberPanel" },
      { key: "openQuickSearch", labelKey: "shortcuts.quickChannelSearch" },
      { key: "openQuickSwitcher", labelKey: "shortcuts.openQuickSwitcher" },
    ],
  },
  {
    titleKey: "shortcuts.groupWindow",
    bindings: [
      { key: "openSettings", labelKey: "shortcuts.openSettings" },
      { key: "toggleFullscreen", labelKey: "shortcuts.toggleFullscreen" },
      { key: "toggleDevOverlay", labelKey: "shortcuts.toggleDevOverlay", expertOnly: true },
    ],
  },
] as const satisfies readonly {
  titleKey: string;
  bindings: readonly { key: keyof ShortcutBindings; labelKey: string; expertOnly?: boolean }[];
}[];

/** The keys the composer and message list own, which are not rebindable. */
const BUILT_IN = [
  { labelKey: "shortcuts.builtinFocusComposer", keys: "Tab" },
  { labelKey: "shortcuts.builtinSendMessage", keys: "Enter" },
  { labelKey: "shortcuts.builtinNewLine", keys: "Shift+Enter" },
  { labelKey: "shortcuts.builtinEditLast", keys: "ArrowUp", suffixKey: "shortcuts.builtinEditLastHint" },
  { labelKey: "shortcuts.builtinBold", keys: "Ctrl+B" },
  { labelKey: "shortcuts.builtinItalic", keys: "Ctrl+I" },
  { labelKey: "shortcuts.builtinInlineCode", keys: "Ctrl+E" },
  {
    labelKey: "shortcuts.builtinEmojiPicker",
    keys: ":",
    suffixKey: "shortcuts.builtinEmojiHint",
    prefix: "Type",
  },
  {
    labelKey: "shortcuts.builtinMentionPicker",
    keys: "@",
    suffixKey: "shortcuts.builtinMentionHint",
    prefix: "Type",
  },
] as const;

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `us-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The mock's key cap. */
function Kbd({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box
      component="kbd"
      sx={(theme) => ({
        px: "6px",
        py: "2px",
        borderRadius: radius("sm"),
        fontFamily: "inherit",
        fontSize: 10.5,
        fontWeight: 600,
        background: theme.palette.nebula.card2,
        border: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      {children}
    </Box>
  );
}

/**
 * The Shortcuts page.
 *
 * The bindings above the rule are global hotkeys registered with the OS, so
 * changing one has to release the old combination as well as record the new
 * one - `applyChangedShortcut` does both, and skipping it leaves the previous
 * key still firing after the page says it no longer does.
 */
export function ShortcutsSettings() {
  const { t } = useTranslation(["settings", "common"]);
  const { prefs } = usePreferenceSettings();
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    let active = true;
    void loadShortcuts()
      .then((loaded) => active && setShortcuts(loaded))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const change = useCallback((key: keyof ShortcutBindings, value: string) => {
    setShortcuts((prev) => {
      const updated = { ...prev, [key]: value };
      void (async () => {
        await applyChangedShortcut(key, prev[key], value);
        await saveShortcuts(updated);
        // The in-app handlers read their bindings off this event rather than
        // from storage, so without it they keep the old key until relaunch.
        globalThis.dispatchEvent(new CustomEvent("shortcuts-changed", { detail: updated }));
      })();
      return updated;
    });
  }, []);

  const isExpert = prefs !== null && prefs.userMode !== "normal";
  const recorderProps = {
    placeholder: t("shared.shortcutNotSet"),
    clearTitle: t("shared.clearShortcutTitle"),
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("shortcuts.panelTitle")} />
      <Banner tone="info">
        <Box component="span" dangerouslySetInnerHTML={{ __html: t("shortcuts.globalHint") }} />
      </Banner>

      {GROUPS.map((group) => {
        const bindings = group.bindings.filter(
          (binding) => isExpert || !("expertOnly" in binding && binding.expertOnly),
        );
        if (bindings.length === 0) return null;
        return (
          <Box key={group.titleKey}>
            <GroupTitle>{t(group.titleKey)}</GroupTitle>
            <SettingsCard>
              {bindings.map((binding) => (
                <ShortcutRecorder
                  key={binding.key}
                  label={t(binding.labelKey)}
                  value={shortcuts[binding.key]}
                  onChange={(value) => change(binding.key, value)}
                  {...recorderProps}
                />
              ))}
            </SettingsCard>
          </Box>
        );
      })}

      <GroupRule />
      <UserShortcuts recorderProps={recorderProps} />

      <GroupRule />
      <GroupTitle hint={t("shortcuts.builtinHint")}>{t("shortcuts.builtinTitle")}</GroupTitle>
      <SettingsCard>
        {BUILT_IN.map((entry) => (
          <Stack key={entry.labelKey} direction="row" alignItems="center" gap={1.5} sx={{ py: "5px" }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>{t(entry.labelKey)}</Typography>
            <Stack
              direction="row"
              alignItems="center"
              gap={0.75}
              sx={(theme) => ({ flex: "none", fontSize: 11, color: theme.palette.nebula.muted })}
            >
              {"prefix" in entry && <span>{entry.prefix}</span>}
              <Kbd>{entry.keys}</Kbd>
              {"suffixKey" in entry && <span>{t(entry.suffixKey)}</span>}
            </Stack>
          </Stack>
        ))}
      </SettingsCard>
    </Box>
  );
}

/**
 * Global hotkeys that jump straight to one person's DM.
 *
 * A binding is stored against the user's certificate hash where they have one,
 * which is what lets it follow them between servers. Users without a hash can
 * only be bound on the server they were picked on, and the picker says so
 * rather than silently making a narrower binding than was asked for.
 */
function UserShortcuts({
  recorderProps,
}: Readonly<{ recorderProps: { placeholder: string; clearTitle: string } }>) {
  const { t } = useTranslation(["settings", "common"]);
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const users = useAppStore((state) => state.users);
  const ownSession = useAppStore((state) => state.ownSession);

  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickSession, setPickSession] = useState("");

  useEffect(() => {
    let active = true;
    void loadUserShortcuts()
      .then((loaded) => active && setShortcuts(loaded))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const activeSession = sessions.find((session) => session.id === activeServerId);
  const candidates = useMemo(
    () => users.filter((user) => user.session !== ownSession).sort((a, b) => a.name.localeCompare(b.name)),
    [users, ownSession],
  );

  const persist = useCallback(async (next: UserShortcut[]) => {
    setShortcuts(next);
    await saveUserShortcuts(next);
  }, []);

  const add = async () => {
    const target = candidates.find((user) => String(user.session) === pickSession);
    if (!target) return;
    await persist([
      ...shortcuts,
      {
        id: newId(),
        hotkey: "",
        userName: target.name,
        userHash: target.hash || undefined,
        serverId: activeServerId ?? undefined,
        serverLabel: activeSession?.label || activeSession?.host || undefined,
      },
    ]);
    setPicking(false);
    setPickSession("");
  };

  const rebind = async (id: string, hotkey: string) => {
    const previous = shortcuts.find((entry) => entry.id === id);
    if (!previous) return;
    // Release the old combination first, or it keeps firing alongside the new.
    if (previous.hotkey && previous.hotkey !== hotkey) await clearUserShortcut(previous.hotkey);
    const next = shortcuts.map((entry) => (entry.id === id ? { ...entry, hotkey } : entry));
    await persist(next);
    const updated = next.find((entry) => entry.id === id);
    if (updated?.hotkey) await applyUserShortcut(updated);
  };

  const remove = async (id: string) => {
    const target = shortcuts.find((entry) => entry.id === id);
    if (target?.hotkey) await clearUserShortcut(target.hotkey);
    await persist(shortcuts.filter((entry) => entry.id !== id));
  };

  return (
    <Box>
      <GroupTitle hint={t("userShortcuts.hint")}>{t("userShortcuts.title")}</GroupTitle>

      {shortcuts.length === 0 ? (
        <EmptyState>{t("userShortcuts.empty")}</EmptyState>
      ) : (
        <SettingsCard>
          {shortcuts.map((entry) => (
            <Stack key={entry.id} direction="row" alignItems="center" gap={1.25} sx={{ py: "4px" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
                  {entry.userName}
                </Typography>
                <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
                  {entry.userHash
                    ? t("userShortcuts.anyServer")
                    : entry.serverLabel
                      ? t("userShortcuts.serverScoped", { server: entry.serverLabel })
                      : t("userShortcuts.serverScopedUnknown")}
                </Typography>
              </Box>
              <Box sx={{ flex: "none" }}>
                <ShortcutRecorder
                  label=""
                  value={entry.hotkey}
                  onChange={(value) => void rebind(entry.id, value)}
                  {...recorderProps}
                />
              </Box>
              <Button size="small" color="error" sx={{ flex: "none" }} onClick={() => void remove(entry.id)}>
                {t("userShortcuts.remove")}
              </Button>
            </Stack>
          ))}
        </SettingsCard>
      )}

      {picking ? (
        <SettingsCard sx={{ mt: "10px" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "7px" }}>
            {t("userShortcuts.pickUser")}
          </Typography>
          {!activeServerId && <Banner tone="warn">{t("userShortcuts.noActiveServer")}</Banner>}
          {activeServerId && candidates.length === 0 && (
            <Banner tone="warn">{t("userShortcuts.noUsersOnline")}</Banner>
          )}
          <TextField
            select
            fullWidth
            size="small"
            sx={{ mt: "8px" }}
            value={pickSession}
            disabled={!activeServerId || candidates.length === 0}
            onChange={(event) => setPickSession(event.target.value)}
            slotProps={{ htmlInput: { "aria-label": t("userShortcuts.pickUser") } }}
          >
            <MenuItem value="">{t("userShortcuts.selectPrompt")}</MenuItem>
            {candidates.map((user) => (
              <MenuItem key={user.session} value={String(user.session)}>
                {user.name}
                {user.hash ? "" : ` (${t("userShortcuts.noHashBadge")})`}
              </MenuItem>
            ))}
          </TextField>
          <Typography sx={(theme) => ({ mt: "7px", fontSize: 11, color: theme.palette.nebula.muted })}>
            {t("userShortcuts.noHashExplain")}
          </Typography>
          <Stack direction="row" gap={0.75} justifyContent="flex-end" sx={{ mt: "10px" }}>
            <Button
              size="small"
              onClick={() => {
                setPicking(false);
                setPickSession("");
              }}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button size="small" variant="contained" disabled={!pickSession} onClick={() => void add()}>
              {t("userShortcuts.add")}
            </Button>
          </Stack>
        </SettingsCard>
      ) : (
        <Button size="small" variant="outlined" sx={{ mt: "10px" }} onClick={() => setPicking(true)}>
          {t("userShortcuts.addBtn")}
        </Button>
      )}
    </Box>
  );
}
