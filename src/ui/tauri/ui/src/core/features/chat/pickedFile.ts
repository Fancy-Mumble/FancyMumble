import { invoke } from "@tauri-apps/api/core";

/** A file chosen from the picker or a drop, before the share question. */
export interface PickedFile {
  readonly filePath: string;
  readonly filename: string;
}

/**
 * Name a path.
 *
 * Both separators, because a Windows path arrives with backslashes and the
 * same build runs against a Linux drop.
 */
export function pickedFile(filePath: string): PickedFile {
  return { filePath, filename: filePath.replaceAll("\\", "/").split("/").pop() ?? "file" };
}

/**
 * What the file picker returned, as a file the composer can stage.
 *
 * A desktop picker returns a path, named here as it always was. Android's
 * returns a `content://` address instead: no path anything can read, and a
 * last segment that is a document id (`image%3A1000000020`) rather than the
 * file's name - staged as it was, a photo became a nameless "FILE" with no
 * size and no preview, and the uploader could not open it. The backend copies
 * that one into the app's cache under the name its provider reports.
 */
export async function resolvePickedFile(path: string): Promise<PickedFile> {
  if (!path.startsWith("content://")) return pickedFile(path);
  return invoke<PickedFile>("resolve_picked_file", { path });
}
