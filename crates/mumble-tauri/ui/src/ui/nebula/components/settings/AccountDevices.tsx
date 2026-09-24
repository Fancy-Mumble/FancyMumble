import { useEffect, type ReactNode } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  MAX_DEVICE_NAME,
  deviceStatus,
  orderedDevices,
  useDeviceEditor,
  type DeviceStatus,
} from "@core/features/settings/accountDevices";
import { useDeviceLinkOffer } from "@core/features/devices/useDeviceLinkOffer";
import { ACCOUNT_ACTION_IDS, type AccountAction, type AccountSettings } from "@core/types";
import { DEVICE_ID_ATTR, TID } from "@core/testids";
import { QrCode } from "@ui/QrCode";
import { Stack } from "../primitives";
import { Banner, Field, GroupTitle, SettingsCard } from "./controls";

/**
 * The account's devices: where it is signed in, which are online, and a way to
 * rename or sign out each of them.
 *
 * Renaming needs no password - it takes nothing away. Signing out does, like
 * every other change that could lock the owner out, so it waits on the
 * page's current-password field the same way the rest of the page does.
 */
export function AccountDevices({
  snapshot,
  busy,
  blocked,
  lastSuccessAction,
  send,
  feedbackFor,
}: Readonly<{
  snapshot: AccountSettings;
  busy: boolean;
  /** Busy, or a password is needed and not typed yet. */
  blocked: boolean;
  lastSuccessAction: number | null;
  send: (action: AccountAction, value: string | undefined, device: { id: string }) => void;
  feedbackFor: (action: AccountAction) => ReactNode;
}>) {
  const { t } = useTranslation("settings");
  const editor = useDeviceEditor();
  const { cancel } = editor;
  const linking = useDeviceLinkOffer(snapshot);

  // Close whatever was open once its action has actually landed.
  useEffect(() => {
    if (
      lastSuccessAction === ACCOUNT_ACTION_IDS.rename_device ||
      lastSuccessAction === ACCOUNT_ACTION_IDS.remove_device
    ) {
      cancel();
    }
  }, [lastSuccessAction, cancel]);

  const devices = orderedDevices(snapshot);
  const statusText = (status: DeviceStatus): string => {
    switch (status.key) {
      case "thisDevice":
        return t("account.devices.thisDevice");
      case "online":
        return t("account.devices.online");
      case "neverSeen":
        return t("account.devices.neverSeen");
      case "lastSeen":
        return t("account.devices.lastSeen", { when: status.when ?? "" });
    }
  };

  return (
    <>
      <GroupTitle hint={t("account.devices.hint")}>{t("account.devices.title")}</GroupTitle>
      {snapshot.devices_locked && (
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "8px" })}>
          {t("account.devices.locked")}
        </Typography>
      )}
      {devices.length === 0 ? (
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {t("account.devices.empty")}
        </Typography>
      ) : (
        <Box data-testid={TID.accountDevices} sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {devices.map((device) => {
            const status = deviceStatus(device, snapshot.this_device);
            const own = status.key === "thisDevice";
            return (
              <Box key={device.id} data-testid={TID.accountDevice} {...{ [DEVICE_ID_ATTR]: device.id }}>
                <SettingsCard>
                  <Stack direction="row" gap={1} alignItems="center">
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
                        {device.name || t("account.devices.unnamed")}
                      </Typography>
                      <Typography
                        sx={(theme) => ({
                          fontSize: 11.5,
                          color:
                            status.key === "online" || own
                              ? theme.palette.nebula.ok
                              : theme.palette.nebula.muted,
                        })}
                      >
                        {statusText(status)}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="text"
                      data-testid={TID.accountDeviceRename}
                      disabled={busy}
                      onClick={() => editor.startRename(device)}
                    >
                      {t("account.devices.rename")}
                    </Button>
                    {!own && (
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        data-testid={TID.accountDeviceSignOut}
                        disabled={busy}
                        onClick={() => editor.startSignOut(device)}
                      >
                        {t("account.devices.signOut")}
                      </Button>
                    )}
                  </Stack>

                  {editor.renaming === device.id && (
                    <Stack direction="row" gap={0.75} sx={{ mt: "10px" }}>
                      <TextField
                        size="small"
                        sx={{ flex: 1 }}
                        value={editor.draft}
                        onChange={(event) => editor.setDraft(event.target.value.slice(0, MAX_DEVICE_NAME))}
                        slotProps={{
                          htmlInput: {
                            "aria-label": t("account.devices.rename"),
                            "data-testid": TID.accountDeviceNameInput,
                          },
                        }}
                      />
                      <Button size="small" onClick={editor.cancel}>
                        {t("account.devices.cancel")}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        data-testid={TID.accountDeviceNameSave}
                        disabled={busy || !editor.draft.trim() || editor.draft.trim() === device.name}
                        onClick={() => send("rename_device", editor.draft.trim(), { id: device.id })}
                      >
                        {t("account.devices.save")}
                      </Button>
                    </Stack>
                  )}

                  {editor.signingOut === device.id && (
                    <Box sx={{ mt: "10px" }}>
                      <Banner tone="warn" title={t("account.devices.signOutConfirm", { name: device.name })}>
                        {snapshot.has_password
                          ? t("account.devices.signOutPasswordPara")
                          : t("account.devices.signOutPara")}
                      </Banner>
                      <Stack direction="row" gap={0.75} justifyContent="flex-end" sx={{ mt: "8px" }}>
                        <Button size="small" onClick={editor.cancel}>
                          {t("account.devices.cancel")}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="contained"
                          data-testid={TID.accountDeviceSignOutConfirm}
                          disabled={blocked}
                          onClick={() => send("remove_device", undefined, { id: device.id })}
                        >
                          {t("account.devices.signOut")}
                        </Button>
                      </Stack>
                    </Box>
                  )}
                </SettingsCard>
              </Box>
            );
          })}
        </Box>
      )}
      {feedbackFor("rename_device")}
      {feedbackFor("remove_device")}

      <Box sx={{ mt: "12px" }}>
        {linking.offer ? (
          <SettingsCard testId={TID.accountDeviceLinkPanel}>
            {linking.linked ? (
              <Banner tone="ok" title={t("account.devices.link.done")} />
            ) : (
              <>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: "4px" }}>
                  {t("account.devices.link.title")}
                </Typography>
                <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
                  {t("account.devices.link.scan")}
                </Typography>
                <Box sx={{ display: "flex", justifyContent: "center", my: "12px" }}>
                  <QrCode
                    value={linking.offer.link}
                    label={t("account.devices.link.qrLabel")}
                    testId={TID.accountDeviceLinkQr}
                  />
                </Box>
                <Field label={t("account.devices.link.codeLabel")} sx={{ mb: "10px" }}>
                  <Typography
                    data-testid={TID.accountDeviceLinkCode}
                    sx={{ fontFamily: "monospace", fontSize: 15, letterSpacing: "0.06em" }}
                  >
                    {linking.offer.code}
                  </Typography>
                </Field>
                <Field label={t("account.devices.link.linkLabel")} sx={{ mb: "10px" }}>
                  <TextField
                    size="small"
                    fullWidth
                    value={linking.offer.link}
                    onFocus={(event) => (event.target as HTMLInputElement).select()}
                    slotProps={{
                      htmlInput: {
                        readOnly: true,
                        "data-testid": TID.accountDeviceLinkText,
                        "aria-label": t("account.devices.link.linkLabel"),
                      },
                    }}
                  />
                </Field>
                <Banner tone="warn" title={t("account.devices.link.warning")} />
              </>
            )}
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: "10px" }}>
              <Button
                size="small"
                data-testid={TID.accountDeviceLinkClose}
                onClick={() => void linking.close()}
              >
                {linking.linked ? t("account.devices.link.close") : t("account.devices.cancel")}
              </Button>
            </Stack>
          </SettingsCard>
        ) : (
          <Button
            size="small"
            variant="outlined"
            data-testid={TID.accountDeviceLinkBegin}
            disabled={busy || linking.starting}
            onClick={() => void linking.begin()}
          >
            {t("account.devices.link.begin")}
          </Button>
        )}
        {linking.error && <Banner tone="danger">{linking.error}</Banner>}
        {linking.expired && (
          <Typography sx={(theme) => ({ mt: "6px", fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {t("account.devices.link.expired")}
          </Typography>
        )}
      </Box>
    </>
  );
}
