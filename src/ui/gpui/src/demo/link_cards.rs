//! The demo's made-up link cards: with `FANCY_GPUI_DEMO_LINKS=<variant>`
//! Scout's last message is a link and nothing else, and the server's card
//! for it is one of these, each a different poster. The pictures are read
//! from `FANCY_GPUI_DEMO_LINK_FILES` (the web preview's `preview/linkcards`).
//!
//! The same cards, pictures and words as the web preview's `?links=<variant>`
//! (`src/ui/tauri/ui/preview/native.tsx`): change the two together.

use std::sync::Arc;

use gpui::SharedString;

use crate::engine::{Conversation, Message, Preview, PreviewDetails, PreviewPrice};

/// One made-up card.
pub(super) struct Card {
    name: &'static str,
    url: &'static str,
    kind: &'static str,
    title: &'static str,
    description: Option<&'static str>,
    site: Option<&'static str>,
    author: Option<&'static str>,
    duration: Option<&'static str>,
    /// The picture's file and its size.
    picture: Option<(&'static str, u32, u32)>,
    icon: Option<&'static str>,
    facts: &'static [(&'static str, &'static str)],
    /// Amount, currency, what it was, availability.
    price: Option<(&'static str, &'static str, &'static str, &'static str)>,
}

const NONE: Card = Card {
    name: "",
    url: "",
    kind: "link",
    title: "",
    description: None,
    site: None,
    author: None,
    duration: None,
    picture: None,
    icon: None,
    facts: &[],
    price: None,
};

const CARDS: &[Card] = &[
    Card {
        name: "full",
        url: "https://www.reddit.com/r/LinkCards/comments/1abc2d/where_to_buy_tickets/",
        title: "From the LinkCards community on Reddit",
        description: Some(
            "I've tried to buy tickets online but the shop would not take my card. Does anyone know where else to buy them?",
        ),
        site: Some("Reddit"),
        author: Some("quiet_heron_204"),
        icon: Some("icon.png"),
        picture: Some(("wide.png", 1200, 630)),
        ..NONE
    },
    Card {
        name: "video",
        url: "https://vimeo.com/104729384",
        kind: "video",
        title: "Night drive along the coast",
        site: Some("Vimeo"),
        author: Some("Coastline Films"),
        duration: Some("4:12"),
        picture: Some(("wide.png", 1200, 630)),
        ..NONE
    },
    Card {
        name: "contained",
        url: "https://art.example.com/works/2817",
        kind: "image",
        title: "Two by the water",
        site: Some("art.example.com"),
        author: Some("ame"),
        facts: &[("likes", "12.4K")],
        picture: Some(("tall.png", 600, 850)),
        ..NONE
    },
    Card {
        name: "native",
        url: "https://pictures.example.net/posts/1",
        kind: "image",
        title: "Summer beach, a study",
        site: Some("pictures.example.net"),
        picture: Some(("small.png", 360, 253)),
        ..NONE
    },
    Card {
        name: "article",
        url: "https://example.org/posts/the-long-way-round",
        kind: "article",
        title: "The long way round: a field report on latency, jitter and the people who notice",
        description: Some("Why the numbers that look fine on a graph still sound wrong in a room."),
        site: Some("example.org"),
        picture: Some(("wide.png", 1200, 630)),
        ..NONE
    },
    Card {
        name: "bare",
        url: "https://docs.example.org/reference/acl",
        title: "Access control lists",
        description: Some("Rules, groups, and the order they are applied in."),
        site: Some("docs.example.org"),
        ..NONE
    },
    Card {
        name: "title",
        url: "https://notes.example.org/today",
        title: "Notes for today",
        ..NONE
    },
    Card {
        name: "shop",
        url: "https://deals.example.de/deals/the-c64-maxi",
        kind: "product",
        title: "THE C64 Maxi, a Commodore remake",
        site: Some("deals.example.de"),
        price: Some(("89.99", "EUR", "129.99", "instock")),
        facts: &[("shipping", "Free")],
        picture: Some(("product.png", 600, 600)),
        ..NONE
    },
    Card {
        name: "compare",
        url: "https://prices.example.de/compare/headphones-x",
        kind: "product",
        title: "Headphones X, wireless",
        site: Some("prices.example.de"),
        price: Some(("149", "EUR", "", "")),
        facts: &[("sellers", "14")],
        ..NONE
    },
];

/// The card asked for, if one is.
pub(super) fn chosen() -> Option<&'static Card> {
    let name = std::env::var("FANCY_GPUI_DEMO_LINKS").ok()?;
    CARDS.iter().find(|card| card.name == name)
}

/// Make the last message the chosen card's link, if a card is chosen.
pub(super) fn put(messages: &mut [(Conversation, Message)]) {
    let Some(card) = chosen() else {
        return;
    };
    if let Some((_, last)) = messages.last_mut() {
        last.body = card.url.into();
        last.html = card.url.into();
    }
}

/// The chosen card, if `url` is its link.
pub(super) fn preview(url: &SharedString) -> Option<Preview> {
    let card = chosen().filter(|card| card.url == url.as_ref())?;
    let folder = std::env::var_os("FANCY_GPUI_DEMO_LINK_FILES").map(std::path::PathBuf::from);
    let read = |file: &str| {
        let bytes = std::fs::read(folder.as_ref()?.join(file)).ok()?;
        crate::picture::picture(bytes).map(Arc::new)
    };
    let said = |text: Option<&'static str>| text.map(SharedString::from);
    Some(Preview {
        url: url.clone(),
        title: Some(card.title.into()),
        description: said(card.description),
        site: said(card.site),
        picture: card.picture.and_then(|(file, _, _)| read(file)),
        kind: Some(card.kind.into()),
        picture_url: None,
        icon: card.icon.and_then(read),
        details: PreviewDetails {
            picture_size: card.picture.map(|(_, width, height)| (width, height)),
            author: said(card.author),
            duration: said(card.duration),
            published: None,
            facts: card
                .facts
                .iter()
                .map(|(name, value)| ((*name).into(), (*value).into()))
                .collect(),
            price: card
                .price
                .map(|(amount, currency, was, availability)| PreviewPrice {
                    amount: amount.into(),
                    currency: currency.into(),
                    was: was.into(),
                    availability: availability.into(),
                }),
        },
    })
}
