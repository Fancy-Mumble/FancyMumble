//! Paths kept from one frame to the next.
//!
//! A drawn theme's marks are paths: building one lays out its outline and
//! cuts it into triangles, which for a hollow wordmark or a band of tape is
//! most of what a frame costs. A mark that stands still is the same path
//! every frame, so it is built once, kept by what it was built from, and
//! drawn again as it was.

use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use gpui::{Path, Pixels};

/// How many built marks are kept: a screen shows a handful; more than this
/// means they keep changing, and the oldest are let go of together.
const MOST: usize = 128;

/// Built paths, by the hash of what each was built from.
#[derive(Default)]
struct Kept(HashMap<u64, Rc<[Path<Pixels>]>>);

thread_local! {
    static KEPT: RefCell<Kept> = RefCell::default();
}

/// The paths `build` makes from `from`, built the first time and kept.
/// `from` must hold everything the paths depend on, their place included.
pub(crate) fn paths<K: Hash>(
    from: &K,
    build: impl FnOnce() -> Vec<Path<Pixels>>,
) -> Rc<[Path<Pixels>]> {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    from.hash(&mut hasher);
    let key = hasher.finish();
    if let Some(known) = KEPT.with_borrow(|kept| kept.0.get(&key).cloned()) {
        return known;
    }
    let built: Rc<[Path<Pixels>]> = build().into();
    KEPT.with_borrow_mut(|kept| {
        if kept.0.len() >= MOST {
            kept.0.clear();
        }
        let _ = kept.0.insert(key, Rc::clone(&built));
    });
    built
}

/// What a path is built from, made hashable: its numbers by their bits.
pub(crate) fn bits(numbers: &[f32]) -> Vec<u32> {
    numbers.iter().map(|number| number.to_bits()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{PathBuilder, point, px};

    fn square(at: f32) -> Vec<Path<Pixels>> {
        let mut path = PathBuilder::fill();
        path.add_polygon(
            &[
                point(px(at), px(0.0)),
                point(px(at + 1.0), px(0.0)),
                point(px(at + 1.0), px(1.0)),
            ],
            true,
        );
        path.build().into_iter().collect()
    }

    #[test]
    fn a_mark_is_built_once_while_it_stays_the_same() {
        let mut built = 0;
        for _ in 0..3 {
            let _ = paths(&("square", bits(&[7.0])), || {
                built += 1;
                square(7.0)
            });
        }
        assert_eq!(built, 1);
        let _ = paths(&("square", bits(&[8.0])), || {
            built += 1;
            square(8.0)
        });
        assert_eq!(built, 2, "moved, it is built again");
    }
}
