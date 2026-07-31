import type { UserPreferences } from "@core/types";
import { SettingsGroup, SettingsToggleRow } from "../layout";
import type { PreferenceToggleHandler } from "../settingsModel";
import PrivacyWarning from "./PrivacyWarning";
import { PRIVACY_ROWS, type PrivacyRowCopy } from "./privacyCopy";

export interface PrivacySettingsPanelProps {
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
}

/**
 * Decide whether a row's risk banner is on screen, and how loud it is.
 *
 * A row that names a `safeHeading` keeps its banner in both states - the
 * setting is dangerous enough that its absence is still worth stating. Every
 * other row shows nothing once the exposure is closed, so the panel quietens
 * down as the user locks things off instead of crying wolf.
 */
function warningFor(row: PrivacyRowCopy, value: boolean) {
  if (!row.warning) return null;
  const risky = value === row.warning.riskyWhen;
  if (!risky && !row.warning.safeHeading) return null;
  return {
    tone: risky ? (row.warning.safeHeading ? ("danger" as const) : ("caution" as const)) : ("muted" as const),
    heading: risky ? row.warning.heading : (row.warning.safeHeading ?? row.warning.heading),
    body: row.warning.body,
  };
}

/** Privacy toggles, each annotated with what it currently exposes. */
export default function PrivacySettingsPanel({ prefs, onToggle }: PrivacySettingsPanelProps) {
  return (
    <SettingsGroup description="Each toggle names exactly what it exposes, and to whom.">
      {PRIVACY_ROWS.map((row) => {
        const value = prefs[row.key] === true;
        const warning = warningFor(row, value);
        return (
          <div key={row.key}>
            <SettingsToggleRow
              title={row.title}
              detail={row.detail}
              checked={value}
              onToggle={() => onToggle(row.key)}
            />
            {warning && <PrivacyWarning tone={warning.tone} heading={warning.heading} body={warning.body} />}
          </div>
        );
      })}
    </SettingsGroup>
  );
}
