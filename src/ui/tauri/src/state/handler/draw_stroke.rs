use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;

use super::{HandleMessage, HandlerContext};
use crate::state::core_event::CoreEvent;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DrawStrokePayload {
    pub sender_session: u32,
    pub channel_id: u32,
    pub stroke_id: String,
    pub color: u32,
    pub width: f32,
    pub width_frac: Option<f32>,
    pub points: Vec<f32>,
    pub is_end: bool,
    pub is_clear: bool,
    pub clear_all: bool,
}

impl HandleMessage for mumble_tcp::FancyDrawStroke {
    fn handle(&self, ctx: &HandlerContext) {
        tracing::info!(
            target: "draw",
            sender_session = self.sender_session.unwrap_or(0),
            channel_id = self.channel_id.unwrap_or(0),
            stroke_id = %self.stroke_id.clone().unwrap_or_default(),
            coords = self.points.len(),
            is_end = self.is_end.unwrap_or(false),
            is_clear = self.is_clear.unwrap_or(false),
            clear_all = self.clear_all.unwrap_or(false),
            width_frac = ?self.width_frac,
            "rx FancyDrawStroke -> emit draw-stroke"
        );
        ctx.send(CoreEvent::DrawStroke(DrawStrokePayload {
            sender_session: self.sender_session.unwrap_or(0),
            channel_id: self.channel_id.unwrap_or(0),
            stroke_id: self.stroke_id.clone().unwrap_or_default(),
            color: self.color.unwrap_or(0xFF_FF_00_00),
            width: self.width.unwrap_or(4.0),
            width_frac: self.width_frac,
            points: self.points.clone(),
            is_end: self.is_end.unwrap_or(false),
            is_clear: self.is_clear.unwrap_or(false),
            clear_all: self.clear_all.unwrap_or(false),
        }));
    }
}
