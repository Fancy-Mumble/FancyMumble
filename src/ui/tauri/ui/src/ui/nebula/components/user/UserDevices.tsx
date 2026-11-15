import { useTranslation } from "react-i18next";
import type { UserStats } from "@core/types";
import { formatDuration } from "@core/utils/format";
import { maskSensitive } from "@core/utils/maskSensitive";
import { Disclosure, InfoCard, InfoFact, StatChip } from "../primitives";
import { ClientFacts, ConnectionTables } from "./UserStatFacts";
import { deviceName } from "./userInfoModel";

/**
 * The devices an account is online from, each opening to its own stats.
 *
 * The server shows a registered account on several devices as one person and
 * tells only an administrator what each device is; with nothing to list, this
 * draws nothing, so every other sheet is unchanged.
 */
export function DevicesCard({
  devices,
  streamerMode,
}: Readonly<{ devices: readonly UserStats[]; streamerMode: boolean }>) {
  const { t } = useTranslation(["sidebar", "nebulaUser"]);
  if (devices.length === 0) return null;
  return (
    <InfoCard
      title={t("sidebar:userInfo.devices")}
      chip={<StatChip tone="accent">{t("nebulaUser:sheet.adminOnly")}</StatChip>}
    >
      {devices.map((device) => (
        <DeviceEntry key={device.session} device={device} streamerMode={streamerMode} />
      ))}
    </InfoCard>
  );
}

/** One device: its name, and under it what the server knows of its connection. */
function DeviceEntry({ device, streamerMode }: Readonly<{ device: UserStats; streamerMode: boolean }>) {
  const { t } = useTranslation(["sidebar", "nebulaUser"]);
  return (
    <Disclosure
      label={deviceName(device) ?? t("sidebar:userInfo.deviceFallback", { session: device.session })}
    >
      <InfoFact label={t("sidebar:userProfile.labelSession")} value={String(device.session)} />
      {device.address && (
        <InfoFact
          label={t("sidebar:userInfo.labelAddress")}
          value={streamerMode ? maskSensitive(device.address) : device.address}
          mono
        />
      )}
      {device.onlinesecs != null && (
        <InfoFact label={t("sidebar:userInfo.labelOnline")} value={formatDuration(device.onlinesecs)} />
      )}
      {device.idlesecs != null && (
        <InfoFact label={t("nebulaUser:sheet.idle")} value={formatDuration(device.idlesecs)} />
      )}
      <ClientFacts stats={device} />
      <ConnectionTables stats={device} />
    </Disclosure>
  );
}
