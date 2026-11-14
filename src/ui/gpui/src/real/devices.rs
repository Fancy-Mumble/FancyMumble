//! The devices an account is on at once, as a server tells an
//! administrator of them: each described as a user's connection is.

use super::{api, user_facts};
use crate::engine::DeviceFacts;

/// Each device the server listed, with the name it gave it, in its order.
pub(super) fn listed<'a>(
    devices: impl IntoIterator<Item = (Option<&'a str>, &'a api::UserStats)>,
) -> Vec<DeviceFacts> {
    devices
        .into_iter()
        .map(|(name, stats)| described(name, stats))
        .collect()
}

/// One device: what it is called, or `Device <session>` where the server
/// gave no name, and what it knows of its connection.
fn described(name: Option<&str>, stats: &api::UserStats) -> DeviceFacts {
    let name = name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map_or_else(|| format!("Device {}", stats.session), str::to_owned);
    DeviceFacts {
        session: stats.session,
        name: name.into(),
        facts: user_facts(stats),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(session: u32, ping: u32) -> api::UserStats {
        api::UserStats {
            session,
            tcp_ping_ms: ping,
            udp_ping_ms: 0,
            online_secs: Some(90),
            idle_secs: None,
            version: Some("1.5.735".to_owned()),
            os: Some("Windows 11".to_owned()),
            address: Some("192.0.2.7".to_owned()),
            device_name: None,
            devices: Vec::new(),
        }
    }

    #[test]
    fn each_device_is_described_as_a_user_is() {
        let (laptop, phone) = (stats(11, 23), stats(12, 140));
        let devices = listed([(Some("Laptop"), &laptop), (None, &phone)]);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].session, 11);
        assert_eq!(devices[0].name.as_ref(), "Laptop");
        assert_eq!(devices[0].facts, user_facts(&laptop));
        assert_eq!(devices[1].facts, user_facts(&phone));
        assert!(
            devices[1]
                .facts
                .iter()
                .any(|(name, value)| name.as_ref() == "Ping" && value.as_ref() == "140 ms")
        );
    }

    #[test]
    fn a_device_without_a_name_is_called_by_its_session() {
        let phone = stats(12, 40);
        let devices = listed([(None, &phone), (Some("  "), &phone)]);
        assert_eq!(devices[0].name.as_ref(), "Device 12");
        assert_eq!(devices[1].name.as_ref(), "Device 12");
    }

    #[test]
    fn nobody_listed_means_no_devices() {
        assert!(listed([]).is_empty());
    }
}
