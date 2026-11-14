//! A test pattern: what is shared and watched wherever a real screen must
//! not be (tests, the demo, every run on a machine somebody is working at).
//!
//! A frame shows its number twice: in large digits, for a person looking at
//! a capture, and as a row of black and white cells a decoded frame can be
//! read back from ([`Pattern::read`]), which survives an encoder's losses.
//! A white mark goes round the middle once every two seconds at thirty
//! frames a second, so a stalled stream is seen to stall.

/// How many bits of the number the cells carry.
const BITS: u32 = 16;
/// The cells: a white one, the bits, a black one. The two at the ends say
/// that what was read is the row and not something else.
const CELLS: u32 = BITS + 2;
/// The frames the mark takes to go round.
const ROUND: u32 = 60;

/// The order a frame's four bytes come in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Order {
    /// What an encoder takes.
    Rgba,
    /// What GPUI draws.
    Bgra,
}

/// The pattern at one size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Pattern {
    width: u32,
    height: u32,
}

/// A colour, as red, green and blue.
type Rgb = [u8; 3];

const GROUND: Rgb = [0x1b, 0x24, 0x40];
const LINES: Rgb = [0x2c, 0x3a, 0x66];
const BAND: Rgb = [0x80, 0x80, 0x80];
const WHITE: Rgb = [0xf2, 0xf2, 0xf2];
const BLACK: Rgb = [0x08, 0x08, 0x08];
const MARK: Rgb = [0xff, 0xd0, 0x40];

impl Pattern {
    /// The pattern `width` by `height`, each at least 64.
    pub(crate) fn new(width: u32, height: u32) -> Self {
        Self {
            width: width.max(64),
            height: height.max(64),
        }
    }

    pub(crate) fn width(self) -> u32 {
        self.width
    }

    pub(crate) fn height(self) -> u32 {
        self.height
    }

    /// Frame `number`, its bytes in `order`.
    pub(crate) fn frame(self, number: u32, order: Order) -> Vec<u8> {
        let mut canvas = Canvas::new(self.width, self.height, order);
        canvas.fill(0, 0, self.width, self.height, GROUND);
        self.grid(&mut canvas);
        self.mark(&mut canvas, number);
        self.digits(&mut canvas, number);
        self.cells(&mut canvas, number);
        canvas.bytes
    }

    /// The number a frame of this pattern shows, read from its cells; `None`
    /// when the row is not where it should be. `bytes` may be in either
    /// order: the cells are grey.
    #[cfg(test)]
    pub(crate) fn read(self, bytes: &[u8]) -> Option<u32> {
        if bytes.len() < (self.width * self.height * 4) as usize {
            return None;
        }
        let lit = |cell: u32| {
            let (x, y) = self.cell_middle(cell);
            let at = ((y * self.width + x) * 4) as usize;
            let grey = (u32::from(bytes[at]) + u32::from(bytes[at + 1]) + u32::from(bytes[at + 2])) / 3;
            grey > 128
        };
        if !lit(0) || lit(CELLS - 1) {
            return None;
        }
        Some((0..BITS).fold(0, |number, bit| (number << 1) | u32::from(lit(bit + 1))))
    }

    /// Lines across and down, an eighth of the frame apart.
    fn grid(self, canvas: &mut Canvas) {
        let thick = (self.height / 270).max(1);
        for step in 1..8 {
            canvas.fill(self.width * step / 8, 0, thick, self.height, LINES);
            canvas.fill(0, self.height * step / 8, self.width, thick, LINES);
        }
    }

    /// The mark, a square going round the middle.
    fn mark(self, canvas: &mut Canvas, number: u32) {
        let side = self.height / 10;
        let turn = f64::from(number % ROUND) / f64::from(ROUND) * std::f64::consts::TAU;
        let reach = f64::from(self.height) / 5.0;
        let (cx, cy) = (f64::from(self.width) / 2.0, f64::from(self.height) * 0.45);
        let x = cx + reach * turn.cos() - f64::from(side) / 2.0;
        let y = cy + reach * turn.sin() - f64::from(side) / 2.0;
        canvas.fill(whole(x), whole(y), side, side, MARK);
    }

    /// The number in seven-segment digits, across the top.
    fn digits(self, canvas: &mut Canvas, number: u32) {
        let text = format!("{number:06}");
        let height = self.height / 6;
        let width = height / 2;
        let gap = width / 3;
        let total = text.len() as u32 * (width + gap);
        let mut x = self.width.saturating_sub(total) / 2;
        for digit in text.bytes() {
            Digit::new(digit - b'0').draw(canvas, x, self.height / 14, width, height);
            x += width + gap;
        }
    }

    /// The number in cells, on a grey band near the foot.
    fn cells(self, canvas: &mut Canvas, number: u32) {
        let (cell_w, cell_h) = self.cell_size();
        let left = self.cells_left();
        let top = self.cells_top();
        canvas.fill(0, top - cell_h / 2, self.width, cell_h * 2, BAND);
        for cell in 0..CELLS {
            let on = match cell {
                0 => true,
                c if c == CELLS - 1 => false,
                c => number >> (BITS - c) & 1 == 1,
            };
            let colour = if on { WHITE } else { BLACK };
            canvas.fill(left + cell * cell_w, top, cell_w, cell_h, colour);
        }
    }

    fn cell_size(self) -> (u32, u32) {
        (self.width / (CELLS + 2), self.height / 10)
    }

    fn cells_left(self) -> u32 {
        self.cell_size().0
    }

    fn cells_top(self) -> u32 {
        self.height - self.cell_size().1 * 2
    }

    #[cfg(test)]
    fn cell_middle(self, cell: u32) -> (u32, u32) {
        let (cell_w, cell_h) = self.cell_size();
        (
            self.cells_left() + cell * cell_w + cell_w / 2,
            self.cells_top() + cell_h / 2,
        )
    }
}

/// A coordinate that may be off the frame, as one that is not.
fn whole(at: f64) -> u32 {
    if at <= 0.0 {
        0
    } else {
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a place on a frame, positive and far below u32"
        )]
        let at = at as u32;
        at
    }
}

/// A frame being drawn.
struct Canvas {
    width: u32,
    height: u32,
    order: Order,
    bytes: Vec<u8>,
}

impl Canvas {
    fn new(width: u32, height: u32, order: Order) -> Self {
        Self {
            width,
            height,
            order,
            bytes: vec![0; (width * height * 4) as usize],
        }
    }

    /// Fill the rectangle at `x`, `y`, as much of it as is on the frame.
    fn fill(&mut self, x: u32, y: u32, width: u32, height: u32, [r, g, b]: Rgb) {
        let pixel = match self.order {
            Order::Rgba => [r, g, b, 255],
            Order::Bgra => [b, g, r, 255],
        };
        let right = (x + width).min(self.width);
        let bottom = (y + height).min(self.height);
        for row in y.min(bottom)..bottom {
            let start = ((row * self.width + x.min(right)) * 4) as usize;
            let end = ((row * self.width + right) * 4) as usize;
            for chunk in self.bytes[start..end].as_chunks_mut::<4>().0 {
                chunk.copy_from_slice(&pixel);
            }
        }
    }
}

/// One digit of seven segments.
struct Digit {
    /// Which segments are lit: a to g, top clockwise, then the middle.
    lit: [bool; 7],
}

impl Digit {
    fn new(digit: u8) -> Self {
        const SEGMENTS: [u8; 10] = [
            0b011_1111, 0b000_0110, 0b101_1011, 0b100_1111, 0b110_0110, 0b110_1101, 0b111_1101,
            0b000_0111, 0b111_1111, 0b110_1111,
        ];
        let bits = SEGMENTS[usize::from(digit % 10)];
        Self {
            lit: std::array::from_fn(|segment| bits >> segment & 1 == 1),
        }
    }

    fn draw(&self, canvas: &mut Canvas, x: u32, y: u32, width: u32, height: u32) {
        let t = (width / 5).max(1);
        let half = height / 2;
        let bars = [
            (x, y, width, t),
            (x + width - t, y, t, half),
            (x + width - t, y + half, t, half),
            (x, y + height - t, width, t),
            (x, y + half, t, half),
            (x, y, t, half),
            (x, y + half - t / 2, width, t),
        ];
        for (bar, lit) in bars.into_iter().zip(self.lit) {
            if lit {
                canvas.fill(bar.0, bar.1, bar.2, bar.3, WHITE);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_is_read_back_as_the_number_it_shows() {
        let pattern = Pattern::new(640, 360);
        for number in [0, 1, 2, 977, 0xfffe, 0xffff] {
            for order in [Order::Rgba, Order::Bgra] {
                let frame = pattern.frame(number, order);
                assert_eq!(frame.len(), 640 * 360 * 4);
                assert_eq!(pattern.read(&frame), Some(number), "{number} in {order:?}");
            }
        }
    }

    #[test]
    fn something_that_is_not_the_pattern_reads_as_nothing() {
        let pattern = Pattern::new(320, 180);
        assert_eq!(pattern.read(&vec![0; 320 * 180 * 4]), None, "black");
        assert_eq!(pattern.read(&vec![255; 320 * 180 * 4]), None, "white");
        assert_eq!(pattern.read(&[0; 16]), None, "too small");
    }

    #[test]
    fn the_mark_moves_from_frame_to_frame() {
        let pattern = Pattern::new(320, 180);
        assert_ne!(
            pattern.frame(1, Order::Rgba),
            pattern.frame(2, Order::Rgba).as_slice()
        );
        // The digits and cells aside, a frame a round later looks the same.
        let (a, b) = (pattern.frame(5, Order::Rgba), pattern.frame(5 + ROUND, Order::Rgba));
        let rows = (180 * 7 / 10) as usize * 320 * 4;
        let band = (180 / 14 + 180 / 6) as usize * 320 * 4;
        assert_eq!(a[band..rows], b[band..rows]);
    }
}
