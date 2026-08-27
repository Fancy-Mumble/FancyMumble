/**
 * What a link warning needs to know about a URL, and which hosts have been
 * excused from the warning altogether.
 *
 * This is the *decision* behind the guard, so it lives here rather than in a
 * pack: Standard and Nebula draw two different dialogs over one answer to
 * "may this open?". A user who trusted a host in one design meets no second
 * prompt for it in the other.
 */

/** A URL split into the parts a warning draws separately. */
export interface LinkTarget {
  /**
   * The registrable host, and the key the trust list is kept by.
   *
   * Empty when the URL did not parse - which is also what makes such a link
   * untrustable, since there is nothing to key trust on.
   */
  host: string;
  /** Path, query and fragment: the part drawn dimmer than the host. */
  rest: string;
  /** `HTTPS` / `HTTP` for the badge, or null when there is nothing to badge. */
  scheme: string | null;
}

/**
 * Only these can ever be opened without asking.
 *
 * `sanitizeHtml` already drops everything else before an anchor is marked
 * `data-external`, so this is a second lock on the same door: a `javascript:`
 * or `file:` URL that reached the guard by some other route must still stop at
 * the dialog rather than inherit a host's trust.
 */
const TRUSTABLE_PROTOCOLS = ["http:", "https:"];

/**
 * Split `url` for display.
 *
 * The host comes back as `URL` gives it - lowercased, and punycode for an
 * internationalised name. That is deliberately the less readable form: it is
 * the one that shows `xn--pple-43d.com` where the pretty rendering would show
 * something indistinguishable from `apple.com`.
 */
export function describeLink(url: string): LinkTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { host: "", rest: url, scheme: null };
  }
  if (!TRUSTABLE_PROTOCOLS.includes(parsed.protocol)) {
    return { host: "", rest: url, scheme: null };
  }
  return {
    host: parsed.host,
    rest: parsed.pathname + parsed.search + parsed.hash,
    scheme: parsed.protocol === "https:" ? "HTTPS" : "HTTP",
  };
}

/**
 * Has the user excused this URL's host from the warning?
 *
 * Matched on the exact host, port included, and never on a suffix: trusting
 * `example.com` is not trusting `evil-example.com`, nor `example.com.evil.tld`,
 * both of which a `endsWith` test would wave through.
 */
export function isTrustedLink(url: string, hosts: readonly string[]): boolean {
  const { host } = describeLink(url);
  return host !== "" && hosts.includes(host);
}

/** `hosts` plus this URL's host, unchanged when it is untrustable or already in. */
export function withTrustedHost(hosts: readonly string[], url: string): string[] {
  const { host } = describeLink(url);
  if (host === "" || hosts.includes(host)) return [...hosts];
  return [...hosts, host];
}
