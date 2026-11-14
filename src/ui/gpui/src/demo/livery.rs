//! The demo's server liveries: one made-up livery, for `kumo.jp`, so that
//! views and captures show one with no network. What its pings say and
//! what a probe answers can be changed by a test.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use crate::livery::{Livery, Palette, Pinged, Tag, TagTone};

/// The address the made-up livery is of.
pub(crate) const BRANDED: &str = "kumo.jp:64738";
/// Its digest, as the server's ping would carry it.
pub(crate) const DIGEST: &str = "6b756d6f6c697665";

/// What the demo's servers say of their liveries.
#[derive(Debug)]
pub(crate) struct Liveries {
    /// What each server holds, by address; `None` for one that has none.
    held: HashMap<String, Option<Arc<Livery>>>,
    /// What a ping says, where a test has said otherwise: `None` for a ping
    /// that has not come back.
    pings: HashMap<String, Option<Pinged>>,
    /// The livery of the server the demo is on, where a test gave it one.
    pub live: Option<(String, Arc<Livery>)>,
    /// Every address asked without joining, in order.
    pub probes: Vec<String>,
    /// Whether a probe is answered; when not, it stays out.
    pub answering: bool,
}

impl Liveries {
    /// `FANCY_GPUI_DEMO_LIVERY=on` has the server the demo is on say the
    /// made-up livery as its own, for looking at the rail, the band and the
    /// colours of a server that has one.
    pub(crate) fn seeded() -> Self {
        let worn = std::env::var("FANCY_GPUI_DEMO_LIVERY").is_ok_and(|on| on == "on");
        Self {
            held: HashMap::new(),
            pings: HashMap::new(),
            live: worn.then(|| ("magical.rocks:64738".to_owned(), made_up())),
            probes: Vec::new(),
            answering: true,
        }
    }

    /// The livery the server at `key` holds.
    pub(crate) fn held(&self, key: &str) -> Option<Arc<Livery>> {
        match self.held.get(key) {
            Some(held) => held.clone(),
            None => (key == BRANDED).then(made_up),
        }
    }

    /// Have the server at `key` hold `livery`, or none.
    #[cfg(test)]
    pub(crate) fn hold(&mut self, key: &str, livery: Option<Arc<Livery>>) {
        let _ = self.held.insert(key.to_owned(), livery);
    }

    /// Have the ping of `key` say `pinged` from now on.
    #[cfg(test)]
    pub(crate) fn ping_says(&mut self, key: &str, pinged: Option<Pinged>) {
        let _ = self.pings.insert(key.to_owned(), pinged);
    }

    /// What the ping of `key`, whose server is up or not, says.
    pub(crate) fn pinged(&self, key: &str, up: bool) -> Option<Pinged> {
        if let Some(said) = self.pings.get(key) {
            return said.clone();
        }
        if !up {
            return Some(Pinged::Down);
        }
        // `kumo.jp` speaks Fancy and says what it holds; the rest cannot say.
        let digest = (key == BRANDED).then(|| {
            self.held(key)
                .map_or_else(Default::default, |livery| livery.digest.clone())
        });
        Some(Pinged::Up { digest })
    }
}

/// The made-up livery, made once, when first asked for.
pub(crate) fn made_up() -> Arc<Livery> {
    static MADE: OnceLock<Arc<Livery>> = OnceLock::new();
    Arc::clone(MADE.get_or_init(|| {
        Arc::new(Livery {
            version: 4,
            digest: DIGEST.into(),
            name: Some("Kumo Lounge".into()),
            tagline: Some("Clouds, tea and late-night voice chat".into()),
            motd: Some(
                "Welcome! Voice is open every evening in the lounge.\nBe kind; keep it cosy."
                    .into(),
            ),
            tags: vec![
                Tag::new("JP / EU", TagTone::Neutral, None),
                Tag::new("Friendly", TagTone::Ok, None),
                Tag::new("Quiet hours", TagTone::Warn, None),
                Tag::new("Rules", TagTone::Accent, Some("https://example.org/rules")),
            ],
            banner: crate::picture::picture(painted(1200, 420, sky)).map(Arc::new),
            icon: crate::picture::picture(painted(128, 128, cloud)).map(Arc::new),
            focus: (50, 30),
            dark: Palette::read([Some("#7fb3ff"), None, Some("#3d6bd6"), Some("#9b5de5")]),
            light: Palette::read([Some("#2f62c8"), None, None, None]),
        })
    }))
}

/// A picture `width` by `height`, each pixel as `colour` says, as a PNG.
fn painted(width: u32, height: u32, colour: fn(f32, f32) -> [u8; 3]) -> Vec<u8> {
    #[expect(clippy::cast_precision_loss, reason = "a picture's side")]
    let pixels = image::RgbImage::from_fn(width, height, |x, y| {
        image::Rgb(colour(x as f32 / width as f32, y as f32 / height as f32))
    });
    let mut file = Vec::new();
    let _ = pixels.write_to(
        &mut std::io::Cursor::new(&mut file),
        image::ImageFormat::Png,
    );
    file
}

/// Channel values from a fraction.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "held to 0..=255 first"
)]
fn channel(value: f32) -> u8 {
    (value * 255.0).clamp(0.0, 255.0) as u8
}

/// An evening sky, with a sun low in it.
fn sky(x: f32, y: f32) -> [u8; 3] {
    let sun = 1.0 - (((x - 0.7) * 3.0).powi(2) + ((y - 0.62) * 2.2).powi(2)).sqrt();
    let glow = sun.max(0.0).powf(1.5);
    [
        channel(0.18 + 0.5 * y + 0.6 * glow),
        channel(0.2 + 0.25 * y + 0.45 * glow),
        channel(0.55 - 0.2 * y + 0.2 * glow),
    ]
}

/// A white cloud on blue.
fn cloud(x: f32, y: f32) -> [u8; 3] {
    let puff = |cx: f32, cy: f32, r: f32| ((x - cx).powi(2) + (y - cy).powi(2)).sqrt() < r;
    if puff(0.38, 0.55, 0.2)
        || puff(0.6, 0.5, 0.24)
        || (y > 0.55 && y < 0.72 && x > 0.2 && x < 0.82)
    {
        [245, 247, 255]
    } else {
        [
            channel(0.25 + 0.2 * y),
            channel(0.42 + 0.2 * y),
            channel(0.85),
        ]
    }
}
