/**
 * The public server directory, in Nebula's own chrome.
 *
 * Standard's `PublicServerList` was borrowed here, which put a CSS-module
 * table inside the pack's full surface: its own hairlines, its own search
 * field, its own ping colours, none of which this theme could reach. The list
 * itself - fetching, throttled pinging, search and sort - is shared through
 * `usePublicServers`, so the two packs disagree about nothing but the drawing.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Typography } from "@mui/material";
import type { PublicServer, ServerPingResult } from "@core/types";
import {
  countryFlag,
  serverKey,
  usePublicServers,
  type PublicServerSortKey,
} from "@core/features/server/usePublicServers";
import { WarningIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { SearchBox, Stack, StatChip, type StatChipTone } from "../primitives";
import { DataTable, type Column } from "../admin/controls";

/** Latency bands, in ms: under the first is good, under the second is fair. */
const PING_GOOD_MS = 30;
const PING_OKAY_MS = 70;

interface Props {
  readonly onConnect: (host: string, port: number) => void;
  readonly onBack: () => void;
  readonly disabled?: boolean;
}

export default function PublicServersSurface({ onConnect, onBack, disabled }: Props) {
  const { t } = useTranslation("server");
  const [consented, setConsented] = useState(false);
  const { servers, pings, loading, error, search, setSearch, sortKey, sortDir, handleSort, displayed } =
    usePublicServers(consented);

  const heading = (
    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
      <Typography sx={{ fontSize: 20, fontWeight: 600 }}>{t("public.title")}</Typography>
      <Button size="small" variant="text" onClick={onBack}>
        {t("public.savedServers")}
      </Button>
    </Stack>
  );

  // -- Consent gate --------------------------------------------------------
  if (!consented) {
    return (
      <Stack direction="column" gap={2} sx={{ p: "24px", maxWidth: 720, mx: "auto" }}>
        {heading}
        <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.nebula.muted })}>
          {t("public.consentText")}
        </Typography>
        <Stack
          direction="row"
          alignItems="flex-start"
          gap={1.5}
          sx={(theme) => ({
            p: "12px 14px",
            borderRadius: radius("lg"),
            background: `${theme.palette.nebula.warn}18`,
            border: `1px solid ${theme.palette.nebula.warn}55`,
            color: theme.palette.nebula.text,
            fontSize: 12.5,
          })}
        >
          <Box sx={(theme) => ({ color: theme.palette.nebula.warn, flexShrink: 0, mt: "1px" })}>
            <WarningIcon width={15} height={15} />
          </Box>
          <Box>{t("public.consentWarning")}</Box>
        </Stack>
        <Box>
          <Button variant="contained" onClick={() => setConsented(true)}>
            {t("public.consentButton")}
          </Button>
        </Box>
      </Stack>
    );
  }

  /** A header that sorts on click, with the direction it is sorting in. */
  const sortable = (key: PublicServerSortKey, header: string) => (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      onClick={() => handleSort(key)}
      sx={{ cursor: "pointer", userSelect: "none" }}
    >
      {header}
      {sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </Box>
  );

  const columns: readonly Column<PublicServer>[] = [
    {
      key: "country",
      header: sortable("country", t("public.colCountry")),
      width: 180,
      cell: (s) => (
        <Stack direction="row" alignItems="center" gap="8px" sx={{ minWidth: 0 }}>
          <Box component="span" sx={{ fontSize: 15, lineHeight: 1 }}>
            {countryFlag(s.country_code)}
          </Box>
          <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.country}
          </Box>
        </Stack>
      ),
    },
    {
      key: "name",
      header: sortable("name", t("public.colServer")),
      cell: (s) => (
        <Box
          component="span"
          title={s.name}
          sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {s.name}
        </Box>
      ),
    },
    {
      key: "users",
      header: sortable("users", t("public.colUsers")),
      width: 110,
      align: "right",
      cell: (s) => <UsersCell ping={pings[serverKey(s)]} />,
    },
    {
      key: "ping",
      header: sortable("ping", t("public.colPing")),
      width: 110,
      align: "right",
      cell: (s) => <PingCell ping={pings[serverKey(s)]} />,
    },
    {
      key: "version",
      header: sortable("version", t("public.colVersion")),
      width: 130,
      align: "right",
      cell: (s) => <VersionCell ping={pings[serverKey(s)]} />,
    },
  ];

  return (
    <Stack
      direction="column"
      gap={2}
      sx={{ p: "24px", height: "100%", minHeight: 0, maxWidth: 1100, mx: "auto" }}
    >
      {heading}
      <Box sx={{ maxWidth: 320 }}>
        <SearchBox value={search} onChange={setSearch} placeholder={t("public.searchPlaceholder")} />
      </Box>

      {error ? (
        <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.bad })}>
          {t("public.loadingError", { error })}
        </Typography>
      ) : (
        <DataTable
          stickyHeader
          layout="fixed"
          minWidth={720}
          columns={columns}
          rows={displayed}
          rowKey={serverKey}
          onRowClick={disabled ? undefined : (s) => onConnect(s.ip, s.port)}
          empty={
            loading ? t("public.loading") : servers.length === 0 ? t("public.noResults") : t("public.noMatch")
          }
        />
      )}
    </Stack>
  );
}

/** Latency as a tone: quick, fair, slow - or nothing back yet. */
function PingCell({ ping }: Readonly<{ ping?: ServerPingResult }>) {
  if (!ping) return <Pending />;
  if (!ping.online || ping.latency_ms == null) return <Pending label="N/A" />;
  const ms = ping.latency_ms;
  const tone: StatChipTone = ms < PING_GOOD_MS ? "ok" : ms < PING_OKAY_MS ? "warn" : "bad";
  return (
    <StatChip tone={tone} sx={{ px: "8px" }}>
      {ms} ms
    </StatChip>
  );
}

function UsersCell({ ping }: Readonly<{ ping?: ServerPingResult }>) {
  if (!ping) return <Pending />;
  if (ping.user_count == null) return <Pending label="-" />;
  const max = ping.max_user_count;
  return (
    <Box component="span">
      {ping.user_count}
      {max != null && max > 0 ? `/${max}` : ""}
    </Box>
  );
}

function VersionCell({ ping }: Readonly<{ ping?: ServerPingResult }>) {
  if (!ping) return <Pending />;
  if (!ping.server_version) return <Pending label="-" />;
  return <Box component="span">{ping.server_version}</Box>;
}

/** A probe that has not answered yet - dim, so it reads as absent, not zero. */
function Pending({ label = "..." }: Readonly<{ label?: string }>) {
  return (
    <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.dim })}>
      {label}
    </Box>
  );
}
