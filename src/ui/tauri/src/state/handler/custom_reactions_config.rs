use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::core_event::CoreEvent;

#[derive(Serialize, Clone)]
pub(crate) struct CustomReactionPayload {
    pub shortcode: String,
    pub display: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl HandleMessage for mumble_tcp::FancyCustomReactionsConfig {
    fn handle(&self, ctx: &HandlerContext) {
        let reactions: Vec<CustomReactionPayload> = self
            .reactions
            .iter()
            .map(|r| CustomReactionPayload {
                shortcode: r.shortcode.clone().unwrap_or_default(),
                display: r.display.clone().unwrap_or_default(),
                label: r.label.clone(),
            })
            .collect();

        debug!(
            count = reactions.len(),
            "received FancyCustomReactionsConfig"
        );

        ctx.send(CoreEvent::CustomReactionsConfig(reactions));
    }
}
