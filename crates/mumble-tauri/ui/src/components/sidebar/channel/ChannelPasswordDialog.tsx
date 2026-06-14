import { useTranslation } from "react-i18next";
import type { ChannelEntry } from "../../../types";
import { PasswordPromptDialog } from "../../elements/PasswordPromptDialog";

interface ChannelPasswordDialogProps {
  channel: ChannelEntry;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

/** Password prompt for joining a password-protected channel.  A thin wrapper
 *  over the shared {@link PasswordPromptDialog}. */
export function ChannelPasswordDialog({ channel, onConfirm, onCancel }: Readonly<ChannelPasswordDialogProps>) {
  const { t } = useTranslation(["sidebar", "common"]);
  return (
    <PasswordPromptDialog
      title={t("channelPassword.title")}
      body={<><strong>{channel.name}</strong>{t("channelPassword.body")}</>}
      placeholder={t("channelPassword.placeholder")}
      confirmLabel={t("channelPassword.joinBtn")}
      cancelLabel={t("common:actions.cancel")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
