import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, MenuItem, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import {
  applyWhisperTarget,
  clearWhisperTarget,
  loadWhisperTargets,
  newWhisperTarget,
  saveWhisperTargets,
  whisperTargetChannels,
  whisperTargetSummary,
  WHISPER_TARGETS_CHANGED_EVENT,
  type WhisperTarget,
} from "@core/features/settings/whisperTargets";
import { useWhisperState } from "@core/features/settings/useWhisperState";
import { CloseIcon } from "@ui/icons";
import { Stack } from "../primitives";
import {
  Banner,
  EmptyState,
  GroupTitle,
  SegmentedGroup,
  SelectField,
  SettingsCard,
  ShortcutRecorder,
  TextRow,
  ToggleRow,
} from "./controls";
import { radius } from "../../tokens";

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `wt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Whisper and shout targets: Mumble's hold-to-speak-elsewhere shortcuts.
 *
 * Every write re-registers the hotkey, not only a rebind. The registered
 * handler holds the target it was bound with, so an edit that changed only who
 * a key reaches would otherwise keep whispering to the old audience until the
 * next launch.
 */
export function WhisperTargetsSection({
  recorderProps,
}: Readonly<{ recorderProps: { placeholder: string; clearTitle: string } }>) {
  const { t } = useTranslation(["settings", "common"]);
  const [targets, setTargets] = useState<WhisperTarget[]>([]);
  const [draft, setDraft] = useState<WhisperTarget | null>(null);
  const { deniedChannels } = useWhisperState();
  const users = useAppStore((state) => state.users);
  const channels = useAppStore((state) => state.channels);
  const currentChannel = useAppStore((state) => state.currentChannel);

  /** The rooms the server refused this target in, by name. A refusal names
   *  only a channel, so it is matched to the targets that need that channel. */
  const refusedIn = (target: WhisperTarget): string =>
    whisperTargetChannels(target, { users, channels, currentChannel })
      .filter((id) => deniedChannels.includes(id))
      .map((id) => channels.find((channel) => channel.id === id)?.name ?? `#${id}`)
      .join(", ");

  useEffect(() => {
    let active = true;
    void loadWhisperTargets()
      .then((loaded) => active && setTargets(loaded))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const commit = useCallback(
    async (next: WhisperTarget[], previous: WhisperTarget | undefined, updated: WhisperTarget | undefined) => {
      if (previous?.hotkey) await clearWhisperTarget(previous.hotkey);
      setTargets(next);
      await saveWhisperTargets(next);
      // The sync re-registers the slots from the saved list; positions moved
      // when a row was removed, and a slot left holding a deleted target
      // would keep whispering to it.
      globalThis.dispatchEvent(new CustomEvent(WHISPER_TARGETS_CHANGED_EVENT));
      if (updated?.hotkey) await applyWhisperTarget(updated);
    },
    [],
  );

  const rebind = (id: string, hotkey: string) => {
    const previous = targets.find((target) => target.id === id);
    if (!previous) return;
    const updated = { ...previous, hotkey };
    void commit(targets.map((target) => (target.id === id ? updated : target)), previous, updated);
  };

  const remove = (id: string) => {
    const previous = targets.find((target) => target.id === id);
    void commit(targets.filter((target) => target.id !== id), previous, undefined);
  };

  const save = (updated: WhisperTarget) => {
    const previous = targets.find((target) => target.id === updated.id);
    const next = previous
      ? targets.map((target) => (target.id === updated.id ? updated : target))
      : [...targets, updated];
    void commit(next, previous, updated);
    setDraft(null);
  };

  const summaryLabels = {
    users: (names: string) => t("whisper.summaryUsers", { names }),
    channel: (name: string) => t("whisper.summaryChannel", { name }),
    currentChannel: t("whisper.summaryCurrent"),
    unset: t("whisper.summaryUnset"),
  };

  return (
    <Box>
      <GroupTitle hint={t("whisper.hint")}>{t("whisper.title")}</GroupTitle>

      {targets.length === 0 ? (
        <EmptyState>{t("whisper.empty")}</EmptyState>
      ) : (
        <SettingsCard>
          {targets.map((target) => (
            <Stack
              key={target.id}
              direction="row"
              alignItems="center"
              gap={1.25}
              flexWrap="wrap"
              sx={{ py: "4px" }}
              data-whisper-target={target.name}
            >
              <Box sx={{ flex: 1, minWidth: 140 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
                  {target.name}
                </Typography>
                <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
                  {whisperTargetSummary(target, summaryLabels)}
                </Typography>
                {refusedIn(target) && (
                  <Typography
                    data-whisper-refused=""
                    sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.warn })}
                  >
                    {t("whisper.deniedRow", { channels: refusedIn(target) })}
                  </Typography>
                )}
              </Box>
              <Box sx={{ flex: "none" }}>
                <ShortcutRecorder
                  label=""
                  value={target.hotkey}
                  onChange={(value) => rebind(target.id, value)}
                  {...recorderProps}
                />
              </Box>
              <Button size="small" sx={{ flex: "none" }} onClick={() => setDraft({ ...target })}>
                {t("whisper.edit")}
              </Button>
              <Button size="small" color="error" sx={{ flex: "none" }} onClick={() => remove(target.id)}>
                {t("whisper.remove")}
              </Button>
            </Stack>
          ))}
        </SettingsCard>
      )}

      {draft ? (
        <WhisperTargetEditor draft={draft} onChange={setDraft} onCancel={() => setDraft(null)} onSave={save} />
      ) : (
        <Button
          size="small"
          variant="outlined"
          sx={{ mt: "10px" }}
          data-testid={TID.whisperTargetAdd}
          onClick={() =>
            setDraft(newWhisperTarget(newId(), t("whisper.defaultName", { n: targets.length + 1 })))
          }
        >
          {t("whisper.addBtn")}
        </Button>
      )}
    </Box>
  );
}

/**
 * The target dialog upstream opens from its shortcut table, laid out inline.
 *
 * People are picked from the active server's roster and stored by certificate
 * hash where they have one - the identity that survives a reconnect. A fixed
 * channel is stored by id, which is only meaningful on the server it was picked
 * on; "my current channel" is the choice that travels.
 */
function WhisperTargetEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: Readonly<{
  draft: WhisperTarget;
  onChange: (target: WhisperTarget) => void;
  onCancel: () => void;
  onSave: (target: WhisperTarget) => void;
}>) {
  const { t } = useTranslation(["settings", "common"]);
  const users = useAppStore((state) => state.users);
  const channels = useAppStore((state) => state.channels);
  const ownSession = useAppStore((state) => state.ownSession);
  const activeServerId = useAppStore((state) => state.activeServerId);

  const candidates = useMemo(
    () =>
      users
        .filter((user) => user.session !== ownSession)
        .filter(
          (user) =>
            !draft.users.some((ref) => (ref.hash ? ref.hash === user.hash : ref.name === user.name)),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, ownSession, draft.users],
  );

  const channelOptions = useMemo(
    () => [
      { id: "", label: t("whisper.channelPick") },
      ...[...channels]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((channel) => ({ id: String(channel.id), label: channel.name })),
    ],
    [channels, t],
  );

  const patch = (changes: Partial<WhisperTarget>) => onChange({ ...draft, ...changes });

  const canSave =
    draft.name.trim() !== "" &&
    (draft.kind === "users"
      ? draft.users.length > 0
      : draft.channelMode === "current" || draft.channelId !== undefined);

  return (
    <SettingsCard sx={{ mt: "10px" }} testId="whisper-target-editor">
      {!activeServerId && <Banner tone="warn">{t("whisper.noActiveServer")}</Banner>}

      <TextRow
        label={t("whisper.nameLabel")}
        value={draft.name}
        onChange={(name) => patch({ name })}
        sx={{ mt: "8px" }}
      />

      <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "7px" }}>{t("whisper.kindLabel")}</Typography>
      <SegmentedGroup
        ariaLabel={t("whisper.kindLabel")}
        value={draft.kind}
        onChange={(kind) => patch({ kind })}
        options={[
          { id: "users", label: t("whisper.kindUsers") },
          { id: "channel", label: t("whisper.kindChannel") },
        ]}
      />

      {draft.kind === "users" ? (
        <Box sx={{ mt: "14px" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "7px" }}>{t("whisper.usersLabel")}</Typography>
          {draft.users.length === 0 ? (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "8px" })}>
              {t("whisper.noUsersPicked")}
            </Typography>
          ) : (
            <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mb: "8px" }}>
              {draft.users.map((ref) => (
                <Stack
                  key={ref.hash ?? `name:${ref.name}`}
                  direction="row"
                  alignItems="center"
                  gap={0.5}
                  sx={(theme) => ({
                    pl: "10px",
                    pr: "4px",
                    py: "3px",
                    fontSize: 12,
                    borderRadius: radius("md"),
                    background: theme.palette.nebula.accentSoft,
                    border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.accentLine}`,
                  })}
                >
                  {ref.name}
                  <Box
                    component="button"
                    type="button"
                    aria-label={t("whisper.removeUser", { name: ref.name })}
                    onClick={() => patch({ users: draft.users.filter((other) => other !== ref) })}
                    sx={{ all: "unset", cursor: "pointer", display: "flex", opacity: 0.7 }}
                  >
                    <CloseIcon width={12} height={12} />
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
          <TextField
            select
            fullWidth
            size="small"
            value=""
            disabled={candidates.length === 0}
            onChange={(event) => {
              const user = candidates.find((candidate) => String(candidate.session) === event.target.value);
              if (!user) return;
              patch({ users: [...draft.users, { name: user.name, hash: user.hash || undefined }] });
            }}
            // The prompt is the "" option, and MUI draws a "" value as an empty
            // box unless told to render it.
            slotProps={{ select: { displayEmpty: true }, htmlInput: { "aria-label": t("whisper.addUser") } }}
          >
            <MenuItem value="">{t("whisper.addUser")}</MenuItem>
            {candidates.map((user) => (
              <MenuItem key={user.session} value={String(user.session)}>
                {user.name}
              </MenuItem>
            ))}
          </TextField>
          <Typography sx={(theme) => ({ mt: "7px", fontSize: 11, color: theme.palette.nebula.muted })}>
            {t("whisper.hashless")}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ mt: "14px" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "7px" }}>
            {t("whisper.channelModeLabel")}
          </Typography>
          <SegmentedGroup
            ariaLabel={t("whisper.channelModeLabel")}
            value={draft.channelMode}
            onChange={(channelMode) => patch({ channelMode })}
            options={[
              { id: "fixed", label: t("whisper.channelFixed") },
              { id: "current", label: t("whisper.channelCurrent") },
            ]}
          />
          {draft.channelMode === "fixed" && (
            <SelectField
              label={t("whisper.channelPick")}
              sx={{ mt: "14px" }}
              value={draft.channelId === undefined ? "" : String(draft.channelId)}
              options={channelOptions}
              onChange={(id) => {
                const channel = channels.find((entry) => String(entry.id) === id);
                patch({ channelId: channel?.id, channelName: channel?.name });
              }}
            />
          )}
          <Box sx={{ mt: "14px" }}>
            <ToggleRow title={t("whisper.links")} checked={draft.links} onChange={() => patch({ links: !draft.links })} />
            <ToggleRow
              title={t("whisper.children")}
              checked={draft.children}
              onChange={() => patch({ children: !draft.children })}
            />
          </Box>
          <TextRow
            label={t("whisper.group")}
            hint={t("whisper.groupHint")}
            value={draft.group ?? ""}
            onChange={(group) => patch({ group })}
          />
        </Box>
      )}

      <Stack direction="row" gap={0.75} justifyContent="flex-end" sx={{ mt: "10px" }}>
        <Button size="small" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button size="small" variant="contained" disabled={!canSave} onClick={() => onSave(draft)}>
          {t("whisper.save")}
        </Button>
      </Stack>
    </SettingsCard>
  );
}
