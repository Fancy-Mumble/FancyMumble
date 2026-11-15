//! Server administration actions: kick, ban, register, mute, deafen,
//! priority speaker, user stats, user list, ban list, and ACL management.

use mumble_protocol::command;
use mumble_protocol::proto::mumble_tcp;

use super::AppState;
use super::types::{AclInput, BanEntryInput, RegisteredUserUpdate};

impl AppState {
    pub async fn kick_user(&self, session: u32, reason: Option<String>) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::KickUser { session, reason })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn ban_user(&self, session: u32, reason: Option<String>) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::BanUser { session, reason })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn register_user(&self, session: u32) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::RegisterUser { session })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn mute_user(&self, session: u32, muted: bool) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::SetUserMute { session, muted })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn deafen_user(&self, session: u32, deafened: bool) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::SetUserDeaf { session, deafened })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn set_priority_speaker(&self, session: u32, priority: bool) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::SetPrioritySpeaker { session, priority })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn reset_user_comment(&self, session: u32) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::ResetUserComment { session })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn remove_user_avatar(&self, session: u32) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::RemoveUserAvatar { session })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    /// Move another user to a different channel (admin action).
    /// Requires the `Move` permission on both source and destination
    /// channels (or `MoveAll` server-wide).
    pub async fn move_user(&self, session: u32, channel_id: u32) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::MoveUser {
                    session,
                    channel_id,
                })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn move_channel_users(
        &self,
        from_channel_id: u32,
        to_channel_id: u32,
    ) -> Result<(), String> {
        let (handle, sessions) = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            let handle = state.conn.client_handle.clone();
            let sessions: Vec<u32> = state
                .users
                .values()
                .filter(|u| u.channel_id == from_channel_id)
                .map(|u| u.session)
                .collect();
            (handle, sessions)
        };
        let h = handle.ok_or_else(|| "Not connected".to_string())?;
        for session in sessions {
            h.send(command::MoveUser {
                session,
                channel_id: to_channel_id,
            })
            .await
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn request_user_stats(&self, session: u32) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::RequestUserStats { session })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn request_user_list(&self) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::RequestUserList)
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn request_user_comment(&self, user_id: u32) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or_else(|| "Not connected".to_owned())?;
        handle
            .send(command::RequestBlob {
                session_texture: vec![],
                session_comment: vec![],
                channel_description: vec![],
                user_id_comment: vec![user_id],
            })
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn update_user_list(&self, users: Vec<RegisteredUserUpdate>) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let entries = users
            .into_iter()
            .map(|u| command::UserListEntry {
                user_id: u.user_id,
                name: u.name,
            })
            .collect();
        match handle {
            Some(h) => h
                .send(command::UpdateUserList { users: entries })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn request_ban_list(&self) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::RequestBanList)
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn update_ban_list(&self, bans: Vec<BanEntryInput>) -> Result<(), String> {
        let entries = bans
            .into_iter()
            .map(BanEntryInput::into_wire)
            .collect::<Result<Vec<_>, String>>()?;

        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::SendBanList { bans: entries })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn request_acl(&self, channel_id: u32) -> Result<(), String> {
        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::RequestAcl { channel_id })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }

    pub async fn update_acl(&self, acl: AclInput) -> Result<(), String> {
        use mumble_protocol::proto::mumble_tcp;

        let groups: Vec<mumble_tcp::acl::ChanGroup> = acl
            .groups
            .into_iter()
            .map(|g| mumble_tcp::acl::ChanGroup {
                name: g.name,
                inherited: Some(g.inherited),
                inherit: Some(g.inherit),
                inheritable: Some(g.inheritable),
                add: g.add,
                remove: g.remove,
                inherited_members: g.inherited_members,
                color: g.color,
                icon: g.icon,
                style_preset: g.style_preset,
                metadata: g
                    .metadata
                    .into_iter()
                    .map(|(key, value)| mumble_tcp::acl::chan_group::KeyValue {
                        key,
                        value: Some(value),
                    })
                    .collect(),
            })
            .collect();

        let acls: Vec<mumble_tcp::acl::ChanAcl> = acl
            .acls
            .into_iter()
            .map(|a| mumble_tcp::acl::ChanAcl {
                apply_here: Some(a.apply_here),
                apply_subs: Some(a.apply_subs),
                inherited: Some(a.inherited),
                user_id: a.user_id,
                group: a.group,
                grant: Some(a.grant),
                deny: Some(a.deny),
            })
            .collect();

        let handle = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        match handle {
            Some(h) => h
                .send(command::SendAcl {
                    channel_id: acl.channel_id,
                    inherit_acls: acl.inherit_acls,
                    groups,
                    acls,
                })
                .await
                .map_err(|e| e.to_string()),
            None => Err("Not connected".into()),
        }
    }
}

/// The bits of the sixteen bytes every ban address travels in.
const WIRE_BITS: u32 = 128;

impl BanEntryInput {
    /// The entry as the server's `BanList` carries it.
    ///
    /// `mask` is already the wire's count over the sixteen address bytes
    /// (one IPv4 address is 128): the web UI turns it in `banMask.ts`, the
    /// native client in its `bans.rs`. A count past 128 is no mask at all.
    ///
    /// # Errors
    ///
    /// When the address is not one, or the mask counts past 128.
    pub(crate) fn into_wire(self) -> Result<mumble_tcp::ban_list::BanEntry, String> {
        let address = fancy_utils::net::parse_ip_to_bytes(&self.address)?;
        if self.mask > WIRE_BITS {
            return Err(format!(
                "A ban mask counts at most {WIRE_BITS} bits, not {}.",
                self.mask
            ));
        }
        let some = |text: String| (!text.is_empty()).then_some(text);
        Ok(mumble_tcp::ban_list::BanEntry {
            address,
            mask: self.mask,
            name: some(self.name),
            hash: some(self.hash),
            reason: some(self.reason),
            start: some(self.start),
            duration: (self.duration != 0).then_some(self.duration),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(address: &str, mask: u32) -> BanEntryInput {
        BanEntryInput {
            address: address.into(),
            mask,
            name: "n".into(),
            hash: String::new(),
            reason: String::new(),
            start: String::new(),
            duration: 0,
        }
    }

    #[test]
    fn one_ipv4_address_goes_out_mapped_with_its_wire_count() {
        let wire = entry("203.0.113.7", 128).into_wire();
        let wire = wire.as_ref().map(|ban| (ban.address.clone(), ban.mask));
        let mut mapped = vec![0u8; 10];
        mapped.extend([0xff, 0xff, 203, 0, 113, 7]);
        assert_eq!(wire, Ok((mapped, 128)));
    }

    #[test]
    fn an_ipv4_network_and_an_ipv6_one_go_out_as_they_are() {
        assert_eq!(entry("10.0.0.0", 120).into_wire().map(|b| b.mask), Ok(120));
        assert_eq!(entry("2001:db8::", 48).into_wire().map(|b| b.mask), Ok(48));
        assert_eq!(entry("2001:db8::1", 128).into_wire().map(|b| b.mask), Ok(128));
    }

    #[test]
    fn a_mask_past_the_address_is_refused() {
        assert!(entry("2001:db8::1", 129).into_wire().is_err());
        assert!(entry("not an address", 128).into_wire().is_err());
    }

    #[test]
    fn empty_fields_are_left_off_the_wire() {
        let ban = entry("203.0.113.7", 128).into_wire();
        let ban = ban.as_ref().map(|b| (b.name.clone(), b.hash.clone(), b.duration));
        assert_eq!(ban, Ok((Some("n".into()), None, None)));
    }
}
