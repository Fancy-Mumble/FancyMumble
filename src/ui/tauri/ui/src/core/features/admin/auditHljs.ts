/**
 * Audit-search highlighting on top of the shared highlight.js pipeline.
 *
 * Rather than a bespoke highlighter, this reuses the same infrastructure the
 * chat composer uses - lazy `highlight.js` ({@link ../../components/chat/markdown/lazyHljs})
 * and {@link ../../components/chat/markdown/hljsTokens!flattenHljs} - so the
 * audit editors get the SQL grammar and github-dark theme for free.
 *
 * The only bespoke piece is a tiny grammar for our simple-mode DSL registered
 * as a highlight.js language; SQL mode uses hljs's built-in `sql`.
 */

import { useEffect, useState } from "react";
import { flattenHljs, type HljsToken } from "../chat/markdown/hljsTokens";
import { loadHljs, loadedHljs, type HljsApi } from "../chat/markdown/lazyHljs";

/** highlight.js language name for the simple-mode audit DSL. */
export const AUDIT_DSL_LANGUAGE = "audit-dsl";

let dslRegistered = false;

/** Register the DSL grammar on the (singleton) hljs instance, once. */
function registerAuditDsl(hljs: HljsApi): void {
  if (dslRegistered || hljs.getLanguage(AUDIT_DSL_LANGUAGE)) {
    dslRegistered = true;
    return;
  }
  hljs.registerLanguage(AUDIT_DSL_LANGUAGE, (h) => ({
    name: "Audit DSL",
    case_insensitive: true,
    keywords: {
      // Boolean joiners vs. the queryable fields, coloured distinctly.
      keyword: "and or not in",
      built_in: "category source severity actor target channel text ts",
    },
    contains: [
      h.QUOTE_STRING_MODE, // "value"
      h.APOS_STRING_MODE, // 'value'
      { scope: "number", begin: /\bnow(?:-\d+[mhdw])?\b/ }, // now / now-7d
      { scope: "number", begin: /\b\d+\b/ },
      { scope: "operator", begin: /[=~!<>]+/ },
    ],
  }));
  dslRegistered = true;
}

/**
 * Highlight `value` into flat `{ text, cls }` tokens (offsets preserved for the
 * overlay). Returns a single plain token when hljs is not yet loaded or the
 * language is unknown, so the backdrop degrades to uncoloured text.
 */
export function auditTokens(hljs: HljsApi | null, value: string, language: string): HljsToken[] {
  if (!hljs) return [{ text: value, cls: "" }];
  if (language === AUDIT_DSL_LANGUAGE) registerAuditDsl(hljs);
  if (!hljs.getLanguage(language)) return [{ text: value, cls: "" }];
  const html = hljs.highlight(value, { language, ignoreIllegals: true }).value;
  return flattenHljs(html);
}

/**
 * React hook: highlight tokens for `value`, lazy-loading highlight.js on first
 * use and re-rendering once it (and the theme) are ready.
 */
export function useAuditHighlight(value: string, language: string): HljsToken[] {
  const [hljs, setHljs] = useState<HljsApi | null>(() => loadedHljs());
  useEffect(() => {
    if (hljs) return undefined;
    let alive = true;
    loadHljs()
      .then((m) => {
        if (alive) setHljs(m);
      })
      .catch(() => {
        /* keep plain text if the highlighter can't load */
      });
    return () => {
      alive = false;
    };
  }, [hljs]);
  return auditTokens(hljs, value, language);
}
