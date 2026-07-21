import type { SlashCommandEntry } from "./manifest";
import type { InteractionKind, OptionValue, SlashCommand } from "./types";

/** A composer draft line interpreted as a slash command invocation. */
export interface ParsedSlashLine {
  readonly pluginName: string;
  readonly command: SlashCommand;
  readonly kind: Extract<InteractionKind, { kind: "slash-command" }>;
  readonly errors: readonly string[];
}

/** Tokenise `/cmd a b c` into `[cmd, a, b, c]`, with quoted strings
 *  treated as single tokens (`/cmd "two words"`).  Returns null when
 *  the line does not start with a slash. */
export function tokenise(line: string): readonly string[] | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of body) {
    if (inQuote) {
      if (ch === '"') {
        inQuote = false;
        out.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/** Look up the typed prefix's command name in the manifest. */
export function findCommandByName(
  entries: readonly SlashCommandEntry[],
  name: string,
): SlashCommandEntry | null {
  const lower = name.toLowerCase();
  return entries.find((e) => e.command.name.toLowerCase() === lower) ?? null;
}

/** Parse a draft line as a slash command invocation against the
 *  manifest entries.  Returns null when the line does not match any
 *  declared command. */
export function parseSlashLine(
  line: string,
  entries: readonly SlashCommandEntry[],
): ParsedSlashLine | null {
  const tokens = tokenise(line);
  if (!tokens || tokens.length === 0) return null;
  const [head, ...rest] = tokens;
  const entry = findCommandByName(entries, head);
  if (!entry) return null;
  return parseAgainstCommand(entry, rest);
}

function parseAgainstCommand(
  entry: SlashCommandEntry,
  args: readonly string[],
): ParsedSlashLine {
  const options: Record<string, OptionValue> = {};
  const errors: string[] = [];
  const declared = entry.command.options ?? [];
  const byName = new Map(declared.map((o) => [o.name, o]));
  const filled = new Set<string>();
  const positional: string[] = [];

  // Pass 1: extract `name=value` tokens.  An equals sign at index > 0
  // marks a named argument; everything else is positional.
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq <= 0) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(0, eq);
    const raw = arg.slice(eq + 1);
    const opt = byName.get(name);
    if (!opt) {
      errors.push(`unknown option "${name}"`);
      continue;
    }
    const coerced = coerceOption(raw, opt.type);
    if (coerced === null) {
      errors.push(`option <${name}> expects ${opt.type}, got "${raw}"`);
      continue;
    }
    options[name] = coerced;
    filled.add(name);
  }

  // Pass 2: drop positional values into the still-unfilled options in
  // declared order.  This keeps `/cmd alice true` working unchanged
  // while also supporting `/cmd loud=true alice` and full key=value
  // invocations.
  const unfilled = declared.filter((o) => !filled.has(o.name));
  for (let i = 0; i < unfilled.length; i += 1) {
    const opt = unfilled[i];
    const raw = positional[i];
    if (raw === undefined) {
      if (opt.required) errors.push(`missing required option <${opt.name}>`);
      continue;
    }
    const coerced = coerceOption(raw, opt.type);
    if (coerced === null) {
      errors.push(`option <${opt.name}> expects ${opt.type}, got "${raw}"`);
      continue;
    }
    options[opt.name] = coerced;
  }

  return {
    pluginName: entry.pluginName,
    command: entry.command,
    kind: { kind: "slash-command", name: entry.command.name, options },
    errors,
  };
}

function coerceOption(
  raw: string,
  type: import("./types").OptionType,
): OptionValue | null {
  switch (type) {
    case "string":
    case "user":
    case "channel":
      return raw;
    case "integer": {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean":
      if (/^(true|yes|on|1)$/i.test(raw)) return true;
      if (/^(false|no|off|0)$/i.test(raw)) return false;
      return null;
  }
}

/** Picker filter: extract the typed-so-far command prefix from a draft
 *  whose caret is positioned after a leading `/`.  Returns null when
 *  the draft is not in a slash-command-typing state. */
export function extractSlashQuery(draft: string): string | null {
  const trimmed = draft.trimStart();
  if (!trimmed.startsWith("/")) return null;
  // Only show the picker while the user is still typing the command
  // name itself - once they hit a space the picker should close so it
  // does not occlude argument hints.
  const afterSlash = trimmed.slice(1);
  if (afterSlash.includes(" ") || afterSlash.includes("\n")) return null;
  return afterSlash;
}
