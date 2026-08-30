import { describe, expect, it, vi, beforeEach } from "vitest";

const invoke = vi.fn();
type Handler = (event: { payload: unknown }) => void;
const listeners = new Map<string, Handler[]>();
const listen = vi.fn(async (name: string, handler: Handler) => {
  listeners.set(name, [...(listeners.get(name) ?? []), handler]);
  return () => {
    listeners.set(name, (listeners.get(name) ?? []).filter((held) => held !== handler));
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: Handler) => listen(name, handler),
}));

const { canonAdminListFiles, canonMyListFiles, canonForgetFile } = await import("./starlingManage");

/** Push one event at whoever is listening for it. */
function emit(name: string, payload: unknown): void {
  for (const handler of listeners.get(name) ?? []) handler({ payload });
}

const FILE = {
  key: "4/018f/plan.pdf",
  channelId: 4,
  filename: "plan.pdf",
  mimeType: "application/pdf",
  size: 1234,
  mode: "public" as const,
  sharedAtMs: 1_700_000_000_000,
  expiresAt: 1_800_000_000,
  downloadedAtMs: 1_700_000_100_000,
  shareUrl: "https://files.example.org/s/4/018f/plan.pdf",
  uploaderAccount: 7,
  uploaderName: "Sebi",
  uploaderCert: "aabb",
  uploaderOnline: true,
};

beforeEach(() => {
  invoke.mockReset();
  listeners.clear();
});

describe("managing shared files on a canon server", () => {
  it("shapes the answer into the DTO the dashboard already renders", async () => {
    // Same shape as the plugin's, on purpose: a second set of components for
    // the same table is how the two views drift apart.
    invoke.mockImplementation(async () => {
      queueMicrotask(() =>
        emit("starling-files-managed", {
          requestId: "r-1",
          files: [FILE],
          storage: { usedBytes: 1234, maxTotalBytes: 10_000, maxUploadBytes: 500, fileCount: 1 },
        }),
      );
      return "r-1";
    });

    const answer = await canonAdminListFiles();
    expect(invoke).toHaveBeenCalledWith("starling_manage_files", { everyone: true, limit: 500 });
    expect(answer.files[0]).toEqual({
      id: "4/018f/plan.pdf",
      filename: "plan.pdf",
      mime_type: "application/pdf",
      size_bytes: 1234,
      access_mode: "public",
      channel_id: 4,
      server_id: 1,
      uploaded_at: 1_700_000_000_000,
      downloaded_at: 1_700_000_100_000,
      expires_at: 1_800_000_000,
      uploader_name: "Sebi",
      uploader_cert_hash: "aabb",
      uploader_user_id: 7,
      uploader_online: true,
    });
    expect(answer.stats.total_bytes_used).toBe(1234);
    expect(answer.stats.file_count).toBe(1);
  });

  it("ignores an answer meant for somebody else's request", async () => {
    // A dashboard refreshing while another operator's removal lands would
    // otherwise read one as the other.
    invoke.mockImplementation(async () => {
      queueMicrotask(() => {
        emit("starling-files-managed", { requestId: "someone-else", files: [FILE], storage: null });
        emit("starling-files-managed", { requestId: "r-2", files: [], storage: null });
      });
      return "r-2";
    });

    const answer = await canonMyListFiles();
    expect(invoke).toHaveBeenCalledWith("starling_manage_files", { everyone: false, limit: 500 });
    expect(answer.files).toEqual([]);
  });

  it("takes an answer that arrived before the request id did", async () => {
    // The server can answer faster than the invoke returns, and an answer
    // dropped for being early is a request that hangs to its timeout.
    invoke.mockImplementation(async () => {
      emit("starling-files-managed", { requestId: "r-3", files: [FILE], storage: null });
      return "r-3";
    });

    const answer = await canonMyListFiles();
    expect(answer.files).toHaveLength(1);
  });

  it("raises the server's own words when it says no", async () => {
    // A refusal has no listing to arrive as, so without this the caller sits
    // out the whole timeout to learn it had been told no.
    invoke.mockImplementation(async () => {
      queueMicrotask(() =>
        emit("starling-file-refused", {
          requestId: "r-4",
          reason: "that file is not yours to remove",
        }),
      );
      return "r-4";
    });

    await expect(canonForgetFile("4/018f/plan.pdf")).rejects.toThrow(
      "that file is not yours to remove",
    );
  });
});
