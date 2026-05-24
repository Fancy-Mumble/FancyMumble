import type { KeyboardEvent } from "react";
import type { SlashCommandEntry } from "../../plugins/tier1/manifest";
import styles from "./SlashCommandMenu.module.css";

interface Props {
  readonly entries: readonly SlashCommandEntry[];
  readonly activeIndex: number;
  readonly onPick: (entry: SlashCommandEntry) => void;
  readonly onActiveIndexChange: (next: number) => void;
}

export default function SlashCommandMenu({
  entries,
  activeIndex,
  onPick,
  onActiveIndexChange,
}: Props) {
  if (entries.length === 0) {
    return <div className={styles.menu}><div className={styles.empty}>No matching commands</div></div>;
  }
  return (
    <div className={styles.menu} role="listbox">
      <div className={styles.list}>
      {entries.map((entry, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={`${entry.pluginName}:${entry.command.name}`}
            type="button"
            role="option"
            aria-selected={active}
            className={`${styles.row} ${active ? styles.activeRow : ""}`}
            onMouseEnter={() => onActiveIndexChange(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(entry);
            }}
          >
            <div className={styles.main}>
              <span className={styles.syntax}>{formatSyntax(entry)}</span>
              {entry.command.description && (
                <span className={styles.desc}>{entry.command.description}</span>
              )}
            </div>
            <span className={styles.plugin}>{entry.pluginName}</span>
          </button>
        );
      })}
      </div>
    </div>
  );
}

function formatSyntax(entry: SlashCommandEntry): string {
  const parts = (entry.command.options ?? []).map((o) =>
    o.required ? `<${o.name}>` : `[${o.name}]`,
  );
  const args = parts.length > 0 ? ` ${parts.join(" ")}` : "";
  return `/${entry.command.name}${args}`;
}

/** Keyboard navigation for the slash command menu.  Mirrors the
 *  mention-autocomplete contract used in ChatComposer. */
export type SlashKeyAction =
  | { kind: "move"; index: number }
  | { kind: "pick"; index: number }
  | { kind: "close" };

export function handleSlashKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
  state: { activeIndex: number; count: number },
): SlashKeyAction | null {
  if (state.count === 0) {
    if (e.key === "Escape") return { kind: "close" };
    return null;
  }
  switch (e.key) {
    case "ArrowDown":
      return { kind: "move", index: (state.activeIndex + 1) % state.count };
    case "ArrowUp":
      return {
        kind: "move",
        index: (state.activeIndex - 1 + state.count) % state.count,
      };
    case "Tab":
    case "Enter":
      return { kind: "pick", index: state.activeIndex };
    case "Escape":
      return { kind: "close" };
    default:
      return null;
  }
}
