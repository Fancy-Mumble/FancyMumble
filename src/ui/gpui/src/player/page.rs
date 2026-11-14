//! The page the player shows: `YouTube`'s embedded player, framed by a
//! page of this program's own, and what that page says back.
//!
//! The frame is needed: `YouTube`'s player refuses to play ("Error 153")
//! unless it was asked for by a page with a web address, and a request
//! header saying so is not enough. The web client frames it from a
//! loopback server for the same reason; here the framing page is served
//! by the web view itself, under an address of its own, with no server.
//!
//! The framing page can be scrolled, though nothing in it moves: the wheel
//! turned over the player, which the player does not use, goes on to the
//! page that frames it, as it does in any browser. The page tells how far,
//! and puts itself back; the client scrolls the conversation by that much.
//! It is the same in every engine, and costs nothing while nobody turns
//! the wheel.
//!
//! `YouTube` asks an application that embeds its player to say who it is
//! in the `Referer`, an https address whose domain is the application's
//! identifier ("Required Minimum Functionality"). The framing page is
//! served at that address, [`ORIGIN`], so it is the page's origin, the
//! referrer the player is asked for with, and the origin the player is
//! told to talk to.

/// Where the embedded player comes from: the address the web client uses.
const EMBED: &str = "https://www.youtube-nocookie.com/embed/";

/// Where the framing page is served: the application's identifier as an
/// https origin. The identifier is the project's, `appIdentifier` in
/// `config/constants.json`, which the web client is installed under.
pub(crate) const ORIGIN: &str = "https://com.fancymumble.app";

/// A video to play.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Page {
    /// Its eleven-letter name.
    pub(crate) id: String,
    /// Played without sound: for runs that look at the player, never for
    /// the reader who pressed play.
    pub(crate) muted: bool,
}

impl Page {
    /// `id`, with sound unless `FANCY_GPUI_PLAYER_MUTED` asks otherwise.
    pub(crate) fn of(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            muted: std::env::var_os("FANCY_GPUI_PLAYER_MUTED").is_some(),
        }
    }

    /// The embedded player's address. It starts at once, since play was
    /// pressed and the page is only loaded once it can be seen (see
    /// [`super::Screen::start`]); tells the framing page how it stands; and has no
    /// full-screen button, since the card has its own way to enlarge.
    pub(crate) fn embed(&self) -> String {
        let mute = if self.muted { "&mute=1" } else { "" };
        format!(
            "{EMBED}{}?autoplay=1&enablejsapi=1&fs=0&origin={ORIGIN}{mute}",
            self.id
        )
    }

    /// The framing page: the player, filling it, and a script that passes
    /// on when it starts, pauses and ends, once each time it changes, and
    /// how far the wheel turned over it.
    pub(crate) fn framing(&self) -> String {
        let embed = self.embed();
        format!(
            r#"<!doctype html><html><head><meta charset="utf-8"><style>html{{overflow:scroll;scrollbar-width:none}}body{{margin:0;height:300vh;background:#000}}iframe{{position:fixed;left:0;top:0;border:0;width:100%;height:100%;display:block}}</style></head><body><iframe id="p" src="{embed}" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe><script>
const p=document.getElementById("p");let last=null;const mid=innerHeight;scrollTo(0,mid);
addEventListener("scroll",()=>{{const d=Math.round(scrollY-mid);if(d){{window.ipc.postMessage("wheel:"+d);scrollTo(0,mid)}}}},{{passive:true}});
p.addEventListener("load",()=>p.contentWindow.postMessage(JSON.stringify({{event:"listening",id:1,channel:"widget"}}),"*"));
addEventListener("message",e=>{{if(e.origin!=="https://www.youtube-nocookie.com")return;let d;try{{d=JSON.parse(e.data)}}catch(_){{return}}
const s=d.event==="onStateChange"?d.info:(d.event==="infoDelivery"&&d.info?d.info.playerState:undefined);
if(typeof s==="number"&&s!==last){{last=s;window.ipc.postMessage("state:"+s)}}}});
</script></body></html>"#
        )
    }
}

/// What the page said about the video, or that there is no page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Said {
    Playing,
    Paused,
    Ended,
    /// No web view could be made to show it in.
    Failed,
    /// The wheel turned over it, as this many pixels down.
    Wheel(i32),
}

impl std::str::FromStr for Said {
    type Err = ();

    /// `state:<n>`, `YouTube`'s numbers for how a player stands (the
    /// in-between ones, buffering and not started, are not worth telling),
    /// or `wheel:<pixels>`.
    fn from_str(said: &str) -> Result<Self, ()> {
        if let Some(pixels) = said.strip_prefix("wheel:") {
            return pixels.parse().map(Self::Wheel).map_err(|_| ());
        }
        match said.strip_prefix("state:").ok_or(())? {
            "1" => Ok(Self::Playing),
            "2" => Ok(Self::Paused),
            "0" => Ok(Self::Ended),
            _ => Err(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_player_is_the_web_clients_and_starts_at_once() {
        let page = Page {
            id: "aqz-KE-bpKQ".to_owned(),
            muted: false,
        };
        assert_eq!(
            page.embed(),
            "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1&enablejsapi=1&fs=0&origin=https://com.fancymumble.app"
        );
        let quiet = Page {
            muted: true,
            ..page.clone()
        };
        assert!(quiet.embed().ends_with("&mute=1"));
        let framing = page.framing();
        assert!(framing.contains(
            r#"<iframe id="p" src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?"#
        ));
        assert!(
            framing.contains("strict-origin-when-cross-origin"),
            "it sends where it is framed"
        );
    }

    #[test]
    fn the_framing_page_is_served_as_the_projects_application() {
        let shared: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../config/constants.json"
        )))
        .expect("the shared constants");
        let origin = url::Url::parse(ORIGIN).expect("an address");
        assert_eq!(origin.scheme(), "https");
        assert_eq!(origin.host_str(), shared["appIdentifier"].as_str());
        assert_eq!(origin.origin().ascii_serialization(), ORIGIN);
    }

    #[test]
    fn what_the_page_says_is_read_and_the_rest_ignored() {
        assert_eq!("state:1".parse(), Ok(Said::Playing));
        assert_eq!("state:2".parse(), Ok(Said::Paused));
        assert_eq!("state:0".parse(), Ok(Said::Ended));
        assert_eq!("state:3".parse::<Said>(), Err(()));
        assert_eq!("hello".parse::<Said>(), Err(()));
        assert_eq!("wheel:-200".parse(), Ok(Said::Wheel(-200)));
        assert_eq!("wheel:far".parse::<Said>(), Err(()));
    }
}
