import { invoke } from "@tauri-apps/api/core";
import { base64ToBytes } from "@core/utils/base64";
import { sniffImageMime } from "@core/utils/imageBlobs";

/** The parts of a pending attachment needed to materialise its bytes. */
interface AttachmentSource {
  /** The original blob, when the attachment came from paste or a file picker. */
  readonly file: File | null;
  /** Absolute path on disk, when the attachment came from a native drop. */
  readonly path: string | null;
  readonly name: string;
}

/**
 * Materialise a pending image attachment as a `File`.
 *
 * A natively dropped file arrives as a bare path with no blob attached, and the
 * webview cannot read that path on its own - `convertFileSrc` yields an
 * `asset://` URL, which WebKitGTK does not treat as CORS-enabled, so fetching
 * it returns an empty body instead of the image.  Reading the bytes through the
 * Rust `read_file_base64` command sidesteps the custom scheme entirely.
 *
 * Throws when the file cannot be read, so callers surface the failure rather
 * than sending a zero-byte image.
 */
export async function attachmentToImageFile(att: AttachmentSource): Promise<File | null> {
  if (att.file) return att.file;
  if (!att.path) return null;

  const encoded = await invoke<string>("read_file_base64", { path: att.path });
  const bytes = base64ToBytes(encoded);
  if (bytes.length === 0) throw new Error(`${att.name} is empty`);

  return new File([bytes], att.name, { type: sniffImageMime(bytes) });
}
