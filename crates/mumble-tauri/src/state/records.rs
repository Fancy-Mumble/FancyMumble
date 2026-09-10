//! The account's record store, client side: ask, and wait for the answer.
//!
//! Records are what this account keeps on the server for itself - the
//! document library, the citation master list, the calendar. They replace the
//! file-server plugin's `/me/storage`, which only existed because the server
//! offered nowhere else to put them; see `STORAGE-UNIFICATION.md` D4.
//!
//! Everything here is one round trip correlated by `request_id`, for the same
//! reason the file grants are: the answers arrive as unordered pushes, and
//! opening a document while the calendar is still loading puts two in flight.

use std::collections::HashMap;

use mumble_protocol::command;
use mumble_protocol::proto::fancy;
use tokio::sync::oneshot;

use super::AppState;

/// How long to wait for an answer before giving up.
///
/// A record is a single small row on the server's own disk, so an answer that
/// has not arrived in this long is not slow - it is a server that does not
/// have the store at all, and the caller needs to hear that rather than sit
/// here. Generous relative to the work so a loaded server is never called
/// absent.
const RECORD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// What the server said about one record request.
#[derive(Debug)]
pub(crate) enum RecordOutcome {
    /// The record as it now stands. `found` false is an absent record, which
    /// is the ordinary answer on a first run and not an error.
    Record(Box<fancy::domain::Record>),
    /// The keys under a prefix.
    Keys(Vec<String>),
    /// The server declined, and this is the sentence for it.
    Refused(String),
}

/// In-flight record requests.
#[derive(Default)]
pub(crate) struct Records {
    /// Waiters keyed by the `request_id` they were sent with.
    waiters: HashMap<String, oneshot::Sender<RecordOutcome>>,
    /// Whether this server has ever answered a record frame.
    ///
    /// `None` until something asks. A server too old for the store never
    /// answers at all, so silence is the only signal there is - and it is
    /// worth remembering, because it decides whether the client offers to
    /// keep a library at all rather than making every read wait out the
    /// timeout again.
    available: Option<bool>,
}

impl Records {
    /// Register a waiter for `request_id` and hand back its receiver.
    pub(crate) fn expect(&mut self, request_id: &str) -> oneshot::Receiver<RecordOutcome> {
        let (tx, rx) = oneshot::channel();
        let _ = self.waiters.insert(request_id.to_owned(), tx);
        rx
    }

    /// Resolve the waiter for `request_id`, if one is still listening.
    pub(crate) fn resolve(&mut self, request_id: &str, outcome: RecordOutcome) {
        if let Some(waiter) = self.waiters.remove(request_id) {
            let _ = waiter.send(outcome);
        }
    }

    /// Give up on a request whose answer never came.
    pub(crate) fn forget(&mut self, request_id: &str) {
        let _ = self.waiters.remove(request_id);
    }

    /// Note that this server does - or does not - keep records.
    pub(crate) fn set_available(&mut self, available: bool) {
        self.available = Some(available);
    }

    /// What asking has shown, or `None` while nothing has asked yet.
    pub(crate) fn available(&self) -> Option<bool> {
        self.available
    }
}

/// One record, as the frontend sees it.
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct StoredRecord {
    /// The value, as UTF-8. Records are JSON documents in every caller this
    /// client has; bytes that are not valid UTF-8 come back as `None` rather
    /// than lossily, so a caller cannot mistake mangled text for its data.
    pub value: Option<String>,
    /// False when there is no such record - a normal first run.
    pub found: bool,
    /// When it was last written, in milliseconds.
    #[serde(rename = "updatedAtMs")]
    pub updated_at_ms: u64,
}

impl AppState {
    /// Read one of this account's records.
    ///
    /// # Errors
    ///
    /// The server's refusal, or a message when nothing answered.
    pub async fn record_get(&self, key: String) -> Result<StoredRecord, String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (handle, waiting) = self.expect_record(&request_id)?;
        if let Err(error) = handle
            .send(command::SendFancyRecordGet {
                request_id: request_id.clone(),
                key,
            })
            .await
        {
            self.forget_record_request(&request_id);
            return Err(format!("could not ask for the record: {error}"));
        }
        match self.wait_for_record(&request_id, waiting).await? {
            RecordOutcome::Record(record) => Ok(stored(&record)),
            RecordOutcome::Keys(_) => Err("the server answered a read with a listing".to_owned()),
            RecordOutcome::Refused(reason) => Err(reason),
        }
    }

    /// Store one of this account's records.
    ///
    /// # Errors
    ///
    /// The server's refusal - which is where a value past the ceiling lands,
    /// with the ceiling in the message - or a message when nothing answered.
    pub async fn record_put(&self, key: String, value: String) -> Result<StoredRecord, String> {
        self.write_record(key, value.into_bytes(), false).await
    }

    /// Remove one of this account's records.
    ///
    /// # Errors
    ///
    /// As [`AppState::record_put`].
    pub async fn record_remove(&self, key: String) -> Result<StoredRecord, String> {
        self.write_record(key, Vec::new(), true).await
    }

    /// The shared half of put and remove.
    async fn write_record(
        &self,
        key: String,
        value: Vec<u8>,
        remove: bool,
    ) -> Result<StoredRecord, String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (handle, waiting) = self.expect_record(&request_id)?;
        if let Err(error) = handle
            .send(command::SendFancyRecordPut {
                request_id: request_id.clone(),
                key,
                value,
                remove,
            })
            .await
        {
            self.forget_record_request(&request_id);
            return Err(format!("could not store the record: {error}"));
        }
        match self.wait_for_record(&request_id, waiting).await? {
            RecordOutcome::Record(record) => Ok(stored(&record)),
            RecordOutcome::Keys(_) => Err("the server answered a write with a listing".to_owned()),
            RecordOutcome::Refused(reason) => Err(reason),
        }
    }

    /// Which of this account's records start with `prefix`.
    ///
    /// # Errors
    ///
    /// As [`AppState::record_get`].
    pub async fn record_list(&self, prefix: String) -> Result<Vec<String>, String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (handle, waiting) = self.expect_record(&request_id)?;
        if let Err(error) = handle
            .send(command::SendFancyRecordList {
                request_id: request_id.clone(),
                prefix,
            })
            .await
        {
            self.forget_record_request(&request_id);
            return Err(format!("could not list the records: {error}"));
        }
        match self.wait_for_record(&request_id, waiting).await? {
            RecordOutcome::Keys(keys) => Ok(keys),
            RecordOutcome::Record(_) => {
                Err("the server answered a listing with one record".to_owned())
            }
            RecordOutcome::Refused(reason) => Err(reason),
        }
    }

    /// Whether this server keeps records, as far as anything has found out.
    ///
    /// `None` while nothing has asked. A caller that needs an answer asks for
    /// a record and reads the result; this is for the surfaces that only want
    /// to know whether to offer the feature.
    pub fn records_available(&self) -> Option<bool> {
        let session = self.inner.snapshot();
        let state = session.lock().ok()?;
        state.records.available()
    }

    /// Register a waiter, and take the handle to send on.
    fn expect_record(
        &self,
        request_id: &str,
    ) -> Result<(super::ClientHandle, oneshot::Receiver<RecordOutcome>), String> {
        let session = self.inner.snapshot();
        let mut state = session.lock().map_err(|e| e.to_string())?;
        let handle = state.conn.client_handle.clone().ok_or("Not connected")?;
        let waiting = state.records.expect(request_id);
        Ok((handle, waiting))
    }

    /// Wait for the answer to a request already sent.
    async fn wait_for_record(
        &self,
        request_id: &str,
        waiting: oneshot::Receiver<RecordOutcome>,
    ) -> Result<RecordOutcome, String> {
        match tokio::time::timeout(RECORD_TIMEOUT, waiting).await {
            Ok(Ok(outcome)) => Ok(outcome),
            Ok(Err(_)) => {
                self.forget_record_request(request_id);
                Err("the connection dropped while waiting for the record".to_owned())
            }
            Err(_) => {
                self.forget_record_request(request_id);
                // Silence is what a server without the store sounds like, so
                // it is recorded as one rather than made to happen again on
                // the next read.
                self.note_records_unanswered();
                Err("this server does not keep per-account records".to_owned())
            }
        }
    }

    /// Drop a waiter whose answer is no longer wanted.
    fn forget_record_request(&self, request_id: &str) {
        let session = self.inner.snapshot();
        if let Ok(mut state) = session.lock() {
            state.records.forget(request_id);
        }
    }

    /// Record that a request went unanswered, unless something already proved
    /// the store is there.
    fn note_records_unanswered(&self) {
        let session = self.inner.snapshot();
        if let Ok(mut state) = session.lock()
            && state.records.available().is_none()
        {
            state.records.set_available(false);
        }
    }
}

/// One wire record as the frontend sees it.
fn stored(record: &fancy::domain::Record) -> StoredRecord {
    StoredRecord {
        value: record
            .found
            .then(|| String::from_utf8(record.value.clone()).ok())
            .flatten(),
        found: record.found,
        updated_at_ms: record.updated_at_ms,
    }
}
