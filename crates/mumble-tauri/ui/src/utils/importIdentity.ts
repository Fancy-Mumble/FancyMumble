import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Let the user pick an exported `.fmid` identity file and import it.
 * Returns the imported identity's label, or null if the picker was cancelled.
 *
 * Android has no MIME type for `.fmid`, so its picker ignores the filter and
 * shows all files; the backend reads the returned `content://` URI.
 */
export async function importIdentity(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Fancy Mumble Identity", extensions: ["fmid"] }],
  });
  if (!selected) return null;
  return invoke<string>("import_certificate", { srcPath: selected });
}
