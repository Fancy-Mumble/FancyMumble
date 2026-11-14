//! A user's sheet, for an administrator, lists each device an account is
//! on at once; for anybody else it is the sheet it always was.

use gpui::{SharedString, TestAppContext};

use super::tests::{click, right_click, shell};
use crate::engine::{DeviceFacts, EngineEvent, Subject};

fn ping(ms: u32) -> Vec<(SharedString, SharedString)> {
    vec![("Ping".into(), format!("{ms} ms").into())]
}

fn device(session: u32, name: &str, ms: u32) -> DeviceFacts {
    DeviceFacts {
        session,
        name: name.to_owned().into(),
        facts: ping(ms),
    }
}

#[gpui::test]
fn a_users_sheet_lists_their_devices_only_where_the_server_told_of_them(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    right_click(cx, "user-2");
    click(cx, "menu-View comment");
    let tell = |cx: &mut gpui::VisualTestContext, devices: Vec<DeviceFacts>| {
        shell.update(cx, |shell, cx| {
            shell.apply(
                EngineEvent::Facts {
                    subject: Subject::User(2),
                    facts: ping(20),
                    devices,
                },
                cx,
            );
            cx.notify();
        });
        cx.run_until_parked();
    };

    // One device, or an asker who is not an administrator: no section.
    tell(cx, Vec::new());
    shell.read_with(cx, |shell, _| {
        let sheet = shell.info.as_ref().expect("the sheet");
        assert_eq!(sheet.subject, Subject::User(2));
        assert_eq!(sheet.facts, ping(20));
        assert!(sheet.devices.is_empty());
    });
    assert!(cx.debug_bounds("info-facts").is_some());
    assert!(cx.debug_bounds("info-devices").is_none());

    // Several: each under its name, with what is known of it.
    let devices = vec![device(11, "Laptop", 23), device(12, "Device 12", 140)];
    tell(cx, devices.clone());
    shell.read_with(cx, |shell, _| {
        let sheet = shell.info.as_ref().expect("the sheet");
        assert_eq!(sheet.devices, devices);
        let names: Vec<&str> = sheet.devices.iter().map(|d| d.name.as_ref()).collect();
        assert_eq!(names, ["Laptop", "Device 12"]);
    });
    assert!(cx.debug_bounds("info-devices").is_some());
    assert!(cx.debug_bounds("info-device-11").is_some());
    assert!(cx.debug_bounds("info-device-12").is_some());

    // Facts about somebody else leave the open sheet alone.
    shell.update(cx, |shell, cx| {
        shell.apply(
            EngineEvent::Facts {
                subject: Subject::User(5),
                facts: Vec::new(),
                devices: Vec::new(),
            },
            cx,
        );
    });
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.info.as_ref().expect("the sheet").devices.len(), 2);
    });
}
