//! The questions a server asks a new member, answered against a live
//! Starling the way the Channels & roles page answers them, and the answers
//! seen where they show: kept by the server for another device of the same
//! account, and as the groups the answer names.
//!
//! ```text
//! FANCY_GPUI_TEST_FANCY=127.0.0.1:64970 FANCY_GPUI_TEST_SUPERUSER=<password> \
//!     cargo test -- --ignored live_fancy_the_questions
//! ```

use std::path::PathBuf;
use std::time::{Duration, Instant};

use super::RealEngine;
use crate::engine::{
    Action, CertificateTask, Connection, Engine, EngineEvent, OnboardingAnswer, OnboardingConfig,
    OnboardingNews, OnboardingQuestion, OnboardingResponse, OnboardingSelection, SavedServer,
};

/// A client of the server `FANCY_GPUI_TEST_FANCY` names, as `name` with the
/// identity `certificate`, its files in the folder `dir` names.
fn client(name: &str, certificate: &str, dir: &str) -> (RealEngine, PathBuf) {
    let address = std::env::var("FANCY_GPUI_TEST_FANCY").expect("FANCY_GPUI_TEST_FANCY");
    let (host, port) = address.rsplit_once(':').expect("host:port");
    let dir = std::env::temp_dir().join(format!("fancy-gpui-onboarding-{dir}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let engine = RealEngine::start(&dir).expect("the engine starts");
    engine.save_server(SavedServer {
        id: "live".into(),
        label: "live".into(),
        host: host.to_owned().into(),
        port: port.parse().expect("a port"),
        username: name.to_owned().into(),
        certificate: Some(certificate.to_owned().into()),
        favorite: false,
    });
    (engine, dir)
}

#[track_caller]
fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// The answers the server keeps of the user on `engine`, asked for.
#[track_caller]
fn kept(engine: &RealEngine) -> Option<OnboardingResponse> {
    let events = engine.events();
    engine.request_onboarding_response();
    let mut said = None;
    wait_for("the answers kept", || {
        said = std::iter::from_fn(|| events.try_recv().ok()).find_map(|event| match event {
            EngineEvent::Onboarding(OnboardingNews::Response(response)) => Some(response),
            _ => None,
        });
        said.is_some()
    });
    said.flatten()
}

/// One question whose one answer puts the user in the group `testers`.
fn questions() -> OnboardingConfig {
    OnboardingConfig {
        version: 1,
        enabled: true,
        default_channel_ids: vec![0],
        questions: vec![OnboardingQuestion {
            id: "why".into(),
            text: "What brings you here?".into(),
            multi_select: false,
            required: true,
            ask_before_join: false,
            answers: vec![OnboardingAnswer {
                id: "testing".into(),
                label: "Testing".into(),
                channel_ids: Vec::new(),
                group_names: vec!["testers".into()],
                emoji: None,
                description: None,
            }],
        }],
        ..OnboardingConfig::default()
    }
}

/// An administrator asks one question; a registered member answers it as
/// the page does; another device of the member reads the answer back, and
/// the administrator finds the member in the group the answer names.
#[test]
#[ignore = "needs a live Starling and its SuperUser password"]
fn live_fancy_the_questions_are_answered_and_the_answer_kept() {
    let superuser = std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
    let (admin, admin_dir) = client("SuperUser", "joinadmin", "admin");
    admin.connect("live", Some(superuser));
    let (member, member_dir) = client("Joiner", "joiner", "member");
    member.connect("live", None);
    wait_for("both on", || {
        admin.snapshot().users.len() >= 2 && member.snapshot().users.len() >= 2
    });
    let session = member.snapshot().own_session.expect("on");
    admin.act(Action::Register { session });
    let mut account = None;
    wait_for("the account", || {
        account = member
            .snapshot()
            .users
            .iter()
            .find(|user| user.session == session)
            .and_then(|user| user.account);
        account.is_some()
    });
    let account = account.expect("registered");
    member.disconnect();
    wait_for("off", || member.snapshot().own_session.is_none());
    member.connect("live", None);
    wait_for("back", || member.snapshot().connection == Connection::Connected);

    // The administrator asks; the member is told the questions.
    let engine = admin.shared.engine.clone();
    admin
        .runtime
        .block_on(engine.save_onboarding_config(questions()))
        .expect("the questions sent");
    wait_for("the member told the questions", || {
        member.onboarding_offered()
            && member
                .onboarding_config()
                .is_some_and(|config| config.enabled && config.questions.len() == 1)
    });
    let revision = member.onboarding_config().expect("questions").revision;
    assert!(kept(&member).is_none(), "nothing answered yet");

    // Answered, as the page answers.
    member.submit_onboarding(OnboardingResponse {
        user_hash: None,
        submitted_at: None,
        config_revision: revision,
        selections: vec![OnboardingSelection {
            question_id: "why".into(),
            answer_ids: vec!["testing".into()],
        }],
    });

    // Another device of the member reads it back.
    let carried = member_dir.join("carried.json");
    member.manage_certificate(CertificateTask::Export {
        label: "joiner".to_owned(),
        to: carried.clone(),
    });
    wait_for("the export", || carried.exists());
    let (other, other_dir) = client("Joiner", "joiner", "other");
    other.manage_certificate(CertificateTask::Import(carried));
    wait_for("the import", || other.certificates().iter().any(|label| label == "joiner"));
    other.connect("live", None);
    wait_for("the other device on", || other.snapshot().connection == Connection::Connected);
    let mut answer = None;
    wait_for("the answer kept", || {
        answer = kept(&other);
        answer.is_some()
    });
    let answer = answer.expect("kept");
    assert_eq!(answer.config_revision, revision);
    assert_eq!(answer.selections.len(), 1);
    assert_eq!(answer.selections[0].answer_ids, ["testing"]);

    // And the member is in the group the answer names.
    let events = admin.events();
    admin.request_acl(0);
    let mut groups = Vec::new();
    wait_for("the root's rules", || {
        if let Some(acl) = std::iter::from_fn(|| events.try_recv().ok()).find_map(|event| match event {
            EngineEvent::Acl(acl) if acl.channel == 0 => Some(acl),
            _ => None,
        }) {
            groups = acl.groups;
        }
        !groups.is_empty()
    });
    let testers = groups.iter().find(|group| group.name.as_ref() == "testers");
    assert!(
        testers.is_some_and(|group| group.added.contains(&account)),
        "in the group the answer names: {groups:?}"
    );

    for (engine, dir) in [(admin, admin_dir), (member, member_dir), (other, other_dir)] {
        engine.shutdown();
        let _ = std::fs::remove_dir_all(dir);
    }
}
