import type { SlashCommandEntry } from "@core/plugins/tier1/manifest";
import { Button } from "../../primitives";
import styles from "../../../AuroraClientExtensions.module.css";

/** `/name <arg> [opt]`, so the row shows the shape of the command. */
function commandUsage(entry: SlashCommandEntry): string {
  const args = (entry.command.options ?? [])
    .map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`))
    .join(" ");
  return args ? `/${entry.command.name} ${args}` : `/${entry.command.name}`;
}

function SlashRow({ entry, active, onPick }: {
  entry: SlashCommandEntry;
  active: boolean;
  onPick: () => void;
}) {
  return <Button
    variant="bare"
    role="option"
    aria-selected={active}
    className={`${styles.suggestionRow} ${active ? styles.suggestionRowActive : ""}`}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onPick}
  >
    <strong>{commandUsage(entry)}</strong>
    {entry.command.description && <small>{entry.command.description}</small>}
    <em>{entry.pluginName}</em>
  </Button>;
}

export interface SlashSuggestionsProps {
  entries: readonly SlashCommandEntry[];
  activeIndex: number;
  onPick: (entry: SlashCommandEntry) => void;
}

/** Plugin commands matching the `/` being typed. Renders nothing when the
 *  draft is not a command line. */
export default function SlashSuggestions({ entries, activeIndex, onPick }: SlashSuggestionsProps) {
  if (entries.length === 0) return null;
  return <div className={styles.suggestions} role="listbox" aria-label="Slash commands">
    {entries.map((entry, index) => <SlashRow
      key={`${entry.pluginName}:${entry.command.name}`}
      entry={entry}
      active={index === activeIndex}
      onPick={() => onPick(entry)}
    />)}
  </div>;
}
