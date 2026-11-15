//! The Profile page of the settings: what it reads of the user's own
//! profile, and what each of its controls sends.

use gpui::Focusable as _;
use gpui::{TestAppContext, VisualTestContext};
use serde_json::{Value, json};

use super::kit;
use super::settings::Page;
use super::tests::{click, shell};
use crate::engine::Action;

/// The profile changes the demo engine was asked for, merged in order.
fn sent(engine: &crate::demo::DemoEngine) -> Value {
    let mut profile = json!({});
    for action in engine.actions() {
        if let Action::PatchProfile(change) = action {
            crate::profile_fields::merge(&mut profile, &change);
        }
    }
    profile
}

/// The settings open on the Profile page.
fn on_profile(
    cx: &mut TestAppContext,
) -> (
    gpui::Entity<super::Shell>,
    std::sync::Arc<crate::demo::DemoEngine>,
    &mut VisualTestContext,
) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-profile");
    // The about editor, drawn in the page, is put away (as Escape does) so
    // that the rows under it are in sight; it is tested on its own.
    shell.update(cx, |shell, cx| {
        shell.panels.profiles.editor = None;
        cx.notify();
    });
    cx.run_until_parked();
    (shell, engine, cx)
}

#[gpui::test]
fn the_page_reads_the_profile_and_sends_what_is_typed_once_typing_pauses(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_profile(cx);
    let field = |shell: &super::Shell, at: usize| {
        shell
            .panels
            .settings
            .profile
            .as_ref()
            .expect("the form")
            .fields()[at]
            .clone()
    };
    let pronouns = shell.read_with(cx, |shell, _| field(shell, 0));
    let contact = shell.read_with(cx, |shell, _| field(shell, 1));
    // What the demo's own profile says is in its field.
    assert_eq!(
        pronouns.read_with(cx, |field, _| field.text().to_owned()),
        "they/them"
    );
    cx.update(|window, cx| window.focus(&contact.focus_handle(cx), cx));
    cx.simulate_input("me@example.org");
    cx.run_until_parked();
    assert_eq!(sent(&engine).get("contact"), None, "not while typing");
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(900));
    cx.run_until_parked();
    assert_eq!(sent(&engine)["contact"], "me@example.org");
    // Emptied, the field takes the key away.
    cx.update(|window, cx| window.focus(&pronouns.focus_handle(cx), cx));
    pronouns.update(cx, |field, cx| {
        field.clear();
        cx.notify();
    });
    cx.simulate_input("x");
    cx.simulate_keystrokes("backspace");
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(900));
    cx.run_until_parked();
    assert!(engine.actions().iter().any(|action| matches!(
        action,
        Action::PatchProfile(change) if change.get("pronouns") == Some(&Value::Null)
    )));
}

#[gpui::test]
fn the_name_style_rows_shown_and_the_banner_colour_are_sent_at_once(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = on_profile(cx);
    click(cx, "profile-name");
    click(cx, "name-font-1");
    click(cx, "name-bold");
    click(cx, "name-italic");
    click(cx, "name-colour");
    click(cx, "name-colour-6");
    click(cx, "profile-banner-colour");
    click(cx, "profile-banner-colour-13");
    // What the card shows is at the foot of the page.
    super::tests_settings::scroll_to_foot(&_shell, cx);
    click(cx, "show-stats");
    let profile = sent(&engine);
    assert_eq!(profile["nameStyle"]["font"], "serif");
    assert_eq!(profile["nameStyle"]["bold"], false);
    assert_eq!(profile["nameStyle"]["italic"], true);
    assert_eq!(profile["nameStyle"]["color"], kit::PALETTE[6]);
    assert_eq!(profile["sections"]["stats"], false);
    assert_eq!(profile["banner"]["color"], kit::PALETTE[13]);
    // What the native card reads of it is what was set.
    let comment = format!("<!--FANCY:{profile}-->");
    let read = crate::profile::Profile::of(&comment).expect("a profile");
    assert!(!read.name_bold && read.name_italic && read.hidden.stats);
    assert_eq!(read.name_face, Some(crate::profile::Face::Serif));
}

#[gpui::test]
fn the_cards_colours_are_added_changed_and_cleared(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_profile(cx);
    // The colours row is the one open at first, as on the web UI's page.
    click(cx, "card-colour-add");
    click(cx, "card-colour-add");
    click(cx, "card-colour-0");
    click(cx, "card-colour-0-2");
    assert_eq!(
        sent(&engine)["themeColors"],
        json!([kit::PALETTE[2], "#6366f1"])
    );
    click(cx, "profile-glass");
    assert_eq!(sent(&engine)["cardGlass"], true);
    click(cx, "card-colour-clear");
    shell.read_with(cx, |shell, _| {
        let form = shell.panels.settings.profile.as_ref().expect("the form");
        assert!(form.held.get("themeColors").is_none(), "taken away");
    });
}

#[gpui::test]
fn the_keyboard_reaches_every_control_of_the_profile_page(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = on_profile(cx);
    shell.update(cx, |shell, cx| shell.turn_to(Page::Profile, cx));
    let mut seen = Vec::new();
    for _ in 0..200 {
        cx.simulate_keystrokes("tab");
        seen.extend(cx.update(|window, cx| kit::keyboard_at(window, cx)));
    }
    for control in [
        "profile-avatar",
        "profile-banner",
        "profile-banner-colour",
        "profile-colours",
        "card-colour-add",
        "card-colour-shuffle",
        "profile-glass",
        "profile-name",
        "show-badges",
        "show-stats",
        "status-tool-0",
        "profile-examples",
    ] {
        assert!(
            seen.iter().any(|stop| stop == control),
            "Tab never reached {control}: {seen:?}"
        );
    }
}

/// Type `text` into the page's field at `at`, and let the pause pass.
fn type_into(shell: &gpui::Entity<super::Shell>, at: usize, text: &str, cx: &mut VisualTestContext) {
    let field = shell.read_with(cx, |shell, _| {
        shell.panels.settings.profile.as_ref().expect("the form").fields()[at].clone()
    });
    cx.update(|window, cx| window.focus(&field.focus_handle(cx), cx));
    cx.simulate_input(text);
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(900));
    cx.run_until_parked();
}

#[gpui::test]
fn the_status_is_written_with_marks_and_sent_as_its_html(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_profile(cx);
    type_into(&shell, 2, "**out** walking", cx);
    assert_eq!(sent(&engine)["status"], "<b>out</b> walking");
    // The card reads it as it was set.
    let comment = format!("<!--FANCY:{}-->", sent(&engine));
    let read = crate::profile::Profile::of(&comment).expect("a profile");
    assert_eq!(read.status.as_deref(), Some("<b>out</b> walking"));
}

#[gpui::test]
fn a_background_of_ones_own_is_sent_as_the_cards_background(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_profile(cx);
    type_into(&shell, 3, "linear-gradient(red,blue)", cx);
    let profile = sent(&engine);
    assert_eq!(profile["cardBackgroundCustom"], "linear-gradient(red,blue)");
    assert_eq!(profile["cardBackground"], "custom");
}

#[gpui::test]
fn the_display_name_is_kept_and_starts_a_new_servers_form(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_profile(cx);
    type_into(&shell, 4, "Sebi", cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.settings.display_name.as_deref(), Some("Sebi"));
    });
    assert!(
        !engine
            .actions()
            .iter()
            .any(|action| matches!(action, Action::PatchProfile(_))),
        "kept here, not sent"
    );
    shell.update_in(cx, |shell, window, cx| shell.open_editor(None, None, window, cx));
    shell.read_with(cx, |shell, cx| {
        let editor = shell.editor.as_ref().expect("the form");
        assert_eq!(editor.username(cx), "Sebi");
    });
}

#[gpui::test]
fn the_preview_draws_the_card_as_typed_and_its_examples_on_asking(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = on_profile(cx);
    assert!(cx.debug_bounds("card-preview").is_some(), "the card, in place");
    // Made-up rows while the switch is on, as on the web UI's page.
    assert!(cx.debug_bounds("card-roles").is_some());
    assert!(cx.debug_bounds("card-stats").is_some());
    click(cx, "profile-examples");
    // A test's bounds outlive what is no longer drawn: the state the card
    // is drawn from says it.
    shell.read_with(cx, |shell, _| {
        let form = shell.panels.settings.profile.as_ref().expect("the form");
        assert!(!form.examples, "none of a server's");
    });
    // What is typed shows before it is sent.
    let contact = shell.read_with(cx, |shell, _| {
        shell.panels.settings.profile.as_ref().expect("the form").fields()[1].clone()
    });
    cx.update(|window, cx| window.focus(&contact.focus_handle(cx), cx));
    cx.simulate_input("me@example.org");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let form = shell.panels.settings.profile.as_ref().expect("the form");
        let profile = form.card.profile.as_ref().expect("read");
        assert_eq!(profile.contact.as_deref(), Some("me@example.org"));
    });
}

/// The settings open on the Profile page with its about field as it comes.
fn on_profile_with_about(
    cx: &mut TestAppContext,
) -> (
    gpui::Entity<super::Shell>,
    std::sync::Arc<crate::demo::DemoEngine>,
    &mut VisualTestContext,
) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-profile");
    cx.run_until_parked();
    (shell, engine, cx)
}

#[gpui::test]
fn an_older_profile_shows_its_words_in_the_field_and_converts_in_its_dialog(cx: &mut TestAppContext) {
    // The demo's own profile is of the older format.
    let (shell, _engine, cx) = on_profile_with_about(cx);
    assert!(cx.debug_bounds("about-field").is_some(), "the field, in the page");
    assert!(cx.debug_bounds("about-field-words").is_some(), "its words");
    shell.read_with(cx, |shell, _| assert!(shell.about_on_settings_page()));
    click(cx, "about-convert");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.about_on_settings_page(), "the dialog, over the page");
        assert!(shell.panels.profiles.editor.is_some(), "the same editor");
    });
    // Turning to another page puts it all away; the dialog is modal, so
    // the page is turned without the column.
    shell.update(cx, |shell, cx| shell.turn_to(Page::Voice, cx));
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.about_dialog));
}

#[gpui::test]
fn the_fields_strip_adds_blocks_to_a_profile_of_the_new_format(cx: &mut TestAppContext) {
    use mumble_tauri_lib::engine_api::about::{About, Align, Block, Run, with_about};
    let (shell, engine, cx) = shell(cx);
    let start = About {
        blocks: vec![Block::Text {
            runs: vec![Run::plain("Was here.")],
            align: Align::Left,
        }],
    };
    let comment = with_about(r#"<!--FANCY:{"v":1}-->"#, &start, None, 0)
        .expect("written")
        .comment;
    engine.set_comment_of(1, comment);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-profile");
    cx.run_until_parked();
    let count = |shell: &gpui::Entity<super::Shell>, cx: &mut VisualTestContext| {
        shell.read_with(cx, |shell, _| {
            let editor = shell.panels.profiles.editor.as_ref().expect("open");
            editor.drafts().map_or(0, <[_]>::len)
        })
    };
    assert_eq!(count(&shell, cx), 1, "what was there");
    click(cx, "about-add-heading");
    click(cx, "about-add-divider");
    assert_eq!(count(&shell, cx), 3, "added from the strip on top");
    assert!(cx.debug_bounds("about-preview").is_none(), "no plate beside it: the card shows it");
}
