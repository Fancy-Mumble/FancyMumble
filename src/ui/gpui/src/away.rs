//! A message without the pictures it carries.
//!
//! A picture travels inside its message, as text a third longer than its
//! file. Held like that for every message of a conversation, by the engine
//! and again by the view, a channel people post pictures in costs many
//! times what is on screen. So a heavy message is held light: the engine
//! puts its body away in a file, and what is handed to the view has a mark
//! where each picture was. The whole body is read back for the rows that
//! are drawn, and let go of with them.

/// How long a body is before it is worth putting away: the engine's own
/// measure, under which a body costs more to fetch than to keep.
const HEAVY: usize = 64 * 1024;

/// What stands where a picture was, in a message held light.
const MARK: &str = "fancy-kept:";

/// Where a picture written into a message begins.
const PICTURE: &str = "src=\"data:image/";

/// Whether `html` is heavy with pictures: worth holding light.
pub(crate) fn is_heavy(html: &str) -> bool {
    html.len() > HEAVY && html.contains(PICTURE)
}

/// Whether `html` is a message held light: one whose pictures are to be
/// read back before it is drawn.
pub(crate) fn is_light(html: &str) -> bool {
    html.contains(MARK)
}

/// `html` with a mark where each picture written into it was: the words,
/// the links and the shape of the message, and none of its weight.
pub(crate) fn light(html: &str) -> String {
    let mut light = String::with_capacity(html.len().min(4096));
    let mut rest = html;
    let mut nth = 0;
    while let Some(at) = rest.find(PICTURE) {
        let (before, picture) = rest.split_at(at);
        light.push_str(before);
        // To the quote that closes the address; a message cut short ends
        // with it.
        let address = &picture["src=\"".len()..];
        let ends = address.find('"').unwrap_or(address.len());
        light.push_str("src=\"");
        light.push_str(MARK);
        light.push_str(&nth.to_string());
        nth += 1;
        rest = &address[ends..];
    }
    light.push_str(rest);
    light
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_is_held_light_with_a_mark_where_each_picture_was() {
        let picture = "A".repeat(HEAVY);
        let html = format!(
            r#"look <img src="data:image/png;base64,{picture}"/> and <b>this</b> <img alt="x" src="data:image/jpeg;base64,{picture}">"#
        );
        assert!(is_heavy(&html) && !is_light(&html));
        let light = light(&html);
        assert_eq!(
            light,
            r#"look <img src="fancy-kept:0"/> and <b>this</b> <img alt="x" src="fancy-kept:1">"#
        );
        assert!(is_light(&light) && !is_heavy(&light));
        // Read as it is, a picture that is not there is said to be one.
        assert_eq!(
            crate::rich::Rich::parse(&light).text.trim(),
            "look [image] and this [x]"
        );
    }

    #[test]
    fn what_is_not_heavy_is_left_as_it_is() {
        let small = r#"<img src="data:image/png;base64,aGkh"/>"#;
        assert!(!is_heavy(small));
        let words = "w".repeat(HEAVY * 2);
        assert!(!is_heavy(&words), "long, and no picture");
        assert_eq!(light("no pictures"), "no pictures");
        // Cut short in the middle of a picture: nothing is lost but that.
        assert_eq!(
            light(r#"a <img src="data:image/png;base64,AAAA"#),
            r#"a <img src="fancy-kept:0"#
        );
    }
}
