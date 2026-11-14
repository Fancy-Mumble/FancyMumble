//! A server's livery: drawn on its page before connecting, from the right
//! source, and worn while connected. On the demo engine, whose `kumo.jp`
//! has a made-up livery.

use std::sync::Arc;

use gpui::{Entity, TestAppContext, VisualTestContext};

use super::Shell;
use super::tests::{click, shell_on};
use crate::demo::DemoEngine;
use crate::demo::livery::{BRANDED, DIGEST, made_up};
use crate::livery::{Livery, Pinged, Shelf, Status};
use crate::store::Store;
use crate::theme::ActiveTheme;

const KUMO: &str = "server-kumo.jp:64738";

/// Draw the window again, and let what it started finish.
fn redraw(cx: &mut VisualTestContext) {
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
}

/// Where the page on screen says its livery came from, and the livery.
fn page(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> (Option<Arc<Livery>>, Status) {
    shell.read_with(cx, |shell, _| {
        let server = shell.selected_server().expect("a server's page");
        shell.page_livery(&server.key, server.host, server.port)
    })
}

fn probes(engine: &DemoEngine) -> Vec<String> {
    engine.liveries(|liveries| liveries.probes.clone())
}

/// A folder of its own for one test's kept liveries.
fn kept_in(name: &str, shell: &Entity<Shell>, cx: &mut VisualTestContext) -> Shelf {
    let dir = std::env::temp_dir().join(format!(
        "fancy-gpui-tests-livery-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    shell.update(cx, |shell, _| shell.store = Some(Store::new(&dir)));
    Store::new(&dir).liveries()
}

#[gpui::test]
fn a_servers_livery_is_asked_for_and_drawn_on_its_page(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    // The first server's page is up; its ping cannot say, so nothing is asked.
    assert_eq!(page(&shell, cx).1, Status::Unverified);
    assert!(
        probes(&engine).is_empty(),
        "nothing asked of a server not shown"
    );
    assert!(cx.debug_bounds("livery-banner").is_none());

    click(cx, KUMO);
    assert_eq!(probes(&engine), [BRANDED], "asked once, when shown");
    let (livery, status) = page(&shell, cx);
    assert_eq!(status, Status::Cached);
    assert_eq!(livery.as_deref(), Some(&*made_up()));
    redraw(cx);
    let banner = cx
        .debug_bounds("livery-banner")
        .expect("the banner picture");
    assert_eq!(banner.size.height, gpui::px(210.0), "the taller banner");
    for part in [
        "livery-tagline",
        "livery-greeting",
        "livery-status-cached",
        "livery-tag-3",
    ] {
        assert!(cx.debug_bounds(part).is_some(), "{part} is drawn");
    }
    // Drawn again and again, asked once.
    redraw(cx);
    assert_eq!(probes(&engine).len(), 1);

    // The tag that leads somewhere is followed as any link: asked first.
    click(cx, "livery-tag-3");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.links.asked(),
            Some("https://example.org/rules")
        );
    });
}

#[gpui::test]
fn the_mark_on_the_address_says_where_the_livery_came_from(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    let on = |key: &str, shell: &Entity<Shell>, cx: &mut VisualTestContext| {
        shell.update(cx, |shell, cx| {
            shell.selected_server = Some(key.to_owned());
            cx.notify();
        });
        redraw(cx);
    };
    assert_eq!(page(&shell, cx).1, Status::Unverified);
    assert!(cx.debug_bounds("livery-status-unverified").is_some());

    on("localhost:64738", &shell, cx);
    assert_eq!(page(&shell, cx).1, Status::Unreachable);

    // The ping is still out.
    engine.liveries(|liveries| liveries.ping_says(BRANDED, None));
    on(BRANDED, &shell, cx);
    assert_eq!(page(&shell, cx).1, Status::Probing);
    assert!(
        probes(&engine).is_empty(),
        "nothing asked before the ping says"
    );

    // It says there is a livery; asking takes a while.
    engine.liveries(|liveries| {
        liveries.answering = false;
        liveries.ping_says(
            BRANDED,
            Some(Pinged::Up {
                digest: Some(DIGEST.into()),
            }),
        );
    });
    redraw(cx);
    assert_eq!(page(&shell, cx).1, Status::Fetching);
    assert!(cx.debug_bounds("livery-status-fetching").is_some());
    engine.answer_probe(BRANDED);
    cx.run_until_parked();
    redraw(cx);
    assert_eq!(page(&shell, cx).1, Status::Cached);

    // The server changed its livery, and the asking brings nothing.
    engine.liveries(|liveries| {
        liveries.ping_says(
            BRANDED,
            Some(Pinged::Up {
                digest: Some("0123456789abcdef".into()),
            }),
        );
        liveries.hold(BRANDED, None);
    });
    redraw(cx);
    engine.answer_probe(BRANDED);
    cx.run_until_parked();
    redraw(cx);
    let (livery, status) = page(&shell, cx);
    assert_eq!(status, Status::Failed);
    assert!(
        livery.is_none(),
        "the old livery is provably not the server's"
    );
    assert_eq!(probes(&engine).len(), 2, "one ask per digest");

    // It says it has none.
    engine.liveries(|liveries| {
        liveries.ping_says(
            BRANDED,
            Some(Pinged::Up {
                digest: Some("".into()),
            }),
        );
    });
    redraw(cx);
    assert_eq!(page(&shell, cx).1, Status::Absent);
    assert!(cx.debug_bounds("livery-status-absent").is_some());
}

#[gpui::test]
fn the_server_the_engine_is_on_says_its_livery_live(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::new(), cx);
    engine.liveries(|liveries| liveries.live = Some(("magical.rocks:64738".to_owned(), made_up())));
    shell.update(cx, |shell, cx| {
        shell.adding_server = true;
        shell.selected_server = Some("magical.rocks:64738".to_owned());
        cx.notify();
    });
    redraw(cx);
    assert_eq!(page(&shell, cx).1, Status::Live);
    assert!(cx.debug_bounds("livery-status-live").is_some());
    assert!(
        probes(&engine).is_empty(),
        "nothing to ask: it is saying it"
    );
}

#[gpui::test]
fn a_kept_copy_is_drawn_when_the_ping_vouches_for_it_and_forgotten_on_none(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    let shelf = kept_in("kept", &shell, cx);
    shelf.put(BRANDED, &made_up()).expect("writable");
    engine.liveries(|liveries| liveries.answering = false);

    click(cx, KUMO);
    let (livery, status) = page(&shell, cx);
    assert_eq!(status, Status::Cached);
    assert_eq!(livery.as_deref(), Some(&*made_up()), "read from disk");
    assert!(
        probes(&engine).is_empty(),
        "the kept copy is the server's: nothing asked"
    );

    // The operator took the livery away.
    engine.liveries(|liveries| liveries.hold(BRANDED, None));
    redraw(cx);
    let (livery, status) = page(&shell, cx);
    assert_eq!(status, Status::Absent);
    assert!(livery.is_none());
    cx.run_until_parked();
    assert!(shelf.read(BRANDED).is_none(), "forgotten on disk as well");
}

#[gpui::test]
fn a_kept_copy_the_server_has_moved_on_from_is_not_drawn_and_the_new_one_is_kept(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    let shelf = kept_in("moved", &shell, cx);
    let old = Livery {
        digest: "00000000000000aa".into(),
        name: Some("Old name".into()),
        ..Livery::default()
    };
    shelf.put(BRANDED, &old).expect("writable");
    engine.liveries(|liveries| liveries.answering = false);

    click(cx, KUMO);
    let (livery, status) = page(&shell, cx);
    assert_eq!(status, Status::Fetching);
    assert!(livery.is_none(), "not the old one meanwhile");
    engine.answer_probe(BRANDED);
    cx.run_until_parked();
    redraw(cx);
    assert_eq!(page(&shell, cx).1, Status::Cached);
    assert_eq!(
        shelf.read(BRANDED).map(|kept| kept.digest),
        Some(DIGEST.into()),
        "the new one kept for next time"
    );
}

#[gpui::test]
fn the_sheet_about_the_server_has_its_livery_at_its_head(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::new(), cx);
    shell.update(cx, |shell, cx| {
        shell.show_about(crate::engine::Subject::Server, cx)
    });
    redraw(cx);
    assert!(
        cx.debug_bounds("livery-sheet-head").is_none(),
        "a server that said nothing"
    );
    shell.update(cx, |shell, _| shell.info = None);
    engine.liveries(|liveries| liveries.live = Some(("magical.rocks:64738".to_owned(), made_up())));
    shell.update(cx, |shell, cx| {
        shell.show_about(crate::engine::Subject::Server, cx)
    });
    redraw(cx);
    assert!(cx.debug_bounds("livery-sheet-head").is_some());
}

#[gpui::test]
fn the_server_on_screen_is_worn_while_connected(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::new(), cx);
    let own = cx.update(|_, cx| cx.global::<ActiveTheme>().0.c.accent);
    assert_eq!(cx.update(|_, cx| ActiveTheme::get(cx).c.accent), own);

    let shelf = kept_in("worn", &shell, cx);
    engine.liveries(|liveries| liveries.live = Some(("magical.rocks:64738".to_owned(), made_up())));
    shell.update(cx, Shell::liveries_changed);
    redraw(cx);
    let worn = cx.update(|_, cx| ActiveTheme::get(cx).c.accent);
    assert_ne!(worn, own, "the server's accent");
    let gpui::Rgba { r, g, b, .. } = worn.to_rgb();
    let channel = |value: f32| (value * 255.0).round() as i32;
    assert!(
        (channel(r) - 0x7f).abs() <= 1
            && (channel(g) - 0xb3).abs() <= 1
            && (channel(b) - 0xff).abs() <= 1,
        "#7fb3ff, as the made-up livery offers for a dark theme: {worn:?}"
    );
    cx.run_until_parked();
    assert!(
        shelf.read("magical.rocks:64738").is_some(),
        "kept for its page"
    );

    engine.liveries(|liveries| liveries.live = None);
    redraw(cx);
    assert_eq!(
        cx.update(|_, cx| ActiveTheme::get(cx).c.accent),
        own,
        "the user's own again"
    );
}
