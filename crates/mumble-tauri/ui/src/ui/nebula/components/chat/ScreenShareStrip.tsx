import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogContent } from "@mui/material";
import { useAppStore } from "@core/store";
import { useScreenShare } from "@standard/components/chat/stream/useScreenShare";
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
  const share = useScreenShare();
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
    if (cameraRequested) share.startCameraSharing();
    else share.startSharing();
  }, [cameraRequested, requested, share]);
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
        (session) => users.find((user) => user.session === session)?.name ?? "Someone",
        ownSession,
        ownDisplayKind,
        usesNativeSurface(),
      ),
    [media, ownDisplayKind, ownSession, sessions, users],
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
        <Stack
          direction="row"
          alignItems="center"
          gap={1.5}
          sx={(theme) => ({
            mx: "20px",
            mt: "12px",
            px: "12px",
            py: "8px",
            borderRadius: radius("md"),
            fontSize: 11.5,
            color: theme.palette.nebula.bad,
            background: `${theme.palette.nebula.bad}1f`,
            border: `1px solid ${theme.palette.nebula.bad}55`,
          })}
        >
          <span>{error}</span>
          <Button
            size="small"
            sx={{ ml: "auto" }}
            onClick={() => useAppStore.setState({ webrtcError: null })}
          >
            Dismiss
          </Button>
        </Stack>
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
        <ScreenShareStage feeds={feeds} share={share} onOpenQuality={() => setQualityOpen(true)} />
      )}
    </>
  );
}
