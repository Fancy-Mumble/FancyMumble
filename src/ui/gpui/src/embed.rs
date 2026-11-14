//! What a link in a message can show in its place, and fetching that from
//! the web.
//!
//! A link can be a picture, or name one through the card the server made
//! of it, or be a `YouTube` video. Showing any of these from where it lives
//! tells that host who is reading, and when, so nothing here is fetched
//! unless the reader asked for it, or trusted the host. What the server
//! sent with its card contacts nobody and is shown as it is.

use std::time::Duration;

use gpui::SharedString;
use url::Url;

use crate::engine::Preview;

/// The most a fetched picture may be, in bytes.
pub(crate) const PICTURE_MOST: usize = 10 << 20;
/// The most what tells a video's title may be, in bytes.
pub(crate) const TITLE_MOST: usize = 64 << 10;
/// How long a host is given to answer and send it all.
const WITHIN: Duration = Duration::from_secs(15);

/// What a link shows in its place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Embed {
    /// A picture at `url`. `alone` when it is the link's whole point: it
    /// stands in for the card, rather than under it.
    Picture { url: SharedString, alone: bool },
    /// A `YouTube` video, by its eleven-letter name.
    YouTube { id: SharedString },
}

impl Embed {
    /// What the link `link` shows, given what the server made of it.
    pub(crate) fn of(link: &str, preview: Option<&Preview>) -> Option<Self> {
        if let Some(id) = youtube_id(link) {
            return Some(Self::YouTube { id: id.into() });
        }
        if is_picture_address(link) {
            return Some(Self::Picture {
                url: link.to_owned().into(),
                alone: true,
            });
        }
        let preview = preview?;
        let named = preview.picture_url.clone()?;
        let picture = matches!(
            preview.kind.as_ref().map(AsRef::as_ref),
            Some("image" | "gifv")
        );
        // A card with a picture the server sent shows that, and asks for
        // nothing more: the web does the same.
        (picture || preview.picture.is_none()).then_some(Self::Picture {
            url: named,
            alone: picture,
        })
    }

    /// Whether this takes the place of the server's card.
    pub(crate) fn replaces_card(&self) -> bool {
        match self {
            Self::Picture { alone, .. } => *alone,
            Self::YouTube { .. } => true,
        }
    }

    /// The host that learns who is reading once this is fetched.
    pub(crate) fn host(&self) -> Option<String> {
        match self {
            Self::Picture { url, .. } => host_of(url),
            Self::YouTube { .. } => Some("www.youtube.com".to_owned()),
        }
    }
}

/// The host of the web address `url`, in lower case.
pub(crate) fn host_of(url: &str) -> Option<String> {
    let url = web(url)?;
    url.host_str().map(str::to_ascii_lowercase)
}

/// `url`, if it is a web address.
fn web(url: &str) -> Option<Url> {
    Url::parse(url)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
}

/// The name of the `YouTube` video `url` leads to, as the web client knows
/// them: `watch?v=`, `shorts/`, `embed/`, `v/` and `youtu.be/`.
pub(crate) fn youtube_id(url: &str) -> Option<String> {
    let url = web(url)?;
    let host = url.host_str()?.to_ascii_lowercase();
    let mut path = url.path_segments()?;
    let id = if host == "youtu.be" {
        path.next()?.to_owned()
    } else if host == "youtube.com" || host.ends_with(".youtube.com") {
        match path.next()? {
            "watch" => url
                .query_pairs()
                .find_map(|(key, value)| (key == "v").then(|| value.into_owned()))?,
            "shorts" | "embed" | "v" => path.next()?.to_owned(),
            _ => return None,
        }
    } else {
        return None;
    };
    let named = id.len() == 11
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
    named.then_some(id)
}

/// Whether `url` is a picture's own address, by the kind of file it names.
pub(crate) fn is_picture_address(url: &str) -> bool {
    let Some(url) = web(url) else {
        return false;
    };
    let name = url.path().rsplit('/').next().unwrap_or_default();
    let kind = name
        .rsplit_once('.')
        .map(|(_, kind)| kind.to_ascii_lowercase());
    matches!(
        kind.as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp")
    )
}

/// Where `YouTube` keeps what is shown of the video `id` before it plays.
pub(crate) mod youtube {
    /// The page the video is watched on.
    pub(crate) fn watch(id: &str) -> String {
        format!("https://www.youtube.com/watch?v={id}")
    }

    /// Its still, 480 by 360.
    pub(crate) fn still(id: &str) -> String {
        format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")
    }

    /// Where its title is told.
    pub(crate) fn about(id: &str) -> String {
        format!(
            "https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch%3Fv%3D{id}"
        )
    }

    /// The title out of what [`about`] answers.
    pub(crate) fn title(about: &[u8]) -> Option<String> {
        let about: serde_json::Value = serde_json::from_slice(about).ok()?;
        let title = about.get("title")?.as_str()?.trim();
        (!title.is_empty()).then(|| title.to_owned())
    }
}

/// What came of fetching something: its bytes, or why there are none.
pub(crate) type Fetched = Result<Vec<u8>, String>;

/// Fetches from the web. The answer comes back on the channel returned.
pub(crate) trait Fetch: Send + Sync {
    /// Fetch `url`, giving up past `most` bytes.
    fn fetch(&self, url: &str, most: usize) -> async_channel::Receiver<Fetched>;
}

/// Fetching from the web itself, through the engine.
#[derive(Debug, Default)]
pub(crate) struct Web;

impl Fetch for Web {
    /// On a thread of its own, which ends with the fetch: they are few,
    /// and each one asked for.
    fn fetch(&self, url: &str, most: usize) -> async_channel::Receiver<Fetched> {
        let (tell, told) = async_channel::bounded(1);
        let url = url.to_owned();
        let spawned = std::thread::Builder::new()
            .name("fetch".to_owned())
            .spawn(move || {
                let fetched = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|error| error.to_string())
                    .and_then(|runtime| {
                        runtime.block_on(mumble_tauri_lib::engine_api::EngineHandle::fetch_web(
                            &url, most, WITHIN,
                        ))
                    })
                    .map(|file| file.bytes);
                let _ = tell.send_blocking(fetched);
            });
        if let Err(error) = spawned {
            tracing::warn!(%error, "no thread to fetch on");
        }
        told
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn preview(kind: Option<&'static str>, named: Option<&'static str>, sent: bool) -> Preview {
        Preview {
            url: "https://example.org/page".into(),
            picture: sent
                .then(|| Arc::new(gpui::Image::from_bytes(gpui::ImageFormat::Png, vec![1]))),
            kind: kind.map(Into::into),
            picture_url: named.map(Into::into),
            ..Preview::default()
        }
    }

    #[test]
    fn youtube_links_are_known_as_the_web_knows_them() {
        let id = "dQw4w9WgXcQ";
        for link in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ?start=3",
            "http://www.youtube.com/v/dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
        ] {
            assert_eq!(youtube_id(link).as_deref(), Some(id), "{link}");
        }
        for link in [
            // Not YouTube, however it is dressed.
            "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com@evil.example/watch?v=dQw4w9WgXcQ",
            // No video, or not one name long.
            "https://www.youtube.com/",
            "https://www.youtube.com/@channel",
            "https://www.youtube.com/watch?v=short",
            "https://youtu.be/dQw4w9WgXcQ1",
            "https://www.youtube.com/watch?v=dQw4w9WgX<Q",
            "mailto:dQw4w9WgXcQ@youtube.com",
        ] {
            assert_eq!(youtube_id(link), None, "{link}");
        }
    }

    #[test]
    fn a_picture_is_known_by_the_file_it_names() {
        assert!(is_picture_address("https://example.org/cat.GIF"));
        assert!(is_picture_address("https://example.org/a/b.jpeg?w=200#top"));
        assert!(is_picture_address("http://example.org/x.webp"));
        assert!(!is_picture_address("https://example.org/gif"));
        assert!(!is_picture_address("https://example.org/cat.gif/page"));
        assert!(!is_picture_address("https://example.org/?file=cat.png"));
        assert!(!is_picture_address("file:///C:/cat.png"));
        assert!(!is_picture_address("data:image/png;base64,AAAA"));
    }

    #[test]
    fn what_a_link_shows_follows_the_link_and_then_the_card() {
        let video = Embed::of("https://youtu.be/dQw4w9WgXcQ", None);
        assert_eq!(
            video,
            Some(Embed::YouTube {
                id: "dQw4w9WgXcQ".into()
            })
        );
        let cat = Embed::of("https://example.org/cat.gif", None);
        assert_eq!(
            cat,
            Some(Embed::Picture {
                url: "https://example.org/cat.gif".into(),
                alone: true
            })
        );
        let page = "https://example.org/page";
        assert_eq!(Embed::of(page, None), None, "nothing said of it");
        // The server says the link is a picture, and where it lives.
        let said = preview(Some("gifv"), Some("https://cdn.example/cat.gif"), true);
        assert_eq!(
            Embed::of(page, Some(&said)),
            Some(Embed::Picture {
                url: "https://cdn.example/cat.gif".into(),
                alone: true
            })
        );
        // An article whose card came without its picture: the picture is
        // offered under the card.
        let bare = preview(Some("article"), Some("https://cdn.example/hero.jpg"), false);
        let under = Embed::of(page, Some(&bare));
        assert!(under.as_ref().is_some_and(|embed| !embed.replaces_card()));
        // With it, the card is enough.
        let whole = preview(Some("article"), Some("https://cdn.example/hero.jpg"), true);
        assert_eq!(Embed::of(page, Some(&whole)), None);
        assert_eq!(Embed::of(page, Some(&preview(None, None, false))), None);
    }

    #[test]
    fn who_learns_of_the_reader_is_the_host_it_comes_from() {
        let cat = Embed::of("https://Cats.Example:8443/cat.png", None);
        assert_eq!(
            cat.and_then(|cat| cat.host()).as_deref(),
            Some("cats.example")
        );
        let video = Embed::of("https://youtu.be/dQw4w9WgXcQ", None);
        assert_eq!(
            video.and_then(|video| video.host()).as_deref(),
            Some("www.youtube.com")
        );
    }

    #[test]
    fn a_title_is_read_out_of_what_youtube_answers() {
        let about = br#"{"title":" A walk by the river ","author_name":"Rin"}"#;
        assert_eq!(
            youtube::title(about).as_deref(),
            Some("A walk by the river")
        );
        assert_eq!(youtube::title(b"{}"), None);
        assert_eq!(youtube::title(b"<html>"), None);
        assert!(youtube::about("dQw4w9WgXcQ").contains("watch%3Fv%3DdQw4w9WgXcQ"));
    }

    /// Answer one request on a port of this machine with `response`, and
    /// say where.
    fn serve(response: Vec<u8>) -> String {
        use std::io::{Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listener.local_addr().expect("its address").port();
        drop(std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0_u8; 4096];
                let _ = stream.read(&mut request);
                let _ = stream.write_all(&response);
            }
        }));
        format!("http://127.0.0.1:{port}/cat.png")
    }

    fn answer(status: &str, length: Option<usize>, body: &[u8]) -> Vec<u8> {
        let length = length.map(|length| format!("Content-Length: {length}\r\n"));
        let mut response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: image/png\r\n{}Connection: close\r\n\r\n",
            length.unwrap_or_default()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    fn fetched(url: &str, most: usize) -> Fetched {
        Web.fetch(url, most).recv_blocking().expect("an answer")
    }

    #[test]
    fn the_web_is_fetched_within_its_limits() {
        let body = vec![7_u8; 3000];
        let url = serve(answer("200 OK", Some(body.len()), &body));
        assert_eq!(fetched(&url, 4096), Ok(body.clone()));
        // Said to be too large, and refused before it is read.
        let url = serve(answer("200 OK", Some(body.len()), &body));
        assert!(fetched(&url, 1000).is_err_and(|why| why.contains("larger")));
        // Not said, and cut off once it is.
        let url = serve(answer("200 OK", None, &body));
        assert!(fetched(&url, 1000).is_err_and(|why| why.contains("larger")));
        let url = serve(answer("404 Not Found", Some(0), b""));
        assert!(fetched(&url, 1000).is_err());
        assert!(fetched("file:///C:/Windows/win.ini", 1000).is_err());
    }
}
