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
//!
//! A player that is not playing is not kept (see `ui::playing`): the page
//! says where the video stood and how fast it ran when it paused, and the
//! next page starts there.

#[cfg_attr(all(not(windows), not(test)), expect(dead_code, reason = "only the Windows web view frames the player; elsewhere a video opens in the browser"))]
/// Where the embedded player comes from: the address the web client uses.
const EMBED: &str = "https://www.youtube-nocookie.com/embed/";

#[cfg_attr(all(not(windows), not(test)), expect(dead_code, reason = "only the Windows web view frames the player; elsewhere a video opens in the browser"))]
/// Where the framing page is served: the application's identifier as an
/// https origin. The identifier is the project's, `appIdentifier` in
/// `config/constants.json`, which the web client is installed under.
pub(crate) const ORIGIN: &str = "https://com.fancymumble.app";

#[cfg_attr(all(not(windows), not(test)), expect(dead_code, reason = "only the Windows web view frames the player; elsewhere a video opens in the browser"))]
/// What the embedded player is asked for, each with why. All of them are
/// the `IFrame` API's own parameters: the player is `YouTube`'s, unchanged.
///
/// * `autoplay=1`: play was pressed, and the page is only loaded once the
///   player can be seen (`Screen::start`), as the terms ask;
/// * `enablejsapi=1` and `origin`: the framing page hears how it stands,
///   and is the only one that may talk to it;
/// * `fs=0`: the card has its own way to enlarge;
/// * `playsinline=1`, `rel=0`: no second video offered from another
///   channel at the end, nothing opened outside the card.
const PARAMETERS: &str = "autoplay=1&enablejsapi=1&fs=0&playsinline=1&rel=0";

/// Where a video stood, and how fast it ran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Moment {
    /// Milliseconds into it.
    pub(crate) at_ms: u32,
    /// Its speed, in hundredths: 100 is normal.
    pub(crate) rate: u16,
}

impl Moment {
    /// The start, at normal speed.
    pub(crate) const START: Self = Self {
        at_ms: 0,
        rate: 100,
    };
}

/// A video to play.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Page {
    /// Its eleven-letter name.
    pub(crate) id: String,
    /// Played without sound: for runs that look at the player, never for
    /// the reader who pressed play.
    pub(crate) muted: bool,
    /// Where it starts, and how fast.
    pub(crate) from: Moment,
}

impl Page {
    /// `id` from its start, with sound unless `FANCY_GPUI_PLAYER_MUTED`
    /// asks otherwise.
    pub(crate) fn of(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            muted: std::env::var_os("FANCY_GPUI_PLAYER_MUTED").is_some(),
            from: Moment::START,
        }
    }

    /// The same video, from `moment`.
    pub(crate) fn from(mut self, moment: Moment) -> Self {
        self.from = moment;
        self
    }

    #[cfg_attr(all(not(windows), not(test)), expect(dead_code, reason = "only the Windows web view frames the player; elsewhere a video opens in the browser"))]
    /// The embedded player's address: see [`PARAMETERS`]. Started part
    /// way, it is asked to start at that second; the framing page seeks to
    /// the exact moment once the player is ready.
    pub(crate) fn embed(&self) -> String {
        let mute = if self.muted { "&mute=1" } else { "" };
        let start = match self.from.at_ms / 1000 {
            0 => String::new(),
            seconds => format!("&start={seconds}"),
        };
        format!(
            "{EMBED}{}?{PARAMETERS}&origin={ORIGIN}{start}{mute}",
            self.id
        )
    }

    #[cfg_attr(all(not(windows), not(test)), expect(dead_code, reason = "only the Windows web view frames the player; elsewhere a video opens in the browser"))]
    /// The framing page: the player, filling it, and a script that passes
    /// on when it starts, pauses and ends, once each time it changes, with
    /// where it stood and how fast it ran; and how far the wheel turned
    /// over it. Its `play()` plays on from a pause.
    pub(crate) fn framing(&self) -> String {
        let embed = self.embed();
        let seek = f64::from(self.from.at_ms) / 1000.0;
        let rate = f64::from(self.from.rate) / 100.0;
        format!(
            r#"<!doctype html><html><head><meta charset="utf-8"><style>html{{overflow:scroll;scrollbar-width:none}}body{{margin:0;height:300vh;background:#000}}iframe{{position:fixed;left:0;top:0;border:0;width:100%;height:100%;display:block}}</style></head><body><iframe id="p" src="{embed}" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe><script>
const p=document.getElementById("p");const Y="https://www.youtube-nocookie.com";let last=null,pos={seek},rate={rate},ready=false;
function call(f,a){{p.contentWindow.postMessage(JSON.stringify({{event:"command",func:f,args:a}}),Y)}}
function play(){{call("playVideo",[])}}const mid=innerHeight;scrollTo(0,mid);
addEventListener("scroll",()=>{{const d=Math.round(scrollY-mid);if(d){{window.ipc.postMessage("wheel:"+d);scrollTo(0,mid)}}}},{{passive:true}});
p.addEventListener("load",()=>p.contentWindow.postMessage(JSON.stringify({{event:"listening",id:1,channel:"widget"}}),"*"));
addEventListener("message",e=>{{if(e.origin!==Y)return;let d;try{{d=JSON.parse(e.data)}}catch(_){{return}}
if(d.event==="onReady"&&!ready){{ready=true;if(pos>0)call("seekTo",[pos,true]);if(rate!==1)call("setPlaybackRate",[rate])}}
const i=d.info&&typeof d.info==="object"?d.info:{{}};if(typeof i.currentTime==="number")pos=i.currentTime;if(typeof i.playbackRate==="number")rate=i.playbackRate;
const s=d.event==="onStateChange"?d.info:(d.event==="infoDelivery"?i.playerState:undefined);
if(typeof s==="number"&&s!==last){{last=s;window.ipc.postMessage("state:"+s+":"+Math.round(pos*1000)+":"+Math.round(rate*100))}}}});
</script></body></html>"#
        )
    }
}

/// What the page said about the video, or that there is no page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Said {
    Playing,
    /// Paused here.
    Paused(Moment),
    Ended,
    #[cfg_attr(all(not(windows), not(test)), expect(dead_code, reason = "only the Windows web view frames the player; elsewhere a video opens in the browser"))]
    /// No web view could be made to show it in.
    Failed,
    /// The wheel turned over it, as this many pixels down.
    Wheel(i32),
    #[cfg_attr(all(not(windows), not(test)), expect(dead_code, reason = "only the Windows web view frames the player; elsewhere a video opens in the browser"))]
    /// The window it is in was minimised.
    Minimised,
}

impl std::str::FromStr for Said {
    type Err = ();

    /// `state:<n>[:<ms>:<rate>]`, `YouTube`'s numbers for how a player
    /// stands (the in-between ones, buffering and not started, are not
    /// worth telling) with where it stood and how fast it ran; or
    /// `wheel:<pixels>`.
    fn from_str(said: &str) -> Result<Self, ()> {
        if let Some(pixels) = said.strip_prefix("wheel:") {
            return pixels.parse().map(Self::Wheel).map_err(|_| ());
        }
        let mut parts = said.strip_prefix("state:").ok_or(())?.split(':');
        let state = parts.next().ok_or(())?;
        let at_ms = parts.next().and_then(|ms| ms.parse().ok()).unwrap_or(0);
        let rate = parts
            .next()
            .and_then(|rate| rate.parse().ok())
            .filter(|rate| *rate > 0)
            .unwrap_or(100);
        match state {
            "1" => Ok(Self::Playing),
            "2" => Ok(Self::Paused(Moment { at_ms, rate })),
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
            from: Moment::START,
        };
        assert_eq!(
            page.embed(),
            "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1&enablejsapi=1&fs=0&playsinline=1&rel=0&origin=https://com.fancymumble.app"
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
    fn a_video_played_on_starts_where_it_stood_at_its_speed() {
        let page = Page::of("aqz-KE-bpKQ").from(Moment {
            at_ms: 83_450,
            rate: 150,
        });
        assert!(page.embed().contains("&start=83"));
        let framing = page.framing();
        assert!(framing.contains("pos=83.45"), "seeks to the exact moment");
        assert!(framing.contains("rate=1.5"));
        assert!(!Page::of("aqz-KE-bpKQ").embed().contains("start="));
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
        assert_eq!(
            "state:2:83450:150".parse(),
            Ok(Said::Paused(Moment {
                at_ms: 83_450,
                rate: 150
            }))
        );
        assert_eq!("state:2".parse(), Ok(Said::Paused(Moment::START)));
        assert_eq!("state:0:5000:100".parse(), Ok(Said::Ended));
        assert_eq!("state:3".parse::<Said>(), Err(()));
        assert_eq!("hello".parse::<Said>(), Err(()));
        assert_eq!("wheel:-200".parse(), Ok(Said::Wheel(-200)));
        assert_eq!("wheel:far".parse::<Said>(), Err(()));
    }
}
