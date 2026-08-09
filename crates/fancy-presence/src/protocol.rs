//! Discord RPC message shapes: the handshake, `SET_ACTIVITY` payloads, and
//! the responses a standalone (no-Discord-running) server has to produce.
//!
//! Everything here is deliberately lenient. Client libraries disagree about
//! optional fields - `pypresence`, the abandoned `discord-rpc` C library and
//! the Game SDK all send slightly different `SET_ACTIVITY` bodies - so every
//! field is optional and unknown keys are ignored rather than rejected. The
//! raw JSON is always kept alongside the parsed view so bridge mode can
//! forward the original bytes to Discord untouched.

use serde::{Deserialize, Serialize};

/// Protocol version this crate speaks. Discord has only ever used `1`.
pub const PROTOCOL_VERSION: u32 = 1;

/// Values below this are epoch *seconds*, above are epoch *milliseconds*.
///
/// Discord documents activity timestamps as milliseconds, but several client
/// libraries send seconds. 1e11 ms is 1973, so no plausible millisecond
/// timestamp falls below it and no plausible second timestamp (which would
/// mean the year 5138) rises above it.
const SECONDS_VS_MILLIS_THRESHOLD: i64 = 100_000_000_000;

/// The `{ "v": 1, "client_id": "..." }` body of an [`crate::codec::Opcode::Handshake`] frame.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Handshake {
    /// Protocol version the client asked for.
    #[serde(default)]
    pub v: Option<u32>,
    /// The caller's Discord application id, as a decimal string.
    ///
    /// Some libraries send this as a JSON number, hence the untyped value and
    /// [`Handshake::application_id`] rather than a plain `String`.
    #[serde(default)]
    pub client_id: Option<serde_json::Value>,
}

impl Handshake {
    /// The application id as a string, whether it arrived as a string or a number.
    #[must_use]
    pub fn application_id(&self) -> Option<String> {
        match self.client_id.as_ref()? {
            serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    }
}

/// Start/end times driving Discord's "elapsed"/"remaining" counter.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Timestamps {
    /// When the activity started, in epoch milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<i64>,
    /// When the activity ends, in epoch milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<i64>,
}

/// Image keys and their hover text.
///
/// The image fields are *keys*, not URLs - see [`crate::assets`] for how they
/// resolve to something displayable.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Assets {
    /// Key or URL reference for the large artwork.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub large_image: Option<String>,
    /// Hover text for the large artwork.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub large_text: Option<String>,
    /// Key or URL reference for the small badge artwork.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub small_image: Option<String>,
    /// Hover text for the small badge artwork.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub small_text: Option<String>,
}

/// Group/lobby size information ("3 of 5").
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Party {
    /// Opaque party identifier chosen by the application.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// `[current, maximum]` member counts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Vec<i64>>,
}

/// A labelled link rendered under the presence card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Button {
    /// Text on the button.
    pub label: String,
    /// Where it points. Absent when the application supplied only a label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Buttons arrive either as `{label, url}` objects or as bare label strings,
/// depending on which client library produced them.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum RawButton {
    Labeled {
        label: String,
        #[serde(default)]
        url: Option<String>,
    },
    Label(String),
}

impl From<RawButton> for Button {
    fn from(raw: RawButton) -> Self {
        match raw {
            RawButton::Labeled { label, url } => Self { label, url },
            RawButton::Label(label) => Self { label, url: None },
        }
    }
}

/// A parsed rich-presence activity.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Activity {
    /// Application-supplied name. Usually absent over RPC, where the
    /// application's own name is implied by the handshake's client id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Discord activity type (0 = playing, 2 = listening, 3 = watching, ...).
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub activity_type: Option<u8>,
    /// First line of the presence card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// Second line of the presence card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// Elapsed/remaining counter bounds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamps: Option<Timestamps>,
    /// Artwork keys and hover text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assets: Option<Assets>,
    /// Party/lobby occupancy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub party: Option<Party>,
    /// Link buttons.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buttons: Option<Vec<Button>>,
    /// Stream URL for `type = 1` (streaming) activities.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl Activity {
    /// Parse an activity from a `SET_ACTIVITY` payload, tolerating the shape
    /// differences between client libraries.
    ///
    /// Returns `None` for anything that is not a JSON object, which is how
    /// applications signal "clear my presence".
    #[must_use]
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        let object = value.as_object()?;
        let mut activity = Self {
            name: string_field(object.get("name")),
            activity_type: object
                .get("type")
                .and_then(serde_json::Value::as_u64)
                .and_then(|n| u8::try_from(n).ok()),
            details: string_field(object.get("details")),
            state: string_field(object.get("state")),
            timestamps: object
                .get("timestamps")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            assets: object
                .get("assets")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            party: object
                .get("party")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            buttons: object.get("buttons").and_then(parse_buttons),
            url: string_field(object.get("url")),
        };
        activity.normalize_timestamps();
        Some(activity)
    }

    /// True when the activity carries nothing worth displaying.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.details.is_none()
            && self.state.is_none()
            && self.name.is_none()
            && self.assets.is_none()
            && self.timestamps.is_none()
    }

    /// Rewrite second-precision timestamps to milliseconds.
    fn normalize_timestamps(&mut self) {
        let Some(timestamps) = self.timestamps.as_mut() else {
            return;
        };
        timestamps.start = timestamps.start.map(to_epoch_millis);
        timestamps.end = timestamps.end.map(to_epoch_millis);
    }
}

fn to_epoch_millis(value: i64) -> i64 {
    if value.abs() < SECONDS_VS_MILLIS_THRESHOLD {
        value.saturating_mul(1000)
    } else {
        value
    }
}

fn string_field(value: Option<&serde_json::Value>) -> Option<String> {
    match value? {
        serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn parse_buttons(value: &serde_json::Value) -> Option<Vec<Button>> {
    let raw: Vec<RawButton> = serde_json::from_value(value.clone()).ok()?;
    let buttons: Vec<Button> = raw.into_iter().map(Button::from).collect();
    if buttons.is_empty() {
        None
    } else {
        Some(buttons)
    }
}

/// A parsed view of an [`crate::codec::Opcode::Frame`] message sent by a client.
#[derive(Debug, Clone)]
pub struct RpcRequest {
    /// The command name, e.g. `SET_ACTIVITY`.
    pub cmd: String,
    /// Correlation token the response must echo back.
    pub nonce: Option<serde_json::Value>,
    /// Command arguments.
    pub args: serde_json::Value,
    /// Event name, for `SUBSCRIBE`/`UNSUBSCRIBE`.
    pub evt: Option<String>,
}

impl RpcRequest {
    /// Parse a request, or `None` if the frame carries no `cmd`.
    #[must_use]
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        Some(Self {
            cmd: value.get("cmd")?.as_str()?.to_owned(),
            nonce: value.get("nonce").cloned(),
            args: value.get("args").cloned().unwrap_or(serde_json::Value::Null),
            evt: value
                .get("evt")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
        })
    }

    /// The process id the application reported, if any.
    #[must_use]
    pub fn pid(&self) -> Option<u32> {
        self.args
            .get("pid")
            .and_then(serde_json::Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
    }

    /// The raw `activity` argument of a `SET_ACTIVITY` request.
    #[must_use]
    pub fn activity_value(&self) -> Option<&serde_json::Value> {
        self.args.get("activity")
    }

    /// The response a standalone server should send for this request.
    ///
    /// Discord replies to every command; a library that gets silence blocks
    /// forever waiting for its nonce, so even commands we do not implement
    /// get a benign acknowledgement rather than nothing.
    #[must_use]
    pub fn response(&self) -> serde_json::Value {
        let data = match self.cmd.as_str() {
            "SET_ACTIVITY" => self
                .activity_value()
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            "SUBSCRIBE" | "UNSUBSCRIBE" => serde_json::json!({ "evt": self.evt }),
            _ => serde_json::Value::Null,
        };
        serde_json::json!({
            "cmd": self.cmd,
            "data": data,
            "evt": serde_json::Value::Null,
            "nonce": self.nonce.clone().unwrap_or(serde_json::Value::Null),
        })
    }
}

/// The `READY` dispatch a standalone server sends after a handshake.
///
/// Client libraries parse `data.user` and reject the connection if it is
/// missing or malformed, so this presents a complete, obviously-synthetic
/// user rather than an empty object. The id is the snowflake-shaped constant
/// below; it belongs to no real Discord account.
#[must_use]
pub fn ready_dispatch() -> serde_json::Value {
    serde_json::json!({
        "cmd": "DISPATCH",
        "evt": "READY",
        "data": {
            "v": PROTOCOL_VERSION,
            "config": {
                "cdn_host": "cdn.discordapp.com",
                "api_endpoint": "//discord.com/api",
                "environment": "production",
            },
            "user": {
                "id": "0",
                "username": "fancy-mumble",
                "discriminator": "0",
                "global_name": "Fancy Mumble",
                "avatar": serde_json::Value::Null,
                "bot": false,
                "flags": 0,
                "premium_type": 0,
            },
        },
    })
}

/// The body of a [`crate::codec::Opcode::Close`] frame.
#[must_use]
pub fn close_payload(code: i32, message: &str) -> serde_json::Value {
    serde_json::json!({ "code": code, "message": message })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_client_id_sent_as_a_number() {
        let handshake: Handshake =
            serde_json::from_value(serde_json::json!({ "v": 1, "client_id": 1234567890_u64 }))
                .expect("parse");
        assert_eq!(handshake.application_id().as_deref(), Some("1234567890"));
    }

    #[test]
    fn promotes_second_precision_timestamps_to_millis() {
        let activity = Activity::from_value(&serde_json::json!({
            "details": "In a match",
            "timestamps": { "start": 1_700_000_000_i64 },
        }))
        .expect("activity");
        let timestamps = activity.timestamps.expect("timestamps");
        assert_eq!(timestamps.start, Some(1_700_000_000_000));
    }

    #[test]
    fn leaves_millisecond_timestamps_alone() {
        let activity = Activity::from_value(&serde_json::json!({
            "timestamps": { "start": 1_700_000_000_000_i64, "end": 1_700_000_060_000_i64 },
        }))
        .expect("activity");
        let timestamps = activity.timestamps.expect("timestamps");
        assert_eq!(timestamps.start, Some(1_700_000_000_000));
        assert_eq!(timestamps.end, Some(1_700_000_060_000));
    }

    #[test]
    fn accepts_buttons_as_objects_or_bare_labels() {
        let activity = Activity::from_value(&serde_json::json!({
            "buttons": [{ "label": "Website", "url": "https://example.invalid" }, "Plain"],
        }))
        .expect("activity");
        let buttons = activity.buttons.expect("buttons");
        assert_eq!(buttons[0].label, "Website");
        assert_eq!(buttons[0].url.as_deref(), Some("https://example.invalid"));
        assert_eq!(buttons[1].label, "Plain");
        assert_eq!(buttons[1].url, None);
    }

    #[test]
    fn ignores_unknown_activity_fields() {
        let activity = Activity::from_value(&serde_json::json!({
            "details": "Something",
            "some_future_field": { "nested": true },
        }))
        .expect("activity");
        assert_eq!(activity.details.as_deref(), Some("Something"));
    }

    #[test]
    fn a_non_object_activity_means_clear_presence() {
        assert!(Activity::from_value(&serde_json::Value::Null).is_none());
    }

    #[test]
    fn echoes_the_nonce_on_every_response() {
        let request = RpcRequest::from_value(&serde_json::json!({
            "cmd": "SET_ACTIVITY",
            "nonce": "abc-123",
            "args": { "pid": 42, "activity": { "details": "d" } },
        }))
        .expect("request");

        assert_eq!(request.pid(), Some(42));
        let response = request.response();
        assert_eq!(response["nonce"], "abc-123");
        assert_eq!(response["cmd"], "SET_ACTIVITY");
        assert_eq!(response["data"]["details"], "d");
    }

    #[test]
    fn acknowledges_subscribe_with_the_event_name() {
        let request = RpcRequest::from_value(&serde_json::json!({
            "cmd": "SUBSCRIBE",
            "evt": "ACTIVITY_JOIN",
            "nonce": "n",
        }))
        .expect("request");
        assert_eq!(request.response()["data"]["evt"], "ACTIVITY_JOIN");
    }

    #[test]
    fn acknowledges_commands_it_does_not_implement() {
        let request = RpcRequest::from_value(&serde_json::json!({
            "cmd": "GET_GUILDS",
            "nonce": "n",
        }))
        .expect("request");
        let response = request.response();
        assert_eq!(response["nonce"], "n");
        assert!(response["data"].is_null());
    }
}
