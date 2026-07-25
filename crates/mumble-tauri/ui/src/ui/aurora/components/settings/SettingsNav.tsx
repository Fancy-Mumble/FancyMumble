import { SearchField } from "../primitives";
import SettingsNavButton from "./SettingsNavButton";
import { SETTINGS_SECTIONS, sectionMatchesQuery, type SettingsSectionId } from "./settingsModel";

export interface SettingsNavProps {
  section: SettingsSectionId;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (id: SettingsSectionId) => void;
}

export default function SettingsNav({ section, query, onQueryChange, onSelect }: SettingsNavProps) {
  return <nav>
    <SearchField value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search settings" aria-label="Search settings" />
    {SETTINGS_SECTIONS.filter((item) => sectionMatchesQuery(item, query)).map((item) => <SettingsNavButton key={item.id} label={item.label} active={item.id === section} onSelect={() => onSelect(item.id)} />)}
  </nav>;
}
