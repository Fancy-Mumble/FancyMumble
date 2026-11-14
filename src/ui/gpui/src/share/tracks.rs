//! What each video track of a share carries, as its START says it:
//! `{"v":1,"tracks":[{"mid":"0","content":"screen"}, ...]}`, the web
//! client's `buildStartPayload` (`trackContent.ts`). An empty or unreadable
//! payload is an older client's: one track, a screen.

use serde::{Deserialize, Serialize};

/// What one track shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Content {
    /// A screen or a window: the announcement does not tell them apart.
    Screen,
    /// A camera.
    Camera,
}

/// One track, by its SDP mid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Track {
    pub mid: String,
    pub content: Content,
}

/// The tracks of one share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Tracks {
    v: u32,
    pub tracks: Vec<Track>,
}

impl Tracks {
    /// A share of these, in order: the track at `n` is mid `n`.
    pub(crate) fn of(contents: impl IntoIterator<Item = Content>) -> Self {
        Self {
            v: 1,
            tracks: contents
                .into_iter()
                .enumerate()
                .map(|(at, content)| Track {
                    mid: at.to_string(),
                    content,
                })
                .collect(),
        }
    }

    /// What a START announced; an older client's says nothing.
    pub(crate) fn announced(payload: &str) -> Self {
        serde_json::from_str::<Self>(payload)
            .ok()
            .filter(|read| !read.tracks.is_empty())
            .unwrap_or_else(|| Self::of([Content::Screen]))
    }

    /// The payload of a START announcing these.
    pub(crate) fn payload(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// What the track with `mid` shows; an unannounced one shows nothing.
    pub(crate) fn content(&self, mid: &str) -> Option<Content> {
        self.tracks
            .iter()
            .find(|track| track.mid == mid)
            .map(|track| track.content)
    }

    /// The track the stage shows: the screen, else the camera.
    pub(crate) fn main(&self) -> Option<&str> {
        self.tracks
            .iter()
            .find(|track| track.content == Content::Screen)
            .or_else(|| self.tracks.first())
            .map(|track| track.mid.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_payload_is_the_web_clients_byte_for_byte() {
        // `JSON.stringify({v: 1, tracks: [...]})` in `buildStartPayload`.
        let both = Tracks::of([Content::Screen, Content::Camera]);
        assert_eq!(
            both.payload(),
            r#"{"v":1,"tracks":[{"mid":"0","content":"screen"},{"mid":"1","content":"camera"}]}"#
        );
        assert_eq!(Tracks::announced(&both.payload()), both);
    }

    #[test]
    fn an_older_clients_start_is_one_screen() {
        let legacy = Tracks::of([Content::Screen]);
        assert_eq!(Tracks::announced(""), legacy);
        assert_eq!(Tracks::announced("not json"), legacy);
        assert_eq!(Tracks::announced(r#"{"v":1,"tracks":[]}"#), legacy);
    }

    #[test]
    fn the_stage_shows_the_screen_and_a_camera_alone_when_there_is_nothing_else() {
        let camera_first = Tracks::announced(
            r#"{"v":1,"tracks":[{"mid":"0","content":"camera"},{"mid":"1","content":"screen"}]}"#,
        );
        assert_eq!(camera_first.main(), Some("1"));
        assert_eq!(camera_first.content("0"), Some(Content::Camera));
        assert_eq!(camera_first.content("2"), None);
        assert_eq!(Tracks::of([Content::Camera]).main(), Some("0"));
    }
}
