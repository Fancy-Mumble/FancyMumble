/**
 * Client helpers for the file-server admin dashboard: thin wrappers over the
 * Tauri proxy commands plus MIME categorisation and a small preview cache.
 *
 * All three commands proxy through the Tauri backend (the file-server origin
 * is cross-origin to the webview, so a direct `fetch` would be CORS-blocked
 * and could not attach the admin bearer).
 */

import { invoke } from "@tauri-apps/api/core";
import type { AdminDocumentsResponse, AdminFilesResponse } from "../../types";
import { cachedPreviewText, cachedPreviewUrl, dropPreview } from "../../components/fileserver/previewLoader";
import type { FilePreviewSource } from "../../components/fileserver/FilePreview";

/** Credentials every admin request needs (from the file-server config). */
export interface AdminCreds {
  readonly baseUrl: string;
  readonly sessionJwt: string;
}

/** Reject after `ms` so a non-responding backend call can't leave the
 *  dashboard spinning on "Loading…" forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

/** Result of a file-server health probe. */
export interface FileServerHealth {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

/** Probe the file-server's public `GET /capabilities` (5 s timeout in the
 *  backend) to report whether it is reachable and how fast.  Deliberately
 *  independent of the admin/list call, so it still reports "down" when the
 *  storage/list path is hung. */
export async function checkFileServerHealth(baseUrl: string): Promise<FileServerHealth> {
  const t0 = performance.now();
  try {
    await invoke<string>("fetch_file_server_capabilities", { baseUrl });
    return { ok: true, latencyMs: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ok: false, latencyMs: Math.round(performance.now() - t0), error: e instanceof Error ? e.message : String(e) };
  }
}

/** List every stored file plus aggregate storage stats. */
export function adminListFiles(creds: AdminCreds): Promise<AdminFilesResponse> {
  return withTimeout(
    invoke<AdminFilesResponse>("fileserver_admin_list_files", {
      request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt },
    }),
    15000,
    "Listing files",
  );
}

/** List every persisted live-doc document (separate from uploaded files). */
export function adminListDocuments(creds: AdminCreds): Promise<AdminDocumentsResponse> {
  return withTimeout(
    invoke<AdminDocumentsResponse>("fileserver_admin_list_documents", {
      request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt },
    }),
    15000,
    "Listing documents",
  );
}

/** Delete one stored file (blob + metadata). */
export function adminDeleteFile(creds: AdminCreds, fileId: string): Promise<void> {
  return invoke("fileserver_admin_delete_file", {
    request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt, fileId },
  });
}

/** Delete one persisted live-doc document (all revisions + metadata rows). */
export function adminDeleteDocument(creds: AdminCreds, name: string): Promise<void> {
  return invoke("fileserver_admin_delete_document", {
    request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt, name },
  });
}

/** Fetch a file's raw bytes (admin preview) as standard base64. */
function adminFileBase64(creds: AdminCreds, fileId: string, maxBytes: number): Promise<string> {
  return invoke<string>("fileserver_admin_file_base64", {
    request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt, fileId, maxBytes },
  });
}

// MIME categorisation lives in the shared file-server module; re-exported here
// so the existing admin imports keep working.
export { categorize, isPreviewable, type FileCategory } from "../../components/fileserver/fileTypes";

/** Fetch a file's bytes and return a same-origin object URL for rendering.
 *  Cached by file id.  `maxBytes` caps the transfer (0 = server default). */
export function loadPreviewUrl(
  creds: AdminCreds,
  fileId: string,
  mime: string,
  maxBytes: number,
): Promise<string> {
  return cachedPreviewUrl((id, max) => adminFileBase64(creds, id, max), fileId, mime, maxBytes);
}

/** Fetch a text file's contents (for the text preview). */
export function loadPreviewText(creds: AdminCreds, fileId: string, maxBytes: number): Promise<string> {
  return cachedPreviewText((id, max) => adminFileBase64(creds, id, max), fileId, maxBytes);
}

export { dropPreview };

/** A [`FilePreviewSource`] backed by the admin file endpoints. */
export function makeAdminFilesSource(creds: AdminCreds): FilePreviewSource {
  return {
    loadPreviewUrl: (fileId, mime, maxBytes) => loadPreviewUrl(creds, fileId, mime, maxBytes),
    loadPreviewText: (fileId, maxBytes) => loadPreviewText(creds, fileId, maxBytes),
  };
}
