/**
 * MIME categorisation shared by the file-server admin dashboard and the
 * per-user "my shared files" view.  Pure (no Tauri / DOM) so it can be reused
 * and unit-tested freely.
 */

/** Broad MIME category used for icons, the type chart, and preview routing. */
export type FileCategory = "image" | "video" | "audio" | "document" | "archive" | "other";

const DOC_MIMES = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/rtf",
]);
const ARCHIVE_MIMES = new Set([
  "application/zip",
  "application/x-tar",
  "application/gzip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
]);

/** Classify a MIME type into a broad [`FileCategory`]. */
export function categorize(mime: string): FileCategory {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("text/") || m.includes("officedocument") || DOC_MIMES.has(m)) return "document";
  if (ARCHIVE_MIMES.has(m)) return "archive";
  return "other";
}

/** Whether a file can be shown inline in the preview modal. */
export function isPreviewable(mime: string): boolean {
  const cat = categorize(mime);
  const m = (mime || "").toLowerCase();
  // SVG is excluded on purpose (the server never serves it inline either).
  if (m === "image/svg+xml") return false;
  return (
    cat === "image" ||
    cat === "video" ||
    cat === "audio" ||
    m === "application/pdf" ||
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml"
  );
}
