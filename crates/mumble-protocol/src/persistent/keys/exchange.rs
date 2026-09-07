//! Key exchange protocol: signature verification, receive, distribute, handle requests.

use std::collections::HashMap;
use std::time::Instant;

use ed25519_dalek::Verifier;
use x25519_dalek::PublicKey as X25519PublicKey;

use crate::error::{Error, Result};
use crate::persistent::PchatProtocol;
use crate::persistent::encryption::{self, build_key_exchange_signed_data, epoch_fingerprint};
use crate::persistent::wire::{PchatKeyExchange, PchatKeyRequest};

use super::KeyManager;
use super::types::{ALGORITHM_VERSION, ChannelKey, ConsensusCollector, KEY_EXCHANGE_FRESHNESS_MS};
use crate::persistent::KeyTrustLevel;

fn validate_timestamp_freshness(
    request_timestamp: Option<u64>,
    exchange_timestamp: u64,
) -> Result<()> {
    if let Some(req_ts) = request_timestamp {
        if exchange_timestamp < req_ts {
            return Err(Error::InvalidState(
                "key-exchange timestamp before request".into(),
            ));
        }
        if exchange_timestamp > req_ts + KEY_EXCHANGE_FRESHNESS_MS {
            return Err(Error::InvalidState(
                "key-exchange timestamp too far after request".into(),
            ));
        }
    }
    Ok(())
}

impl KeyManager {
    // ---- Key exchange signature verification ------------------------

    /// Verify the Ed25519 signature on a key-exchange payload.
    pub fn verify_key_exchange_signature(&self, exchange: &PchatKeyExchange) -> Result<()> {
        let peer = self.peer_keys.get(&exchange.sender_hash).ok_or_else(|| {
            Error::InvalidState(format!("unknown sender: {}", exchange.sender_hash))
        })?;

        if exchange.algorithm_version != peer.algorithm_version {
            return Err(Error::InvalidState(
                "algorithm_version mismatch with sender's announced version".into(),
            ));
        }

        let protocol = PchatProtocol::from_wire_str(&exchange.protocol);
        let signed_data = build_key_exchange_signed_data(
            exchange.algorithm_version,
            exchange.channel_id,
            &protocol,
            exchange.epoch,
            &exchange.encrypted_key,
            &exchange.recipient_hash,
            exchange.request_id.as_deref(),
            exchange.timestamp,
        );

        let signature = ed25519_dalek::Signature::from_slice(&exchange.signature)
            .map_err(|e| Error::InvalidState(format!("invalid signature bytes: {e}")))?;

        peer.signing_public
            .verify(&signed_data, &signature)
            .map_err(|e| Error::InvalidState(format!("key-exchange signature invalid: {e}")))
    }

    // ---- Key exchange processing ------------------------------------

    /// Process an incoming key exchange message.
    ///
    /// 1. Verifies Ed25519 signature.
    /// 2. Checks timestamp freshness.
    /// 3. Decrypts the key via DH shared secret.
    /// 4. Verifies `epoch_fingerprint` matches.
    /// 5. Verifies an inline countersignature when one is present.
    /// 6. For `FULL_ARCHIVE`: adds to consensus collector.
    ///
    /// `observed_members` is how many channel members could have answered
    /// the key request that this exchange responds to. It sets the
    /// consensus threshold, so passing a count that is too low accepts a
    /// key on fewer agreeing answers than the channel can supply.
    pub fn receive_key_exchange(
        &mut self,
        exchange: &PchatKeyExchange,
        request_timestamp: Option<u64>,
        observed_members: u32,
    ) -> Result<()> {
        self.verify_key_exchange_signature(exchange)?;
        validate_timestamp_freshness(request_timestamp, exchange.timestamp)?;

        let key_bytes = self.decrypt_exchanged_key(exchange)?;

        let computed_fp = epoch_fingerprint(&key_bytes);
        if exchange.epoch_fingerprint.len() != 8 || computed_fp != exchange.epoch_fingerprint[..8] {
            return Err(Error::InvalidState("epoch_fingerprint mismatch".into()));
        }

        // Before the key is stored: a bad countersignature rejects the
        // exchange rather than leaving the key in the collector.
        self.verify_inline_countersignature(exchange)?;

        let protocol = PchatProtocol::from_wire_str(&exchange.protocol);
        self.store_exchanged_key(
            protocol,
            exchange,
            key_bytes,
            request_timestamp,
            observed_members,
        )
    }

    fn decrypt_exchanged_key(&self, exchange: &PchatKeyExchange) -> Result<[u8; 32]> {
        let peer = self
            .peer_keys
            .get(&exchange.sender_hash)
            .ok_or_else(|| Error::InvalidState("unknown sender".into()))?;

        let shared_secret = self.identity.dh_agree(&peer.dh_public);
        let decrypt_key = self.suite.key_deriver().derive(
            &shared_secret,
            encryption::HKDF_SALT_IDENTITY,
            b"key-wrap",
        )?;

        let decrypted_key_bytes =
            self.suite
                .encryptor()
                .decrypt(&decrypt_key, &exchange.encrypted_key, &[])?;

        if decrypted_key_bytes.len() != 32 {
            return Err(Error::InvalidState(format!(
                "decrypted key is {} bytes, expected 32",
                decrypted_key_bytes.len()
            )));
        }

        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(&decrypted_key_bytes);
        Ok(key_bytes)
    }

    fn store_exchanged_key(
        &mut self,
        protocol: PchatProtocol,
        exchange: &PchatKeyExchange,
        key_bytes: [u8; 32],
        request_timestamp: Option<u64>,
        observed_members: u32,
    ) -> Result<()> {
        match protocol {
            PchatProtocol::FancyV1FullArchive => {
                if let Some(ref request_id) = exchange.request_id {
                    let collector = self
                        .pending_consensus
                        .entry(request_id.clone())
                        .or_insert_with(|| ConsensusCollector {
                            window_start: Instant::now(),
                            responses: HashMap::new(),
                            request_timestamp: request_timestamp.unwrap_or(0),
                            observed_members,
                        });
                    // Later answers can reveal a larger channel than the
                    // first one did; the threshold tracks the widest view.
                    collector.observed_members = collector.observed_members.max(observed_members);
                    let _ = collector
                        .responses
                        .insert(exchange.sender_hash.clone(), key_bytes.to_vec());
                } else {
                    let _ = self.archive_keys.insert(
                        exchange.channel_id,
                        (ChannelKey { key: key_bytes }, KeyTrustLevel::Unverified),
                    );
                }
                Ok(())
            }
            _ => Err(Error::InvalidState(format!(
                "unexpected protocol in key-exchange: {protocol:?}"
            ))),
        }
    }

    /// Verify an inline countersignature, if the exchange carries one.
    ///
    /// A countersignature that is present but does not verify is a forgery
    /// attempt, so it fails the whole exchange rather than being ignored.
    /// An exchange with no countersignature is accepted unchanged; it just
    /// does not gain the trust a valid countersignature would carry.
    fn verify_inline_countersignature(&self, exchange: &PchatKeyExchange) -> Result<()> {
        let (Some(countersig), Some(countersigner)) =
            (&exchange.countersignature, &exchange.countersigner_hash)
        else {
            return Ok(());
        };

        let parent_fp = exchange.parent_fingerprint.as_deref().unwrap_or(&[0u8; 8]);
        self.verify_countersignature_internal(
            exchange.channel_id,
            exchange.epoch,
            &exchange.epoch_fingerprint,
            parent_fp,
            countersigner,
            &exchange.sender_hash,
            exchange.timestamp,
            countersig,
        )
    }

    // ---- Key distribution -------------------------------------------

    /// Generate a key-exchange payload for distributing a key to a new member.
    #[allow(
        clippy::too_many_arguments,
        reason = "key distribution requires all cryptographic parameters"
    )]
    pub fn distribute_key(
        &self,
        channel_id: u32,
        protocol: PchatProtocol,
        epoch: u32,
        recipient_hash: &str,
        recipient_public: &X25519PublicKey,
        request_id: Option<&str>,
        timestamp: u64,
    ) -> Result<PchatKeyExchange> {
        let key_bytes = match protocol {
            PchatProtocol::FancyV1FullArchive => {
                let (channel_key, _) = self
                    .archive_keys
                    .get(&channel_id)
                    .ok_or_else(|| Error::InvalidState("no archive key".into()))?;
                channel_key.key
            }
            _ => {
                return Err(Error::InvalidState(format!(
                    "cannot distribute key for protocol {protocol:?}"
                )));
            }
        };

        // Encrypt the key to the recipient's X25519 public key via DH
        let shared_secret = self.identity.dh_agree(recipient_public);
        let wrap_key = self.suite.key_deriver().derive(
            &shared_secret,
            encryption::HKDF_SALT_IDENTITY,
            b"key-wrap",
        )?;
        let encrypted_key = self.suite.encryptor().encrypt(&wrap_key, &key_bytes, &[])?;

        // Compute fingerprints
        let efp = epoch_fingerprint(&key_bytes);
        let parent_fp = None;

        // Build and sign
        let signed_data = build_key_exchange_signed_data(
            ALGORITHM_VERSION,
            channel_id,
            &protocol,
            epoch,
            &encrypted_key,
            recipient_hash,
            request_id,
            timestamp,
        );
        let signature = self.identity.sign(&signed_data);

        Ok(PchatKeyExchange {
            channel_id,
            protocol: protocol.as_wire_str().to_string(),
            epoch,
            encrypted_key,
            sender_hash: String::new(), // caller fills in cert_hash
            recipient_hash: recipient_hash.to_string(),
            request_id: request_id.map(String::from),
            timestamp,
            algorithm_version: ALGORITHM_VERSION,
            signature: signature.to_bytes().to_vec(),
            parent_fingerprint: parent_fp,
            epoch_fingerprint: efp.to_vec(),
            countersignature: None,
            countersigner_hash: None,
        })
    }

    // ---- Key request handling ---------------------------------------

    /// Handle an incoming key request. Returns a key-exchange payload
    /// if we hold the key and have not exceeded the batch limit.
    pub fn handle_key_request(
        &mut self,
        request: &PchatKeyRequest,
        our_cert_hash: &str,
    ) -> Result<Option<PchatKeyExchange>> {
        if self.requests_processed >= self.max_requests_per_connection {
            return Ok(None);
        }

        if request.requester_public.len() != 32 {
            return Err(Error::InvalidState(
                "invalid requester public key length".into(),
            ));
        }

        let protocol = PchatProtocol::from_wire_str(&request.protocol);
        let channel_id = request.channel_id;

        // Check if we hold the key for this channel
        let has_key = match protocol {
            PchatProtocol::FancyV1FullArchive => self.archive_keys.contains_key(&channel_id),
            _ => false,
        };

        if !has_key {
            return Ok(None);
        }

        let epoch = 0;

        let mut requester_key_bytes = [0u8; 32];
        requester_key_bytes.copy_from_slice(&request.requester_public);
        let recipient_public = X25519PublicKey::from(requester_key_bytes);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let mut exchange = self.distribute_key(
            channel_id,
            protocol,
            epoch,
            &request.requester_hash,
            &recipient_public,
            Some(&request.request_id),
            now,
        )?;
        exchange.sender_hash = our_cert_hash.to_string();

        self.requests_processed += 1;
        Ok(Some(exchange))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]

    use super::super::KeyManager;
    use super::super::identity::SeedIdentity;
    use crate::persistent::wire::PchatKeyExchange;
    use crate::persistent::{KeyTrustLevel, PchatProtocol};

    const CHANNEL: u32 = 7;
    const ARCHIVE_KEY: [u8; 32] = [0x5A; 32];

    fn km(seed: u8) -> KeyManager {
        KeyManager::new(Box::new(SeedIdentity::from_seed(&[seed; 32]).unwrap()))
    }

    /// A distributes the channel's archive key to B under `request_id`.
    /// Returns the exchange and B's key manager, which already knows A.
    fn distributed(request_id: Option<&str>) -> (PchatKeyExchange, KeyManager) {
        let mut a = km(0xAA);
        let mut b = km(0xBB);
        a.store_archive_key(CHANNEL, ARCHIVE_KEY, KeyTrustLevel::Verified);

        let announce_a = a.build_key_announce("a-cert", 1_000);
        let announce_b = b.build_key_announce("b-cert", 1_000);
        assert!(b.record_peer_key(&announce_a).unwrap());
        assert!(a.record_peer_key(&announce_b).unwrap());

        let b_dh = a.get_peer("b-cert").unwrap().dh_public;
        let mut exchange = a
            .distribute_key(
                CHANNEL,
                PchatProtocol::FancyV1FullArchive,
                0,
                "b-cert",
                &b_dh,
                request_id,
                2_000,
            )
            .unwrap();
        exchange.sender_hash = "a-cert".to_string();
        (exchange, b)
    }

    #[test]
    fn an_exchange_without_a_countersignature_is_accepted() {
        let (exchange, mut b) = distributed(None);
        assert!(b.receive_key_exchange(&exchange, None, 1).is_ok());
        assert!(b.has_key(CHANNEL, PchatProtocol::FancyV1FullArchive));
    }

    /// The countersignature used to be verified and the verdict thrown
    /// away, so a forged one was worth exactly as much as a real one.
    #[test]
    fn a_forged_countersignature_rejects_the_whole_exchange() {
        let (mut exchange, mut b) = distributed(None);
        exchange.countersigner_hash = Some("a-cert".to_string());
        exchange.countersignature = Some(vec![0x11; 64]);

        let err = b.receive_key_exchange(&exchange, None, 1).unwrap_err();
        assert!(
            format!("{err}").contains("countersignature"),
            "expected a countersignature failure, got: {err}"
        );
        assert!(
            !b.has_key(CHANNEL, PchatProtocol::FancyV1FullArchive),
            "a rejected exchange must not leave the key behind"
        );
    }

    #[test]
    fn a_countersignature_from_an_unknown_signer_is_refused() {
        let (mut exchange, mut b) = distributed(None);
        exchange.countersigner_hash = Some("nobody".to_string());
        exchange.countersignature = Some(vec![0x11; 64]);

        assert!(b.receive_key_exchange(&exchange, None, 1).is_err());
    }

    /// `observed_members` used to be hard-wired to 0, which made the
    /// threshold `clamp(0, 1, 5)` == 1: one answer was enough to call a
    /// key Verified no matter how many members could have disagreed.
    #[test]
    fn one_answer_in_a_wide_channel_is_not_verified() {
        let request_id = "req-1";
        let (exchange, mut b) = distributed(Some(request_id));

        // Eight other members could have answered; one did.
        b.receive_key_exchange(&exchange, None, 8).unwrap();
        let (trust, key) = b.evaluate_consensus(request_id, CHANNEL, &[]).unwrap();

        assert_eq!(key, Some(ARCHIVE_KEY));
        assert_eq!(
            trust,
            KeyTrustLevel::Unverified,
            "one of eight possible answers must not reach Verified"
        );
    }

    #[test]
    fn one_answer_in_a_two_party_channel_is_verified() {
        let request_id = "req-2";
        let (exchange, mut b) = distributed(Some(request_id));

        // A is the only other member, so its answer is the whole channel.
        b.receive_key_exchange(&exchange, None, 1).unwrap();
        let (trust, key) = b.evaluate_consensus(request_id, CHANNEL, &[]).unwrap();

        assert_eq!(key, Some(ARCHIVE_KEY));
        assert_eq!(trust, KeyTrustLevel::Verified);
    }
}
