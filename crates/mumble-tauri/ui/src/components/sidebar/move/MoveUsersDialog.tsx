import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ChannelEntry } from "../../../types";
import { Autocomplete, type AutocompleteOption } from "../../elements/Autocomplete";
import { Modal } from "../../elements/Modal";
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
  const { t } = useTranslation(["sidebar", "common"]);
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

  return (
    <Modal onClose={onCancel}>
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
          <button className={styles.cancelBtn} onClick={onCancel}>{t("common:actions.cancel")}</button>
          <button
            className={styles.confirmBtn}
            disabled={selected === null}
            onClick={() => { if (selected) onConfirm(selected.value); }}
          >
            {t("moveUsersDialog.confirmBtn")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

