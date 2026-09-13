import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Checkbox, FormControlLabel, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import type { Friend } from "@core/friendsStorage";
import {
  NOTEPAD_PROTOCOLS,
  resolveNotepad,
  sameNotepad,
  selfLogins,
  toSettings,
  type NotepadLogin,
  type NotepadProtocol,
  type NotepadSettings as NotepadChoice,
  type ResolvedNotepad,
} from "@core/notepad";
import {
  changeNotepad,
  isNotepadReachable,
  NotepadError,
  saveNotepadSettings,
  type NotepadFailure,
  type NotepadProgress,
} from "@core/notepadActions";
import { useSavedFriends } from "../../useFriends";
import { useStoredNotepad } from "../../useNotepad";
import { Stack } from "../primitives";
import { Banner, SelectField } from "./controls";

const LOCAL_ID = "local";

function loginId(login: NotepadLogin): string {
  return `server:${login.host}:${login.port}:${login.username}`;
}

function loginOf(friend: Friend): NotepadLogin {
  return { host: friend.serverHost!, port: friend.serverPort!, username: friend.serverUsername ?? "" };
}

/**
 * Where your notepad is kept, and how it is encrypted.
 *
 * Drawn on the Privacy page and in the dialog the notepad row opens, so both
 * say the same thing. Changing either starts a new notepad: the choice is only
 * saved once the user confirms, together with whether the old notes are copied
 * across and whether they are deleted from where they were.
 */
export function NotepadSettings({ onDone }: Readonly<{ onDone?: () => void }>) {
  const { t } = useTranslation("nebulaSettings");
  const saved = useSavedFriends();
  const stored = useStoredNotepad();
  const sessions = useAppStore((state) => state.sessions);
  const users = useAppStore((state) => state.users);
  const ownSession = useAppStore((state) => state.ownSession);

  const current = useMemo(() => resolveNotepad(stored.settings, saved), [stored.settings, saved]);
  const logins = useMemo(() => selfLogins(saved), [saved]);
  const [draft, setDraft] = useState<NotepadChoice | null>(null);
  const [copy, setCopy] = useState(true);
  const [deleteOld, setDeleteOld] = useState(false);
  const [progress, setProgress] = useState<NotepadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  if (!stored.loaded) return null;

  const target = draft ?? toSettings(current);
  const next = resolveNotepad(target, saved);
  const changed = !sameNotepad(next, current);

  const place = (notepad: ResolvedNotepad) =>
    notepad.location.kind === "local"
      ? t("notepad.placeDevice")
      : notepad.friend?.serverLabel || notepad.location.host;

  const fromReachable = isNotepadReachable(current, sessions);
  const toReachable = isNotepadReachable(next, sessions);
  const canCopy = fromReachable && toReachable;
  const doCopy = copy && canCopy;
  const doDelete = deleteOld && fromReachable;
  const unreachable = [current, next].find((notepad) => !isNotepadReachable(notepad, sessions));

  const protocolLabels: Record<NotepadProtocol, string> = {
    signal_v1: t("notepad.protocolSignal"),
    fancy_v1_full_archive: t("notepad.protocolFancy"),
    server_managed: t("notepad.protocolServer"),
  };
  const protocolHints: Record<NotepadProtocol, string> = {
    signal_v1: t("notepad.signalHint"),
    fancy_v1_full_archive: t("notepad.fancyHint"),
    server_managed: t("notepad.serverHint"),
  };

  const failure = (reason: NotepadFailure, detail: string): string =>
    ({
      notConnected: t("notepad.errors.notConnected"),
      notRegistered: t("notepad.errors.notRegistered"),
      protocolUnsupported: t("notepad.errors.protocolUnsupported"),
      readFailed: t("notepad.errors.readFailed", { detail }),
      copyFailed: t("notepad.errors.copyFailed", { detail }),
      deleteFailed: t("notepad.errors.deleteFailed", { detail }),
    })[reason];

  const progressText = (step: NotepadProgress) =>
    ({
      reading: t("notepad.progressReading", { done: step.done }),
      copying: t("notepad.progressCopying", { done: step.done, total: step.total }),
      deleting: t("notepad.progressDeleting", { done: step.done, total: step.total }),
    })[step.step];

  const chooseLocation = (id: string) => {
    setOutcome(null);
    if (id === LOCAL_ID) {
      setDraft({ location: { kind: "local" }, protocol: target.protocol });
      return;
    }
    const login = logins.find((friend) => loginId(loginOf(friend)) === id);
    if (login) setDraft({ location: { kind: "server", ...loginOf(login) }, protocol: target.protocol });
  };

  const apply = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const own = users.find((user) => user.session === ownSession);
      const result = await changeNotepad({
        from: current,
        to: next,
        copy: doCopy,
        deleteOld: doDelete,
        author: {
          name: current.friend?.userName ?? own?.name ?? t("notepad.title"),
          hash: own?.hash ?? current.friend?.userHash ?? null,
        },
        onProgress: setProgress,
      });
      await saveNotepadSettings(toSettings(next));
      setDraft(null);
      setOutcome({
        tone: "ok",
        text: [
          t("notepad.done", { copied: result.copied, deleted: result.deleted }),
          result.skipped > 0 ? t("notepad.skipped", { count: result.skipped }) : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      onDone?.();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setOutcome({
        tone: "danger",
        text: failure(error instanceof NotepadError ? error.reason : "readFailed", detail),
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Box data-testid={TID.notepadSettings}>
      <SelectField
        label={t("notepad.location")}
        value={target.location.kind === "local" ? LOCAL_ID : loginId(target.location)}
        options={[
          { id: LOCAL_ID, label: t("notepad.thisDevice") },
          ...logins.map((friend) => ({
            id: loginId(loginOf(friend)),
            label: t("notepad.loginLabel", {
              server: friend.serverLabel || friend.serverHost,
              name: friend.userName,
            }),
          })),
        ]}
        onChange={chooseLocation}
        disabled={busy}
      />
      <SelectField
        label={t("notepad.encryption")}
        hint={target.location.kind === "local" ? t("notepad.localHint") : protocolHints[target.protocol]}
        value={target.protocol}
        options={NOTEPAD_PROTOCOLS.map((protocol) => ({ id: protocol, label: protocolLabels[protocol] }))}
        onChange={(protocol) => {
          setOutcome(null);
          setDraft({ ...target, protocol });
        }}
        disabled={busy || target.location.kind === "local"}
      />

      {changed && (
        <Banner tone="warn" title={t("notepad.changeTitle")}>
          {t("notepad.changeBody")}
          <Stack sx={{ mt: "6px" }}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={doCopy}
                  disabled={!canCopy || busy}
                  onChange={(event) => setCopy(event.target.checked)}
                />
              }
              label={t("notepad.copyOld", { place: place(next) })}
              slotProps={{ typography: { sx: { fontSize: 12 } } }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={doDelete}
                  disabled={!fromReachable || busy}
                  onChange={(event) => setDeleteOld(event.target.checked)}
                />
              }
              label={t("notepad.deleteOld", { place: place(current) })}
              slotProps={{ typography: { sx: { fontSize: 12 } } }}
            />
          </Stack>
          {unreachable && (
            <Typography sx={{ fontSize: 11.5 }}>
              {t("notepad.needsConnection", { server: place(unreachable) })}
            </Typography>
          )}
          {doCopy && next.location.kind === "server" && (
            <Typography sx={{ fontSize: 11.5 }}>{t("notepad.copyHint")}</Typography>
          )}
          {doDelete && !doCopy && (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.bad })}>
              {t("notepad.deleteWarning")}
            </Typography>
          )}
        </Banner>
      )}

      {progress && (
        <Typography sx={(theme) => ({ mt: "10px", fontSize: 12, color: theme.palette.nebula.muted })}>
          {progressText(progress)}
        </Typography>
      )}
      {outcome && <Banner tone={outcome.tone}>{outcome.text}</Banner>}

      {changed && (
        <Stack direction="row" gap={1} sx={{ mt: "12px" }}>
          <Button
            variant="contained"
            size="small"
            disabled={busy}
            onClick={() => void apply()}
            data-testid={TID.notepadApply}
          >
            {t("notepad.apply")}
          </Button>
          <Button size="small" disabled={busy} onClick={() => setDraft(null)}>
            {t("notepad.cancel")}
          </Button>
        </Stack>
      )}
    </Box>
  );
}
