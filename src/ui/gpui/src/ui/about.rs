//! What is known of a channel without asking the server: the facts its
//! information sheet lists above its description.

use gpui::SharedString;

use crate::engine::{Channel, User};

/// One fact: what it is, and what it is for this channel.
type Fact = (SharedString, SharedString);

/// The facts of `channel`, among `channels` and with `users` connected.
pub(super) fn channel_facts(channel: &Channel, channels: &[Channel], users: &[User]) -> Vec<Fact> {
    let fact = |name: &'static str, value: String| (SharedString::from(name), value.into());
    let inside = users
        .iter()
        .filter(|user| user.channel == channel.id)
        .count();
    let mut facts = vec![fact("Kind", kind(channel).to_owned())];
    let parent = channel
        .parent
        .and_then(|id| channels.iter().find(|known| known.id == id));
    if let Some(parent) = parent {
        facts.push(fact("Inside", parent.name.to_string()));
    }
    facts.push(fact(
        "People",
        match channel.max_users {
            0 => inside.to_string(),
            limit => format!("{inside} of {limit}"),
        },
    ));
    facts.push(fact("Messages", kept(channel).to_owned()));
    facts.push(fact("Channel id", channel.id.to_string()));
    facts
}

/// What kind of room it is, by how one gets in and how long it stays.
fn kind(channel: &Channel) -> &'static str {
    match (channel.restricted, channel.temporary) {
        (true, true) => "Temporary, behind a password",
        (true, false) => "Behind a password",
        (false, true) => "Temporary: gone once it is empty",
        (false, false) if channel.parent.is_none() => "The server's root",
        (false, false) => "Open",
    }
}

/// What becomes of what is said in it.
fn kept(channel: &Channel) -> &'static str {
    match (channel.history, channel.encrypted) {
        (true, true) => "Kept, sealed with a key the server does not have",
        (true, false) => "Kept by the server",
        _ => "Not kept: only those here see them",
    }
}
