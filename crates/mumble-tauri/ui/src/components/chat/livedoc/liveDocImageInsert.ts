import type { Editor } from "@tiptap/react";
import { resizeImage } from "../../../pages/settings/imageUtils";

/** Maximum dimensions / byte budget for images embedded in a live doc. */
const MAX_IMAGE_DIMENSION = 800;
const MAX_IMAGE_BYTES = 250_000;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result;
      if (typeof raw === "string") {
        resolve(raw);
      } else {
        reject(new Error("unexpected FileReader result"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize `file` and insert it as an inline image at the current
 * selection of the Tiptap `editor`.  Shared by the toolbar image
 * button and the drag-drop handler so both paths behave identically.
 */
export async function insertEditorImage(editor: Editor, file: File): Promise<void> {
  const raw = await readFileAsDataUrl(file);
  const dataUrl = await resizeImage(raw, MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, MAX_IMAGE_BYTES);
  editor.chain().focus().setImage({ src: dataUrl }).run();
}

/**
 * Extract the first image file from a clipboard/drag `DataTransfer`,
 * or `null` when none is present.  Shared by the editor's paste handler.
 */
export function imageFileFromClipboard(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  for (const item of data.items ?? []) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of data.files ?? []) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}
