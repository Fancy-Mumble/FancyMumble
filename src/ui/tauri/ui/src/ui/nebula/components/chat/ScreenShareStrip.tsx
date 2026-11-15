import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogContent } from "@mui/material";
import { useAppStore } from "@core/store";
import { useScreenShare, type ScreenShareHook } from "@standard/components/chat/stream/useScreenShare";
import ScreenSharePickerDialog from "@standard/components/chat/stream/ScreenSharePickerDialog";
import { Stack } from "../primitives";
import { radius } from "../../tokens";
import { buildFeeds, type FeedKind, type SessionMedia } from "./share/feeds";
import { SessionMediaSource } from "./share/SessionMediaSource";
import { ScreenShareStage } from "./share/ScreenShareStage";
import { usesNativeSurface } from "./share/StreamSurface";

// The bare item list, not the default export: that one is a kebab button that
// anchors its own popup, which inside this dialog collapsed to a stray button
// over a menu positioned out of the dialog's box.
const StreamConfigItems = lazy(() =>
  import("@standard/components/chat/stream/StreamConfigMenu").then((m) => ({
    default: m.StreamConfigItems,
  })),
);

interface ScreenShareStripProps {
  /** True while the channel menu's "Share screen" is waiting for a source. */
  pickerRequested: boolean;
  /** The same, for the voice dock's "Share your camera": camera-only mode. */
  cameraRequested?: boolean;
  onPickerClosed: () => void;
}

/**
 * Everything the live share owns above the message river.
 *
 * This is the plumbing half - the source picker, the encoder dialog, the error
 * banner, and one receive path per broadcaster - while the picture itself is
 * {@link ScreenShareStage}. The split follows the lifetimes: a viewer
 * connection must outlive any tile that happens to be drawing it, and the
 * picker must outlive the stage, which does not exist until pixels do.
 */
export function ScreenShareStrip({
  pickerRequested,
  cameraRequested = false,
  onPickerClosed,
}: Readonly<ScreenShareStripProps>) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const share = useScreenShare();
  // Set when a share was asked for while another server connection holds the
  // app's one capture; cleared once that share ends.
  const [blocked, setBlocked] = useState(false);
  const elsewhere = share.isBroadcastingFromOtherTab;
  useEffect(() => {
    if (!elsewhere) setBlocked(false);
  }, [elsewhere]);
  // Every way into a share passes through here - the header, the dock, the
  // phone's voice screen, the stage's own camera button - so this is where a
  // second capture is refused, rather than in each of them.
  const guarded = useMemo<ScreenShareHook>(
    () =>
      elsewhere
        ? { ...share, startSharing: () => setBlocked(true), startCameraSharing: () => setBlocked(true) }
        : share,
    [elsewhere, share],
  );
  const users = useAppStore((state) => state.users);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const ownSession = useAppStore((state) => state.ownSession);
  const error = useAppStore((state) => state.webrtcError);
  const webrtcConnecting = useAppStore((state) => state.webrtcConnecting);

  const [qualityOpen, setQualityOpen] = useState(false);
  const [media, setMedia] = useState<ReadonlyMap<number, SessionMedia>>(new Map());

  const broadcasters = useMemo(
    () =>
      [...share.broadcastingSessions].filter(
        (session) =>
          session !== ownSession &&
          users.some((user) => user.session === session && user.channel_id === currentChannel),
      ),
    [currentChannel, ownSession, share.broadcastingSessions, users],
  );

  // Own share first: it is the one the user just started, and the stage takes
  // its first feed when nothing else is selected.
  const sessions = useMemo(
    () => (share.isBroadcasting && ownSession !== null ? [ownSession, ...broadcasters] : [...broadcasters]),
    [broadcasters, ownSession, share.isBroadcasting],
  );
  const sessionKey = sessions.join(",");

  // The picker is the hook's own state; the channel menu and the voice dock
  // just ask for it. Which of the two asked decides whether the picker opens
  // on every source or on cameras alone.
  const requested = pickerRequested || cameraRequested;
  useEffect(() => {
    if (!requested || share.pickerOpen) return;
    if (cameraRequested) guarded.startCameraSharing();
    else guarded.startSharing();
  }, [cameraRequested, guarded, requested, share.pickerOpen]);
  useEffect(() => {
    if (requested && !share.pickerOpen) onPickerClosed();
  }, [onPickerClosed, requested, share.pickerOpen]);

  useEffect(() => {
    if (qualityOpen && !share.isBroadcasting) setQualityOpen(false);
  }, [qualityOpen, share.isBroadcasting]);

  const publishMedia = useCallback((next: SessionMedia) => {
    setMedia((previous) => new Map(previous).set(next.session, next));
  }, []);

  // Drop what a session that stopped sharing left behind, so a later share by
  // the same person starts from its own transport rather than from stale refs.
  useEffect(() => {
    const live = new Set(sessionKey === "" ? [] : sessionKey.split(",").map(Number));
    setMedia((previous) => {
      if ([...previous.keys()].every((session) => live.has(session))) return previous;
      return new Map([...previous].filter(([session]) => live.has(session)));
    });
  }, [sessionKey]);

  // Screen versus window is ours to know only about our own broadcast - the
  // announce other clients send carries screen-versus-camera and no more.
  const ownDisplayKind: FeedKind =
    share.activeSources?.find((source) => source.kind !== "device")?.kind === "window" ? "window" : "screen";

  const feeds = useMemo(
    () =>
      buildFeeds(
        sessions.map((session) => media.get(session)).filter((entry) => entry !== undefined),
        (session) => users.find((user) => user.session === session)?.name ?? t("nebulaChat:share.someone"),
        ownSession,
        ownDisplayKind,
        usesNativeSurface(),
        t("nebulaChat:share.you"),
      ),
    [media, ownDisplayKind, ownSession, sessions, users, t],
  );

  return (
    <>
      {share.pickerOpen && (
        <ScreenSharePickerDialog
          onConfirm={(sources, settings) => void share.confirmSource(sources, settings)}
          onCancel={share.cancelPicker}
          initialSettings={share.settings}
          initialSelection={share.activeSources ?? undefined}
          deviceOnly={share.pickerDeviceOnly}
        />
      )}

      {error && (
        <StripNotice
          text={error}
          dismissLabel={t("common:actions.dismiss")}
          onDismiss={() => useAppStore.setState({ webrtcError: null })}
        />
      )}
      {blocked && elsewhere && (
        <StripNotice
          text={t("chat:screenShare.alreadySharingOtherServer")}
          dismissLabel={t("common:actions.dismiss")}
          onDismiss={() => setBlocked(false)}
        />
      )}

      {/* Resolution, frame rate and what is captured, changed on the live share
          rather than only when it is started. */}
      <Dialog open={qualityOpen} onClose={() => setQualityOpen(false)} maxWidth="xs" fullWidth>
        <DialogContent sx={{ p: 1.5 }}>
          <Suspense fallback={null}>
            <StreamConfigItems
              layout="panel"
              settings={share.settings}
              onStop={share.stopSharing}
              onChangeSource={share.startSharing}
              onSetSettings={share.changeSettings}
              onDismiss={() => setQualityOpen(false)}
            />
          </Suspense>
        </DialogContent>
      </Dialog>

      {/* Draws nothing: the receive paths, mounted for as long as their
          sessions are sharing rather than for as long as a tile draws them. */}
      {sessions.map((session) => (
        <SessionMediaSource
          key={session}
          session={session}
          // The loopback preview can only start once the Rust broadcaster is on
          // the wire; mounting earlier races START.
          active={session !== ownSession || !webrtcConnecting}
          onChange={publishMedia}
        />
      ))}

      {feeds.length > 0 && (
        <ScreenShareStage feeds={feeds} share={guarded} onOpenQuality={() => setQualityOpen(true)} />
      )}
    </>
  );
}

/** A line under the stage saying why a share is not happening, until dismissed. */
function StripNotice({ text, dismissLabel, onDismiss }: Readonly<{ text: string; dismissLabel: string; onDismiss: () => void }>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.5}
      role="alert"
      sx={(theme) => ({
        mx: "20px",
        mt: "12px",
        px: "12px",
        py: "8px",
        borderRadius: radius("md"),
        fontSize: 11.5,
        color: theme.palette.nebula.bad,
        background: `${theme.palette.nebula.bad}1f`,
        border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.bad}55`,
      })}
    >
      <span>{text}</span>
      <Button size="small" sx={{ ml: "auto" }} onClick={onDismiss}>
        {dismissLabel}
      </Button>
    </Stack>
  );
}
