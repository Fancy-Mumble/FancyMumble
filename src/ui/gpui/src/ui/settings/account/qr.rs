//! A QR code, drawn as the web UI's `QrCode` draws it: black modules on a
//! white ground whatever the theme, since a phone's camera has to read it,
//! with two modules of quiet room around them as part of the picture, at
//! medium error correction.

use crate::ui::kit::Picture;

/// How wide the code is drawn, as the web UI's.
pub(super) const SIDE: f32 = 176.0;

/// The quiet room around the modules, in modules.
const BORDER: usize = 2;

/// The SVG of the code that says `text`; none if it is too long for one.
fn svg(text: &str) -> Option<String> {
    let code = qrcode::QrCode::with_error_correction_level(text, qrcode::EcLevel::M).ok()?;
    let width = code.width();
    let side = width + 2 * BORDER;
    let mut path = String::new();
    for (at, colour) in code.to_colors().into_iter().enumerate() {
        if colour == qrcode::Color::Dark {
            let (x, y) = (at % width + BORDER, at / width + BORDER);
            path.push_str(&format!("M{x} {y}h1v1h-1z"));
        }
    }
    Some(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {side} {side}\" \
         shape-rendering=\"crispEdges\"><rect width=\"{side}\" height=\"{side}\" \
         fill=\"#ffffff\"/><path d=\"{path}\" fill=\"#000000\"/></svg>"
    ))
}

/// The code that says `text`, drawn; none for an empty text or one too
/// long for a code.
pub(super) fn picture(text: &str) -> Option<Picture> {
    if text.is_empty() {
        return None;
    }
    Picture::from_svg(svg(text)?.as_bytes(), SIDE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_code_is_black_on_white_with_its_quiet_room_and_its_finders() {
        let uri = "otpauth://totp/settings-test:Alex?secret=JBSWY3DPEHPK3PXP&issuer=settings-test";
        let pixels = picture(uri).expect("a code").pixels();
        let (w, h) = pixels.dimensions();
        assert_eq!(w, h, "square");
        let modules = qrcode::QrCode::with_error_correction_level(uri, qrcode::EcLevel::M)
            .expect("encodable")
            .width()
            + 2 * BORDER;
        let module = w as f32 / modules as f32;
        let at = |mx: f32, my: f32| {
            let p = pixels.get_pixel((mx * module) as u32, (my * module) as u32);
            (p[0], p[1], p[2])
        };
        // The quiet room is white, the corner of each finder black.
        assert_eq!(at(0.5, 0.5), (255, 255, 255));
        assert_eq!(at(BORDER as f32 + 0.5, BORDER as f32 + 0.5), (0, 0, 0));
        let far = (modules - BORDER) as f32 - 0.5;
        assert_eq!(at(far, BORDER as f32 + 0.5), (0, 0, 0));
        assert_eq!(at(BORDER as f32 + 0.5, far), (0, 0, 0));
        // And inside each finder, its white ring.
        assert_eq!(at(BORDER as f32 + 1.5, BORDER as f32 + 1.5), (255, 255, 255));
        assert!(picture("").is_none());
    }
}
