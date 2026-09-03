/**
 * Drawing on the picture, in Nebula's chrome.
 *
 * The canvas, the wire format and the whole cross-window stroke store are
 * Standard's `DrawingOverlay` - annotations are a *protocol*, and two packs
 * that drew them differently would disagree about where a circle went. What is
 * redrawn here is the palette, which is a control surface like any other and
 * belongs in the same glass as the rest of the stage's controls.
 *
 * Two things about the geometry are Nebula's own, and both are handed down:
 * the stage lets the viewer scale the picture three ways, so `mediaFit` says
 * which; and the toolbar has to clear the control row along the bottom rather
 * than Standard's, which sits lower.
 */
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import DrawingOverlay, {
  type DrawingTools,
  type MediaFit,
} from "@standard/components/chat/drawing/DrawingOverlay";
import { TrashIcon } from "@ui/icons";
import { Stack } from "../../primitives";
import { radius } from "../../../tokens";
import { GLASS_BG, GLASS_BLUR, GLASS_LINE, OverlayButton } from "./overlayChrome";

/** Clear of the stage's own control row, which is 26px tall at 8px from the
 *  bottom - so the palette starts where that ends. */
const TOOLBAR_BOTTOM = 42;

export interface AnnotationLayerProps {
  /** The channel the drawing belongs to. Annotations are channel-scoped, not
   *  feed-scoped: one shared canvas over whatever the channel is watching. */
  readonly channelId: number;
  readonly ownSession: number;
  /** The element on the stage the strokes are anchored to. */
  readonly media: React.RefObject<HTMLVideoElement | HTMLCanvasElement | null>;
  readonly fit: MediaFit;
}

export function AnnotationLayer({ channelId, ownSession, media, fit }: Readonly<AnnotationLayerProps>) {
  return (
    <DrawingOverlay
      channelId={channelId}
      ownSession={ownSession}
      videoRef={media}
      mediaFit={fit}
      renderToolbar={(tools) => <AnnotationToolbar tools={tools} />}
    />
  );
}

/** The palette, the nib and the eraser, on the stage's glass. */
function AnnotationToolbar({ tools }: Readonly<{ tools: DrawingTools }>) {
  const { t } = useTranslation("chat");
  const clearLabel = tools.clearsEveryone ? t("drawing.clearAll") : t("drawing.clearMine");
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="6px"
      sx={{
        position: "absolute",
        left: 9,
        bottom: TOOLBAR_BOTTOM,
        padding: "5px 8px",
        borderRadius: radius("md"),
        background: GLASS_BG,
        border: GLASS_LINE,
        backdropFilter: GLASS_BLUR,
        // The overlay root above this is click-through, by design: the canvas
        // is the only thing in it that should ever swallow a pointer.
        pointerEvents: "auto",
      }}
    >
      {tools.palette.map((argb) => {
        const label = t("drawing.selectColor", { color: argb.toString(16) });
        const chosen = argb === tools.color;
        return (
          <Box
            key={argb}
            component="button"
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={chosen}
            onClick={() => tools.setColor(argb)}
            sx={{
              width: 15,
              height: 15,
              flex: "none",
              padding: 0,
              borderRadius: "50%",
              cursor: "pointer",
              background: tools.cssColor(argb),
              border: chosen ? "2px solid #fff" : "1px solid rgba(255,255,255,.32)",
              transform: chosen ? "scale(1.14)" : "none",
              transition: "transform .1s ease, border-color .15s ease",
              "&:hover": { transform: "scale(1.2)" },
            }}
          />
        );
      })}

      <NibWidth tools={tools} />

      <OverlayButton title={clearLabel} onClick={tools.clear}>
        <TrashIcon width={12} height={12} />
      </OverlayButton>
    </Stack>
  );
}

/** A plain range input rather than MUI's slider: it is 60px of chrome on a
 *  video frame, where the thumb and rail MUI would draw are more furniture
 *  than the control is worth. */
function NibWidth({ tools }: Readonly<{ tools: DrawingTools }>) {
  const { t } = useTranslation("chat");
  const theme = useTheme();
  return (
    <input
      type="range"
      min={tools.minWidth}
      max={tools.maxWidth}
      value={tools.width}
      onChange={(event) => tools.setWidth(Number(event.target.value))}
      aria-label={t("drawing.strokeWidth")}
      title={t("drawing.widthTooltip", { strokeWidth: tools.width })}
      style={{ width: 60, accentColor: theme.palette.nebula.accent, cursor: "pointer" }}
    />
  );
}
