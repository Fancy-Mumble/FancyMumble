/**
 * The behaviour behind an external-link warning: intercept, ask, open.
 *
 * A live anchor inside a webview navigates the app's own window - click a link
 * in a message and the window becomes that page, with nothing left to click
 * back with. Every pack has to stop that, and every pack draws its own dialog
 * over it. What none of them should re-derive is *when* to ask, what counts as
 * a trusted host, or how a URL finally reaches the browser, so that all lives
 * here and the packs supply only the surface.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { isTrustedLink, withTrustedHost } from "./externalLinks";

export interface ExternalLinkGuardFlow {
  /** Attach to the subtree whose `data-external` anchors are intercepted. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The URL awaiting confirmation, or null when nothing is pending. */
  pendingUrl: string | null;
  /** State of the dialog's "trust this host" tick. */
  trust: boolean;
  setTrust: (value: boolean) => void;
  /** Open the pending URL, remembering the host when the tick is set. */
  confirm: () => void;
  cancel: () => void;
}

/** Hand a URL to the system browser, never to this window. */
function openExternally(url: string): void {
  openUrl(url).catch(() => {
    // Fallback for non-Tauri environments (e.g. the Vite dev server).
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

export function useExternalLinkGuard(): ExternalLinkGuardFlow {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [trust, setTrust] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Read through a ref, not through the effect's closure: the click listener is
  // attached once, and a listener re-created on every preference change would
  // drop a click that landed while it was being swapped.
  const trustedHosts = useRef<string[]>([]);

  useEffect(() => {
    const load = () =>
      void getPreferences()
        .then((preferences) => {
          trustedHosts.current = preferences.trustedLinkHosts ?? [];
        })
        .catch(() => undefined);
    load();
    // Settings can clear the list while the client is open, in either pack.
    globalThis.addEventListener("preferences-changed", load);
    return () => globalThis.removeEventListener("preferences-changed", load);
  }, []);

  // A native DOM listener rather than a JSX `onClick`, so the wrapper does not
  // have to be declared an interactive element to satisfy the a11y lint.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest("a[data-external]");
      if (!anchor) return;
      e.preventDefault();
      e.stopPropagation();
      const href = anchor.getAttribute("href");
      if (!href) return;
      // A host the user has already vouched for skips the dialog, but not the
      // interception: it still leaves by the browser rather than in here.
      if (isTrustedLink(href, trustedHosts.current)) openExternally(href);
      else setPendingUrl(href);
    };

    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, []);

  const confirm = useCallback(() => {
    if (pendingUrl) {
      // Trust is recorded on confirm rather than on the tick, so a dialog that
      // is ticked and then cancelled leaves nothing behind.
      if (trust) {
        const hosts = withTrustedHost(trustedHosts.current, pendingUrl);
        trustedHosts.current = hosts;
        void updatePreferences({ trustedLinkHosts: hosts }).catch(() => undefined);
      }
      openExternally(pendingUrl);
    }
    setPendingUrl(null);
    setTrust(false);
  }, [pendingUrl, trust]);

  const cancel = useCallback(() => {
    setPendingUrl(null);
    setTrust(false);
  }, []);

  return { containerRef, pendingUrl, trust, setTrust, confirm, cancel };
}
