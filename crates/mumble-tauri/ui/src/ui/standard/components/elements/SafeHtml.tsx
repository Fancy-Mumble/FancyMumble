/**
 * SafeHtml - renders untrusted HTML safely.
 *
 * Combines DOMPurify-based sanitization with ExternalLinkGuard so
 * that every piece of user-generated HTML goes through a single,
 * auditable security pipeline.
 *
 * Usage:
 *   <SafeHtml html={channel.description} className={styles.desc} />
 *   <SafeHtml html={welcomeText} fallback={<em>No content</em>} />
 */

import { useMemo } from "react";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { useInnerHtml } from "@core/utils/innerHtml";
import { ExternalLinkGuard } from "./ExternalLinkGuard";

interface SafeHtmlProps {
  /** Raw (untrusted) HTML string to sanitize and render. */
  readonly html: string;
  /** Optional CSS class applied to the wrapper div. */
  readonly className?: string;
  /** Inline styles applied to the wrapper div. */
  readonly style?: React.CSSProperties;
  /** Rendered when `html` is empty or only whitespace. */
  readonly fallback?: React.ReactNode;
}

export function SafeHtml({ html, className, style, fallback }: SafeHtmlProps) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  // Stable, so a re-render does not rebuild the markup under a selection.
  const markup = useInnerHtml(clean);

  if (!clean && fallback) {
    return (
      <div className={className} style={style}>
        {fallback}
      </div>
    );
  }

  if (!clean) return null;

  return (
    <ExternalLinkGuard className={className} style={style}>
      <div dangerouslySetInnerHTML={markup} />
    </ExternalLinkGuard>
  );
}
