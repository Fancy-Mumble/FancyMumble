//! A stand-in for Klipy on a port of this machine, for the tests: its
//! API's shape, answered with animations made on the spot. Nothing is
//! fetched from the internet in a test.
//!
//! `/api/v1/<key>/gifs/trending` and `/search?q=` answer pages of ten,
//! three pages deep; `/media/<n>.gif` and `/media/<n>.webp` are the
//! animations they name. A wrong key is answered 401, `q=huge` with an
//! answer larger than any page may be, and `q=broken` with something that
//! is not a page.

use std::io::{BufRead as _, BufReader, Write as _};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

/// The key the stand-in takes.
pub(crate) const KEY: &str = "stand-in-key-0123";
/// How many a page has, and how many pages there are.
const PER_PAGE: usize = 10;
const PAGES: u32 = 3;

/// The stand-in, answering for as long as the test runs.
pub(crate) struct StandIn {
    /// Its address: `http://127.0.0.1:<port>`.
    pub(crate) root: String,
    /// The paths and queries it was asked for, in order.
    asked: Arc<Mutex<Vec<String>>>,
}

impl StandIn {
    /// Start answering on a free port.
    pub(crate) fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let root = format!("http://{}", listener.local_addr().expect("its address"));
        let asked = Arc::new(Mutex::new(Vec::new()));
        let noted = Arc::clone(&asked);
        let base = root.clone();
        drop(std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let noted = Arc::clone(&noted);
                let base = base.clone();
                drop(std::thread::spawn(move || answer(stream, &base, &noted)));
            }
        }));
        Self { root, asked }
    }

    /// Where its API is, as `Klipy::at` takes it.
    pub(crate) fn api(&self) -> String {
        format!("{}/api/v1", self.root)
    }

    /// What it was asked for, in order.
    pub(crate) fn asked(&self) -> Vec<String> {
        self.asked.lock().expect("the list").clone()
    }
}

/// Answer the one request on `stream`.
fn answer(mut stream: TcpStream, base: &str, asked: &Mutex<Vec<String>>) {
    let mut reader = BufReader::new(stream.try_clone().expect("the stream"));
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    // The rest of the head, up to the blank line.
    let mut header = String::new();
    while reader.read_line(&mut header).is_ok_and(|read| read > 2) {
        header.clear();
    }
    let target = line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_owned();
    asked.lock().expect("the list").push(target.clone());
    let (status, kind, body) = respond(&target, base);
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
}

/// What the stand-in says to `target`.
fn respond(target: &str, base: &str) -> (&'static str, &'static str, Vec<u8>) {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if let Some(name) = path.strip_prefix("/media/") {
        return match media(name) {
            Some(bytes) => ("200 OK", "image/gif", bytes),
            None => ("404 Not Found", "text/plain", b"no such picture".to_vec()),
        };
    }
    let Some(rest) = path.strip_prefix("/api/v1/") else {
        return ("404 Not Found", "text/plain", Vec::new());
    };
    let (key, action) = rest.split_once("/gifs/").unwrap_or((rest, ""));
    if key != KEY {
        return (
            "401 Unauthorized",
            "application/json",
            br#"{"result":false}"#.to_vec(),
        );
    }
    let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    let value = |name: &str| {
        pairs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    let page: u32 = value("page")
        .and_then(|page| page.parse().ok())
        .unwrap_or(1);
    let words = match action {
        "trending" => "trending".to_owned(),
        "search" => value("q").unwrap_or_default(),
        _ => return ("404 Not Found", "text/plain", Vec::new()),
    };
    match words.as_str() {
        "huge" => ("200 OK", "application/json", vec![b' '; 2 << 20]),
        "broken" => ("200 OK", "application/json", b"<html>busy</html>".to_vec()),
        _ => ("200 OK", "application/json", self::page(&words, page, base)),
    }
}

/// Page `page` of what is found for `words`, as Klipy answers it.
fn page(words: &str, page: u32, base: &str) -> Vec<u8> {
    let items: Vec<serde_json::Value> = (0..PER_PAGE)
        .map(|at| {
            let n = (page as usize - 1) * PER_PAGE + at;
            let file = |name: &str| serde_json::json!({ "url": format!("{base}/media/{name}") });
            let mut sizes = serde_json::json!({
                "hd": { "gif": file(&format!("{n}.gif")), "webp": file(&format!("{n}-hd.webp")) },
                "sm": { "gif": file(&format!("{n}-sm.gif")) },
                "xs": { "gif": file(&format!("{n}-xs.gif")), "webp": file(&format!("{n}-xs.webp")) },
            });
            // One in five has no small sizes; one has no file at all.
            if n % 5 == 4 {
                sizes = serde_json::json!({ "md": { "gif": file(&format!("{n}.gif")) } });
            }
            let mut item = serde_json::json!({
                "id": n,
                "title": format!("{words} {n}"),
                "file": sizes,
                "type": "gif",
            });
            if n == 7 {
                item = serde_json::json!({ "id": n, "type": "ad" });
            }
            item
        })
        .collect();
    serde_json::to_vec(&serde_json::json!({
        "result": true,
        "data": {
            "data": items,
            "current_page": page,
            "per_page": PER_PAGE,
            "has_next": page < PAGES,
        }
    }))
    .expect("a page")
}

/// The animation called `name`: two frames whose colours follow from its
/// number.
fn media(name: &str) -> Option<Vec<u8>> {
    let number: u32 = name
        .split(['.', '-'])
        .next()
        .and_then(|number| number.parse().ok())?;
    Some(animation(number))
}

/// An animation of two frames, coloured after `number`.
pub(crate) fn animation(number: u32) -> Vec<u8> {
    let hue = u8::try_from(number * 37 % 256).unwrap_or(0);
    let mut file = Vec::new();
    {
        let mut encoder = image::codecs::gif::GifEncoder::new(&mut file);
        encoder
            .set_repeat(image::codecs::gif::Repeat::Infinite)
            .expect("a repeat");
        for colour in [[hue, 80, 200], [200, hue, 80]] {
            let [red, green, blue] = colour;
            let frame = image::RgbaImage::from_pixel(64, 48, image::Rgba([red, green, blue, 255]));
            let delay = image::Delay::from_numer_denom_ms(100, 1);
            encoder
                .encode_frame(image::Frame::from_parts(frame, 0, 0, delay))
                .expect("a frame");
        }
    }
    file
}
