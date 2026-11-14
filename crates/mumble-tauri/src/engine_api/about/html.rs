//! The plain HTML an about is written as, after the profile's mark, for the
//! clients that do not read about: plain Mumble, and Fancy clients from
//! before it. Only what the web client lets through of a bio (`p`, `br`,
//! `strong`, `em`, `u`, `a`, and `span` with a style), which plain Mumble
//! draws as well. Pictures are left out: they would ride in the comment a
//! second time.

use super::model::{About, Align, Block, Run};

impl About {
    /// The about as plain, basic HTML.
    #[must_use]
    pub fn html(&self) -> String {
        let mut writer = Writer::default();
        self.blocks.iter().for_each(|block| writer.block(block));
        writer.out
    }
}

/// `runs` as HTML with a tag for each mark (`s`, `code`), which is what the
/// engine's reading of typed marks writes and reads back.
pub(super) fn marked_html(runs: &[Run]) -> String {
    let mut writer = Writer {
        out: String::new(),
        tagged: true,
    };
    writer.runs(runs);
    writer.out
}

/// Writes blocks as HTML, one after another.
#[derive(Default)]
struct Writer {
    out: String,
    /// Struck text and code as tags of their own rather than styled spans,
    /// which a bio may not hold.
    tagged: bool,
}

impl Writer {
    fn block(&mut self, block: &Block) {
        match block {
            Block::Heading { text, align } => {
                self.open(*align);
                self.out.push_str("<strong>");
                self.text(text);
                self.out.push_str("</strong></p>");
            }
            Block::Text { runs, align } => {
                self.open(*align);
                self.runs(runs);
                self.out.push_str("</p>");
            }
            Block::List {
                numbered,
                items,
                align,
            } => {
                self.open(*align);
                for (at, item) in items.iter().enumerate() {
                    if at > 0 {
                        self.out.push_str("<br>");
                    }
                    if *numbered {
                        self.out.push_str(&format!("{}. ", at + 1));
                    } else {
                        self.out.push_str("\u{2022} ");
                    }
                    self.runs(item);
                }
                self.out.push_str("</p>");
            }
            Block::Quote { runs } => {
                self.out.push_str("<p>\u{201c}<em>");
                self.runs(runs);
                self.out.push_str("</em>\u{201d}</p>");
            }
            Block::Divider => self.out.push_str("<p>\u{2014}\u{2014}\u{2014}</p>"),
            Block::Pictures { .. } => {}
        }
    }

    fn open(&mut self, align: Align) {
        self.out.push_str(match align {
            Align::Left => "<p>",
            Align::Center => r#"<p style="text-align:center">"#,
            Align::Right => r#"<p style="text-align:right">"#,
        });
    }

    fn runs(&mut self, runs: &[Run]) {
        runs.iter().for_each(|run| self.run(run));
    }

    fn run(&mut self, run: &Run) {
        let (strike, code) = if self.tagged {
            (("<s>", "</s>"), ("<code>", "</code>"))
        } else {
            (
                (r#"<span style="text-decoration:line-through">"#, "</span>"),
                (r#"<span style="font-family:monospace">"#, "</span>"),
            )
        };
        let marks = [
            (run.bold, "<strong>", "</strong>"),
            (run.italic, "<em>", "</em>"),
            (run.underline, "<u>", "</u>"),
            (run.strike, strike.0, strike.1),
            (run.code, code.0, code.1),
        ];
        if let Some(link) = &run.link {
            self.out.push_str("<a href=\"");
            self.attribute(link);
            self.out.push_str("\">");
        }
        for (on, opens, _) in marks {
            if on {
                self.out.push_str(opens);
            }
        }
        self.text(&run.text);
        for (on, _, closes) in marks.iter().rev() {
            if *on {
                self.out.push_str(closes);
            }
        }
        if run.link.is_some() {
            self.out.push_str("</a>");
        }
    }

    /// Text, with what means something in HTML written out, and its line
    /// breaks as breaks.
    fn text(&mut self, text: &str) {
        for character in text.chars() {
            match character {
                '&' => self.out.push_str("&amp;"),
                '<' => self.out.push_str("&lt;"),
                '>' => self.out.push_str("&gt;"),
                '\n' => self.out.push_str("<br>"),
                other => self.out.push(other),
            }
        }
    }

    /// A value inside double quotes.
    fn attribute(&mut self, value: &str) {
        for character in value.chars() {
            match character {
                '&' => self.out.push_str("&amp;"),
                '"' => self.out.push_str("&quot;"),
                '<' => self.out.push_str("&lt;"),
                '>' => self.out.push_str("&gt;"),
                other => self.out.push(other),
            }
        }
    }
}
