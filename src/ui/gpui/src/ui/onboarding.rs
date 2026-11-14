//! The questions a server asks a new member, asked as the web UI asks them
//! (`OnboardingModal`, `onboardingStore`): a dialog that first shows the
//! channels everybody gets, then one question a step, a rail of the steps
//! across it.
//!
//! It opens by itself where the server says the user still owes an answer
//! to its questions as they now stand, unless skipped on that server since
//! the client started; and from the Channels & roles page, to change the
//! answers or start over. Neither Escape nor a click beside it closes it:
//! leaving on purpose is what is remembered.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::time::Duration;

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Button, Dialog, Emphasis, Reachable, icon};
use super::widgets::EMPHASIS;
use crate::engine::{OnboardingConfig, OnboardingNews, OnboardingResponse, OnboardingSelection};
use crate::theme::Theme;
use crate::words::t;

/// How long the server is given to say what it keeps of the user's
/// answers before none is taken for never having answered.
const ANSWERS_WITHIN: Duration = Duration::from_secs(5);

/// The questions being asked: which step, and what is chosen so far.
#[derive(Debug, Default)]
pub(super) struct Asking {
    /// The step on show: the channels everybody gets first, then one per
    /// question.
    pub step: usize,
    /// The answers chosen, by question.
    pub chosen: BTreeMap<String, BTreeSet<String>>,
}

/// What the client knows of the questions on the server on show.
#[derive(Debug, Default)]
pub(in crate::ui) struct Onboarding {
    /// The user's answers as the server keeps them.
    pub response: Option<OnboardingResponse>,
    /// Whether the server said what it keeps: until it has, no answers is
    /// not the same as never having answered.
    pub known: bool,
    /// Whether the server was asked, and the answer is waited for.
    asked: bool,
    /// The questions, while they are asked.
    pub asking: Option<Asking>,
    /// The servers the questions were skipped on since the client started.
    skipped: HashSet<SharedString>,
}

impl Shell {
    /// What the server said of the questions or the answers: the questions
    /// are asked if the user owes an answer to them.
    pub(super) fn onboarding_news(&mut self, news: OnboardingNews, cx: &mut Context<Self>) {
        if let OnboardingNews::Response(response) = news {
            let onboarding = &mut self.panels.settings.onboarding;
            onboarding.response = response;
            onboarding.known = true;
            onboarding.asked = false;
        }
        self.ask_if_owed(cx);
    }

    /// Ask the questions where the server says this user still owes an
    /// answer to them as they now stand; ask the server first when that is
    /// not known yet, and take its silence for no answer.
    fn ask_if_owed(&mut self, cx: &mut Context<Self>) {
        if !self.engine.onboarding_offered() || self.panels.settings.onboarding.asking.is_some() {
            return;
        }
        let Some(config) = self.engine.onboarding_config().filter(|config| config.enabled) else {
            return;
        };
        let onboarding = &mut self.panels.settings.onboarding;
        if onboarding.response.is_none()
            && let Some(kept) = self.engine.onboarding_response()
        {
            onboarding.response = Some(kept);
            onboarding.known = true;
        }
        if !onboarding.known {
            if !onboarding.asked {
                onboarding.asked = true;
                self.engine.request_onboarding_response();
                cx.spawn(async move |shell, cx| {
                    cx.background_executor().timer(ANSWERS_WITHIN).await;
                    let _ = shell.update(cx, Self::answers_not_said);
                })
                .detach();
            }
            return;
        }
        let answered = onboarding
            .response
            .as_ref()
            .is_some_and(|response| response.config_revision >= config.revision);
        let skipped = self
            .active_session
            .as_ref()
            .is_some_and(|server| onboarding.skipped.contains(server));
        if !answered && !skipped {
            self.ask_questions(false, cx);
        }
    }

    /// The server did not say what it keeps of the answers in time: none
    /// is taken for never having answered.
    fn answers_not_said(&mut self, cx: &mut Context<Self>) {
        let onboarding = &mut self.panels.settings.onboarding;
        if onboarding.asked && !onboarding.known {
            onboarding.known = true;
            onboarding.asked = false;
            self.ask_if_owed(cx);
            cx.notify();
        }
    }

    /// Ask the questions: with the answers kept ticked to begin with, or
    /// with `afresh` none.
    pub(super) fn ask_questions(&mut self, afresh: bool, cx: &mut Context<Self>) {
        let onboarding = &mut self.panels.settings.onboarding;
        let chosen = if afresh {
            BTreeMap::new()
        } else {
            onboarding
                .response
                .iter()
                .flat_map(|response| response.selections.iter())
                .map(|selection| {
                    (
                        selection.question_id.clone(),
                        selection.answer_ids.iter().cloned().collect(),
                    )
                })
                .collect()
        };
        onboarding.asking = Some(Asking { step: 0, chosen });
        cx.notify();
    }

    /// Choose `answer` of the question `question`: the only one where one
    /// is asked for (choosing it again leaves it chosen), or one more, or
    /// one less, where several are.
    fn choose_answer(&mut self, question: &str, answer: &str, several: bool, cx: &mut Context<Self>) {
        let Some(asking) = &mut self.panels.settings.onboarding.asking else {
            return;
        };
        let chosen = asking.chosen.entry(question.to_owned()).or_default();
        if !several {
            chosen.clear();
            let _ = chosen.insert(answer.to_owned());
        } else if !chosen.remove(answer) {
            let _ = chosen.insert(answer.to_owned());
        }
        cx.notify();
    }

    /// Go a step on, or back.
    fn step_questions(&mut self, on: bool, cx: &mut Context<Self>) {
        if let Some(asking) = &mut self.panels.settings.onboarding.asking {
            asking.step = if on {
                asking.step + 1
            } else {
                asking.step.saturating_sub(1)
            };
        }
        cx.notify();
    }

    /// Give the server the answers chosen, and put the questions away.
    fn finish_questions(&mut self, config: &OnboardingConfig, cx: &mut Context<Self>) {
        let Some(asking) = self.panels.settings.onboarding.asking.take() else {
            return;
        };
        let selections = config
            .questions
            .iter()
            .filter_map(|question| {
                let chosen = asking.chosen.get(&question.id)?;
                (!chosen.is_empty()).then(|| OnboardingSelection {
                    question_id: question.id.clone(),
                    answer_ids: chosen.iter().cloned().collect(),
                })
            })
            .collect();
        let response = OnboardingResponse {
            user_hash: None,
            submitted_at: None,
            config_revision: config.revision,
            selections,
        };
        self.engine.submit_onboarding(response.clone());
        let onboarding = &mut self.panels.settings.onboarding;
        onboarding.response = Some(response);
        onboarding.known = true;
        cx.notify();
    }

    /// Put the questions away, and do not ask them again on this server
    /// until the client starts again.
    fn skip_questions(&mut self, cx: &mut Context<Self>) {
        let onboarding = &mut self.panels.settings.onboarding;
        onboarding.asking = None;
        if let Some(server) = &self.active_session {
            let _ = onboarding.skipped.insert(server.clone());
        }
        cx.notify();
    }

    /// Another server is on show, or the connection is new: what was known
    /// of the answers is of the server before.
    pub(super) fn forget_onboarding(&mut self) {
        let onboarding = &mut self.panels.settings.onboarding;
        onboarding.response = None;
        onboarding.known = false;
        onboarding.asked = false;
        onboarding.asking = None;
    }
}

/// The questions, while they are asked.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Option<AnyElement> {
    let asking = shell.panels.settings.onboarding.asking.as_ref()?;
    let config = shell.engine.onboarding_config()?;
    let steps = config.questions.len() + 1;
    let question = asking.step.checked_sub(1).and_then(|at| config.questions.get(at));
    let (title, says): (SharedString, SharedString) = match question {
        None => (t!("Welcome!"), t!("Let's tailor your view of this server.")),
        Some(question) => (
            question.text.clone().into(),
            if question.multi_select {
                t!("Pick all that apply.")
            } else {
                t!("Pick one.")
            },
        ),
    };
    let answered = question.is_none_or(|question| {
        !question.required || asking.chosen.get(&question.id).is_some_and(|chosen| !chosen.is_empty())
    });
    let last = asking.step + 1 >= steps;
    let body = match question {
        None => everybodys(shell, &config, theme),
        Some(question) => div()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .when(question.required, |answers| {
                answers.child(
                    div()
                        .text_size(px(11.5))
                        .text_color(theme.c.muted)
                        .child(t!("* required")),
                )
            })
            .children(question.answers.iter().enumerate().map(|(at, answer)| {
                let on = asking
                    .chosen
                    .get(&question.id)
                    .is_some_and(|chosen| chosen.contains(&answer.id));
                answer_row(question, answer, at, on, theme, cx)
            })),
    };
    let head = div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .size(px(28.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(9.0))
                        .bg(theme.c.accent_soft)
                        .child(icon("sparkles", 16.0, theme.c.accent)),
                )
                .child(
                    div()
                        .debug_selector(|| "onboarding-title".to_owned())
                        .text_size(px(15.0))
                        .font_weight(EMPHASIS)
                        .child(title),
                ),
        )
        .child(div().text_size(px(12.5)).text_color(theme.c.muted).child(says));
    let rail = div().flex().gap(px(4.0)).children((0..steps).map(|at| {
        div()
            .h(px(3.0))
            .flex_1()
            .rounded(theme.skin.radius_pill)
            .bg(if at <= asking.step {
                theme.c.accent
            } else {
                theme.c.line2
            })
    }));
    Some(
        Dialog::new("onboarding")
            .w(px(600.0))
            .gap(px(16.0))
            .p(px(24.0))
            .child(head)
            .child(rail)
            .child(body)
            .child(footer(asking.step, answered, last, config, cx))
            .into_any_element(),
    )
}

/// The channels everybody gets, shown before the first question.
fn everybodys(shell: &Shell, config: &OnboardingConfig, theme: &Theme) -> gpui::Div {
    let muted = |words: SharedString| div().text_size(px(12.5)).text_color(theme.c.muted).child(words);
    if config.default_channel_ids.is_empty() {
        return div().child(muted(t!(
            "You'll start with the full channel list. Answer the next questions to narrow it down."
        )));
    }
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(muted(t!("You'll start in these channels")))
        .child(div().flex().flex_wrap().gap(px(6.0)).children(
            config.default_channel_ids.iter().map(|id| {
                div()
                    .px(px(10.0))
                    .py(px(4.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.card2)
                    .border_1()
                    .border_color(theme.c.line2)
                    .text_size(px(12.5))
                    .child(SharedString::from(format!("#{}", shell.channel_name(*id))))
            }),
        ))
}

impl Shell {
    /// What the channel `id` is called, or its number where it is not known.
    pub(super) fn channel_name(&self, id: u32) -> String {
        self.snapshot
            .channels
            .iter()
            .find(|channel| channel.id == id)
            .map_or_else(|| id.to_string(), |channel| channel.name.to_string())
    }
}

/// One answer: the whole card is what is pressed, and a tick on its far
/// side says it is chosen, as its edge does.
fn answer_row(
    question: &crate::engine::OnboardingQuestion,
    answer: &crate::engine::OnboardingAnswer,
    at: usize,
    on: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let id = SharedString::from(format!("onboarding-answer-{at}"));
    let selector = id.clone();
    let (question_id, answer_id, several) =
        (question.id.clone(), answer.id.clone(), question.multi_select);
    let line = theme.c.accent_line;
    let row = div()
        .id(id.clone())
        .debug_selector(move || selector.to_string())
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(12.0))
        .py(px(10.0))
        .rounded(px(11.0))
        .cursor_pointer()
        .bg(if on { theme.c.accent_soft } else { theme.c.card })
        .border_1()
        .border_color(if on { theme.c.accent_line } else { theme.c.line2 })
        .hover(move |style| style.border_color(line))
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.choose_answer(&question_id, &answer_id, several, cx);
        }))
        .children(answer.emoji.clone().map(|emoji| div().text_size(px(17.0)).child(emoji)))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .text_size(px(13.5))
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child(answer.label.clone()),
                )
                .children(answer.description.clone().map(|description| {
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.c.muted)
                        .child(description)
                })),
        )
        .child(
            div()
                .flex_none()
                .when(!on, gpui::Styled::invisible)
                .child(icon("check", 16.0, theme.c.accent)),
        );
    Reachable::new(id, row).corner(px(11.0))
}

/// Skip, back, and on (or finish on the last step).
fn footer(
    step: usize,
    answered: bool,
    last: bool,
    config: OnboardingConfig,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let on = Button::new(
        "onboarding-next",
        if last { t!("Finish") } else { t!("Next") },
    )
    .emphasis(Emphasis::Contained);
    let on = if !answered {
        on
    } else if last {
        on.on_click(cx.listener(move |shell, _, _, cx| shell.finish_questions(&config, cx)))
    } else {
        on.on_click(cx.listener(|shell, _, _, cx| shell.step_questions(true, cx)))
    };
    div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            Button::new("onboarding-skip", t!("Skip for now"))
                .on_click(cx.listener(|shell, _, _, cx| shell.skip_questions(cx))),
        )
        .child(div().flex_1())
        .when(step > 0, |footer| {
            footer.child(
                Button::new("onboarding-back", t!("Back"))
                    .on_click(cx.listener(|shell, _, _, cx| shell.step_questions(false, cx))),
            )
        })
        .child(div().when(!answered, |held| held.opacity(0.4)).child(on))
}
