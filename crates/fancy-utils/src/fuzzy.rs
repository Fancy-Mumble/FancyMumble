//! Fuzzy string matching utilities.
//!
//! Provides a simplified Smith-Waterman-style scoring algorithm for
//! matching a query pattern against candidate text. Lower scores are
//! better. Useful for search-as-you-type UIs.

/// Default score threshold - results worse than this are discarded.
pub const DEFAULT_SCORE_CUTOFF: u32 = 500;

/// Compute a fuzzy match score between `pattern` and `text`.
///
/// Both strings should be lowercase (or otherwise normalised) before
/// calling this function.
///
/// Returns `Some(score)` if the pattern fuzzy-matches the text, where
/// lower scores are better. Returns `None` if no match.
///
/// The algorithm:
/// - Exact substring match gets the best score (0 + length penalty).
/// - Character-by-character fuzzy match allows gaps and transpositions.
/// - Consecutive matches and word-boundary matches get bonuses.
///
/// Results with a score above `score_cutoff` are discarded.
pub fn fuzzy_score(pattern: &str, text: &str, score_cutoff: u32) -> Option<u32> {
    if pattern.is_empty() {
        return Some(0);
    }

    // Quick exact substring check (best possible match).
    if text.contains(pattern) {
        // Score based on how much "extra" text surrounds the match.
        // Shorter texts matching fully get better scores.
        // Counted in characters, so a text in a script that takes several
        // bytes per letter does not rank below the same text in ASCII.
        let len_diff = text.chars().count().saturating_sub(pattern.chars().count()) as u32;
        return Some(len_diff);
    }

    let pattern_chars: Vec<char> = pattern.chars().collect();
    let text_chars: Vec<char> = text.chars().collect();

    if pattern_chars.len() > text_chars.len() + 2 {
        return None;
    }

    // Try fuzzy character-by-character matching allowing skips and
    // single-character transpositions / substitutions.
    let score = fuzzy_match_chars(&pattern_chars, &text_chars)?;

    if score > score_cutoff {
        return None;
    }

    Some(score)
}

/// Character-level fuzzy matching with gap penalties and bonuses.
///
/// Uses a greedy forward scan with backtracking for transpositions.
fn fuzzy_match_chars(pattern: &[char], text: &[char]) -> Option<u32> {
    let mut score: u32 = 0;
    let mut text_idx = 0;
    let mut pat_idx = 0;
    let mut consecutive = 0u32;
    let mut matched = 0u32;

    while pat_idx < pattern.len() && text_idx < text.len() {
        let p = pattern[pat_idx];
        let t = text[text_idx];

        if p == t {
            // Direct match
            matched += 1;
            consecutive += 1;
            // Bonus for consecutive matches (subtract from score).
            if consecutive > 1 {
                score = score.saturating_sub(consecutive * 2);
            }
            // Bonus for matching at start or after a word boundary.
            if text_idx == 0 || is_boundary(text[text_idx - 1]) {
                score = score.saturating_sub(10);
            }
            pat_idx += 1;
            text_idx += 1;
        } else if pat_idx + 1 < pattern.len()
            && text_idx + 1 < text.len()
            && pattern[pat_idx + 1] == t
            && p == text[text_idx + 1]
        {
            // Transposition: "ab" in pattern matches "ba" in text.
            matched += 2;
            score += 5; // small penalty for transposition
            pat_idx += 2;
            text_idx += 2;
            consecutive = 0;
        } else {
            // Gap in text (skip one text char).
            score += 3;
            text_idx += 1;
            consecutive = 0;
        }
    }

    // Remaining unmatched pattern characters: each is a substitution/typo.
    let remaining = (pattern.len() - pat_idx) as u32;
    if remaining > 0 {
        // Allow up to ~30% of pattern length as typos.
        let max_typos = (pattern.len() as u32 / 3).max(1);
        if remaining > max_typos {
            return None;
        }
        score += remaining * 15;
        matched += remaining; // count as "matched" for threshold
    }

    // Must match at least 60% of pattern chars (via direct or transposition).
    let min_matched = ((pattern.len() as f32) * 0.6).ceil() as u32;
    if matched < min_matched {
        return None;
    }

    // Penalty for text being much longer than the pattern.
    let len_ratio = text.len() as u32 / (pattern.len() as u32).max(1);
    score += len_ratio;

    Some(score)
}

/// Check if a character is a word boundary (space, punctuation, etc.).
pub fn is_boundary(c: char) -> bool {
    c.is_whitespace() || c == '_' || c == '-' || c == '.'
}

/// Extract a snippet of `text` around the first occurrence of `query`,
/// capped at `max_len` characters.
///
/// `text` is HTML; the snippet is cut from its visible text (see
/// [`crate::html::visible_text`]), so markup, entities and inline image
/// payloads never show up in it.
pub fn snippet(text: &str, query: &str, max_len: usize) -> String {
    snippet_plain(&crate::html::visible_text(text), query, max_len)
}

/// Like [`snippet`], for text that is already plain.
///
/// Works in characters throughout. Byte offsets used to be sliced
/// straight into the text, and any window edge that fell inside a
/// multibyte character ("a" followed by sixty 'ä', say) panicked - in a
/// build that aborts on panic, the whole client went down on a search.
pub fn snippet_plain(plain: &str, query: &str, max_len: usize) -> String {
    let chars: Vec<char> = plain.chars().collect();
    let pos = find_char_ignore_case(&chars, query).unwrap_or(0);

    // Center the snippet around the match.
    let half = max_len / 2;
    let start = pos.saturating_sub(half);
    let end = (start + max_len).min(chars.len());
    let start = if end == chars.len() {
        end.saturating_sub(max_len)
    } else {
        start
    };

    let mut s = String::new();
    if start > 0 {
        s.push_str("...");
    }
    s.extend(&chars[start..end]);
    if end < chars.len() {
        s.push_str("...");
    }
    s
}

/// Character index of the first case-insensitive occurrence of `query`
/// in `chars`.
///
/// Compares character by character, lowercasing each side as it goes,
/// rather than searching a lowercased copy: `to_lowercase` changes the
/// length of some characters ('İ' becomes two), so an offset found in the
/// copy does not point at the same place in the original.
fn find_char_ignore_case(chars: &[char], query: &str) -> Option<usize> {
    let query: Vec<char> = query.chars().flat_map(char::to_lowercase).collect();
    if query.is_empty() {
        return None;
    }
    (0..chars.len()).find(|&start| {
        let mut lowered = chars[start..].iter().flat_map(|c| c.to_lowercase());
        query.iter().all(|q| lowered.next() == Some(*q))
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    fn exact_match_scores_zero() {
        assert_eq!(fuzzy_score("hello", "hello", DEFAULT_SCORE_CUTOFF), Some(0));
    }

    #[test]
    fn substring_match_scores_length_diff() {
        // "ello" inside "hello" => len_diff = 1
        assert_eq!(fuzzy_score("ello", "hello", DEFAULT_SCORE_CUTOFF), Some(1));
    }

    #[test]
    fn no_match_returns_none() {
        assert_eq!(fuzzy_score("xyz", "abc", DEFAULT_SCORE_CUTOFF), None);
    }

    #[test]
    fn empty_pattern_matches_everything() {
        assert_eq!(fuzzy_score("", "anything", DEFAULT_SCORE_CUTOFF), Some(0));
    }

    #[test]
    fn transposition_is_penalised() {
        let score = fuzzy_score("ab", "ba", DEFAULT_SCORE_CUTOFF);
        assert!(score.is_some());
        assert!(score.unwrap() > 0);
    }

    #[test]
    fn boundary_chars() {
        assert!(is_boundary(' '));
        assert!(is_boundary('_'));
        assert!(is_boundary('-'));
        assert!(is_boundary('.'));
        assert!(!is_boundary('a'));
    }

    #[test]
    fn snippet_centers_around_query() {
        let text = "The quick brown fox jumps over the lazy dog";
        let s = snippet(text, "fox", 20);
        assert!(s.contains("fox"));
    }

    #[test]
    fn snippet_strips_html() {
        let text = "<b>hello</b> world";
        let s = snippet(text, "hello", 50);
        assert!(s.contains("hello"));
        assert!(!s.contains("<b>"));
    }

    #[test]
    fn snippet_never_cuts_a_multibyte_character() {
        // Used to panic: "end byte index 80 is not a char boundary".
        let text = format!("a{}", "ä".repeat(60));
        let s = snippet(&text, "a", 80);
        assert_eq!(s, text);
        let s = snippet(&text, "a", 20);
        assert_eq!(s, format!("a{}...", "ä".repeat(19)));
    }

    #[test]
    fn snippet_window_is_counted_in_characters() {
        let text = format!("{}needle{}", "ü".repeat(100), "ö".repeat(100));
        let s = snippet(&text, "NEEDLE", 20);
        assert_eq!(
            s,
            format!("...{}needle{}...", "ü".repeat(10), "ö".repeat(4))
        );
    }

    #[test]
    fn snippet_finds_the_match_after_case_changing_characters() {
        // 'İ' lowercases to two characters; a position found in a lowercased
        // copy would land past the real match.
        let text = format!("{}target{}", "İ".repeat(50), "x".repeat(50));
        let s = snippet(&text, "target", 10);
        assert_eq!(s, "...İİİİİtarge...");
    }

    #[test]
    fn snippet_decodes_entities_and_drops_markup() {
        let s = snippet("<p>fish&nbsp;&amp;&nbsp;chips</p><br>", "chips", 50);
        assert_eq!(s, "fish & chips");
    }

    #[test]
    fn snippet_without_a_match_starts_at_the_beginning() {
        assert_eq!(snippet_plain("ääääää", "zz", 3), "äää...");
        assert_eq!(snippet_plain("", "zz", 3), "");
    }

    #[test]
    fn exact_match_length_penalty_counts_characters() {
        assert_eq!(fuzzy_score("a", "aää", DEFAULT_SCORE_CUTOFF), Some(2));
    }
}
