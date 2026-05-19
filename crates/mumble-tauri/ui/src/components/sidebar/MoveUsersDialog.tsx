import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ChannelEntry } from "../../types";
import { Autocomplete, type AutocompleteOption } from "../elements/Autocomplete";
import styles from "./MoveUsersDialog.module.css";

interface MoveUsersDialogProps {
  /** The channel whose users are being moved. */
  sourceChannel: ChannelEntry;
  /** All available channels to pick as target. */
  channels: ChannelEntry[];
  onConfirm: (targetChannelId: number) => void;
  onCancel: () => void;
}

export function MoveUsersDialog({ sourceChannel, channels, onConfirm, onCancel }: Readonly<MoveUsersDialogProps>) {
  const { t } = useTranslation("sidebar");
  const eligibleChannels = useMemo(
    () => channels.filter((c) => c.id !== sourceChannel.id),
    [channels, sourceChannel.id],
  );

  const options = useMemo<AutocompleteOption<number>[]>(
    () => eligibleChannels.map((c) => ({ key: c.id, label: c.name, value: c.id })),
    [eligibleChannels],
  );

  const [selected, setSelected] = useState<AutocompleteOption<number> | null>(
    options[0] ?? null,
  );

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return createPortal(
    <div className={styles.overlay} onMouseDown={handleOverlayClick}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <h3 className={styles.title}>{t("moveUsersDialog.title", { channel: sourceChannel.name })}</h3>
        <p className={styles.body}>{t("moveUsersDialog.body")}</p>
        <Autocomplete
          options={options}
          value={selected}
          onChange={setSelected}
          placeholder={t("moveUsersDialog.searchPlaceholder")}
          noOptionsText={t("moveUsersDialog.noOptions")}
          label={t("moveUsersDialog.destinationLabel")}
          inputRef={inputRef}
        />
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>{t("moveUsersDialog.cancelBtn")}</button>
          <button
            className={styles.confirmBtn}
            disabled={selected === null}
            onClick={() => { if (selected) onConfirm(selected.value); }}
          >
            {t("moveUsersDialog.confirmBtn")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

