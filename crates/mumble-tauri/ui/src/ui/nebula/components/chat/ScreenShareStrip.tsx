import { useEffect, useMemo, useRef } from "react";
import { Box, Button, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { useRemoteStreams, useScreenShare } from "@standard/components/chat/stream/useScreenShare";
import ScreenSharePickerDialog from "@standard/components/chat/stream/ScreenSharePickerDialog";
import { useNativeStreamView } from "@standard/components/chat/stream/nativeStreamView";
import {
  activeStreamViewerStrategy,
  StreamViewerStrategyId,
} from "@standard/components/chat/stream/viewerStrategy";
import { UserAvatar, Stack } from "../primitives";
import { radius } from "../../tokens";

/** Whether the active strategy paints onto a canvas (the native Rust viewer -
 *  mandatory on Linux, where WebKitGTK has no WebRTC) instead of binding a
 *  MediaStream to `<video>`. Constant per page load (the strategy is latched),
 *  so branching on it inside a component never changes hook order. */
function usesNativeSurface(): boolean {
  return activeStreamViewerStrategy().id === StreamViewerStrategyId.Native;
}

interface ScreenShareStripProps {
  /** True while the channel menu's "Share screen" is waiting for a source. */
  pickerRequested: boolean;
  onPickerClosed: () => void;
}

/**
 * The live video strip above the message river.
 *
 * The mock puts shared screens and cameras in one grid pinned to the top of
 * the conversation rather than in a separate call view, so chat keeps running
 * underneath a share. The strip only exists while something is actually live -
 * there is no empty "no one is sharing" state to dismiss.
 */
export function ScreenShareStrip({ pickerRequested, onPickerClosed }: Readonly<ScreenShareStripProps>) {
  const share = useScreenShare();
  const users = useAppStore((state) => state.users);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const ownSession = useAppStore((state) => state.ownSession);
  const error = useAppStore((state) => state.webrtcError);
  const webrtcConnecting = useAppStore((state) => state.webrtcConnecting);

  const broadcasters = useMemo(
    () =>
      [...share.broadcastingSessions].filter(
        (session) =>
          session !== ownSession &&
          users.some((user) => user.session === session && user.channel_id === currentChannel),
      ),
    [currentChannel, ownSession, share.broadcastingSessions, users],
  );

  // The picker is the hook's own state; the channel menu just asks for it.
  useEffect(() => {
    if (pickerRequested && !share.pickerOpen) share.startSharing();
  }, [pickerRequested, share]);
  useEffect(() => {
    if (pickerRequested && !share.pickerOpen) onPickerClosed();
  }, [onPickerClosed, pickerRequested, share.pickerOpen]);

  const live = broadcasters.length > 0 || share.isBroadcasting;

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

      {live && (
        <Box
          sx={(theme) => ({
            flex: "none",
            mx: "20px",
            mt: "12px",
            p: "8px",
            borderRadius: radius("lg"),
            background: "#0a0b0d",
            border: `1px solid ${theme.palette.nebula.line2}`,
          })}
        >
          <Stack direction="row" alignItems="center" gap={1} sx={{ px: "2px", pb: "8px" }}>
            <Box
              component="span"
              sx={{
                px: "8px",
                py: "3px",
                borderRadius: radius("sm"),
                background: "#d95757",
                color: "#fff",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".04em",
              }}
            >
              LIVE
            </Box>
            <Typography sx={{ fontSize: 11, color: "#c6c9d0" }}>
              {broadcasters.length + (share.isBroadcasting ? 1 : 0)} sharing
            </Typography>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gap: "8px",
              gridTemplateColumns: `repeat(${Math.min(3, broadcasters.length + (share.isBroadcasting ? 1 : 0))},1fr)`,
              height: 270,
            }}
          >
            {share.isBroadcasting && (
              <Tile
                stream={share.localStream}
                label="You · sharing"
                session={ownSession}
                name="You"
                own
                // The loopback preview can only start once the Rust
                // broadcaster is on the wire; mounting earlier races START.
                nativeActive={!webrtcConnecting}
              />
            )}
            {broadcasters.map((session) => (
              <RemoteTile key={session} session={session} onWatch={() => share.watchBroadcast(session)} />
            ))}
          </Box>

          <Stack direction="row" gap={0.625} justifyContent="center" sx={{ pt: "8px" }}>
            <Button
              size="small"
              onClick={share.startCameraSharing}
              sx={{ color: "#dfe1e6", background: "rgba(255,255,255,.08)" }}
            >
              Share my camera
            </Button>
            {share.isBroadcasting && (
              <Button
                size="small"
                variant="outlined"
                onClick={share.stopSharing}
                sx={{ color: "#e89a9a", borderColor: "rgba(217,87,87,.5)" }}
              >
                Stop sharing
              </Button>
            )}
            {share.watchingSession !== null && (
              <Button size="small" onClick={share.stopWatching} sx={{ color: "#dfe1e6" }}>
                Stop watching
              </Button>
            )}
          </Stack>
        </Box>
      )}
    </>
  );
}

function RemoteTile({ session, onWatch }: Readonly<{ session: number; onWatch: () => void }>) {
  const streams = useRemoteStreams(session);
  const name = useAppStore(
    (state) => state.users.find((user) => user.session === session)?.name ?? "Someone",
  );
  return (
    <Tile
      stream={streams.primary}
      label={`${name} · screen`}
      session={session}
      name={name}
      // Native viewports own their own receive path, so every tile opens one
      // on mount - the counterpart of the webview family's channel
      // auto-connect, which is what makes those tiles go live unprompted.
      nativeActive
      // Only the webview family has anything left for a click to do; under
      // the native family the tile is already connecting on its own.
      onClick={usesNativeSurface() || streams.primary ? undefined : onWatch}
    />
  );
}

function Tile({
  stream,
  label,
  session,
  name,
  own = false,
  nativeActive = false,
  onClick,
}: Readonly<{
  /** Webview family: the MediaStream to bind. Always null under the native
   *  family, which never produces one. */
  stream: MediaStream | null;
  label: string;
  session: number | null;
  name: string;
  own?: boolean;
  /** Native family: whether this tile should run a viewer for `session`. */
  nativeActive?: boolean;
  onClick?: () => void;
}>) {
  const nativeSurface = usesNativeSurface();
  const video = useRef<HTMLVideoElement>(null);
  const displayCanvas = useRef<HTMLCanvasElement>(null);
  // The strip has no camera PiP, so the camera slot decodes into a ref that
  // is never attached; its paints find no target and are dropped.
  const cameraCanvas = useRef<HTMLCanvasElement>(null);
  const native = useNativeStreamView(
    session ?? -1,
    nativeSurface && nativeActive,
    displayCanvas,
    cameraCanvas,
  );
  const hasMedia = nativeSurface ? native.hasDisplay : stream !== null;

  useEffect(() => {
    const element = video.current;
    if (element && element.srcObject !== stream) element.srcObject = stream;
  }, [stream]);

  return (
    <Box
      onClick={onClick}
      sx={{
        position: "relative",
        borderRadius: radius("md"),
        overflow: "hidden",
        background: "#000",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {!hasMedia && (
        <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center" }}>
          <Typography sx={{ fontSize: 11, color: "#9aa0a8" }}>
            {native.failed ? "Stream unavailable" : onClick ? "Click to watch" : "Connecting…"}
          </Typography>
        </Stack>
      )}
      {/* The media surface is the only strategy-dependent part of the tile. */}
      {nativeSurface ? (
        <canvas
          ref={displayCanvas}
          data-testid={TID.streamNativeView}
          data-own={own ? "true" : "false"}
          data-session={session ?? undefined}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: hasMedia ? "block" : "none",
          }}
        />
      ) : (
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: hasMedia ? "block" : "none",
          }}
        />
      )}
      <Stack
        direction="row"
        alignItems="center"
        gap={0.75}
        sx={{
          position: "absolute",
          left: 8,
          bottom: 8,
          pl: "4px",
          pr: "9px",
          py: "3px",
          borderRadius: radius("xl"),
          background: "rgba(10,11,13,.75)",
          backdropFilter: "blur(8px)",
        }}
      >
        <UserAvatar name={name} session={session} size={16} />
        <Typography sx={{ fontSize: 10.5, color: "#e6e9f0", fontWeight: 500 }}>{label}</Typography>
      </Stack>
    </Box>
  );
}
