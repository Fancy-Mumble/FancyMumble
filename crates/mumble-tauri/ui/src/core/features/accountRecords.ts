/**
 * The account's own record store on the server.
 *
 * What this account keeps for itself and nobody else: the document library,
 * the citation master list, the calendar.  One value under one name, read and
 * written a key at a time.
 *
 * This replaces the file-server plugin's per-user private storage.  The
 * plugin's version needed a plugin, an HTTP listener and a session JWT, so a
 * server without all three had nowhere to put any of it - and the client, with
 * only the plugin's word to go on, told registered users they were not
 * registered.  The store is part of the server now (`STORAGE-UNIFICATION.md`
 * D4), so the question "can this be saved" has an answer that does not depend
 * on which plugins an operator happened to load.
 */

import { invoke } from "@tauri-apps/api/core";

/** One record as the backend hands it over. */
export interface StoredRecord {
  /** The value, or `null` when absent or not valid UTF-8. */
  readonly value: string | null;
  /** False when there is no such record - a normal first run, not an error. */
  readonly found: boolean;
  readonly updatedAtMs: number;
}

/** Why a record could not be read or written. */
export type RecordFailure =
  | /** The server has no record store: too old, or not Fancy at all. */ "unsupported"
  | /** The server refused - a guest asking, or a value past the ceiling. */ "refused"
  | /** Something else went wrong, and retrying may work. */ "error";

/** A read that did not produce a record. */
export interface RecordDenied {
  readonly failure: RecordFailure;
  /** The server's own sentence, where it gave one. */
  readonly detail: string;
}

/**
 * Which failure a backend error message describes.
 *
 * The backend returns a string, and the three cases need telling apart
 * because they lead to three different things being shown: a server with no
 * store is a fact about the server, a refusal is a fact about the account,
 * and everything else is worth a retry button.  The two sentences matched
 * here are minted in `state/records.rs` and in the server's `selfservice.rs`;
 * anything else is the third case by default, which is the safe direction -
 * offering a retry that fails again is better than telling somebody their
 * documents cannot be saved when they can.
 */
export function classify(error: unknown): RecordDenied {
  const detail = String(error ?? "");
  if (detail.includes("does not keep per-account records")) {
    return { failure: "unsupported", detail };
  }
  if (detail.includes("guest") || detail.includes("at most")) {
    return { failure: "refused", detail };
  }
  return { failure: "error", detail };
}

/** Read one record. Absent is `found: false`, never an error. */
export function getRecord(key: string): Promise<StoredRecord> {
  return invoke<StoredRecord>("account_record_get", { key });
}

/** Store one record, and get back what now stands. */
export function putRecord(key: string, value: string): Promise<StoredRecord> {
  return invoke<StoredRecord>("account_record_put", { key, value });
}

/** Remove one record. */
export function removeRecord(key: string): Promise<StoredRecord> {
  return invoke<StoredRecord>("account_record_remove", { key });
}

/** Which of this account's records start with `prefix`. */
export function listRecords(prefix: string): Promise<string[]> {
  return invoke<string[]>("account_record_list", { prefix });
}

/**
 * Whether this server keeps records, as far as anything has found out.
 *
 * `null` until something has asked once: the store announces itself in no
 * handshake, so absence cannot be known in advance - only discovered by a
 * request that goes unanswered.
 */
export function recordsAvailable(): Promise<boolean | null> {
  return invoke<boolean | null>("account_records_available");
}

/** The keys this client stores, named once so nothing goes hunting for them. */
export const RECORD_KEYS = {
  /** The live-doc sidebar tree: sections, folders and saved document links. */
  liveDocSidebar: "livedoc/sidebar",
  /** The Word-style master source list, shared across documents. */
  liveDocSources: "livedoc/sources",
  /** Events and availability. */
  calendar: "calendar",
} as const;
