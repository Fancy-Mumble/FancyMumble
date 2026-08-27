import { useEffect, useRef } from "react";
import { useRemoteStreams } from "@standard/components/chat/stream/useScreenShare";
import { useNativeStreamView } from "@standard/components/chat/stream/nativeStreamView";
import { usesNativeSurface } from "./StreamSurface";
import type { SessionMedia } from "./feeds";

export interface SessionMediaSourceProps {
  readonly session: number;
  /** Native family: whether to run a viewer for this session at all. The own
   *  loopback preview must wait for the Rust broadcaster to be on the wire;
   *  mounting earlier races START. */
  readonly active: boolean;
  readonly onChange: (media: SessionMedia) => void;
}

/**
 * The receive path for one broadcaster, hoisted out of the tiles that draw it.
 *
 * A session's media can appear in two places at once - on the stage and in the
 * filmstrip - and a screen+camera share splits across two tiles besides. None
 * of those may own the transport: the native viewer is one Rust peer per
 * session (a second `useNativeStreamView` for the same session would start a
 * second one and overwrite its metrics), and a tile that unmounts because the
 * focus moved would tear the stream down with it. So the hooks live here, one
 * instance per session for as long as that session is sharing, and publish
 * what they produce upwards.
 *
 * Renders nothing: the canvases it hands out are mounted by the tiles.
 */
export function SessionMediaSource({ session, active, onChange }: Readonly<SessionMediaSourceProps>) {
  const streams = useRemoteStreams(session);
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<HTMLCanvasElement | null>(null);
  const native = useNativeStreamView(session, usesNativeSurface() && active, displayRef, cameraRef);

  useEffect(() => {
    onChange({
      session,
      primary: streams.primary,
      camera: streams.camera,
      displayRef,
      cameraRef,
      hasDisplay: native.hasDisplay,
      hasCamera: native.hasCamera,
      failed: native.failed,
    });
  }, [
    session,
    streams.primary,
    streams.camera,
    native.hasDisplay,
    native.hasCamera,
    native.failed,
    onChange,
  ]);

  return null;
}
