/**
 * liveDocMarkdownImages - collapse huge base64 data-URI payloads in the
 * markdown source view so the document stays readable, while keeping the
 * full payload for a lossless round-trip back to the document.
 *
 * Each `data:<mime>;base64,<payload>` whose payload is large is rewritten
 * to `data:<mime>;base64,⟦image#N · 12.3 KB⟧`, and the real payload is kept
 * in a token→payload map.  `expandBase64` puts the payloads back before the
 * markdown is parsed and applied to the document.
 */

/** Matches a base64 data URI's prefix + payload.  Only long payloads are
 *  collapsed (short ones are already readable).  The MIME part includes `/`
 *  (e.g. `image/png`) and optional parameters (e.g. `;charset=...`). */
const DATA_URI_RE = /(data:[\w.+/-]+(?:;[\w.+-]+=[\w.+-]+)*;base64,)([A-Za-z0-9+/=]{48,})/g;

export interface AbbreviatedMarkdown {
  /** Markdown with long base64 payloads replaced by readable tokens. */
  readonly text: string;
  /** Token → original payload, used by `expandBase64` to restore them. */
  readonly map: Map<string, string>;
}

function humanSize(payloadLength: number): string {
  const bytes = Math.floor((payloadLength * 3) / 4); // base64 → bytes
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Replace long base64 payloads with readable tokens (collapse). */
export function abbreviateBase64(markdown: string): AbbreviatedMarkdown {
  const map = new Map<string, string>();
  let n = 0;
  const text = markdown.replace(DATA_URI_RE, (_full, prefix: string, payload: string) => {
    n += 1;
    const token = `⟦image#${n} · ${humanSize(payload.length)}⟧`;
    map.set(token, payload);
    return `${prefix}${token}`;
  });
  return { text, map };
}

/** Restore the original base64 payloads from a collapsed markdown string. */
export function expandBase64(text: string, map: ReadonlyMap<string, string>): string {
  if (map.size === 0) return text;
  let out = text;
  for (const [token, payload] of map) {
    // split/join avoids treating the token's punctuation as a regex.
    if (out.includes(token)) out = out.split(token).join(payload);
  }
  return out;
}
