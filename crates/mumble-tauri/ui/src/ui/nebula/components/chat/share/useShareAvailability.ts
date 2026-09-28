/**
 * Whether a screen share can start from this connection, and how it would
 * reach viewers.
 *
 * Read off the store rather than `useScreenShare`: that hook owns the capture
 * and only the strip mounts it. The header and the dock only need to know
 * whether to offer a share and what to say about it.
 */
import { useAppStore } from "@core/store";
import { broadcastOwner } from "@core/features/chat/broadcastOwner";

export interface ShareAvailability {
  /** The app's one capture is running for this connection: the share is ours to stop. */
  here: boolean;
  /** The app's one capture is already running for another server connection. */
  elsewhere: boolean;
  /** Viewers get the stream through the server rather than from us directly. */
  relayed: boolean;
}

export function useShareAvailability(): ShareAvailability {
  const owner = useAppStore((state) =>
    broadcastOwner({
      broadcastingOwnSession: state.broadcastingOwnSession,
      broadcastingServerId: state.broadcastingServerId,
      ownSession: state.ownSession,
      activeServerId: state.activeServerId,
    }),
  );
  const relayed = useAppStore((state) => !!state.serverConfig.webrtc_sfu_available);
  return { here: owner === "here", elsewhere: owner === "elsewhere", relayed };
}
