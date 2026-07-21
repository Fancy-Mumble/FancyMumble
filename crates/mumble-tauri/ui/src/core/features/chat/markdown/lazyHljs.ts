/**
 * Lazily-loaded highlight.js.
 *
 * `highlight.js/lib/common` (~250 kB) plus the github-dark theme are only
 * needed once a `<pre><code>` block or a ``` code fence actually appears, so
 * they are kept off the startup heap until then.  Shared by the composer
 * (`MarkdownInput`) and the global received-message highlighter
 * (`useCodeHighlight`) so both reuse a single chunk + module instance and the
 * theme stylesheet is injected exactly once.
 */
export type HljsApi = typeof import("highlight.js/lib/common")["default"];

let hljsModule: HljsApi | null = null;
let hljsLoading: Promise<HljsApi> | null = null;

/** The highlighter if it has already been loaded, else `null` (no load). */
export function loadedHljs(): HljsApi | null {
  return hljsModule;
}

/** Load (once) highlight.js and its theme; resolves with the highlighter. */
export function loadHljs(): Promise<HljsApi> {
  if (hljsModule) return Promise.resolve(hljsModule);
  hljsLoading ??= Promise.all([
    import("highlight.js/lib/common"),
    import("highlight.js/styles/github-dark.css"),
  ]).then(([m]) => (hljsModule = m.default));
  return hljsLoading;
}
