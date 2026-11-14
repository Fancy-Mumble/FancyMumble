use mumble_protocol::proto::mumble_tcp;

use super::{HandleMessage, HandlerContext};
use crate::state::core_event::CoreEvent;
use crate::state::types::{PacketStats, RollingStatsPayload, UserStatsPayload};

fn extract_packet_stats(stats: &Option<mumble_tcp::user_stats::Stats>) -> Option<PacketStats> {
    stats.as_ref().map(|s| PacketStats {
        good: s.good.unwrap_or(0),
        late: s.late.unwrap_or(0),
        lost: s.lost.unwrap_or(0),
        resync: s.resync.unwrap_or(0),
    })
}

/// The payload for one `UserStats` message, or `None` without a session.
///
/// Used for the reply itself and again for each entry of its `devices`: the
/// server describes every device of a multi-device account with a full
/// `UserStats` under the device's own session, so one mapping serves both.
fn user_stats_payload(stats: &mumble_tcp::UserStats) -> Option<UserStatsPayload> {
    let session = stats.session?;

    // Version / OS info (only present when the server includes details).
    let (version, os, os_version) = stats
        .version
        .as_ref()
        .map(|v| (v.release.clone(), v.os.clone(), v.os_version.clone()))
        .unwrap_or_default();

    let address = stats
        .address
        .as_ref()
        .map(|a| fancy_utils::net::format_ip_address(a));

    let rolling_stats = stats.rolling_stats.as_ref().map(|rs| RollingStatsPayload {
        time_window: rs.time_window.unwrap_or(0),
        from_client: extract_packet_stats(&rs.from_client).unwrap_or_default(),
        from_server: extract_packet_stats(&rs.from_server).unwrap_or_default(),
    });

    Some(UserStatsPayload {
        session,
        tcp_packets: stats.tcp_packets.unwrap_or(0),
        udp_packets: stats.udp_packets.unwrap_or(0),
        tcp_ping_avg: stats.tcp_ping_avg.unwrap_or(0.0),
        tcp_ping_var: stats.tcp_ping_var.unwrap_or(0.0),
        udp_ping_avg: stats.udp_ping_avg.unwrap_or(0.0),
        udp_ping_var: stats.udp_ping_var.unwrap_or(0.0),
        bandwidth: stats.bandwidth,
        onlinesecs: stats.onlinesecs,
        idlesecs: stats.idlesecs,
        // Kept as options: the server omits both unless the asker is an
        // administrator or is asking about themselves, and an absent field
        // means "not reported", not "no".  Collapsing it here is what made
        // every peer read as a weak certificate on legacy CELT.
        strong_certificate: stats.strong_certificate,
        opus: stats.opus,
        version,
        os,
        os_version,
        address,
        from_client: extract_packet_stats(&stats.from_client),
        from_server: extract_packet_stats(&stats.from_server),
        rolling_stats,
        device_name: stats.device_name.clone(),
        // Only sent to administrators, and only for an account online from
        // two or more devices; an entry without a session says nothing.
        devices: stats
            .devices
            .iter()
            .filter_map(user_stats_payload)
            .collect(),
    })
}

impl HandleMessage for mumble_tcp::UserStats {
    fn handle(&self, ctx: &HandlerContext) {
        if let Some(payload) = user_stats_payload(self) {
            ctx.send(CoreEvent::UserStats(payload));
        }
    }
}
