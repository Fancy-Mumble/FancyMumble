//! Which source is asked when, and what is drawn of its answer: the web
//! client's rules, against the stand-in for a key of the user's own.

use std::sync::Arc;

use super::*;
use crate::embed::Web;
use crate::gif::made_up::MadeUp;
use crate::gif::stand_in::{KEY, StandIn};
use crate::gif::{Gif, Refused, Support, wait};

/// A server's service from `made_up`, as it said itself to be.
fn service(made_up: &Arc<MadeUp>, available: bool, proxies: bool) -> Service {
    let mut service = made_up.service();
    service.support.available = available;
    if !proxies {
        service.support.media_base = None;
    }
    service
}

#[test]
fn there_are_gifs_with_a_key_or_from_a_server_that_serves_them_itself() {
    let made_up = Arc::new(MadeUp::at("https://chat.example", 10));
    let web = || Arc::new(Web) as Arc<dyn Fetch>;
    let private = service(&made_up, true, true);
    let cdn = service(&made_up, true, false);
    let none = service(&made_up, false, false);
    assert!(Plan::of(None, None, web()).is_none());
    assert!(Plan::of(Some(&none), None, web()).is_none());
    assert!(
        Plan::of(Some(&cdn), None, web()).is_none(),
        "the provider would be reached without the user's say"
    );
    assert!(Plan::of(Some(&private), None, web()).is_some());
    assert!(
        Plan::of(None, Some("  "), web()).is_none(),
        "a blank key is none"
    );
    let own = Plan::of(Some(&none), Some(KEY), web()).expect("a key");
    assert_eq!(own.provider, "Klipy");
    assert!(
        own.then.is_none(),
        "a server without the service is not asked"
    );
    assert!(Plan::of(Some(&cdn), Some(KEY), web()).is_some_and(|plan| plan.then.is_some()));
}

#[test]
fn without_a_key_only_what_the_server_serves_itself_is_drawn() {
    let made_up = Arc::new(MadeUp::at("https://chat.example", 3));
    let mut private = service(&made_up, true, true);
    private.support.media_base = "https://other.example/gif?".parse().ok();
    let plan = Plan::of(Some(&private), None, Arc::new(Web)).expect("a plan");
    let page = wait(plan.page("", 1)).expect("a page");
    assert!(page.gifs.is_empty(), "served from elsewhere: left out");
    let mut page = Page {
        gifs: vec![
            Gif {
                title: "in".into(),
                url: "https://chat.example/gif?u=1".into(),
                preview: "https://chat.example/gif?u=1&s=xs".into(),
            },
            Gif {
                title: "half".into(),
                url: "https://chat.example/gif?u=2".into(),
                preview: "https://static.klipy.com/2.webp".into(),
            },
        ],
        has_next: true,
    };
    page = kept(page, made_up.media_base().as_ref());
    assert_eq!(page.gifs.len(), 1);
    assert_eq!(page.gifs[0].title, "in");
}

#[test]
fn the_server_is_asked_first_and_the_own_key_only_when_it_has_none() {
    let stand_in = StandIn::start();
    let made_up = Arc::new(MadeUp::at("https://chat.example", 30));
    let cdn = service(&made_up, true, false);
    let own = Arc::new(Klipy::at(&stand_in.api(), KEY, Arc::new(Web))) as Arc<dyn Source>;
    let plan = Plan {
        then: Some(own),
        ..Plan::of(Some(&cdn), Some(KEY), Arc::new(Web)).expect("a plan")
    };
    let page = wait(plan.page("cat", 1)).expect("from the server");
    assert!(page.gifs[0].url.starts_with("https://chat.example"));
    assert!(
        stand_in.asked().is_empty(),
        "Klipy is not reached alongside"
    );
    // Throttled: said as it is, and not routed round with the key.
    made_up.refuse(Some(Refused::new(Why::Throttled, "slow down")));
    let throttled = wait(plan.page("cat", 1)).expect_err("throttled");
    assert_eq!(throttled.why, Why::Throttled);
    assert!(stand_in.asked().is_empty());
    // No service after all: the key answers.
    made_up.refuse(Some(Refused::new(Why::Unavailable, "none")));
    let page = wait(plan.page("", 2)).expect("from Klipy");
    assert!(page.gifs[0].url.starts_with(&stand_in.root));
    assert_eq!(
        stand_in.asked(),
        [format!("/api/v1/{KEY}/gifs/trending?per_page=30&page=2")]
    );
}

#[test]
fn support_said_by_nobody_is_no_service() {
    assert!(!Support::default().available);
}
