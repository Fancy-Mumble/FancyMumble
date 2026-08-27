import type { ReactNode } from "react";
import { ExternalLinkGuard } from "@standard/components/elements/ExternalLinkGuard";

/**
 * A live anchor inside a webview navigates the app's own window: click a link
 * in a message and the window becomes that page, with nothing left to click
 * back with. Standard answers this with `ExternalLinkGuard` - it intercepts
 * anchors marked `data-external`, confirms, then hands the URL to the system
 * browser - and nebula uses the very same guard.
 *
 * The only thing added here is `display: contents` on its wrapper. Nebula's
 * bodies are flex items sized against their row (`max-width: min(620px, 78%)`),
 * and a `div` between the two would be the box that gets measured instead.
 */
export function LinkGuard({ children }: Readonly<{ children: ReactNode }>) {
  return <ExternalLinkGuard style={PASSTHROUGH}>{children}</ExternalLinkGuard>;
}

const PASSTHROUGH = { display: "contents" } as const;
