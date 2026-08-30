//! Sender-side congestion control for the broadcast uplink.
//!
//! Until this module existed the broadcaster was open-loop: [`crate::encode`]'s
//! `scaled_bitrate` picked a target from pixel rate alone and the encoder held
//! it whatever the network did. On a residential uplink that builds queues for
//! about a minute and then collapses into chronic loss - the observed failure
//! being a share that runs clean for ~45 s and then freezes with every keyframe
//! dying in transit while deltas still arrive.
//!
//! What lives here is the LOSS half of GCC (the same additive-increase /
//! multiplicative-decrease controller libwebrtc runs beside its delay
//! estimator), driven by the `fraction_lost` field of the RTCP receiver
//! reports the SFU already sends us. It deliberately does not need TWCC, a
//! pacer or a delay estimate, so it works against today's transport with no
//! server change. When the delay-based estimate arrives it becomes the second
//! input and the final target is the minimum of the two, exactly as GCC does.
//!
//! ```text
//! RTCP RR ─► CongestionController ─► BitrateAllocator ─► per-track AtomicU32
//!            (loss AIMD, this file)                       │
//!                                                capture_loop reads per tick
//!                                                         │
//!                                            EncodePipeline::set_bitrate
//! ```
//!
//! The controller is deliberately conservative in both directions: it backs
//! off hard (loss is already damage) and recovers slowly (a screen share that
//! oscillates looks worse than one that settles low).

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::sources::SourceKind;

/// Loss fraction above which the controller backs off multiplicatively.
/// libwebrtc uses the same 10 % threshold.
const LOSS_DECREASE: f32 = 0.10;

/// Loss fraction below which the controller probes upward. Between this and
/// [`LOSS_DECREASE`] the target is held: a little loss is normal on the
/// internet and reacting to it wastes capacity.
const LOSS_INCREASE: f32 = 0.02;

/// Multiplicative growth applied at most once per control interval while the
/// link looks clean. 5 % per RTT takes ~15 s to double, which is slow enough
/// that a share does not visibly pump.
const INCREASE_FACTOR: f64 = 1.05;

/// Share of the measured loss that translates into backoff. A 20 % loss
/// therefore cuts the target by 10 %, a 60 % loss by 30 %; repeated once per
/// RTT this converges on the real capacity within a few round trips without
/// the single catastrophic halving that leaves a share unusable.
const DECREASE_RESPONSE: f64 = 0.5;

/// Lowest target the controller will ever ask an encoder for. Below roughly
/// this a desktop share is illegible, so it is better to hold here and let
/// the frame-rate ladder (a later phase) take over the degradation.
pub(crate) const MIN_TARGET_BPS: u32 = 800_000;

/// Target assumed before any track has reported what its content needs.
const INITIAL_TARGET_BPS: u32 = 2_500_000;

/// RTT assumed before a receiver report has carried one.
const DEFAULT_RTT: Duration = Duration::from_millis(100);

/// Lower bound on the control interval. On a LAN the real RTT is well under
/// a millisecond, and reacting that fast to a 1 Hz report stream would just
/// amplify measurement noise.
const MIN_CONTROL_INTERVAL: Duration = Duration::from_millis(200);

/// Upper bound on the control interval, so a pathological RTT cannot freeze
/// adaptation altogether.
const MAX_CONTROL_INTERVAL: Duration = Duration::from_secs(2);

/// Smoothing applied to the RTT estimate (weight of the new sample).
const RTT_ALPHA: f64 = 0.2;

/// One RTCP receiver report, reduced to what the controller acts on.
#[derive(Debug, Clone, Copy)]
pub(crate) struct FeedbackSample {
    /// Fraction of packets lost since the previous report, 0.0 ..= 1.0.
    pub fraction_lost: f32,
    /// Round-trip time, when the report carried the fields to derive it.
    pub rtt: Option<Duration>,
}

/// What the controller last decided, for logs and the stats UI.
#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CongestionSnapshot {
    /// Current uplink target in bits per second.
    pub target_bps: u32,
    /// Ceiling the target is clamped to (what the content actually needs).
    pub ceiling_bps: u32,
    /// Most recent loss fraction reported by the SFU, 0.0 ..= 1.0.
    pub fraction_lost: f32,
    /// Smoothed round-trip time in milliseconds, when known.
    pub rtt_ms: Option<u32>,
    /// Receiver reports folded in since the broadcast started.
    pub reports: u64,
}

/// Loss-driven AIMD controller for one uplink (one ICE transport).
///
/// Bandwidth is a property of the path, so there is exactly one of these per
/// broadcast even when the broadcast carries several tracks; splitting the
/// result across tracks is [`BitrateAllocator`]'s job.
#[derive(Debug)]
pub(crate) struct CongestionController {
    /// Current target, kept as f64 so repeated small steps do not quantise
    /// away to nothing.
    target: f64,
    /// Highest target the content can use (sum of the per-track ceilings).
    ceiling: u32,
    /// Smoothed RTT, used as the control interval.
    rtt: Duration,
    /// When the target last moved down / up, so each is rate-limited to one
    /// control interval.
    last_decrease: Instant,
    last_increase: Instant,
    /// Latest observations, for the snapshot.
    last_loss: f32,
    reports: u64,
    /// Whether any report has carried an RTT yet.
    have_rtt: bool,
}

impl CongestionController {
    /// Create a controller starting at a conservative target.
    pub(crate) fn new(now: Instant) -> Self {
        Self {
            target: f64::from(INITIAL_TARGET_BPS),
            ceiling: INITIAL_TARGET_BPS,
            rtt: DEFAULT_RTT,
            last_decrease: now,
            last_increase: now,
            last_loss: 0.0,
            reports: 0,
            have_rtt: false,
        }
    }

    /// Set the highest target the content can currently use.
    ///
    /// Capture loops publish their own `scaled_bitrate` once they know their
    /// frame dimensions; the broadcaster sums those. Raising the ceiling never
    /// raises the target directly - the controller still has to probe up to it.
    pub(crate) fn set_ceiling(&mut self, ceiling: u32) {
        self.ceiling = ceiling.max(MIN_TARGET_BPS);
        if self.target > f64::from(self.ceiling) {
            self.target = f64::from(self.ceiling);
        }
    }

    /// The control interval: one smoothed RTT, bounded.
    fn interval(&self) -> Duration {
        self.rtt.clamp(MIN_CONTROL_INTERVAL, MAX_CONTROL_INTERVAL)
    }

    /// Fold one receiver report into the estimate.
    pub(crate) fn on_feedback(&mut self, sample: FeedbackSample, now: Instant) {
        self.reports += 1;
        self.last_loss = sample.fraction_lost;
        if let Some(rtt) = sample.rtt {
            self.rtt = if self.have_rtt {
                smooth_rtt(self.rtt, rtt)
            } else {
                self.have_rtt = true;
                rtt
            };
        }

        let interval = self.interval();
        let loss = f64::from(sample.fraction_lost.clamp(0.0, 1.0));
        if sample.fraction_lost > LOSS_DECREASE {
            if now.duration_since(self.last_decrease) >= interval {
                self.target *= 1.0 - DECREASE_RESPONSE * loss;
                self.clamp_target();
                self.last_decrease = now;
                // Do not probe upward in the same interval we just backed off.
                self.last_increase = now;
            }
        } else if sample.fraction_lost < LOSS_INCREASE
            && now.duration_since(self.last_increase) >= interval
        {
            self.target *= INCREASE_FACTOR;
            self.clamp_target();
            self.last_increase = now;
        }
    }

    /// Hold the target inside `[MIN_TARGET_BPS, ceiling]`.
    fn clamp_target(&mut self) {
        let ceiling = f64::from(self.ceiling.max(MIN_TARGET_BPS));
        self.target = self.target.clamp(f64::from(MIN_TARGET_BPS), ceiling);
    }

    /// The current uplink target in bits per second.
    pub(crate) fn target_bps(&self) -> u32 {
        // `clamp_target` keeps this inside u32 range at all times.
        self.target.round().max(f64::from(MIN_TARGET_BPS)) as u32
    }

    /// A snapshot for logging and the stats UI.
    pub(crate) fn snapshot(&self) -> CongestionSnapshot {
        CongestionSnapshot {
            target_bps: self.target_bps(),
            ceiling_bps: self.ceiling,
            fraction_lost: self.last_loss,
            rtt_ms: if self.have_rtt {
                u32::try_from(self.rtt.as_millis()).ok()
            } else {
                None
            },
            reports: self.reports,
        }
    }
}

/// Exponentially smooth the RTT estimate.
fn smooth_rtt(current: Duration, sample: Duration) -> Duration {
    let blended = current.as_secs_f64() * (1.0 - RTT_ALPHA) + sample.as_secs_f64() * RTT_ALPHA;
    Duration::from_secs_f64(blended)
}

/// Relative share of the uplink a track gets.
///
/// A camera is small, low-entropy and already capped at 30 fps, so it needs a
/// fraction of what a desktop needs; giving it an equal share would starve the
/// screen track that the share actually exists for.
fn weight_of(kind: SourceKind) -> u32 {
    if kind == SourceKind::Device {
        1
    } else {
        4
    }
}

/// Absolute cap on what a camera track may take, whatever the weights say.
const CAMERA_MAX_BPS: u32 = 2_000_000;

/// One track's slice of the uplink, shared with its capture thread.
///
/// Both halves are plain atomics for the same reason the keyframe flag is:
/// the capture loop is a blocking OS thread that must never `.await`, and it
/// reads this once per frame.
#[derive(Debug)]
pub(crate) struct TrackBudget {
    /// What the controller wants this track to send, in bits per second.
    target: AtomicU32,
    /// What this track's content can actually use (its `scaled_bitrate`).
    /// Zero until the capture loop has seen its first frame.
    ceiling: AtomicU32,
    /// Relative share, from the source kind.
    weight: u32,
}

impl TrackBudget {
    /// Create a budget for a track of the given source kind.
    pub(crate) fn new(kind: SourceKind) -> Self {
        Self {
            target: AtomicU32::new(INITIAL_TARGET_BPS),
            ceiling: AtomicU32::new(0),
            weight: weight_of(kind),
        }
    }

    /// Publish what this track's content can use (called by the capture loop
    /// once it knows its frame dimensions).
    pub(crate) fn set_ceiling(&self, bps: u32) {
        self.ceiling.store(bps, Ordering::Relaxed);
    }

    /// The ceiling this track last published, if any.
    fn ceiling(&self) -> u32 {
        self.ceiling.load(Ordering::Relaxed)
    }

    /// What this track should encode at right now, never above what its
    /// content can use and never below the floor.
    pub(crate) fn target_bps(&self) -> u32 {
        let target = self.target.load(Ordering::Relaxed);
        let ceiling = self.ceiling();
        let capped = if ceiling == 0 {
            target
        } else {
            target.min(ceiling)
        };
        capped.max(MIN_TARGET_BPS)
    }
}

/// Splits one uplink target across the tracks of a broadcast.
#[derive(Debug)]
pub(crate) struct BitrateAllocator {
    budgets: Vec<Arc<TrackBudget>>,
}

impl BitrateAllocator {
    /// Create an allocator over one budget per source, in track (mid) order.
    pub(crate) fn new(kinds: &[SourceKind]) -> Self {
        Self {
            budgets: kinds
                .iter()
                .map(|kind| Arc::new(TrackBudget::new(*kind)))
                .collect(),
        }
    }

    /// The per-track handles, in track order, for the capture threads.
    pub(crate) fn budgets(&self) -> &[Arc<TrackBudget>] {
        &self.budgets
    }

    /// Sum of what every track's content can use; zero while no track has
    /// reported yet.
    pub(crate) fn total_ceiling(&self) -> u32 {
        self.budgets
            .iter()
            .map(|b| b.ceiling())
            .fold(0u32, u32::saturating_add)
    }

    /// Distribute `total` across the tracks by weight.
    ///
    /// A track that cannot use its whole share (its content is cheaper than
    /// the slice it was given) hands the remainder back to the others, so a
    /// still camera does not strand bandwidth the screen could use.
    pub(crate) fn apply(&self, total: u32) {
        let total_weight: u32 = self.budgets.iter().map(|b| b.weight).sum();
        if total_weight == 0 {
            return;
        }
        let mut spare = 0u64;
        let mut hungry: Vec<&Arc<TrackBudget>> = Vec::new();

        for budget in &self.budgets {
            let share = mul_div(total, budget.weight, total_weight);
            let share = if budget.weight == 1 {
                share.min(CAMERA_MAX_BPS)
            } else {
                share
            };
            let ceiling = budget.ceiling();
            if ceiling > 0 && share > ceiling {
                spare += u64::from(share - ceiling);
                budget.target.store(ceiling, Ordering::Relaxed);
            } else {
                budget.target.store(share, Ordering::Relaxed);
                hungry.push(budget);
            }
        }

        if spare == 0 || hungry.is_empty() {
            return;
        }
        let extra = spare / hungry.len() as u64;
        for budget in hungry {
            let current = u64::from(budget.target.load(Ordering::Relaxed));
            let raised = u32::try_from(current + extra).unwrap_or(u32::MAX);
            budget.target.store(raised, Ordering::Relaxed);
        }
    }
}

/// `value * numer / denom` without overflowing on realistic bitrates.
fn mul_div(value: u32, numer: u32, denom: u32) -> u32 {
    if denom == 0 {
        return value;
    }
    let scaled = u64::from(value) * u64::from(numer) / u64::from(denom);
    u32::try_from(scaled).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed `count` reports carrying `loss`, one control interval apart.
    fn drive(ctrl: &mut CongestionController, loss: f32, count: u32) -> u32 {
        let mut now = Instant::now();
        for _ in 0..count {
            now += Duration::from_millis(250);
            ctrl.on_feedback(
                FeedbackSample {
                    fraction_lost: loss,
                    rtt: Some(Duration::from_millis(60)),
                },
                now,
            );
        }
        ctrl.target_bps()
    }

    #[test]
    fn clean_link_ramps_toward_the_ceiling() {
        let mut ctrl = CongestionController::new(Instant::now());
        ctrl.set_ceiling(8_000_000);
        let start = ctrl.target_bps();
        let after = drive(&mut ctrl, 0.0, 20);
        assert!(
            after > start,
            "clean link should ramp up ({start} -> {after})"
        );
        assert!(after <= 8_000_000, "never above the ceiling");
    }

    #[test]
    fn ramp_stops_at_the_ceiling() {
        let mut ctrl = CongestionController::new(Instant::now());
        ctrl.set_ceiling(3_000_000);
        let after = drive(&mut ctrl, 0.0, 200);
        assert_eq!(after, 3_000_000);
    }

    #[test]
    fn heavy_loss_backs_off_within_a_few_intervals() {
        let mut ctrl = CongestionController::new(Instant::now());
        ctrl.set_ceiling(10_000_000);
        let start = drive(&mut ctrl, 0.0, 40);
        let after = drive(&mut ctrl, 0.15, 6);
        assert!(
            after < start * 3 / 4,
            "15 % loss should cut the target hard ({start} -> {after})"
        );
    }

    #[test]
    fn moderate_loss_is_held_not_chased() {
        let mut ctrl = CongestionController::new(Instant::now());
        ctrl.set_ceiling(10_000_000);
        let start = drive(&mut ctrl, 0.0, 20);
        let after = drive(&mut ctrl, 0.05, 20);
        assert_eq!(after, start, "5 % loss is the hold band");
    }

    #[test]
    fn recovery_is_gradual_not_a_jump() {
        let mut ctrl = CongestionController::new(Instant::now());
        ctrl.set_ceiling(10_000_000);
        let _ramped = drive(&mut ctrl, 0.0, 40);
        let bottom = drive(&mut ctrl, 0.30, 10);
        let after_one = drive(&mut ctrl, 0.0, 1);
        assert!(after_one <= bottom * 11 / 10, "one interval, one step");
        let after_many = drive(&mut ctrl, 0.0, 30);
        assert!(after_many > bottom, "but it does recover");
    }

    #[test]
    fn target_never_falls_below_the_floor() {
        let mut ctrl = CongestionController::new(Instant::now());
        ctrl.set_ceiling(10_000_000);
        let after = drive(&mut ctrl, 0.9, 200);
        assert_eq!(after, MIN_TARGET_BPS);
    }

    #[test]
    fn lowering_the_ceiling_pulls_the_target_down() {
        let mut ctrl = CongestionController::new(Instant::now());
        ctrl.set_ceiling(9_000_000);
        let _high = drive(&mut ctrl, 0.0, 60);
        ctrl.set_ceiling(1_500_000);
        assert_eq!(ctrl.target_bps(), 1_500_000);
    }

    #[test]
    fn allocator_favours_the_screen_over_the_camera() {
        let alloc = BitrateAllocator::new(&[SourceKind::Screen, SourceKind::Device]);
        alloc.apply(5_000_000);
        let budgets = alloc.budgets();
        let screen = budgets[0].target_bps();
        let camera = budgets[1].target_bps();
        assert!(
            screen > camera * 3,
            "screen gets the bulk ({screen} vs {camera})"
        );
    }

    #[test]
    fn allocator_caps_the_camera_absolutely() {
        let alloc = BitrateAllocator::new(&[SourceKind::Device]);
        alloc.apply(20_000_000);
        assert_eq!(alloc.budgets()[0].target_bps(), CAMERA_MAX_BPS);
    }

    #[test]
    fn a_cheap_track_hands_its_remainder_back() {
        let alloc = BitrateAllocator::new(&[SourceKind::Screen, SourceKind::Device]);
        let budgets = alloc.budgets();
        // The camera's content only needs 600 kbps.
        budgets[1].set_ceiling(600_000);
        budgets[0].set_ceiling(20_000_000);
        alloc.apply(5_000_000);
        let screen = budgets[0].target_bps();
        assert!(
            screen > 4_000_000,
            "screen should absorb the camera's unused share (got {screen})"
        );
    }

    #[test]
    fn a_track_never_encodes_above_what_its_content_needs() {
        let alloc = BitrateAllocator::new(&[SourceKind::Screen]);
        alloc.budgets()[0].set_ceiling(1_200_000);
        alloc.apply(9_000_000);
        assert_eq!(alloc.budgets()[0].target_bps(), 1_200_000);
    }

    #[test]
    fn a_track_target_never_falls_below_the_floor() {
        let alloc = BitrateAllocator::new(&[SourceKind::Screen, SourceKind::Device]);
        alloc.apply(100_000);
        for budget in alloc.budgets() {
            assert_eq!(budget.target_bps(), MIN_TARGET_BPS);
        }
    }
}
