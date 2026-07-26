import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface IdentitiesState {
  labels: string[];
  error: string | null;
  setError: (error: string | null) => void;
  refresh: () => void;
}

/**
 * The certificate labels this device holds.
 *
 * Every mutation goes through the backend and is followed by a refresh rather
 * than a local splice: the certificate store on disk is the truth, and a failed
 * delete that we had already removed from the list would be invisible.
 */
export function useIdentities(): IdentitiesState {
  const [labels, setLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void invoke<string[]>("list_certificates")
      .then(setLabels)
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(refresh, [refresh]);

  return { labels, error, setError, refresh };
}
