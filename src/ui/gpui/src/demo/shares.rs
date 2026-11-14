//! Shares on the demo server: people in the lounge sharing the test
//! pattern, and drawing on it.

use super::DemoEngine;
use crate::engine::{EngineEvent, Session};
use crate::share::{Heard, Signal, SignalKind, Stroke};

/// Who shares, in order, when the demo is asked for shares: Rin, Flora,
/// Torque, Scout.
const SHARERS: [Session; 4] = [3, 2, 5, 4];

impl DemoEngine {
    /// Have `count` people in the lounge share their screens.
    pub(crate) fn share_screens(&self, count: usize) {
        for session in SHARERS.into_iter().take(count) {
            self.say_share(session, SignalKind::Start);
        }
    }

    /// Have the local user's own account share from another device: on
    /// Starling, that device's START names this device's own session.
    pub(crate) fn share_from_elsewhere(&self) {
        self.say_share(1, SignalKind::Start);
    }

    /// Have `session` share their screen and their camera beside it, as the
    /// web client announces the two.
    pub(crate) fn share_with_camera(&self, session: Session) {
        use crate::share::tracks::{Content, Tracks};
        self.tell(EngineEvent::Share(Heard::Signal(Signal {
            server: None,
            sender: Some(session),
            kind: SignalKind::Start,
            payload: Tracks::of([Content::Screen, Content::Camera]).payload(),
        })));
    }

    /// Have `session` say START or STOP.
    pub(crate) fn say_share(&self, session: Session, kind: SignalKind) {
        self.tell(EngineEvent::Share(Heard::Signal(Signal {
            server: None,
            sender: Some(session),
            kind,
            payload: String::new(),
        })));
    }

    /// Have Rin draw a ring and a stroke under it on the share in the
    /// lounge, as the web client sends them.
    pub(crate) fn draw_on_share(&self) {
        let ring: Vec<f32> = (0..=36)
            .flat_map(|step| {
                let turn = step as f32 / 36.0 * std::f32::consts::TAU;
                [0.5 + 0.12 * turn.cos(), 0.45 + 0.2 * turn.sin()]
            })
            .collect();
        let packet = |id: &str, colour: u32, points: Vec<f32>| Stroke {
            sender: 3,
            channel: 1,
            id: id.to_owned(),
            colour,
            width: 6.0,
            width_frac: Some(0.012),
            points,
            end: true,
            clear: false,
            clear_all: false,
        };
        self.tell(EngineEvent::Share(Heard::Stroke(packet("ring", 0xFF_00_CC_00, ring))));
        let under = vec![0.3, 0.8, 0.45, 0.76, 0.6, 0.8, 0.7, 0.77];
        self.tell(EngineEvent::Share(Heard::Stroke(packet("under", 0xFF_FF_BB_00, under))));
    }
}
