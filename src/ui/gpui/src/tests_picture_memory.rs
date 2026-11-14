//! What making pictures ready to send takes, for measuring from outside:
//! the steps staging and sending run on every picture of a folder, one
//! after another and then several at once, each step announced on stdout
//! and followed by a pause, so that a watcher of the process's commit can
//! tell the steps apart.
//!
//!     FANCY_GPUI_TEST_PICTURES=<folder> cargo test --release -- --ignored \
//!         --exact tests_picture_memory::pictures_made_ready_to_send --nocapture

use std::path::PathBuf;
use std::time::Duration;

/// What staging does with one file: a small copy for its tile, and the
/// size it would go up as made smaller. Whether a tile was made.
fn staged(path: &std::path::Path) -> bool {
    crate::picture::at(path)
        .map(|bytes| crate::picture::staged(&bytes))
        .is_some_and(|staging| staging.tile.is_some())
}

/// What sending does with one file before it goes up. Whether it was a
/// picture.
fn sent(path: &std::path::Path) -> bool {
    crate::picture::at(path)
        .map(|file| crate::picture::outgoing(&file, false))
        .is_some_and(|made| made.pixels.is_some())
}

/// How many of `files` came out as pictures, staged or sent.
fn all(files: &[PathBuf], each: fn(&std::path::Path) -> bool) -> usize {
    files.iter().filter(|file| each(file)).count()
}

fn step(name: &str) {
    println!("STEP {name}");
    std::thread::sleep(Duration::from_secs(2));
}

#[test]
#[ignore = "measures memory from outside; needs FANCY_GPUI_TEST_PICTURES"]
fn pictures_made_ready_to_send() {
    let Some(folder) = std::env::var_os("FANCY_GPUI_TEST_PICTURES") else {
        return;
    };
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder)
        .expect("the folder")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    files.sort();
    step("start");
    let pictures = all(&files, staged);
    assert!(pictures > 0, "pictures in the folder");
    step("staged one after another");
    println!("sent {} of {pictures}", all(&files, sent));
    step("sent one after another");
    let at_once = std::thread::scope(|scope| {
        let readers: Vec<_> = (0..4)
            .map(|_| scope.spawn(|| all(&files, staged)))
            .collect();
        readers
            .into_iter()
            .map(|reader| reader.join().expect("a reader"))
            .sum::<usize>()
    });
    println!("staged {at_once} of {}", 4 * pictures);
    step("staged four times at once");
    let both = std::thread::scope(|scope| {
        let staging = scope.spawn(|| all(&files, staged));
        let sending = scope.spawn(|| all(&files, sent));
        staging.join().expect("staging") + sending.join().expect("sending")
    });
    println!("staged and sent {both} of {}", 2 * pictures);
    step("staged while sending");
    println!("STEP end");
    std::thread::sleep(Duration::from_secs(2));
}
