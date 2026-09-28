import type { ReactNode } from "react";
import { useExternalLinkGuard } from "@core/features/elements/useExternalLinkGuard";
import { LinkWarningDialog } from "./LinkWarningDialog";

/**
 * A live anchor inside a webview navigates the app's own window: click a link
 * in a message and the window becomes that page, with nothing left to click
 * back with. `useExternalLinkGuard` is the answer every pack shares - it
 * intercepts anchors marked `data-external`, confirms, then hands the URL to
 * the system browser - and what Nebula adds is the surface it confirms on.
 *
 * The wrapper is `display: contents`. Nebula's bodies are flex items sized
 * against their row (`max-width: min(620px, 78%)`), and a `div` between the two
 * would be the box that gets measured instead.
 */
export function LinkGuard({ children }: Readonly<{ children: ReactNode }>) {
  const { containerRef, pendingUrl, trust, setTrust, confirm, cancel } = useExternalLinkGuard();

  return (
    <>
      <div ref={containerRef} style={PASSTHROUGH}>
        {children}
      </div>
      <LinkWarningDialog
        url={pendingUrl}
        trust={trust}
        onTrustChange={setTrust}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </>
  );
}

const PASSTHROUGH = { display: "contents" } as const;
