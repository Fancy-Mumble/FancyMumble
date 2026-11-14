//! Runs as somebody types them, with the composer's marks (`**bold**`,
//! `*italic*`, `__underlined__`, `~~struck~~`, `` `code` ``,
//! `[words](https://address)`), and back: what an about's editor shows in
//! its fields. Both ways go through the engine's one reading of those marks
//! (`markup`), so a field and a message cannot read them differently.

use super::model::{Block, Run};
use super::reader::Reader;
use super::tags::Tokens;

/// The runs `typed` stands for; lines stay lines.
#[must_use]
pub fn runs_of_typed(typed: &str) -> Vec<Run> {
    let html = crate::markup::marked(typed);
    let mut reader = Reader::default();
    Tokens::new(&html).for_each(|token| reader.token(token));
    let (about, _) = reader.finish();
    let mut runs: Vec<Run> = Vec::new();
    for block in about.blocks {
        let read = match block {
            Block::Text { runs, .. } | Block::Quote { runs } => runs,
            Block::Heading { text, .. } => vec![Run::plain(text)],
            Block::List { items, .. } => items.into_iter().flatten().collect(),
            Block::Divider | Block::Pictures { .. } => continue,
        };
        if !runs.is_empty() {
            runs.push(Run::plain("\n"));
        }
        for run in read {
            match runs.last_mut() {
                Some(last) if last.same_setting(&run) => last.text.push_str(&run.text),
                _ => runs.push(run),
            }
        }
    }
    runs
}

/// `runs` as they would be typed, marks and all.
#[must_use]
pub fn typed_of_runs(runs: &[Run]) -> String {
    crate::markup::source(&super::html::marked_html(runs))
}
