/**
 * Custom properties read under Nebula that nothing defines.
 *
 * The bug: shared components painted their buttons with `var(--accent, #2aabee)`,
 * and no stylesheet Nebula (or Standard) loads defines `--accent` - the token is
 * `--color-accent` - so every theme's accent lost to a hard-coded blue. A name
 * nothing defines fails silently, so they are listed here.
 *
 * `KNOWN_UNDEFINED` is what was already undefined when this check was written:
 * each falls back to a literal and is owed a fix of its own. The check fails on
 * any name outside it, and on any of the accent names, so the list only shrinks.
 */
import { describe, expect, it } from "vitest";

// Sources as text. A glob rather than `node:fs`, so the suite type-checks under
// the app's own tsconfig, which carries no Node types. Aurora is left out: it
// is a different pack with its own tokens, and nothing of it loads under Nebula.
const SOURCES = import.meta.glob<string>(
  ["../standard/**/*.{css,ts,tsx}", "./**/*.{css,ts,tsx}", "../../shared/**/*.{css,ts,tsx}", "!**/*.test.*"],
  { query: "?raw", import: "default", eager: true },
);

/** Defined by code at run time rather than in a stylesheet. */
const RUNTIME_DEFINED = ["--fm-safe-top", "--fm-safe-right", "--fm-safe-bottom", "--fm-safe-left"];

/** Undefined when this check was written; each has a literal fallback or is owed. */
const KNOWN_UNDEFINED = new Set([
  "--accent-600",
  "--accent-700",
  "--bg-hover",
  "--bg-secondary",
  "--bg-tertiary",
  "--border",
  "--border-color",
  "--button-bg",
  "--button-bg-hover",
  "--button-border",
  "--button-border-hover",
  "--card-bg",
  "--card-border",
  "--color-accent-bg",
  "--color-accent-rgb",
  "--color-active",
  "--color-bg",
  "--color-bg-base",
  "--color-bg-hover",
  "--color-bg-input",
  "--color-bg-subtle",
  "--color-bg-tertiary",
  "--color-border",
  "--color-border-strong",
  "--color-border-subtle",
  "--color-card-header",
  "--color-error",
  "--color-glass-bg",
  "--color-glass-border-soft",
  "--color-glass-border-subtle",
  "--color-glass-highlight",
  "--color-hover",
  "--color-on-accent",
  "--color-overlay-soft",
  "--color-primary",
  "--color-status-active",
  "--color-success",
  "--color-surface-1",
  "--color-surface-2",
  "--color-surface-elevated",
  "--color-surface-hover",
  "--color-text",
  "--color-text-dim",
  "--color-text-tertiary",
  "--color-warning-bg",
  "--color-warning-border",
  "--error",
  "--error-600",
  "--error-700",
  "--font-mono",
  "--font-sans",
  "--input-bg",
  "--ld-margin-band",
  "--ld-tick-major",
  "--ld-tick-minor",
  "--media-accent",
  "--nebula-chat-gutter",
  "--nebula-mono",
  "--preview-ratio",
  "--radius-xs",
  "--surface",
  "--surface-2",
  "--surface-3",
  "--surface-4",
  "--surface-deep",
  "--surface-elevated",
  "--surface-overlay",
  "--text-muted",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
]);

function undefinedVariables(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  const defined = new Set(RUNTIME_DEFINED);
  for (const [path, text] of Object.entries(SOURCES)) {
    for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
      // A name built at run time (`--nebula-radius-${size}`) is not a name.
      if (match[1].endsWith("-")) continue;
      const files = used.get(match[1]) ?? [];
      if (!files.includes(path)) files.push(path);
      used.set(match[1], files);
    }
    // A declaration in a stylesheet, or a key in an object of properties.
    for (const match of text.matchAll(/(?:^|[\s{;"'`(])(--[\w-]+)\s*["'`]?\s*:/g)) defined.add(match[1]);
    for (const match of text.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)) defined.add(match[1]);
  }
  return new Map([...used].filter(([name]) => !defined.has(name)));
}

describe("CSS variables under Nebula", () => {
  it("reads no accent alias that nothing defines", () => {
    const missing = undefinedVariables();
    for (const name of ["--accent", "--accent-color", "--accent-hover", "--accent-soft"]) {
      expect(missing.get(name), name).toBeUndefined();
    }
  });

  it("adds no undefined name beyond those already owed", () => {
    const fresh = [...undefinedVariables()]
      .filter(([name]) => !KNOWN_UNDEFINED.has(name))
      .map(([name, files]) => `${name}: ${files.join(", ")}`);
    expect(fresh).toEqual([]);
  });
});
