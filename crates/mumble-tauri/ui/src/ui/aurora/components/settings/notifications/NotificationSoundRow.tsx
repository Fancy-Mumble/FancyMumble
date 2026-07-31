import type { NotificationEventConfig } from "@core/types";
import { SOUND_OPTIONS } from "@core/features/notifications/sounds";
import { PlayIcon } from "@ui/icons";
import { Button, IconButton, Slider, ToggleSwitch } from "../../primitives";
import type { NotificationEventCopy } from "./notificationCopy";
import styles from "./Notifications.module.css";

export interface NotificationSoundRowProps {
  copy: NotificationEventCopy;
  config: NotificationEventConfig;
  onChange: (patch: Partial<NotificationEventConfig>) => void;
  onPreview: (sound: string, volume: number) => void;
}

/**
 * One sound event: whether it fires, which sound, and how loud.
 *
 * The picker and volume only appear once the event is on - an off event has no
 * sound to configure, and collapsing them keeps a ten-event list readable.
 */
export default function NotificationSoundRow({
  copy,
  config,
  onChange,
  onPreview,
}: NotificationSoundRowProps) {
  return (
    <>
      <Button
        variant="bare"
        wrapLabel={false}
        className={styles.eventRow}
        aria-pressed={config.enabled}
        onClick={() => onChange({ enabled: !config.enabled })}
      >
        <span>
          <strong>{copy.label}</strong>
          <small>{copy.detail}</small>
        </span>
        <ToggleSwitch on={config.enabled} />
      </Button>

      {config.enabled && (
        <div className={styles.eventConfig}>
          <select
            className={styles.soundSelect}
            value={config.sound}
            aria-label={`${copy.label} sound`}
            onChange={(event) => onChange({ sound: event.target.value })}
          >
            {SOUND_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <IconButton
            icon={<PlayIcon />}
            label={`Preview ${copy.label} sound`}
            disabled={config.sound === "none"}
            onClick={() => onPreview(config.sound, config.volume)}
          />
          <Slider
            className={styles.volume}
            label={`${copy.label} volume`}
            value={config.volume}
            min={0}
            max={1}
            step={0.05}
            onChange={(volume) => onChange({ volume })}
            format={(volume) => `${Math.round(volume * 100)}%`}
          />
        </div>
      )}
    </>
  );
}
