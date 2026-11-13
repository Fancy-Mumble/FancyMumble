//! The audio device panel: which microphone and which speaker to use.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::widgets::{EMPHASIS, icon, label, opaque};
use crate::engine::{AudioDevice, ChosenDevices};
use crate::theme::Theme;

/// Which of the two lists a row belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Input,
    Output,
}

impl Shell {
    /// Open or close the panel. Opening asks the system for its devices, off
    /// the view's thread: enumeration can stall on a driver.
    pub(super) fn toggle_devices(&mut self, cx: &mut Context<Self>) {
        self.devices_open = !self.devices_open;
        if self.devices_open {
            self.chosen_devices = self.engine.chosen_devices();
            let engine = std::sync::Arc::clone(&self.engine);
            cx.spawn(async move |shell, cx| {
                let devices = cx
                    .background_executor()
                    .spawn(async move { engine.audio_devices() })
                    .await;
                let _ = shell.update(cx, |shell, cx| {
                    shell.devices = Some(devices);
                    cx.notify();
                });
            })
            .detach();
        }
        cx.notify();
    }

    /// Use `device` (or the system's default, for `None`) as the microphone
    /// or the speaker, and remember the choice.
    fn choose_device(&mut self, kind: Kind, device: Option<SharedString>, cx: &mut Context<Self>) {
        match kind {
            Kind::Input => self.chosen_devices.input = device,
            Kind::Output => self.chosen_devices.output = device,
        }
        self.engine.choose_devices(self.chosen_devices.clone());
        self.remember_settings(cx);
        cx.notify();
    }
}

/// The panel, above the user tile it was opened from.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let panel = div()
        .id("devices")
        .absolute()
        .bottom(px(112.0))
        .left(theme.skin.rail_width + px(12.0))
        .w(theme.skin.column_width - px(24.0))
        .max_h(px(420.0))
        .overflow_y_scroll()
        .occlude()
        .flex()
        .flex_col()
        .gap(px(2.0))
        .p(px(8.0))
        .rounded(theme.skin.radius_lg)
        .bg(opaque(theme.c.card, theme.c.bg0))
        .border_1()
        .border_color(theme.c.line2)
        .shadow_lg();
    let Some(devices) = &shell.devices else {
        return panel.child(
            div()
                .p(px(8.0))
                .text_color(theme.c.muted)
                .child("Looking for audio devices…"),
        );
    };
    let ChosenDevices { input, output } = &shell.chosen_devices;
    panel
        .child(heading("Microphone", theme))
        .children(rows(
            Kind::Input,
            &devices.inputs,
            input.as_ref(),
            theme,
            cx,
        ))
        .child(heading("Speakers", theme))
        .children(rows(
            Kind::Output,
            &devices.outputs,
            output.as_ref(),
            theme,
            cx,
        ))
}

fn heading(text: &'static str, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .px(px(8.0))
        .pt(px(8.0))
        .pb(px(4.0))
        .text_size(px(11.0))
        .font_weight(EMPHASIS)
        .text_color(theme.c.muted)
        .child(label(text, theme))
}

/// "System default", then each device.
fn rows(
    kind: Kind,
    devices: &[AudioDevice],
    chosen: Option<&SharedString>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Vec<gpui::AnyElement> {
    let prefix = match kind {
        Kind::Input => "input",
        Kind::Output => "output",
    };
    let mut rows = vec![row(
        format!("{prefix}-default"),
        "System default".into(),
        chosen.is_none(),
        kind,
        None,
        theme,
        cx,
    )];
    rows.extend(devices.iter().map(|device| {
        row(
            format!("{prefix}-{}", device.name),
            device.name.clone(),
            chosen == Some(&device.name),
            kind,
            Some(device.name.clone()),
            theme,
            cx,
        )
    }));
    rows
}

fn row(
    tag: String,
    name: SharedString,
    current: bool,
    kind: Kind,
    device: Option<SharedString>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> gpui::AnyElement {
    let hover = theme.c.hover;
    div()
        .id(SharedString::from(tag.clone()))
        .debug_selector(move || tag)
        .min_h(px(30.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(8.0))
        .py(px(4.0))
        .rounded(theme.skin.radius_md)
        .cursor_pointer()
        .text_size(px(13.0))
        .when(current, |row| row.bg(theme.c.accent_soft))
        .when(!current, |row| row.hover(move |style| style.bg(hover)))
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.choose_device(kind, device.clone(), cx);
        }))
        .child(div().flex_1().min_w_0().child(name))
        .when(current, |row| {
            row.child(icon("check", 13.0, theme.c.accent_text))
        })
        .into_any_element()
}
