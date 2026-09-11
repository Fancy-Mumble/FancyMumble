/** Per-user ping / packet statistics returned by the server on each Ping
 *  exchange. */

/** UDP crypto packet counters. */
export interface PacketStats {
  good: number;
  late: number;
  lost: number;
  resync: number;
}

/** Crypto stats payload emitted on each Ping exchange. */
export interface CryptoStats {
  /** Our local decrypt stats (packets we received/decoded). */
  from_client: PacketStats;
  /** Server-reported stats for packets it sent to us. */
  to_client: PacketStats;
}

/** Rolling-window packet statistics. */
export interface RollingStats {
  /** Rolling window duration in seconds. */
  time_window: number;
  from_client: PacketStats;
  from_server: PacketStats;
}

/** Ping and connection statistics for a user, returned by the server. */
export interface UserStats {
  session: number;
  tcp_packets: number;
  udp_packets: number;
  tcp_ping_avg: number;
  tcp_ping_var: number;
  udp_ping_avg: number;
  udp_ping_var: number;
  bandwidth: number | null;
  onlinesecs: number | null;
  idlesecs: number | null;
  /** Whether the certificate is strong, or null when the server did not say:
   *  it reports this only to admins and to the person themselves. */
  strong_certificate: boolean | null;
  /** Whether the client speaks Opus, or null when the server did not say.
   *  Gated exactly as `strong_certificate` is. */
  opus: boolean | null;
  /** Client version string (e.g. "1.5.517"). */
  version?: string | null;
  /** Operating system name. */
  os?: string | null;
  /** Operating system version. */
  os_version?: string | null;
  /** Client IP address (formatted). Only present for admins. */
  address?: string | null;
  /** Total UDP crypto stats: packets received from the client. */
  from_client?: PacketStats | null;
  /** Total UDP crypto stats: packets sent to the client. */
  from_server?: PacketStats | null;
  /** Rolling-window packet statistics. */
  rolling_stats?: RollingStats | null;
}
