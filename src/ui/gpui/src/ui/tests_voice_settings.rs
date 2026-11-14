//! The Voice page with the made-up check of the voice: every row the web
//! page has, the meter and the gate set on it by hand and from the
//! keyboard, the gate calibrating itself, hearing oneself, the noise
//! suppressors and the packet length, and nothing of it made before it is
//! started or kept after the page is left.

use std::sync::Arc;
use std::time::Duration;

use gpui::{Entity, TestAppContext, VisualTestContext};

use super::Shell;
use super::tests::{click, shell};
use crate::demo::DemoEngine;
use crate::engine::Engine as _;
use crate::sound_check::made_up::CALIBRATED;
use crate::sound_check::{Denoiser, PacketCounts, Sample, Stats};

/// A shell on the demo server with the Voice page open.
fn on_voice_page(
    cx: &mut TestAppContext,
) -> (Entity<Shell>, Arc<DemoEngine>, &mut VisualTestContext) {
    let (shell, engine, cx) = shell(cx);
    shell.update(cx, |shell, cx| shell.open_settings_at("voice", cx));
    cx.run_until_parked();
    (shell, engine, cx)
}

/// Let `ms` go by, on the made-up clock and the view's, a tick at a time.
fn wait(engine: &DemoEngine, ms: u64, cx: &mut VisualTestContext) {
    for _ in 0..ms / 50 {
        engine.voice().advance(50);
        cx.executor().advance_clock(Duration::from_millis(50));
        cx.run_until_parked();
    }
}

fn has_check(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> bool {
    shell.read_with(cx, |shell, _| shell.panels.settings.voice.has_check())
}

#[gpui::test]
fn every_row_of_the_web_page_is_there(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = on_voice_page(cx);
    for row in [
        "input-device",
        "input-volume",
        "activation-0",
        "gate-mode-0",
        "gate-mode-1",
        "gate-meter",
        "gate-test",
        "gate-hold",
        "hear-yourself",
        "automatic-gain",
        "noise-suppression-0",
        "bitrate",
        "frame-size-0",
        "voice-over-tcp",
    ] {
        assert!(cx.debug_bounds(row).is_some(), "no `{row}`");
    }
    assert_eq!(
        cx.debug_bounds("exclusive-input").is_some(),
        cfg!(windows),
        "exclusive mode is Windows' alone"
    );
}

#[gpui::test]
fn the_meter_runs_on_the_made_up_voice_and_nothing_outlives_the_page(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_voice_page(cx);
    assert!(!has_check(&shell, cx), "nothing before it is started");
    click(cx, "gate-test");
    assert!(has_check(&shell, cx));
    wait(&engine, 300, cx);
    shell.read_with(cx, |shell, _| {
        let page = &shell.panels.settings.voice;
        assert!(page.metering);
        assert!(page.level.rms > 0.05, "speech is heard: {:?}", page.level);
        assert!(page.peak > 0.5, "and its peak held along the meter");
    });
    click(cx, "gate-test");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.settings.voice.metering);
        assert!(shell.panels.settings.voice.level.rms.abs() < f32::EPSILON);
    });
    click(cx, "gate-test");
    // Another page: the check is let go of, and the meter with it.
    shell.update(cx, |shell, cx| shell.open_settings_at("privacy", cx));
    assert!(!has_check(&shell, cx));
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.settings.voice.metering)
    });
}

#[gpui::test]
fn the_gate_is_set_by_hand_from_the_keyboard(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = on_voice_page(cx);
    let before = engine.voice_settings().threshold;
    let at =
        |cx: &mut VisualTestContext| cx.update(|window, cx| super::kit::keyboard_at(window, cx));
    for _ in 0..200 {
        if at(cx).is_some_and(|id| id.contains("gate-meter-marker-0")) {
            break;
        }
        cx.simulate_keystrokes("tab");
    }
    assert!(
        at(cx).is_some_and(|id| id.contains("gate-meter-marker-0")),
        "the open marker is a stop"
    );
    cx.simulate_keystrokes("right");
    let raised = engine.voice_settings().threshold;
    assert!(raised > before, "{before} to {raised}");
    // The close marker never goes over the open one.
    cx.simulate_keystrokes("tab");
    assert!(at(cx).is_some_and(|id| id.contains("gate-meter-marker-1")));
    cx.simulate_keystrokes("end");
    assert!((engine.voice_settings().close_ratio - 0.99).abs() < 1e-4);
}

#[gpui::test]
fn the_gate_calibrates_itself_from_five_seconds_of_speech(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_voice_page(cx);
    click(cx, "gate-mode-0");
    assert!(engine.voice_settings().auto_calibrate);
    click(cx, "gate-test");
    wait(&engine, 2_000, cx);
    shell.read_with(cx, |shell, _| {
        let page = &shell.panels.settings.voice;
        assert!(
            page.speech_ms > 500 && page.speech_ms < 2_000,
            "only speech counts: {}",
            page.speech_ms
        );
        assert!(page.calibrated_for.is_none());
    });
    wait(&engine, 3_200, cx);
    let voice = engine.voice_settings();
    assert!((voice.threshold - CALIBRATED.open).abs() < 1e-6);
    assert!((voice.close_ratio - CALIBRATED.close_ratio).abs() < 1e-6);
    assert_eq!(voice.hold_frames, CALIBRATED.hold_frames);
    assert!((voice.max_gain_db - CALIBRATED.max_gain_db).abs() < 1e-6);
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.settings.voice.calibrated_for,
            Some(super::settings::voice_check_signature(shell)),
            "remembered for this microphone and these filters"
        );
    });
}

#[gpui::test]
fn a_sample_is_recorded_played_back_and_stops_with_the_page(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_voice_page(cx);
    super::tests_settings::scroll_to_foot(&shell, cx);
    click(cx, "hear-yourself");
    wait(&engine, 2_000, cx);
    let sample = shell.read_with(cx, |shell, _| shell.panels.settings.voice.sample);
    assert!(
        matches!(
            sample,
            Sample::Recording {
                elapsed_ms: 2_000,
                ..
            }
        ),
        "{sample:?}"
    );
    click(cx, "hear-yourself");
    wait(&engine, 1_000, cx);
    let sample = shell.read_with(cx, |shell, _| shell.panels.settings.voice.sample);
    assert!(
        matches!(
            sample,
            Sample::Playing {
                total_ms: 2_000,
                ..
            }
        ),
        "{sample:?}"
    );
    wait(&engine, 1_100, cx);
    let sample = shell.read_with(cx, |shell, _| shell.panels.settings.voice.sample);
    assert_eq!(sample, Sample::Idle);
    click(cx, "hear-yourself");
    shell.update(cx, |shell, cx| shell.close_settings(cx));
    assert!(!has_check(&shell, cx), "let go of with the page");
}

#[gpui::test]
fn the_suppressor_and_the_packet_length_are_chosen_and_kept(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_voice_page(cx);
    super::tests_settings::scroll_to_foot(&shell, cx);
    let offered = Denoiser::available();
    let last = offered.len();
    let pill: &'static str = Box::leak(format!("noise-suppression-{last}").into_boxed_str());
    click(cx, pill);
    let voice = engine.voice_settings();
    assert!(voice.noise_suppression);
    assert_eq!(Some(voice.denoiser), offered.last().copied());
    click(cx, "noise-suppression-0");
    assert!(!engine.voice_settings().noise_suppression);
    click(cx, "frame-size-2");
    assert_eq!(engine.voice_settings().frame_ms, 40);
}

#[gpui::test]
fn the_expert_rows_are_offered_in_the_expert_mode(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_voice_page(cx);
    super::tests_settings::scroll_to_foot(&shell, cx);
    assert!(cx.debug_bounds("legacy-backend").is_none());
    shell.update(cx, |shell, cx| {
        shell.panels.settings.user_mode = crate::store::UserMode::Expert;
        cx.notify();
    });
    super::tests_settings::scroll_to_foot(&shell, cx);
    click(cx, "legacy-backend");
    assert!(engine.voice_settings().legacy_backend);
    engine.set_voice_stats(Stats {
        to_client: PacketCounts {
            good: 9,
            ..PacketCounts::default()
        },
        ..Stats::default()
    });
    assert_eq!(
        engine.voice_stats().map(|stats| stats.to_client.good),
        Some(9)
    );
    assert!(engine.tuning().is_empty());
}
