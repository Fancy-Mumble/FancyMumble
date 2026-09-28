/**
 * The stage's screenshot button.
 *
 * The frame goes to the clipboard rather than to a file: the app has no
 * "write these bytes there" backend command, and a picture of what someone is
 * showing you is almost always on its way straight back into the conversation.
 * Where the webview has no image clipboard (WebKitGTK is the one that bites)
 * the caller is told so rather than shown a success that did not happen.
 */

export type ScreenshotOutcome = "copied" | "unsupported" | "failed";

/** Natural pixel size of whichever element the active viewer family mounted. */
function frameSize(element: HTMLVideoElement | HTMLCanvasElement): { width: number; height: number } {
  return element instanceof HTMLVideoElement
    ? { width: element.videoWidth, height: element.videoHeight }
    : { width: element.width, height: element.height };
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Copy the element's current frame to the clipboard as a PNG. */
export async function copyStreamFrame(
  element: HTMLVideoElement | HTMLCanvasElement | null,
): Promise<ScreenshotOutcome> {
  if (!element) return "failed";
  const { width, height } = frameSize(element);
  if (width === 0 || height === 0) return "failed";
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return "unsupported";

  try {
    const shot = document.createElement("canvas");
    shot.width = width;
    shot.height = height;
    const context = shot.getContext("2d");
    if (!context) return "failed";
    context.drawImage(element, 0, 0, width, height);
    const png = await toPng(shot);
    if (!png) return "failed";
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "copied";
  } catch (e) {
    console.warn("[screenshare] frame copy failed:", e);
    return "failed";
  }
}
