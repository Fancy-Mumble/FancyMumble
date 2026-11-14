//! A long conversation and a steady flow of messages, for measuring
//! scrolling and drawing: `FANCY_GPUI_DEMO_CHAT=<count>` has that many said
//! in the lounge before the window opens, `FANCY_GPUI_DEMO_FLOW=<ms>` has
//! Rin say one more every so many milliseconds for as long as it runs.

use std::sync::Arc;
use std::time::Duration;

use super::DemoEngine;
use crate::engine::Conversation;

/// Words the messages are made of: lines of different lengths, so that rows
/// are one, two and several lines high, as in a real conversation.
const WORDS: &[&str] = &[
    "the", "lounge", "is", "quiet", "tonight", "and", "somebody", "left", "a", "song",
    "playing", "in", "the", "next", "channel", "over", "there", "we", "should", "meet",
    "on", "Saturday", "at", "the", "lake", "if", "the", "weather", "holds", "up",
];

/// The `nth` message: a sentence of a length that varies from one to the next.
fn line(nth: usize) -> String {
    let length = 3 + (nth * 7) % 41;
    let mut said: Vec<&str> = (0..length).map(|word| WORDS[(nth + word * 3) % WORDS.len()]).collect();
    if nth % 5 == 0 {
        said.push("**really**");
    }
    format!("{} #{nth}", said.join(" "))
}

impl DemoEngine {
    /// `count` messages in the lounge, Rin and Alex taking turns.
    pub(crate) fn chatter(&self, count: usize) {
        for nth in 0..count {
            let (session, name) = if nth % 2 == 0 { (3, "Rin") } else { (super::OWN, "Alex") };
            self.say_as(session, name, Conversation::Channel(super::LOUNGE), &line(nth));
        }
    }
}

/// Rin says one more message every `every`, from a thread of its own, for
/// as long as the program runs.
pub(crate) fn flow(engine: Arc<DemoEngine>, every: Duration) {
    let _ = std::thread::Builder::new().name("demo-flow".to_owned()).spawn(move || {
        for nth in 10_000.. {
            std::thread::sleep(every);
            engine.say_as(3, "Rin", Conversation::Channel(super::LOUNGE), &line(nth));
        }
    });
}
