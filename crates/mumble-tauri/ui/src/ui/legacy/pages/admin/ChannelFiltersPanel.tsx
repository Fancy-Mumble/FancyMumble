import { useTranslation } from "react-i18next";
import { TID } from "@core/testids";
import styles from "./AdminPanel.module.css";

interface FilterToggleRowProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
  readonly testId: string;
  readonly hint?: string;
}

function FilterToggleRow({ label, checked, onChange, testId, hint }: Readonly<FilterToggleRowProps>) {
  return (
    <div className={styles.aclTreeFilterRow}>
      <span className={styles.aclTreeFilterLabel}>
        {label}
        {hint && <span className={styles.aclFiltersHint}> - {hint}</span>}
      </span>
      <label className={styles.toggleSwitch}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={testId}
        />
        <span className={styles.toggleSlider} aria-hidden="true" />
      </label>
    </div>
  );
}

export interface ChannelFiltersPanelProps {
  readonly hideDmChannels: boolean;
  readonly onHideDmChannelsChange: (v: boolean) => void;
  readonly hideEmptyChannels: boolean;
  readonly onHideEmptyChannelsChange: (v: boolean) => void;
  readonly privateOnly: boolean;
  readonly onPrivateOnlyChange: (v: boolean) => void;
  readonly topLevelOnly: boolean;
  readonly onTopLevelOnlyChange: (v: boolean) => void;
  readonly customAclOnly: boolean;
  readonly onCustomAclOnlyChange: (v: boolean) => void;
  readonly customAclLoading: boolean;
}

/**
 * Third column of the "Channels / ACL" admin tab: every tree filter in one
 * place, always reachable regardless of whether a channel is selected (the
 * middle detail pane swaps between "select a channel" and the ACL editor).
 */
export function ChannelFiltersPanel({
  hideDmChannels, onHideDmChannelsChange,
  hideEmptyChannels, onHideEmptyChannelsChange,
  privateOnly, onPrivateOnlyChange,
  topLevelOnly, onTopLevelOnlyChange,
  customAclOnly, onCustomAclOnlyChange,
  customAclLoading,
}: Readonly<ChannelFiltersPanelProps>) {
  const { t } = useTranslation("settings");

  return (
    <div className={styles.aclFiltersPane}>
      <h3 className={styles.aclFiltersTitle}>{t("channelAcl.filtersTitle")}</h3>
      <FilterToggleRow
        label={t("channelAcl.hideDmChannels")}
        checked={hideDmChannels}
        onChange={onHideDmChannelsChange}
        testId={TID.aclHideDmChannels}
      />
      <FilterToggleRow
        label={t("channelAcl.hideEmptyChannels")}
        checked={hideEmptyChannels}
        onChange={onHideEmptyChannelsChange}
        testId={TID.aclHideEmptyChannels}
      />
      <FilterToggleRow
        label={t("channelAcl.privateOnly")}
        checked={privateOnly}
        onChange={onPrivateOnlyChange}
        testId={TID.aclPrivateOnly}
      />
      <FilterToggleRow
        label={t("channelAcl.topLevelOnly")}
        checked={topLevelOnly}
        onChange={onTopLevelOnlyChange}
        testId={TID.aclTopLevelOnly}
      />
      <FilterToggleRow
        label={t("channelAcl.customAclOnly")}
        checked={customAclOnly}
        onChange={onCustomAclOnlyChange}
        testId={TID.aclCustomAclOnly}
        hint={customAclLoading ? t("channelAcl.customAclLoading") : undefined}
      />
    </div>
  );
}
