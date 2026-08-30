/**
 * "My shared files" and the operator's view of the same table, on a server
 * that speaks the canon rather than running the plugin.
 *
 * The plugin answers these over HTTP with a session JWT; the canon has neither,
 * so the question goes over the control connection and the answer arrives as an
 * event. What comes back is shaped into the same DTOs the plugin returns, on
 * purpose: the dashboard and the "my files" panel already render those, and a
 * second set of components for the same table is how the two drift apart.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AdminFileEntry, AdminFilesResponse, MyFilesResponse } from "@core/types";

/** How long to wait for the answer before giving up on it. */
const ANSWER_TIMEOUT_MS = 15_000;

/** One file, as the backend hands it over. */
interface ManagedFile {
  key: string;
  channelId: number;
  filename: string;
  mimeType: string;
  size: number;
  mode: "session" | "public" | "password";
  sharedAtMs: number;
  expiresAt: number | null;
  downloadedAtMs: number | null;
  shareUrl: string;
  uploaderAccount: number | null;
  uploaderName: string | null;
  uploaderCert: string | null;
  uploaderOnline: boolean;
}

interface ManagedFiles {
  requestId: string;
  files: ManagedFile[];
  storage: {
    usedBytes: number;
    maxTotalBytes: number;
    maxUploadBytes: number;
    fileCount: number;
  } | null;
}

/**
 * The canon's shape, as the plugin's.
 *
 * `id` is the stored key: it is what every canon operation names a file by,
 * and the dashboard only ever passes it back.
 */
function asEntry(file: ManagedFile): AdminFileEntry {
  return {
    id: file.key,
    filename: file.filename,
    mime_type: file.mimeType,
    size_bytes: file.size,
    access_mode: file.mode,
    channel_id: file.channelId,
    // One virtual server per canon connection, so the plugin's discriminator
    // is a constant here rather than something to carry.
    server_id: 1,
    uploaded_at: file.sharedAtMs,
    downloaded_at: file.downloadedAtMs,
    expires_at: file.expiresAt,
    uploader_name: file.uploaderName,
    uploader_cert_hash: file.uploaderCert,
    uploader_user_id: file.uploaderAccount,
    uploader_online: file.uploaderOnline,
  };
}

/**
 * Ask, then wait for the answer that carries this request's id.
 *
 * Correlated rather than "the next event to arrive": a dashboard refreshing
 * while somebody else's removal lands would otherwise read one as the other.
 *
 * Both listeners are in place before the ask goes out, because the server can
 * answer faster than the invoke returns the id - and an answer that arrived
 * before the id was known is held rather than dropped.
 */
async function askAndWait(command: string, args: Record<string, unknown>): Promise<ManagedFiles> {
  const { listen } = await import("@tauri-apps/api/event");
  let wanted: string | null = null;
  let settle: ((outcome: { ok: ManagedFiles } | { err: string }) => void) | null = null;
  const early: ({ id: string } & ({ ok: ManagedFiles } | { err: string }))[] = [];

  const take = (id: string, outcome: { ok: ManagedFiles } | { err: string }) => {
    if (wanted === null) {
      early.push({ id, ...outcome });
      return;
    }
    if (id === wanted) settle?.(outcome);
  };

  const stops = await Promise.all([
    listen<ManagedFiles>("starling-files-managed", (event) =>
      take(event.payload.requestId, { ok: event.payload }),
    ),
    listen<{ requestId: string; reason: string }>("starling-file-refused", (event) =>
      take(event.payload.requestId, { err: event.payload.reason }),
    ),
  ]);

  try {
    const answered = new Promise<{ ok: ManagedFiles } | { err: string }>((resolve) => {
      settle = resolve;
      setTimeout(() => resolve({ err: "the server did not answer" }), ANSWER_TIMEOUT_MS);
    });
    wanted = await invoke<string>(command, args);
    const outcome = early.find((held) => held.id === wanted) ?? (await answered);
    if ("err" in outcome) throw new Error(outcome.err);
    return outcome.ok;
  } finally {
    for (const stop of stops) stop();
  }
}

/** Every file on the server, with what the disk is doing. */
export async function canonAdminListFiles(): Promise<AdminFilesResponse> {
  const answer = await askAndWait("starling_manage_files", { everyone: true, limit: 500 });
  return {
    files: answer.files.map(asEntry),
    stats: {
      total_bytes_used: answer.storage?.usedBytes ?? 0,
      max_total_storage_bytes: answer.storage?.maxTotalBytes ?? 0,
      max_file_size_bytes: answer.storage?.maxUploadBytes ?? 0,
      file_count: answer.storage?.fileCount ?? answer.files.length,
    },
  };
}

/** Only the files the caller uploaded. */
export async function canonMyListFiles(): Promise<MyFilesResponse> {
  const answer = await askAndWait("starling_manage_files", { everyone: false, limit: 500 });
  return { files: answer.files.map(asEntry) };
}

/** Remove one stored file. Rejects when the server says it is not yours. */
export async function canonForgetFile(key: string): Promise<void> {
  await askAndWait("starling_forget_file", { key });
}
