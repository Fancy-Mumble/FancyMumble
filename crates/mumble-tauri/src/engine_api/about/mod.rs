//! What a user says about themselves, as blocks instead of HTML.
//!
//! A Fancy Mumble profile rides at the head of a user's comment as
//! `<!--FANCY:{json}-->`, and until this format the text after it was HTML
//! that every client had to read and lay out, pictures and all. Here the text
//! is the profile's `about`: a short, bounded list of typed blocks with small
//! thumbnails, read the same way by every client. The HTML after the mark is
//! written from the blocks, for clients that do not know them. What does not
//! fit a comment goes into a `page`: a document in the server's file store,
//! fetched only when somebody asks for the whole profile.
//!
//! `PROFILE_FORMAT.md` in the native client's crate describes the format.

mod bounds;
mod comment;
mod html;
mod migrate;
mod model;
mod page;
mod reader;
mod store;
mod tags;
#[cfg(test)]
mod tests;
mod thumb;
mod typed;

pub use bounds::Limits;
pub use comment::{Fitted, Written, with_about};
pub use migrate::{Embedded, Migration};
pub use model::{About, Align, Block, Picture, Run};
pub use page::{Link, Page, PageRef, Section};
pub use store::Stored;
pub use thumb::{Thumb, Thumbnailer};
pub use typed::{runs_of_typed, typed_of_runs};
