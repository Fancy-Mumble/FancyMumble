//! The server's service: questions matched with their answers, and
//! silence read as "none".

use std::sync::{Arc, Mutex};
use std::time::Duration;

use mumble_tauri_lib::engine_api::gifs::{
    Gif as Found, GifPage, GifRefusal, GifRefused, GifSupport,
};

use super::*;
use crate::gif::wait;

/// Takes every question and keeps it; answers none by itself.
#[derive(Default)]
struct Taken {
    asked: Mutex<Vec<(String, String, u32)>>,
    deaf: bool,
}

impl Ask for Taken {
    fn support(&self, request_id: String) -> Sent {
        self.asked
            .lock()
            .expect("the list")
            .push((request_id, String::new(), 0));
        Box::pin(async { Ok(()) })
    }

    fn search(&self, query: String, page: u32, request_id: String) -> Sent {
        if self.deaf {
            return Box::pin(async { Err("Not connected".to_owned()) });
        }
        self.asked
            .lock()
            .expect("the list")
            .push((request_id, query, page));
        Box::pin(async { Ok(()) })
    }
}

impl Taken {
    fn last(&self) -> (String, String, u32) {
        self.asked
            .lock()
            .expect("the list")
            .last()
            .cloned()
            .expect("a question")
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_time()
        .build()
        .expect("a runtime")
}

/// Wait until `taken` has `count` questions.
fn asked(taken: &Taken, count: usize) {
    for _ in 0..500 {
        if taken.asked.lock().expect("the list").len() >= count {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    panic!("nothing was asked");
}

fn found(n: u32) -> Found {
    Found {
        id: n.to_string(),
        title: if n == 1 {
            String::new()
        } else {
            format!("cat {n}")
        },
        url: format!("https://chat.example/gif?u={n}"),
        preview: format!("https://chat.example/gif?p={n}"),
        ..Found::default()
    }
}

#[test]
fn the_service_is_what_the_server_said_in_answer_to_the_question() {
    let runtime = runtime();
    let taken = Arc::new(Taken::default());
    let gifs = ServerGifs::new(taken.clone(), runtime.handle().clone());
    assert!(gifs.service().is_none(), "nothing said yet");
    gifs.ask_support();
    asked(&taken, 1);
    let (id, _, _) = taken.last();
    let answer = |request_id: &str| GifSupport {
        request_id: request_id.to_owned(),
        available: true,
        media_base: "https://chat.example/gif?".to_owned(),
        provider: "klipy".to_owned(),
    };
    assert!(!gifs.noted_support(&answer("gif-support-99")), "not ours");
    assert!(gifs.noted_support(&answer(&id)));
    let support = gifs.service().expect("said").support;
    assert!(support.available);
    assert_eq!(
        support.media_base.map(|base| base.as_str().to_owned()),
        Some("https://chat.example/gif?".to_owned())
    );
    assert_eq!(support.provider, "Klipy");
    gifs.forget();
    assert!(gifs.service().is_none(), "another server");
}

#[test]
fn a_page_answers_the_search_it_was_asked_for() {
    let runtime = runtime();
    let taken = Arc::new(Taken::default());
    let gifs = ServerGifs::new(taken.clone(), runtime.handle().clone());
    let pending = gifs.search(" cat ", 2);
    asked(&taken, 1);
    let (id, query, page) = taken.last();
    assert_eq!((query.as_str(), page), ("cat", 2));
    gifs.noted_page(GifPage {
        request_id: id,
        results: vec![found(1), found(2)],
        page: 2,
        has_next: true,
        provider: "klipy".to_owned(),
    });
    let page = wait(pending).expect("a page");
    assert!(page.has_next);
    assert_eq!(page.gifs[0].title, "GIF", "no title is said as GIF");
    assert_eq!(page.gifs[1].url, "https://chat.example/gif?u=2");
    assert_eq!(page.gifs[1].preview, "https://chat.example/gif?p=2");
    // Trending is the search for nothing.
    let _trending = gifs.trending(1);
    asked(&taken, 2);
    assert_eq!(taken.last().1, "");
}

#[test]
fn a_refusal_says_why_and_unavailable_is_remembered() {
    let runtime = runtime();
    let taken = Arc::new(Taken::default());
    let gifs = ServerGifs::new(taken.clone(), runtime.handle().clone());
    let throttled = gifs.search("cat", 1);
    asked(&taken, 1);
    gifs.noted_refused(GifRefused {
        request_id: taken.last().0,
        reason: "slow down".to_owned(),
        retry_after_ms: 900,
        kind: GifRefusal::Throttled,
    });
    assert_eq!(
        wait(throttled),
        Err(Refused::new(Why::Throttled, "slow down"))
    );
    let none = gifs.search("cat", 1);
    asked(&taken, 2);
    gifs.noted_refused(GifRefused {
        request_id: taken.last().0,
        reason: String::new(),
        retry_after_ms: 0,
        kind: GifRefusal::Unavailable,
    });
    assert_eq!(
        wait(none).map_err(|refused| refused.why),
        Err(Why::Unavailable)
    );
    // Not asked again: the server said.
    assert_eq!(
        wait(gifs.search("dog", 1)).map_err(|refused| refused.why),
        Err(Why::Unavailable)
    );
    assert_eq!(taken.asked.lock().expect("the list").len(), 2);
}

#[test]
fn silence_is_read_as_no_service_and_so_is_no_connection() {
    let runtime = runtime();
    let taken = Arc::new(Taken::default());
    let gifs = ServerGifs::waiting_for(
        taken.clone(),
        runtime.handle().clone(),
        Duration::from_millis(30),
    );
    let refused = wait(gifs.search("cat", 1)).expect_err("silence");
    assert_eq!(refused.why, Why::Unavailable);
    gifs.ask_support();
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(
        gifs.service().map(|service| service.support),
        Some(Support::default()),
        "said nothing: no service"
    );
    let deaf = Arc::new(Taken {
        deaf: true,
        ..Taken::default()
    });
    let gifs = ServerGifs::new(deaf, runtime.handle().clone());
    let refused = wait(gifs.search("cat", 1)).expect_err("not connected");
    assert_eq!(refused, Refused::new(Why::Unavailable, "Not connected"));
}
