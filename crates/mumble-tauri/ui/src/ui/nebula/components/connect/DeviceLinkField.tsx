import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, TextField, Typography } from "@mui/material";
import { followDeviceLink, isDeviceLink } from "@core/features/devices/deviceLink";
import { TID } from "@core/testids";
import { Stack } from "../primitives";

/**
 * "Link from another device": paste the link a signed-in device shows under
 * Account → Devices, and this one signs in as the same account.
 *
 * Here beside adding a server by hand because it is the same wish - to get
 * onto a server - from someone who already has an account on it.
 */
export function DeviceLinkField({ onLinked }: Readonly<{ onLinked: () => void }>) {
  const { t } = useTranslation("settings");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const follow = async () => {
    setBusy(true);
    setError(null);
    try {
      await followDeviceLink(link.trim());
      onLinked();
    } catch (e) {
      setError(t("account.devices.link.followFailed", { reason: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={(theme) => ({ mt: "8px", pt: "12px", borderTop: `1px solid ${theme.palette.nebula.line}` })}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
        {t("account.devices.link.followTitle")}
      </Typography>
      <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted, mb: "8px" })}>
        {t("account.devices.link.followHint")}
      </Typography>
      <Stack direction="row" gap={0.75}>
        <TextField
          size="small"
          sx={{ flex: 1 }}
          value={link}
          placeholder={t("account.devices.link.followPlaceholder")}
          onChange={(event) => setLink(event.target.value)}
          slotProps={{
            htmlInput: {
              "aria-label": t("account.devices.link.followTitle"),
              "data-testid": TID.connectDeviceLinkInput,
              autoCapitalize: "off",
              autoCorrect: "off",
              spellCheck: false,
            },
          }}
        />
        <Button
          variant="outlined"
          size="small"
          sx={{ flex: "none" }}
          data-testid={TID.connectDeviceLinkSubmit}
          disabled={busy || !isDeviceLink(link)}
          onClick={() => void follow()}
        >
          {busy ? t("account.devices.link.following") : t("account.devices.link.follow")}
        </Button>
      </Stack>
      {error && (
        <Typography sx={(theme) => ({ mt: "6px", fontSize: 11.5, color: theme.palette.nebula.bad })}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
