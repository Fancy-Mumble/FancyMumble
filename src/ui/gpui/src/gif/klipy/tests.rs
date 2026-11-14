//! Klipy asked directly, against the stand-in on this machine.

use std::sync::Arc;

use super::*;
use crate::embed::Web;
use crate::gif::stand_in::{KEY, StandIn};
use crate::gif::wait;

fn klipy(stand_in: &StandIn, key: &str) -> Klipy {
    Klipy::at(&stand_in.api(), key, Arc::new(Web))
}

#[test]
fn trending_and_a_search_are_asked_as_the_web_client_asks_them() {
    let stand_in = StandIn::start();
    let klipy = klipy(&stand_in, KEY);
    let trending = wait(klipy.trending(1)).expect("a page");
    let found = wait(klipy.search("  happy cat ", 1)).expect("a page");
    assert_eq!(
        stand_in.asked(),
        [
            format!("/api/v1/{KEY}/gifs/trending?per_page=30&page=1"),
            format!("/api/v1/{KEY}/gifs/search?q=happy+cat&per_page=30&page=1"),
        ]
    );
    assert!(trending.gifs[0].title.starts_with("trending"));
    assert_eq!(found.gifs[0].title, "happy cat 0");
    // Nothing typed is trending.
    let _ = wait(klipy.search("   ", 2)).expect("a page");
    assert!(stand_in.asked()[2].contains("/gifs/trending?per_page=30&page=2"));
}

#[test]
fn the_largest_gif_is_sent_and_the_smallest_size_drawn() {
    let stand_in = StandIn::start();
    let page = wait(klipy(&stand_in, KEY).trending(1)).expect("a page");
    let media = |name: &str| format!("{}/media/{name}", stand_in.root);
    let first = &page.gifs[0];
    assert_eq!(first.url.as_ref(), media("0.gif"), "hd, as a GIF");
    assert_eq!(first.preview.as_ref(), media("0-xs.webp"), "xs, as WebP");
    // One with only a middle size: that is both.
    let bare = &page.gifs[4];
    assert_eq!(bare.url.as_ref(), media("4.gif"));
    assert_eq!(bare.preview, bare.url);
    // The entry with no file at all is left out, and the rest kept.
    assert_eq!(page.gifs.len(), 9);
    assert!(page.gifs.iter().all(|gif| !gif.title.contains(" 7")));
}

#[test]
fn pages_go_on_while_there_are_more() {
    let stand_in = StandIn::start();
    let klipy = klipy(&stand_in, KEY);
    let second = wait(klipy.search("cat", 2)).expect("a page");
    assert!(second.has_next);
    assert_eq!(second.gifs[0].title, "cat 10");
    let last = wait(klipy.search("cat", 3)).expect("a page");
    assert!(!last.has_next);
}

#[test]
fn a_refusal_says_why_and_never_the_key() {
    let stand_in = StandIn::start();
    let wrong = "not-the-key-9876";
    let refused = wait(klipy(&stand_in, wrong).trending(1)).expect_err("refused");
    assert_eq!(refused.why, Why::Upstream);
    assert!(refused.reason.contains("401"), "{}", refused.reason);
    assert!(!refused.reason.contains(wrong), "{}", refused.reason);
    let klipy = klipy(&stand_in, KEY);
    let broken = wait(klipy.search("broken", 1)).expect_err("not a page");
    assert_eq!(broken.reason, "Klipy answered something that is not a page");
    // Larger than any page may be: not read to its end.
    let huge = wait(klipy.search("huge", 1)).expect_err("too large");
    assert!(huge.reason.contains("larger"), "{}", huge.reason);
    // Nobody there at all.
    let gone = Klipy::at("http://127.0.0.1:9/api/v1", KEY, Arc::new(Web));
    let nobody = wait(gone.trending(1)).expect_err("nobody");
    assert_eq!(nobody.why, Why::Upstream);
    assert!(!nobody.reason.contains(KEY), "{}", nobody.reason);
}

#[test]
fn the_key_is_one_part_of_the_address_whatever_it_holds() {
    let klipy = Klipy::new(" a/b?c ", Arc::new(Web));
    let address = klipy.address(Some("x&per_page=1000"), 0);
    assert_eq!(
        address,
        "https://api.klipy.com/api/v1/a%2Fb%3Fc/gifs/search?q=x%26per_page%3D1000&per_page=30&page=1"
    );
}

#[test]
fn the_provider_is_credited_by_its_name() {
    assert_eq!(credited(""), "Klipy");
    assert_eq!(credited("klipy"), "Klipy");
    assert_eq!(credited("Tenor"), "Tenor");
}
