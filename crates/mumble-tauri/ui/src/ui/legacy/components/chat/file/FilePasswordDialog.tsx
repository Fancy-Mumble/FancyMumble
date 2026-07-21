import { useTranslation } from "react-i18next";
import { PasswordPromptDialog } from "../../elements/PasswordPromptDialog";

interface FilePasswordDialogProps {
  readonly filename: string;
  readonly onConfirm: (password: string) => void;
  readonly onCancel: () => void;
}

/**
 * Native password prompt for downloading a password-protected file.  A thin
 * wrapper over the shared {@link PasswordPromptDialog}; file passwords are
 * passed through verbatim (no trimming) since they encrypt the file content
 * and must match exactly.
 */
export function FilePasswordDialog({ filename, onConfirm, onCancel }: FilePasswordDialogProps) {
  const { t } = useTranslation(["chat", "common"]);
  return (
    <PasswordPromptDialog
      title={t("fileAttachment.passwordDialogTitle", { defaultValue: "Password required" })}
      body={<>{t("fileAttachment.passwordPrompt")} <strong>{filename}</strong></>}
      placeholder={t("fileAttachment.passwordPlaceholder", { defaultValue: "Password" })}
      confirmLabel={t("fileAttachment.unlockBtn", { defaultValue: "Unlock" })}
      cancelLabel={t("common:actions.cancel")}
      preserveWhitespace
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
