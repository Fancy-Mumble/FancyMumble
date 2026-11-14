//! The demo server's register of accounts beyond the people in its seed: as
//! many made-up members as a test or a capture asks for, under made-up
//! roles, some with pictures. Empty until filled, so the demo is otherwise
//! the small server it always was.

use std::collections::HashMap;

use gpui::SharedString;

use crate::engine::{Registered, Role};

/// The first halves of the made-up names.
const GIVEN: [&str; 25] = [
    "Ash", "Bree", "Cato", "Dove", "Ember", "Fenn", "Gale", "Hollis", "Ivo", "Juno", "Kes", "Lark",
    "Moss", "Nyx", "Orrin", "Pell", "Quill", "Rook", "Sable", "Tamsin", "Umber", "Vale", "Wick",
    "Yarrow", "Zephyr",
];

/// The second halves.
const FAMILY: [&str; 20] = [
    "Morrow", "Finch", "Tallow", "Reedly", "Calder", "Holt", "Merrin", "Strand", "Bray", "Locke",
    "Vesper", "Harrow", "Ingle", "Dunmore", "Pike", "Farrow", "Quayle", "Thistle", "Wade", "Oakes",
];

/// The made-up roles, in the order the server lists them, with the colour
/// each is drawn in where it has one.
const ROLES: [(&str, Option<u32>); 3] = [
    ("Stewards", Some(0x5d_b0e8)),
    ("Gardeners", Some(0x7c_c46a)),
    ("Night owls", None),
];

/// The first account id the made-up members are given: well clear of the
/// seed's.
const FIRST_ID: u32 = 1000;

/// How large a made-up picture is: what a client sends as a face.
const PICTURE_SIDE: u32 = 256;

/// The register, and what was asked of it.
#[derive(Debug, Default)]
pub(crate) struct Directory {
    accounts: Vec<Registered>,
    roles: Vec<Role>,
    /// The pictures made so far, by account: each is made when it is
    /// first asked for, as a server's would be fetched.
    pictures: HashMap<u32, Vec<u8>>,
    /// How often the member list asked for the register.
    pub asked: u32,
    /// The accounts whose picture was asked for, in order.
    pub pictures_asked: Vec<u32>,
    /// How often the pictures were let go of.
    pub put_away: u32,
    /// Whether the server refuses to list its accounts.
    pub refuses: bool,
}

impl Directory {
    /// `count` made-up members, none of them here, every `pictured`th with
    /// a picture (none for zero). The first of every five has no role, and
    /// the rest are spread over the roles.
    pub(crate) fn fill(&mut self, count: usize, pictured: usize) {
        let ids = (FIRST_ID..).take(count);
        self.accounts = ids
            .clone()
            .enumerate()
            .map(|(nth, id)| Registered {
                id,
                name: name(nth),
                last_seen: Some("2026-11-01T18:00:00Z".into()),
                last_channel: None,
                picture: pictured > 0 && nth % pictured == 0,
            })
            .collect();
        self.roles = ROLES
            .iter()
            .enumerate()
            .map(|(at, (role, color))| Role {
                name: (*role).into(),
                color: color.map(|color| gpui::rgb(color).into()),
                members: ids
                    .clone()
                    .enumerate()
                    .filter(|(nth, _)| nth % 5 != 0 && nth % ROLES.len() == at)
                    .map(|(_, id)| id)
                    .collect(),
            })
            .collect();
        self.pictures.clear();
    }

    /// The made-up accounts.
    pub(crate) fn accounts(&self) -> &[Registered] {
        &self.accounts
    }

    /// The made-up roles.
    pub(crate) fn roles(&self) -> &[Role] {
        &self.roles
    }

    /// The picture of `account`, made now if it has one and none was made
    /// yet. Noted as asked for either way.
    pub(crate) fn picture(&mut self, account: u32) -> Option<Vec<u8>> {
        self.pictures_asked.push(account);
        let pictured = self
            .accounts
            .iter()
            .any(|known| known.id == account && known.picture);
        if !pictured {
            return None;
        }
        let made = self
            .pictures
            .entry(account)
            .or_insert_with(|| painted(account));
        Some(made.clone())
    }

    /// Let go of the pictures made.
    pub(crate) fn put_away(&mut self) {
        self.put_away += 1;
        self.pictures.clear();
    }
}

/// The `nth` made-up name: every one different for the first five hundred.
fn name(nth: usize) -> SharedString {
    let given = GIVEN[nth % GIVEN.len()];
    let family = FAMILY[(nth / GIVEN.len()) % FAMILY.len()];
    format!("{given} {family}").into()
}

/// A picture for `account`: a wash of two colours that its id picks, as a
/// JPEG of the size a face is sent at.
fn painted(account: u32) -> Vec<u8> {
    let hue = |turn: u32| (account.wrapping_mul(turn) % 255) as u8;
    let (from, to) = ([hue(37), hue(91), hue(53)], [hue(11), hue(67), hue(29)]);
    let picture = image::RgbImage::from_fn(PICTURE_SIDE, PICTURE_SIDE, |x, y| {
        let along = (x + y) as f32 / (2 * PICTURE_SIDE) as f32;
        let mix =
            |at: usize| (f32::from(from[at]) * (1.0 - along) + f32::from(to[at]) * along) as u8;
        // A little grain, so the file is the size of a photograph's.
        let grain = ((x * 7 + y * 13 + account) % 23) as u8;
        image::Rgb([mix(0) ^ grain, mix(1) ^ grain, mix(2) ^ grain])
    });
    let mut file = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 85);
    // Encoding a picture made in memory into memory does not fail.
    let _ = picture.write_with_encoder(encoder);
    file
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_filled_register_has_every_name_once_and_files_four_in_five_under_a_role() {
        let mut directory = Directory::default();
        directory.fill(500, 2);
        let names: std::collections::HashSet<_> = directory
            .accounts()
            .iter()
            .map(|account| &account.name)
            .collect();
        assert_eq!(names.len(), 500);
        let filed: usize = directory
            .roles()
            .iter()
            .map(|role| role.members.len())
            .sum();
        assert_eq!(filed, 400);
        assert_eq!(
            directory
                .accounts()
                .iter()
                .filter(|account| account.picture)
                .count(),
            250
        );
    }

    #[test]
    fn a_picture_is_made_only_for_who_has_one_and_is_a_picture() {
        let mut directory = Directory::default();
        directory.fill(4, 2);
        let picture = directory.picture(FIRST_ID).expect("the first has one");
        assert!(crate::picture::picture(picture).is_some());
        assert!(directory.picture(FIRST_ID + 1).is_none());
        assert_eq!(directory.pictures_asked, [FIRST_ID, FIRST_ID + 1]);
    }
}
