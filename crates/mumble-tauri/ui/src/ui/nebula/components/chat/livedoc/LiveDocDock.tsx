import { lazy, Suspense, useCallback, useRef } from "react";
import { Box } from "@mui/material";
import { Stack } from "../../primitives";
import { radius } from "../../../tokens";
import type { NebulaLiveDoc } from "./useNebulaLiveDoc";

const LiveDocPanel = lazy(() => import("@standard/components/chat/livedoc/LiveDocPanel"));
const LiveDocLibraryPanel = lazy(() => import("@standard/components/chat/livedoc/LiveDocLibraryPanel"));

/** How much of the pane the document takes when the conversation is showing. */
const DEFAULT_SPLIT = "58%";
/** Room left for the conversation below, and for the document above. */
const MIN_CHAT_PX = 140;
const MIN_DOC_PX = 160;

interface LiveDocDockProps {
  readonly doc: NebulaLiveDoc;
  /** Opens the launch dialog, absent where a document cannot be created. */
  readonly onCreateDoc?: () => void;
}

/**
 * The region a Live Doc occupies above the conversation.
 *
 * The document is Standard's - Nebula owns where it sits, not what it is. Two
 * shapes: with the conversation put away it takes the pane under the header,
 * and with the conversation showing it yields the bottom of the pane and grows
 * a handle. The handle is the only reason this is a component rather than a
 * fragment in the client: the height it drags is a pixel count that has to be
 * clamped against the pane it lives in, which is a thing to measure.
 */
export function LiveDocDock({ doc, onCreateDoc }: LiveDocDockProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const { session, libraryOpen, hidesChat, splitPx, setSplitPx } = doc;

  const startDrag = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startPx = wrapper.current?.getBoundingClientRect().height ?? 300;
      // The pane is the dock's parent; a drag may not push either side of the
      // split below the point where it stops being worth showing.
      const paneHeight = wrapper.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
      const onMove = (move: MouseEvent) => {
        const next = startPx + (move.clientY - startY);
        setSplitPx(Math.max(MIN_DOC_PX, Math.min(paneHeight - MIN_CHAT_PX, next)));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [setSplitPx],
  );

  if (!session && !libraryOpen) return null;

  return (
    <>
      <Stack
        ref={wrapper}
        sx={{
          minHeight: 0,
          overflow: "hidden",
          // With the chat away the document has the pane; with the chat
          // showing it is sized, and a dragged height overrides the default.
          flex: hidesChat ? "1 1 0" : `0 0 ${splitPx !== null ? `${splitPx}px` : DEFAULT_SPLIT}`,
        }}
      >
        <Suspense fallback={null}>
          {session ? (
            <LiveDocPanel
              session={session}
              // Standard words this the other way round - its panel asks
              // whether the chat is a compact strip, which is exactly the
              // state this pack calls "the conversation is showing".
              compactChat={doc.chatVisible}
              onToggleCompactChat={doc.toggleChatVisible}
              onCreateDoc={onCreateDoc}
              onCreateDocInFolder={onCreateDoc ? doc.openLaunchInFolder : undefined}
            />
          ) : (
            <LiveDocLibraryPanel
              onOpenDoc={doc.openLibraryDoc}
              onCreateDoc={onCreateDoc ?? (() => {})}
              onCreateDocInFolder={onCreateDoc ? doc.openLaunchInFolder : undefined}
              onClose={doc.closeLibrary}
            />
          )}
        </Suspense>
      </Stack>

      {/* Only a split can be dragged: with the chat away there is nothing on
          the other side of the handle to give room to. */}
      {!hidesChat && (
        <Box
          aria-hidden="true"
          onMouseDown={startDrag}
          sx={(theme) => ({
            flex: "0 0 7px",
            cursor: "ns-resize",
            position: "relative",
            zIndex: 5,
            "&::after": {
              content: '""',
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 34,
              height: 3,
              transform: "translate(-50%, -50%)",
              borderRadius: radius("sm"),
              background: theme.palette.nebula.line2,
              transition: "width .15s, background .15s",
            },
            "&:hover::after": { width: 52, background: theme.palette.nebula.accent },
          })}
        />
      )}
    </>
  );
}

export default LiveDocDock;
