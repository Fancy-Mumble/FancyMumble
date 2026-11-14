//! Setting what is selected apart with a mark, and taking the mark off
//! again: what the composer's format bar and its keys do to the text.
//!
//! Whether words have a mark is read off the engine's own reading of the
//! text (the [`Setting`] of each stretch), never worked out again here: two
//! readings would be two dialects. What changes is only marks, put in and
//! taken out, so the words stay as they were and stay selected.

use std::ops::Range;

use crate::engine::Setting;

/// The modifier the marks' keys are held with, as this platform writes it.
const COMMAND: &str = if cfg!(target_os = "macos") {
    "⌘"
} else {
    "Ctrl+"
};

/// Where a link's address names no way of opening it, the one it is given.
const DEFAULT_SCHEME: &str = "https://";

/// The ways of opening a link that the engine writes one for.
const SCHEMES: &[&str] = &["https://", "http://", "mailto:", "mumble://"];

/// A way of setting words apart that is typed as a mark on either side.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mark {
    Bold,
    Italic,
    Underlined,
    Struck,
    Code,
    /// Hidden until the reader asks for it.
    Hidden,
}

impl Mark {
    pub(crate) const ALL: [Self; 6] = [
        Self::Bold,
        Self::Italic,
        Self::Underlined,
        Self::Struck,
        Self::Code,
        Self::Hidden,
    ];

    /// The mark as it is put in.
    pub(crate) const fn written(self) -> &'static str {
        self.spellings()[0]
    }

    /// Every way of typing it that reads as it, the one put in first.
    const fn spellings(self) -> &'static [&'static str] {
        match self {
            Self::Bold => &["**"],
            Self::Italic => &["*", "_"],
            Self::Underlined => &["__"],
            Self::Struck => &["~~"],
            Self::Code => &["`"],
            Self::Hidden => &["||"],
        }
    }

    /// Whether a stretch set as `setting` has it.
    const fn on(self, setting: Setting) -> bool {
        match self {
            Self::Bold => setting.bold,
            Self::Italic => setting.italic,
            Self::Underlined => setting.underlined,
            Self::Struck => setting.struck,
            Self::Code => setting.code,
            Self::Hidden => setting.hidden,
        }
    }

    /// The letter that sets it, held with the command key, and whether
    /// shift is held too: the web UI's keys, and this client's own where
    /// the web UI has none.
    pub(crate) const fn key(self) -> (&'static str, bool) {
        match self {
            Self::Bold => ("b", false),
            Self::Italic => ("i", false),
            Self::Underlined => ("u", false),
            Self::Struck => ("x", true),
            Self::Code => ("e", false),
            Self::Hidden => ("h", true),
        }
    }

    /// That key as a person reads it: `Ctrl+B`.
    pub(crate) fn shortcut(self) -> String {
        let (key, shift) = self.key();
        let shift = if shift { "Shift+" } else { "" };
        format!("{COMMAND}{shift}{}", key.to_uppercase())
    }
}

/// What is typed as a link's address, as the link is written with it:
/// given `https://` where it names no way of opening it, and nothing where
/// it cannot be an address.
pub(crate) fn address(typed: &str) -> Option<String> {
    let typed = typed.trim();
    let unfit = |c: char| c.is_whitespace() || "\"<>()[]".contains(c);
    if typed.is_empty() || typed.contains(unfit) {
        return None;
    }
    if SCHEMES.iter().any(|scheme| typed.starts_with(scheme)) {
        Some(typed.to_owned())
    } else if typed.contains("://") {
        None
    } else {
        Some(format!("{DEFAULT_SCHEME}{typed}"))
    }
}

/// The text after a change, and what is selected in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Rewritten {
    pub text: String,
    pub selected: Range<usize>,
}

/// What is typed, what of it is selected, and how the engine reads it: the
/// stretches that are set apart, in order, with how each is set.
pub(crate) struct Draft {
    text: String,
    selected: Range<usize>,
    read: Vec<(Range<usize>, Setting)>,
}

impl Draft {
    pub(crate) fn new(
        text: &str,
        selected: Range<usize>,
        read: Vec<(Range<usize>, Setting)>,
    ) -> Self {
        Self {
            text: text.to_owned(),
            selected,
            read,
        }
    }

    /// Whether every word selected is set apart by `mark`.
    pub(crate) fn has(&self, mark: Mark) -> bool {
        self.all_words(|setting| mark.on(setting))
    }

    /// Whether every word selected is the words of a link.
    pub(crate) fn is_linked(&self) -> bool {
        self.all_words(|setting| setting.linked)
    }

    /// `mark` put round the selection, or taken off it if all of it has it
    /// already. With nothing selected, the caret is left between the two
    /// marks, or an empty pair round it is taken away.
    pub(crate) fn toggle(&self, mark: Mark) -> Rewritten {
        if self.selected.is_empty() {
            return self.toggle_at_caret(mark);
        }
        let mut edits = Edits::default();
        if self.has(mark) {
            self.take_off(mark, &mut edits);
        } else {
            self.put_on(mark, &mut edits);
        }
        edits.apply(&self.text, &self.selected)
    }

    /// The selection made the words of a link to `address`, which is
    /// written as it is given. What was linked in it is not any more.
    pub(crate) fn link(&self, address: &str) -> Rewritten {
        let target = trimmed(&self.text, self.selected.clone());
        if target.is_empty() || self.text[target.clone()].contains('\n') {
            return self.unchanged();
        }
        let mut edits = Edits::default();
        self.cut_links(&mut edits);
        edits.put(target.start, "[");
        edits.put(target.end, &format!("]({address})"));
        edits.apply(&self.text, &self.selected)
    }

    /// The links the selection is in, undone: their words stay.
    pub(crate) fn unlink(&self) -> Rewritten {
        let mut edits = Edits::default();
        self.cut_links(&mut edits);
        edits.apply(&self.text, &self.selected)
    }

    fn unchanged(&self) -> Rewritten {
        Rewritten {
            text: self.text.clone(),
            selected: self.selected.clone(),
        }
    }

    /// How the character at `at` is set.
    fn setting_at(&self, at: usize) -> Setting {
        self.read
            .iter()
            .find(|(range, _)| range.contains(&at))
            .map(|(_, setting)| *setting)
            .unwrap_or_default()
    }

    /// Whether there is a word selected, and every one is set as `test`
    /// says. Marks and white space are not words.
    fn all_words(&self, test: impl Fn(Setting) -> bool) -> bool {
        let start = self.selected.start;
        let mut words = self.text[self.selected.clone()]
            .char_indices()
            .filter(|(_, character)| !character.is_whitespace())
            .map(|(at, _)| self.setting_at(start + at))
            .filter(|setting| !setting.mark)
            .peekable();
        words.peek().is_some() && words.all(test)
    }

    /// The stretches set as `test` says, each as far as it runs unbroken.
    fn runs(&self, test: impl Fn(Setting) -> bool) -> Vec<Range<usize>> {
        let mut runs: Vec<Range<usize>> = Vec::new();
        for (range, _) in self.read.iter().filter(|(_, setting)| test(*setting)) {
            match runs.last_mut() {
                Some(last) if last.end == range.start => last.end = range.end,
                _ => runs.push(range.clone()),
            }
        }
        runs
    }

    /// The runs set as `test` says that share some of the selection.
    fn selected_runs(&self, test: impl Fn(Setting) -> bool) -> Vec<Range<usize>> {
        let selected = &self.selected;
        self.runs(test)
            .into_iter()
            .filter(|run| run.start < selected.end && selected.start < run.end)
            .collect()
    }

    /// The marks on either side of `run` that set it apart as `mark`, if
    /// they are typed there.
    fn marks_round(&self, run: &Range<usize>, mark: Mark) -> Option<(Range<usize>, Range<usize>)> {
        mark.spellings()
            .iter()
            .find(|spelled| {
                self.text[..run.start].ends_with(*spelled)
                    && self.text[run.end..].starts_with(*spelled)
            })
            .map(|spelled| {
                (
                    run.start - spelled.len()..run.start,
                    run.end..run.end + spelled.len(),
                )
            })
    }

    /// Take `mark` off what is selected. What of a run lies outside the
    /// selection keeps it, closed and opened again at the selection's
    /// edges.
    fn take_off(&self, mark: Mark, edits: &mut Edits) {
        let selected = &self.selected;
        for run in self.selected_runs(|setting| mark.on(setting)) {
            let Some((open, close)) = self.marks_round(&run, mark) else {
                continue;
            };
            let spelled = &self.text[open.clone()];
            let before = trimmed(&self.text, run.start..selected.start.max(run.start));
            let after = trimmed(&self.text, selected.end.min(run.end)..run.end);
            if before.is_empty() {
                edits.cut(open);
            } else {
                edits.put(before.end, spelled);
            }
            if after.is_empty() {
                edits.cut(close);
            } else {
                edits.put(after.start, spelled);
            }
        }
    }

    /// Put `mark` round what is selected, a line at a time, the white space
    /// at its ends left outside. A run with the mark already that it
    /// overlaps or touches joins it, under one pair of marks.
    fn put_on(&self, mark: Mark, edits: &mut Edits) {
        let runs: Vec<_> = self
            .runs(|setting| mark.on(setting))
            .iter()
            .filter_map(|run| self.marks_round(run, mark))
            .collect();
        for line in lines(&self.text, self.selected.clone()) {
            let target = trimmed(&self.text, line);
            if target.is_empty() {
                continue;
            }
            let mut joined = target.clone();
            for (open, close) in &runs {
                if open.start <= target.end && target.start <= close.end {
                    joined.start = joined.start.min(open.start);
                    joined.end = joined.end.max(close.end);
                    edits.cut(open.clone());
                    edits.cut(close.clone());
                }
            }
            edits.put(joined.start, mark.written());
            edits.put(joined.end, mark.written());
        }
    }

    /// Cut the brackets and the address from every link the selection is
    /// in.
    fn cut_links(&self, edits: &mut Edits) {
        for run in self.selected_runs(|setting| setting.linked) {
            let closing = self.text[run.end..]
                .strip_prefix("](")
                .and_then(|address| address.find(')'))
                .map(|len| run.end..run.end + "](".len() + len + 1);
            if self.text[..run.start].ends_with('[')
                && let Some(closing) = closing
            {
                edits.cut(run.start - 1..run.start);
                edits.cut(closing);
            }
        }
    }

    /// The caret's mark: a pair put in with the caret between them, or an
    /// empty pair round the caret taken away.
    fn toggle_at_caret(&self, mark: Mark) -> Rewritten {
        let at = self.selected.start;
        let written = mark.written();
        // A mark is one character said once or more (`*`, `**`, `~~`), so
        // whether it is there is read off how many of that character stand
        // against the caret: a pair of stars is in two or three of them, a
        // single one in one or three.
        let sign = written.chars().next().unwrap_or('*');
        let before = self.text[..at]
            .chars()
            .rev()
            .take_while(|c| *c == sign)
            .count();
        let after = self.text[at..].chars().take_while(|c| *c == sign).count();
        let said = written.chars().count();
        let there = |run: usize| run >= said && (said != 1 || run % 2 == 1);
        let (text, caret) = if there(before) && there(after) {
            let text = [
                &self.text[..at - written.len()],
                &self.text[at + written.len()..],
            ]
            .concat();
            (text, at - written.len())
        } else {
            let text = [&self.text[..at], written, written, &self.text[at..]].concat();
            (text, at + written.len())
        };
        Rewritten {
            text,
            selected: caret..caret,
        }
    }
}

/// Marks taken out of a text and put into it, carried out all at once.
#[derive(Debug, Default)]
struct Edits {
    cuts: Vec<Range<usize>>,
    puts: Vec<(usize, String)>,
}

impl Edits {
    fn cut(&mut self, range: Range<usize>) {
        self.cuts.push(range);
    }

    fn put(&mut self, at: usize, text: &str) {
        self.puts.push((at, text.to_owned()));
    }

    /// `text` with the changes made, and `selected` where it is after them:
    /// what is put at its start stands before it, and what is put at its
    /// end after it.
    fn apply(mut self, text: &str, selected: &Range<usize>) -> Rewritten {
        // Stable: what is put at one place goes in in the order it was put.
        self.puts.sort_by_key(|(at, _)| *at);
        let mut points: Vec<usize> = self
            .cuts
            .iter()
            .flat_map(|cut| [cut.start, cut.end])
            .chain(self.puts.iter().map(|(at, _)| *at))
            .chain([selected.start, selected.end, text.len()])
            .collect();
        points.sort_unstable();
        points.dedup();
        let mut out = String::with_capacity(text.len() + 16);
        let (mut from, mut start, mut end) = (0, 0, 0);
        let mut puts = self.puts.iter().peekable();
        for point in points {
            let cut = self
                .cuts
                .iter()
                .any(|cut| cut.start <= from && point <= cut.end);
            if !cut {
                out.push_str(&text[from..point]);
            }
            if point == selected.end {
                end = out.len();
            }
            while let Some((_, put)) = puts.next_if(|(at, _)| *at == point) {
                out.push_str(put);
            }
            if point == selected.start {
                start = out.len();
            }
            from = point;
        }
        Rewritten {
            text: out,
            selected: start..end.max(start),
        }
    }
}

/// `range` of `text` without the white space at either end.
fn trimmed(text: &str, range: Range<usize>) -> Range<usize> {
    let inside = &text[range.clone()];
    let start = range.start + (inside.len() - inside.trim_start().len());
    let end = range.end - (inside.len() - inside.trim_end().len());
    start..end.max(start)
}

/// `range` of `text` cut where its lines break, the breaks left out.
fn lines(text: &str, range: Range<usize>) -> Vec<Range<usize>> {
    let mut start = range.start;
    let mut lines = Vec::new();
    for (at, _) in text[range.clone()].match_indices('\n') {
        lines.push(start..range.start + at);
        start = range.start + at + 1;
    }
    lines.push(start..range.end);
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `mark` toggled on what `text` has between `[` and `]`, read as the
    /// engine reads it; the result written the same way.
    fn toggled(text: &str, mark: Mark) -> String {
        with_selection(text, |draft| draft.toggle(mark))
    }

    /// Whether what is selected (between `[` and `]`) has `mark`.
    fn has(text: &str, mark: Mark) -> bool {
        let (plain, selected) = parse(text);
        let read = crate::real::typed(&plain);
        Draft::new(&plain, selected, read).has(mark)
    }

    /// `text` without the brackets that say what is selected, and that.
    fn parse(text: &str) -> (String, Range<usize>) {
        let start = text.find('[').expect("a selection");
        let end = text.rfind(']').expect("a selection") - 1;
        let plain = [&text[..start], &text[start + 1..=end], &text[end + 2..]].concat();
        (plain, start..end)
    }

    fn with_selection(text: &str, change: impl Fn(&Draft) -> Rewritten) -> String {
        let (plain, selected) = parse(text);
        let read = crate::real::typed(&plain);
        let Rewritten { text, selected } = change(&Draft::new(&plain, selected, read));
        format!(
            "{}[{}]{}",
            &text[..selected.start],
            &text[selected.clone()],
            &text[selected.end..]
        )
    }

    #[test]
    fn each_mark_goes_round_the_selection_and_comes_off_again() {
        for (mark, written) in [
            (Mark::Bold, "**"),
            (Mark::Italic, "*"),
            (Mark::Underlined, "__"),
            (Mark::Struck, "~~"),
            (Mark::Code, "`"),
            (Mark::Hidden, "||"),
        ] {
            let on = toggled("so [loud] now", mark);
            assert_eq!(on, format!("so {written}[loud]{written} now"), "{mark:?}");
            assert!(has(&on, mark), "{mark:?} is on");
            assert_eq!(toggled(&on, mark), "so [loud] now", "{mark:?} comes off");
        }
    }

    #[test]
    fn two_marks_stack_and_each_comes_off_on_its_own() {
        let both = toggled(&toggled("so [loud] now", Mark::Bold), Mark::Italic);
        assert_eq!(both, "so ***[loud]*** now");
        assert!(has(&both, Mark::Bold) && has(&both, Mark::Italic));
        assert_eq!(toggled(&both, Mark::Bold), "so *[loud]* now");
        assert_eq!(toggled(&both, Mark::Italic), "so **[loud]** now");
    }

    #[test]
    fn a_selection_that_takes_in_the_marks_takes_them_off() {
        assert_eq!(toggled("so [**loud**] now", Mark::Bold), "so [loud] now");
        assert_eq!(toggled("[*so*]", Mark::Italic), "[so]");
        // An underscore's italic comes off as well as a star's.
        assert_eq!(toggled("a _[so]_ b", Mark::Italic), "a [so] b");
    }

    #[test]
    fn a_partly_marked_selection_is_marked_all_through_once() {
        assert!(!has("a [**lo**ud] b", Mark::Bold), "not all of it");
        assert_eq!(toggled("a [**lo**ud] b", Mark::Bold), "a **[loud]** b");
        assert_eq!(toggled("a **l[o**ud] b", Mark::Bold), "a **l[oud]** b");
        assert_eq!(
            toggled("[one **two** three]", Mark::Bold),
            "**[one two three]**"
        );
        // A run it only touches joins it too.
        assert_eq!(toggled("**ab**[cd]", Mark::Bold), "**ab[cd]**");
    }

    #[test]
    fn taking_a_mark_off_part_of_a_run_leaves_the_rest_marked() {
        assert!(has("**so [loud]**", Mark::Bold));
        assert_eq!(toggled("**so [loud]**", Mark::Bold), "**so** [loud]");
        assert_eq!(toggled("**a [b] c**", Mark::Bold), "**a** [b] **c**");
        assert_eq!(toggled("**lo[u]d**", Mark::Bold), "**lo**[u]**d**");
    }

    #[test]
    fn white_space_at_the_ends_stays_outside_the_marks() {
        assert_eq!(toggled("a[ loud ]b", Mark::Bold), "a[ **loud** ]b");
        assert_eq!(toggled("[ ]", Mark::Bold), "[ ]", "nothing to set apart");
        assert!(!has("[ ]", Mark::Bold));
    }

    #[test]
    fn a_selection_over_lines_is_marked_a_line_at_a_time() {
        assert_eq!(toggled("[one\ntwo]", Mark::Bold), "**[one**\n**two]**");
        assert!(has("**[one**\n**two]**", Mark::Bold));
        assert_eq!(toggled("**[one**\n**two]**", Mark::Bold), "[one\ntwo]");
    }

    #[test]
    fn with_nothing_selected_the_caret_is_left_between_the_marks() {
        assert_eq!(toggled("aß []", Mark::Struck), "aß ~~[]~~");
        assert_eq!(
            toggled("aß ~~[]~~", Mark::Struck),
            "aß []",
            "and they go as they came"
        );
        // A pair of stars is not a single one: slanting what is heavy adds.
        assert_eq!(toggled("**[]**", Mark::Italic), "***[]***");
    }

    #[test]
    fn the_moving_end_of_a_selection_moves_with_it() {
        let read = crate::real::typed("code");
        let rewritten = Draft::new("code", 0..4, read).toggle(Mark::Code);
        assert_eq!(rewritten.text, "`code`");
        assert_eq!(rewritten.selected, 1..5);
    }

    #[test]
    fn a_link_is_put_round_the_selection_and_undone() {
        let linked = with_selection("see [the docs] now", |draft| {
            draft.link("https://example.org")
        });
        assert_eq!(linked, "see [[the docs]](https://example.org) now");
        let (plain, selected) = ("see [the docs](https://example.org) now".to_owned(), 5..13);
        let read = crate::real::typed(&plain);
        let draft = Draft::new(&plain, selected, read);
        assert!(draft.is_linked());
        let undone = draft.unlink();
        assert_eq!(undone.text, "see the docs now");
        assert_eq!(&undone.text[undone.selected], "the docs");
        // Linking linked words again links them once, to the new address.
        let relinked = draft.link("https://example.com");
        assert_eq!(relinked.text, "see [the docs](https://example.com) now");
        // Marks inside the words stay.
        let marked = with_selection("[**big**]", |draft| draft.link("https://a.example"));
        assert_eq!(marked, "[[**big**]](https://a.example)");
    }

    #[test]
    fn what_is_typed_as_an_address_is_made_one_or_refused() {
        assert_eq!(
            address(" example.org/a?b=1 ").as_deref(),
            Some("https://example.org/a?b=1")
        );
        assert_eq!(
            address("http://x.example").as_deref(),
            Some("http://x.example")
        );
        assert_eq!(
            address("mailto:a@b.example").as_deref(),
            Some("mailto:a@b.example")
        );
        for refused in [
            "",
            "  ",
            "two words",
            "javascript:alert(1)",
            "ftp://x",
            "a\"b",
            "a)b",
        ] {
            assert_eq!(address(refused), None, "{refused}");
        }
        // Whatever is made one, the engine reads as a link.
        for typed in ["example.org", "mumble://host:64738", "mailto:a@b.example"] {
            let written = format!("[a]({})", address(typed).expect("an address"));
            assert!(
                crate::real::typed(&written)
                    .iter()
                    .any(|(_, setting)| setting.linked),
                "{typed}"
            );
        }
    }

    #[test]
    fn the_keys_are_read_as_a_person_writes_them() {
        if !cfg!(target_os = "macos") {
            assert_eq!(Mark::Bold.shortcut(), "Ctrl+B");
            assert_eq!(Mark::Struck.shortcut(), "Ctrl+Shift+X");
        }
    }
}
