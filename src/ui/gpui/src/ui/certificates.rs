//! The certificates the client holds: which there are, who uses each, and
//! taking one to another machine or bringing one from there.
//!
//! A certificate is how a server recognises a user without a password; a
//! registration is tied to it. Losing one loses the registrations made
//! with it, so deleting asks twice and exporting is one click.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::widgets::{EMPHASIS, icon, opaque};
use crate::engine::CertificateTask;
use crate::theme::Theme;

/// The panel's state.
#[derive(Default)]
pub(super) struct Panel {
    /// Whether it is showing.
    pub open: bool,
    /// The certificates it lists.
    pub held: Vec<SharedString>,
    /// The certificate a first click on delete has armed.
    pub doomed: Option<SharedString>,
}

impl Shell {
    /// Open or close the panel, reading the certificates afresh on opening.
    pub(super) fn toggle_certificates(&mut self, cx: &mut Context<Self>) {
        self.certs.open = !self.certs.open;
        self.certs.doomed = None;
        if self.certs.open {
            self.certs.held = self.engine.certificates();
        }
        cx.notify();
    }

    /// How many saved identities present the certificate `label`.
    fn users_of(&self, label: &str) -> usize {
        self.servers
            .iter()
            .filter(|server| {
                server
                    .certificate
                    .as_ref()
                    .is_some_and(|held| held.as_ref() == label)
            })
            .count()
    }

    /// Delete `label` on the second asking; the first only arms it.
    fn delete_certificate(&mut self, label: &SharedString, cx: &mut Context<Self>) {
        if self.certs.doomed.as_ref() == Some(label) {
            self.certs.doomed = None;
            self.engine
                .manage_certificate(CertificateTask::Delete(label.to_string()));
        } else {
            self.certs.doomed = Some(label.clone());
        }
        cx.notify();
    }

    /// Ask where to, and write `label` there.
    fn export_certificate(&mut self, label: &SharedString, cx: &mut Context<Self>) {
        let home = std::env::var_os("HOME").map_or_else(std::env::temp_dir, Into::into);
        let chosen = cx.prompt_for_new_path(&home, Some(&format!("{label}.fancy-identity.json")));
        let label = label.to_string();
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(to))) = chosen.await else {
                return;
            };
            let _ = shell.update(cx, |shell, _| {
                shell
                    .engine
                    .manage_certificate(CertificateTask::Export { label, to });
            });
        })
        .detach();
    }

    /// Ask for an exported certificate, and take it in.
    fn import_certificate(&mut self, cx: &mut Context<Self>) {
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose an exported certificate".into()),
        });
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(paths))) = chosen.await else {
                return;
            };
            let Some(from) = paths.into_iter().next() else {
                return;
            };
            let _ = shell.update(cx, |shell, _| {
                shell
                    .engine
                    .manage_certificate(CertificateTask::Import(from));
            });
        })
        .detach();
    }
}

/// A small square button with an icon on it.
fn tool(
    id: (&'static str, usize),
    glyph: &'static str,
    ink: gpui::Hsla,
    theme: &Theme,
) -> gpui::Stateful<gpui::Div> {
    let hover = theme.c.hover;
    div()
        .id(id)
        .flex_none()
        .size(px(28.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(theme.skin.radius_md)
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .child(icon(glyph, 14.0, ink))
}

fn row(
    shell: &Shell,
    at: usize,
    label: &SharedString,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let users = shell.users_of(label);
    let doomed = shell.certs.doomed.as_ref() == Some(label);
    let about: SharedString = match (doomed, users) {
        (true, 0) => "Click again to delete it for good".into(),
        (true, _) => "In use. Click again to delete it for good".into(),
        (false, 0) => "Not used by any saved identity".into(),
        (false, 1) => "Used by 1 saved identity".into(),
        (false, many) => format!("Used by {many} saved identities").into(),
    };
    let (for_export, for_delete, tag) = (label.clone(), label.clone(), label.clone());
    let tag_delete = tag.clone();
    div()
        .h(px(46.0))
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(10.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card2)
        .child(icon("key-round", 15.0, theme.c.muted))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(div().truncate().font_weight(EMPHASIS).child(label.clone()))
                .child(
                    div()
                        .truncate()
                        .text_size(px(11.5))
                        .text_color(if doomed { theme.c.bad } else { theme.c.muted })
                        .child(about),
                ),
        )
        .child(
            tool(("certificate-export", at), "download", theme.c.muted, theme)
                .debug_selector(move || format!("export-{tag}"))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.export_certificate(&for_export, cx);
                })),
        )
        .child(
            tool(("certificate-delete", at), "trash-2", theme.c.bad, theme)
                .debug_selector(move || format!("delete-{tag_delete}"))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.delete_certificate(&for_delete, cx);
                })),
        )
}

/// The panel, over a veil.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let mut veil = gpui::black();
    veil.a = 0.5;
    let hover = theme.c.hover;
    let button = |id: &'static str, name: &'static str| {
        div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .h(px(36.0))
            .px(px(16.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .rounded(theme.skin.radius_md)
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .child(name)
    };
    div()
        .id("certificates")
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .bg(veil)
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .w(px(480.0))
                .max_h(px(560.0))
                .flex()
                .flex_col()
                .gap(px(12.0))
                .p(px(22.0))
                .rounded(theme.skin.radius_lg)
                .bg(opaque(theme.c.card, theme.c.bg0))
                .border_1()
                .border_color(theme.c.line2)
                .shadow_lg()
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(EMPHASIS)
                        .child("Certificates"),
                )
                .child(div().text_size(px(12.5)).text_color(theme.c.muted).child(
                    "A server recognises you by your certificate, and a \
                             registration belongs to it. Export one to use it on \
                             another machine; an exported file holds its private key.",
                ))
                .child(
                    div()
                        .id("certificate-list")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .gap(px(6.0))
                        .text_size(px(13.0))
                        .when(shell.certs.held.is_empty(), |list| {
                            list.child(div().py(px(10.0)).text_color(theme.c.muted).child(
                                "None yet: one is made the first time an identity connects.",
                            ))
                        })
                        .children(
                            shell
                                .certs
                                .held
                                .iter()
                                .enumerate()
                                .map(|(at, label)| row(shell, at, label, theme, cx)),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .text_size(px(13.0))
                        .child(
                            button("import-certificate", "Import…")
                                .text_color(theme.c.accent_text)
                                .on_click(cx.listener(|shell, _, _, cx| {
                                    shell.import_certificate(cx);
                                })),
                        )
                        .child(
                            button("certificates-close", "Close")
                                .text_color(theme.c.muted)
                                .on_click(cx.listener(|shell, _, _, cx| {
                                    shell.toggle_certificates(cx);
                                })),
                        ),
                ),
        )
}
