//! The developer's part of the Advanced page, as the web UI's: what level
//! the log is kept at, whether it goes to a file, whether old files are
//! compressed, whether a release build writes to the terminal, and the
//! files themselves, to look at or to export as one.

use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{ActionRow, Button, Emphasis, Field, Look, Select, Size, SwitchRow};
use crate::store::LOG_LEVELS;
use crate::theme::Theme;
use crate::words::t;

/// What the page changes about the log.
#[derive(Debug, Clone, Copy)]
enum Steer {
    Level(usize),
    ToFile,
    AutoZip,
    Terminal,
}

impl Shell {
    /// Keep the log another way, at once and at the next start.
    fn steer_logs(&mut self, steer: Steer, cx: &mut Context<Self>) {
        let logs = &mut self.panels.settings.logs;
        match steer {
            Steer::Level(at) => {
                logs.log_level = LOG_LEVELS
                    .get(at)
                    .filter(|level| **level != "info")
                    .map(|level| (*level).to_owned());
            }
            Steer::ToFile => logs.log_to_file = !logs.log_to_file,
            // Only while there is a file to compress.
            Steer::AutoZip if logs.log_to_file => logs.auto_zip_logs = !logs.auto_zip_logs,
            Steer::AutoZip => return,
            Steer::Terminal => logs.terminal_logging = !logs.terminal_logging,
        }
        crate::real::steer_logs(&self.panels.settings.logs);
        self.remember_settings(cx);
        cx.notify();
    }

    /// Ask where to, and write every kept log file there as one.
    fn export_logs(&mut self, cx: &mut Context<Self>) {
        let directory = crate::paths::data_dir();
        let chosen = cx.prompt_for_new_path(&directory, Some("fancy-mumble-logs.log.zst"));
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(to))) = chosen.await else {
                return;
            };
            let said = match crate::real::export_logs(&to) {
                Ok(()) => t!("Logs exported successfully."),
                Err(error) => t!("Failed to export logs: {{error}}", error = error),
            };
            let _ = shell.update(cx, |shell, cx| {
                shell.notice = Some(said);
                cx.notify();
            });
        })
        .detach();
    }
}

/// The developer's rows.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let logs = &shell.panels.settings.logs;
    let lit = &shell.panels.settings.lit;
    let at = LOG_LEVELS
        .iter()
        .position(|level| *level == logs.level())
        .unwrap_or(2);
    let names = vec![
        t!("error - errors only"),
        t!("warn - warnings and errors"),
        t!("info - general info (default)"),
        t!("debug - verbose diagnostics"),
        t!("trace - maximum verbosity"),
    ];
    let switch = |id: &'static str,
                  title: SharedString,
                  hint: SharedString,
                  on: bool,
                  steer: Steer,
                  cx: &mut Context<Shell>| {
        let lights = lit.lights(&title);
        SwitchRow::new(id, title, on)
            .look(Look::Setting)
            .lit(lights)
            .hint(hint)
            .on_click(cx.listener(move |shell, _, _, cx| shell.steer_logs(steer, cx)))
    };
    let (to_file, zip) = (logs.log_to_file, logs.auto_zip_logs);
    div()
        .child(super::heading(lit, t!("Log Level")))
        .child(
            div().mb(px(14.0)).child(Field::new(
                t!("Log Level"),
                div()
                    .child(
                        div()
                            .mt(px(-3.0))
                            .mb(px(7.0))
                            .text_size(px(11.5))
                            .text_color(theme.c.muted)
                            .child(t!(
                                "Set the verbosity of Rust backend logging. Lower levels include all messages from higher levels. Changes take effect immediately."
                            )),
                    )
                    .child(Select::new("log-level", names, at).on_choose(cx.listener(
                        |shell, at: &usize, _, cx| shell.steer_logs(Steer::Level(*at), cx),
                    ))),
            )),
        )
        .child(switch(
            "log-to-file",
            t!("Log to file"),
            t!(
                "Write logs at the level above to a date-stamped file in the app log folder. Useful for capturing issues in a release build where no terminal is attached."
            ),
            to_file,
            Steer::ToFile,
            cx,
        ))
        .child(div().when(!to_file, |row| row.opacity(0.45)).child(switch(
            "auto-zip-logs",
            t!("Auto-compress old logs"),
            t!(
                "When file logging is on, compress log files older than one day (zstd) to save space. Older logs become .log.zst archives."
            ),
            zip,
            Steer::AutoZip,
            cx,
        )))
        .child(switch(
            "terminal-logging",
            t!("Terminal logging (release builds)"),
            t!(
                "Emit logs to stdout/terminal in release builds. Already always on in development builds."
            ),
            logs.terminal_logging,
            Steer::Terminal,
            cx,
        ))
        .child(log_files(cx))
}

/// The folder the log is written into, and all of it exported as one file.
fn log_files(cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    ActionRow::new(
        t!("Log files"),
        div()
            .flex()
            .gap(px(6.0))
            .child(
                Button::new("open-logs", t!("View log files"))
                    .emphasis(Emphasis::Outlined)
                    .size(Size::Compact)
                    .on_click(cx.listener(|_, _, _, cx| {
                        cx.open_with_system(&crate::paths::data_dir().join("logs"));
                    })),
            )
            .child(
                Button::new("export-logs", t!("Export saved logs"))
                    .emphasis(Emphasis::Outlined)
                    .size(Size::Compact)
                    .on_click(cx.listener(|shell, _, _, cx| shell.export_logs(cx))),
            ),
    )
    .hint(t!(
        "View the folder containing your log files, or export all saved logs into a single compressed archive to share."
    ))
}
