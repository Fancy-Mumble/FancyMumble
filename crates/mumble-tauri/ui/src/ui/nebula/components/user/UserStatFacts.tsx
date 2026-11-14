import { useTranslation } from "react-i18next";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import type { UserStats } from "@core/types";
import { InfoFact } from "../primitives";
import { certificateLabel, osLabel } from "./userInfoModel";

/**
 * The facts one connection's stats give, drawn the same wherever they appear.
 *
 * The User Information sheet draws these for the person, and its Devices card
 * again for each device of a multi-device account: one set of components, so
 * a device reads exactly as a person does.
 */

/** The client: its version, its system, its certificate and its codec. */
export function ClientFacts({ stats }: Readonly<{ stats: UserStats }>) {
  const { t } = useTranslation(["sidebar"]);
  const certificate = certificateLabel(stats.strong_certificate);
  const os = osLabel(stats.os, stats.os_version);
  return (
    <>
      {stats.version && <InfoFact label={t("sidebar:userInfo.labelVersion")} value={stats.version} />}
      {os && <InfoFact label={t("sidebar:userInfo.labelOs")} value={os} />}
      <InfoFact
        label={t("sidebar:userInfo.labelCertificate")}
        value={t(certificate.labelKey)}
        tone={certificate.tone}
      />
      <InfoFact
        label={t("sidebar:userInfo.labelOpus")}
        value={
          stats.opus == null
            ? t("sidebar:userInfo.notReported")
            : t(stats.opus ? "sidebar:userProfile.yes" : "sidebar:userProfile.no")
        }
        tone={stats.opus == null ? "muted" : undefined}
      />
    </>
  );
}

/** The round trips over TCP and UDP, and the packet counts each way. */
export function ConnectionTables({ stats }: Readonly<{ stats: UserStats }>) {
  const { t } = useTranslation(["nebulaUser", "sidebar"]);
  return (
    <>
      <FactTable
        head={[
          "",
          t("sidebar:userInfo.colPackets"),
          t("sidebar:userInfo.colAvgPing"),
          t("sidebar:userInfo.colDeviation"),
        ]}
        rows={[
          [
            t("nebulaUser:sheet.tcp"),
            String(stats.tcp_packets),
            t("nebulaUser:sheet.milliseconds", { value: stats.tcp_ping_avg.toFixed(1) }),
            t("nebulaUser:sheet.milliseconds", { value: stats.tcp_ping_var.toFixed(1) }),
          ],
          [
            t("nebulaUser:sheet.udp"),
            String(stats.udp_packets),
            t("nebulaUser:sheet.milliseconds", { value: stats.udp_ping_avg.toFixed(1) }),
            t("nebulaUser:sheet.milliseconds", { value: stats.udp_ping_var.toFixed(1) }),
          ],
        ]}
      />
      {(stats.from_client || stats.from_server) && (
        <FactTable
          head={[
            "",
            t("sidebar:userInfo.colGood"),
            t("sidebar:userInfo.colLate"),
            t("sidebar:userInfo.colLost"),
            t("sidebar:userInfo.colResync"),
          ]}
          rows={[
            stats.from_client && [t("nebulaUser:sheet.inbound"), ...packetRow(stats.from_client)],
            stats.from_server && [t("nebulaUser:sheet.outbound"), ...packetRow(stats.from_server)],
          ].filter((row): row is string[] => !!row)}
        />
      )}
    </>
  );
}

function packetRow(packets: NonNullable<UserStats["from_client"]>): string[] {
  return [packets.good, packets.late, packets.lost, packets.resync].map(String);
}

/**
 * The label-and-figures table the sheet uses for codec and network facts.
 *
 * Rules and padding come off MUI's cells, not out of them: these rows are a
 * reading of numbers, and a line under each one turns four facts into a grid.
 */
function FactTable({
  head,
  rows,
}: Readonly<{ head: readonly string[]; rows: readonly (readonly string[])[] }>) {
  return (
    <Table
      size="small"
      sx={(theme) => ({
        width: "100%",
        mt: "14px",
        fontSize: 12,
        "& th, & td": { border: "none" },
        "& th": {
          fontSize: 10,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: theme.palette.nebula.dim,
          textAlign: "right",
          p: 0,
          pb: "6px",
        },
        "& td": { p: 0, py: "4px", textAlign: "right", color: theme.palette.nebula.text },
        "& th:first-of-type, & td:first-of-type": { textAlign: "left", color: theme.palette.nebula.muted },
      })}
    >
      <TableHead>
        <TableRow>
          {head.map((cell, index) => (
            <TableCell key={index}>{cell}</TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row[0]}>
            {row.map((cell, index) => (
              <TableCell key={index}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
