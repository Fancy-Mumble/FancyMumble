//! The composer as the web client's: what the staging tray offers on a
//! server that shares files by no link or for no while (the one locked
//! choice with its note, and nothing asked of the server that it does not
//! allow), and the newline hint that goes when a line wraps.

use gpui::TestAppContext;

use super::tests::{click, shell};
use crate::engine::{FileSharing, Lasts, Reach};

#[gpui::test]
fn a_server_without_links_or_lifetimes_offers_its_one_choice_and_says_so(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.allow_sharing(FileSharing {
        by_link: false,
        expiring: false,
    });
    let folder = std::env::temp_dir().join(format!("fancy-gpui-locked-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("a folder");
    let notes = folder.join("notes.txt");
    std::fs::write(&notes, b"words").expect("written");
    cx.executor().allow_parking();
    shell.update(cx, |shell, cx| shell.stage_files(vec![notes], cx));
    cx.run_until_parked();
    click(cx, "staged-options");
    assert!(cx.debug_bounds("share-to-0").is_some());
    assert!(cx.debug_bounds("share-to-1").is_none(), "no link to choose");
    assert!(cx.debug_bounds("share-lasts-0").is_some());
    assert!(
        cx.debug_bounds("share-lasts-1").is_none(),
        "no lifetime to choose"
    );
    click(cx, "send");
    cx.run_until_parked();
    let shares = engine.shares();
    let how = &shares.last().expect("shared").2;
    assert_eq!((how.reach.clone(), how.lasts), (Reach::Here, Lasts::Always));
    let _ = std::fs::remove_dir_all(folder);
}

/// The composer's newline hint goes once a line runs out of room, as a
/// typed break puts it away, and comes back when the field is empty.
#[gpui::test]
fn the_newline_hint_goes_when_a_long_line_wraps(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let broken = |cx: &mut gpui::VisualTestContext| {
        shell.read_with(cx, |shell, cx| shell.composer.read(cx).has_broken())
    };
    shell.update(cx, |shell, cx| {
        shell.composer.update(cx, |field, cx| {
            field.set_text("short");
            cx.notify();
        });
    });
    cx.run_until_parked();
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    assert!(!broken(cx), "one line");
    shell.update(cx, |shell, cx| {
        shell.composer.update(cx, |field, cx| {
            field.set_text("words that go on ".repeat(40));
            cx.notify();
        });
    });
    cx.run_until_parked();
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    assert!(broken(cx), "wrapped");
    shell.update(cx, |shell, cx| {
        shell.composer.update(cx, |field, cx| {
            field.clear();
            cx.notify();
        });
    });
    cx.run_until_parked();
    assert!(!broken(cx), "empty again");
}

/// The options' rows, open in a narrow tray: each starts at or below where
/// the one above ends, however far its chips wrap.
#[gpui::test]
fn the_options_rows_stand_one_under_another_in_a_narrow_tray(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let folder = std::env::temp_dir().join(format!("fancy-gpui-rows-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("a folder");
    let pictures: Vec<std::path::PathBuf> = (0..4)
        .map(|n| {
            let path = folder.join(format!("big{n}.png"));
            image::RgbImage::from_fn(3000, 2000, |x, y| {
                image::Rgb([
                    (x % 256) as u8,
                    (y % 256) as u8,
                    ((x + y + n * 40) % 256) as u8,
                ])
            })
            .save(&path)
            .expect("a png");
            path
        })
        .collect();
    cx.executor().allow_parking();
    shell.update(cx, |shell, cx| shell.stage_files(pictures, cx));
    cx.run_until_parked();
    click(cx, "staged-options");
    for (theme, width) in [
        ("dark", 480.0),
        ("dark", 900.0),
        ("dark", 1400.0),
        ("nimbus", 480.0),
        ("nimbus", 900.0),
        ("nimbus", 2560.0),
    ] {
        cx.update(|_, cx| crate::theme::ActiveTheme::set(theme, crate::theme::Mode::Dark, cx));
        cx.simulate_resize(gpui::size(gpui::px(width), gpui::px(800.0)));
        cx.run_until_parked();
        let chips = |cx: &mut gpui::VisualTestContext, row: &str, count: usize| {
            (0..count)
                .filter_map(|at| cx.debug_bounds(Box::leak(format!("{row}-{at}").into_boxed_str())))
                .collect::<Vec<_>>()
        };
        let rows = [
            chips(cx, "share-quality", 2),
            chips(cx, "share-to", 3),
            chips(cx, "share-lasts", 3),
        ];
        // A picture that comes out no smaller has no quality row.
        let rows: Vec<_> = rows.into_iter().filter(|row| !row.is_empty()).collect();
        for pair in rows.windows(2) {
            let above = pair[0]
                .iter()
                .map(|chip| chip.bottom())
                .max()
                .expect("chips");
            let below = pair[1].iter().map(|chip| chip.top()).min().expect("chips");
            assert!(
                below >= above,
                "{theme} at {width}: a row starts at {below:?}, above the {above:?} the one before ends"
            );
        }
    }
    let _ = std::fs::remove_dir_all(folder);
}

/// On Nimbus the clip and its chevron tile one leaning plate: the pointer
/// in each half lights that tool alone, and just either side of the leaning
/// seam it lights the tool whose cut it is in, never both. (A window each:
/// GPUI keeps a selector's last bounds after it is gone.)
#[gpui::test]
fn the_clip_and_its_chevron_share_their_plate_along_its_lean(cx: &mut TestAppContext) {
    let lit_at = |x: f32, y: f32, cx: &mut TestAppContext| {
        let mut app = cx.clone();
        let (_shell, _engine, cx) = shell(&mut app);
        cx.update(|_, cx| crate::theme::ActiveTheme::set("nimbus", crate::theme::Mode::Dark, cx));
        cx.run_until_parked();
        let plate = cx.debug_bounds("compose-tools").expect("the plate");
        let y = if y < 0.0 {
            f32::from(plate.size.height) + y
        } else {
            y
        };
        let at = plate.origin + gpui::point(gpui::px(x), gpui::px(y));
        cx.simulate_mouse_move(at, None, gpui::Modifiers::default());
        cx.run_until_parked();
        (
            cx.debug_bounds("attach-lit").is_some(),
            cx.debug_bounds("compose-more-lit").is_some(),
        )
    };
    assert_eq!(lit_at(18.0, 27.0, cx), (true, false), "the clip");
    assert_eq!(lit_at(54.0, 27.0, cx), (false, true), "the chevron");
    // At 36 across the seam runs between top and bottom.
    assert_eq!(
        lit_at(36.0, 3.0, cx),
        (true, false),
        "the clip, above the seam"
    );
    assert_eq!(
        lit_at(36.0, -3.0, cx),
        (false, true),
        "the chevron, below it"
    );
}
