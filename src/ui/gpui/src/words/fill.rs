//! Putting values into what is said: `{{name}}`, as the web client's files
//! write it.

use std::fmt::{Display, Write as _};

use gpui::SharedString;

/// `template` with each `{{name}}` in it replaced by the value given for
/// that name. A name given no value is left as it is written, where it shows.
///
/// What follows a comma inside the braces (`{{value, number}}`) is how the
/// web client formats a value; the value is put in as it displays.
pub(crate) fn fill(template: SharedString, values: &[(&str, &dyn Display)]) -> SharedString {
    if !template.contains("{{") {
        return template;
    }
    let mut filled = String::with_capacity(template.len() + 16);
    let mut rest = template.as_ref();
    while let Some(open) = rest.find("{{") {
        let Some(close) = rest[open..].find("}}").map(|close| open + close) else {
            break;
        };
        filled.push_str(&rest[..open]);
        let inside = &rest[open + 2..close];
        let name = inside.split(',').next().unwrap_or_default().trim();
        match values.iter().find(|(given, _)| *given == name) {
            Some((_, value)) => {
                let _ = write!(filled, "{value}");
            }
            None => filled.push_str(&rest[open..close + 2]),
        }
        rest = &rest[close + 2..];
    }
    filled.push_str(rest);
    filled.into()
}
