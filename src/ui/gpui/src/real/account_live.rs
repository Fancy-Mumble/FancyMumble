//! The local user's own account on a live Starling, changed the way the
//! Account page changes it and each change seen where it shows: by the
//! server's answer, and by another device of the same account.
//!
//! ```text
//! FANCY_GPUI_TEST_FANCY=127.0.0.1:64970 FANCY_GPUI_TEST_SUPERUSER=<password> \
//!     cargo test -- --ignored live_fancy_the_account
//! ```
//!
//! Wants a fresh server: the account it makes is deleted at the end, but a
//! failure half way leaves it there.

use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};

use super::RealEngine;
use crate::engine::{
    AccountAck, AccountAction, AccountNews, AccountSettings, Action, CertificateTask, Connection,
    Engine, EngineEvent, SavedServer, Wanted,
};

/// The account's password once it has one.
const PASSWORD: &str = "live-account-pass-1";

/// A client of the server `FANCY_GPUI_TEST_FANCY` names, as `name` with the
/// identity `certificate`, its files in the folder `dir` names.
fn client(name: &str, certificate: &str, dir: &str) -> (RealEngine, PathBuf) {
    let address = std::env::var("FANCY_GPUI_TEST_FANCY").expect("FANCY_GPUI_TEST_FANCY");
    let (host, port) = address.rsplit_once(':').expect("host:port");
    let dir = std::env::temp_dir().join(format!("fancy-gpui-account-{dir}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let engine = RealEngine::start(&dir).expect("the engine starts");
    engine.save_server(SavedServer {
        id: "live".into(),
        label: "live".into(),
        host: host.to_owned().into(),
        port: port.parse().expect("a port"),
        username: name.to_owned().into(),
        certificate: Some(certificate.to_owned().into()),
        favorite: false,
    });
    (engine, dir)
}

/// Another device of the account `from` is on: the same identity, carried
/// over to an engine of its own (which is a device key of its own).
fn second_device(from: &RealEngine, from_dir: &std::path::Path, dir: &str) -> (RealEngine, PathBuf) {
    let carried = from_dir.join(format!("carried-{dir}.json"));
    from.manage_certificate(CertificateTask::Export {
        label: "acctowner".to_owned(),
        to: carried.clone(),
    });
    wait_for("the export", || carried.exists());
    let (device, device_dir) = client("AcctOwner", "acctowner", dir);
    device.manage_certificate(CertificateTask::Import(carried));
    wait_for("the import", || {
        device.certificates().iter().any(|label| label == "acctowner")
    });
    (device, device_dir)
}

#[track_caller]
fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// What one engine was told, kept until it is looked for.
struct Ear {
    events: async_channel::Receiver<EngineEvent>,
    heard: Vec<EngineEvent>,
}

impl Ear {
    fn of(engine: &RealEngine) -> Self {
        Self {
            events: engine.events(),
            heard: Vec::new(),
        }
    }

    /// Wait for the first thing heard that `pick` takes, and take it and
    /// everything before it.
    #[track_caller]
    fn wait<T>(&mut self, what: &str, mut pick: impl FnMut(&EngineEvent) -> Option<T>) -> T {
        let mut found = None;
        wait_for(what, || {
            self.heard.extend(std::iter::from_fn(|| self.events.try_recv().ok()));
            if let Some(at) = self.heard.iter().position(|event| pick(event).is_some()) {
                found = pick(&self.heard[at]);
                let _ = self.heard.drain(..=at);
            }
            found.is_some()
        });
        found.expect("found")
    }

    /// The server's answer to the change `id`.
    #[track_caller]
    fn ack(&mut self, id: u32) -> AccountAck {
        self.wait("the server's answer", |event| match event {
            EngineEvent::Account(AccountNews::Ack(ack)) if ack.action == id => Some(ack.clone()),
            _ => None,
        })
    }

    /// The account as the server next says it stands, once `holds` is true
    /// of it.
    #[track_caller]
    fn account(&mut self, holds: impl Fn(&AccountSettings) -> bool) -> AccountSettings {
        self.wait("the account", |event| match event {
            EngineEvent::Account(AccountNews::Settings(account)) if holds(account) => {
                Some(account.clone())
            }
            _ => None,
        })
    }
}

/// Ask `action` of the server on `engine`, proved with the password where
/// it has one, and wait for its answer; it must be done.
#[track_caller]
fn done(engine: &RealEngine, ear: &mut Ear, action: AccountAction, proof: Option<&str>) -> AccountAck {
    let id = action.id();
    engine.update_account(action, proof.map(str::to_owned));
    let ack = ear.ack(id);
    assert!(ack.ok, "refused: {:?}", ack.error);
    ack
}

/// The code an authenticator shows for `secret` at `at` seconds since
/// 1970: RFC 6238 with SHA-1, six digits, thirty seconds, as Starling makes
/// its secrets (the provisioning link says so).
fn code(secret: &str, at: u64) -> String {
    let key = data_encoding::BASE32_NOPAD
        .decode(secret.trim_end_matches('=').as_bytes())
        .expect("a base32 secret");
    let mut mac = Hmac::<sha1::Sha1>::new_from_slice(&key).expect("any key");
    mac.update(&(at / 30).to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = usize::from(digest[19] & 0x0f);
    let value = u32::from_be_bytes([
        digest[offset] & 0x7f,
        digest[offset + 1],
        digest[offset + 2],
        digest[offset + 3],
    ]);
    format!("{:06}", value % 1_000_000)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("after 1970")
        .as_secs()
}

/// A code of a thirty seconds other than `used`'s: one code is good once.
fn fresh_code(secret: &str, used: &str) -> String {
    wait_for("the next code", || code(secret, now()) != used);
    code(secret, now())
}

#[test]
fn the_code_is_the_one_rfc_6238_gives() {
    // RFC 6238, appendix B, SHA-1 at 59 seconds: 94287082, the last six.
    let secret = data_encoding::BASE32_NOPAD.encode(b"12345678901234567890");
    assert_eq!(code(&secret, 59), "287082");
    assert_eq!(code(&secret, 1_111_111_109), "081804");
}

/// Register, set a password, enrol a second factor, rename a device and
/// sign another out, take both off again and delete the registration;
/// each change seen by the server's answer and, where it shows anywhere
/// else, by another device of the account.
#[test]
#[ignore = "needs a live Starling and its SuperUser password"]
fn live_fancy_the_account_is_changed_and_another_device_sees_it() {
    let superuser = std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
    let (admin, admin_dir) = client("SuperUser", "acctadmin", "admin");
    admin.connect("live", Some(superuser));
    let (owner, owner_dir) = client("AcctOwner", "acctowner", "owner");
    owner.connect("live", None);
    wait_for("both on", || {
        admin.snapshot().users.len() >= 2 && owner.snapshot().users.len() >= 2
    });

    // Registered by the administrator, and back as the account it is.
    let session = owner.snapshot().own_session.expect("on");
    admin.act(Action::Register { session });
    wait_for("the account", || {
        owner.snapshot().users.iter().any(|user| user.session == session && user.account.is_some())
    });
    owner.disconnect();
    wait_for("off", || owner.snapshot().own_session.is_none());
    owner.connect("live", None);
    wait_for("back", || owner.snapshot().connection == Connection::Connected);
    wait_for("the page offered", || owner.account_offered());
    let mut ear = Ear::of(&owner);
    owner.update_account(AccountAction::Query, None);
    let account = ear.account(|account| account.registered);
    assert_eq!(account.name.as_deref(), Some("AcctOwner"));
    assert!(!account.has_password);

    // A password: from now on it is asked for on connecting, and for
    // every change.
    let _ = done(&owner, &mut ear, AccountAction::SetPassword(PASSWORD.into()), None);
    assert!(ear.account(|account| account.has_password).has_password);
    let refused = {
        owner.update_account(AccountAction::SetEmail("acct@example.org".into()), Some("wrong".into()));
        ear.ack(AccountAction::SetEmail(String::new()).id())
    };
    assert!(!refused.ok, "a wrong password proves nothing");
    let (second, second_dir) = second_device(&owner, &owner_dir, "second");
    let mut second_ear = Ear::of(&second);
    second.connect("live", None);
    second_ear.wait("asked for the password", |event| {
        matches!(event, EngineEvent::Wanted(Wanted::Password)).then_some(())
    });
    second.connect("live", Some(PASSWORD.into()));
    wait_for("the second device on", || second.snapshot().connection == Connection::Connected);
    second.update_account(AccountAction::Query, None);
    let seen = second_ear.account(|account| account.devices.len() >= 2);
    assert!(seen.has_password, "the second device sees the password");
    let second_id = seen.this_device.clone().expect("the second device is named");

    // The second device renamed from the first, and seen so on the second.
    let _ = done(
        &owner,
        &mut ear,
        AccountAction::RenameDevice {
            device: second_id.clone(),
            name: "Second".into(),
        },
        Some(PASSWORD),
    );
    second.update_account(AccountAction::Query, None);
    let _ = second_ear.account(|account| {
        account.devices.iter().any(|device| device.id == second_id && device.name == "Second")
    });

    // A second factor, enrolled with the code the secret gives.
    let begun = done(&owner, &mut ear, AccountAction::TotpBegin, Some(PASSWORD));
    let secret = begun.totp_secret.expect("a secret");
    let uri = begun.totp_uri.unwrap_or_default();
    assert!(uri.starts_with("otpauth://totp/"), "a link to scan: {uri}");
    let first_code = code(&secret, now());
    let _ = done(&owner, &mut ear, AccountAction::TotpVerify(first_code.clone()), Some(PASSWORD));
    assert!(ear.account(|account| account.totp_enabled).totp_enabled);
    // A device the account has never been on is asked for the code too.
    let (third, third_dir) = second_device(&owner, &owner_dir, "third");
    let mut third_ear = Ear::of(&third);
    third.connect("live", Some(PASSWORD.into()));
    third_ear.wait("asked for the code", |event| {
        matches!(event, EngineEvent::Wanted(Wanted::Code)).then_some(())
    });
    let third_code = fresh_code(&secret, &first_code);
    third.connect_with_code("live", Some(PASSWORD.into()), Some(third_code.clone()));
    wait_for("the third device on", || third.snapshot().connection == Connection::Connected);
    third.disconnect();

    // The second device signed out from the first: off, and listed no more.
    let _ = done(&owner, &mut ear, AccountAction::RemoveDevice(second_id.clone()), Some(PASSWORD));
    wait_for("the second device put off", || {
        second.snapshot().connection != Connection::Connected
    });
    let after = ear.account(|account| !account.devices.iter().any(|device| device.id == second_id));
    assert!(after.devices_locked);

    // Both taken off again, and the registration deleted.
    let off_code = fresh_code(&secret, &third_code);
    let _ = done(&owner, &mut ear, AccountAction::TotpDisable(off_code), Some(PASSWORD));
    assert!(!ear.account(|account| !account.totp_enabled).totp_enabled);
    let _ = done(&owner, &mut ear, AccountAction::ClearPassword, Some(PASSWORD));
    assert!(!ear.account(|account| !account.has_password).has_password);
    let _ = done(&owner, &mut ear, AccountAction::Unregister, None);
    let _ = ear.account(|account| !account.registered);

    for (engine, dir) in [
        (admin, admin_dir),
        (owner, owner_dir),
        (second, second_dir),
        (third, third_dir),
    ] {
        engine.shutdown();
        let _ = std::fs::remove_dir_all(dir);
    }
}
