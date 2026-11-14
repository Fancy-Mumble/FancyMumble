//! A channel's groups between the engine's terms and the view's: whole,
//! colour, icon, style and all, so what the view sends back is every group
//! as it is now. A group the view took out is gone; one it renamed is the
//! one it renamed, not a new one beside the old.

use std::collections::HashMap;

use mumble_tauri_lib::engine_api as api;

use crate::engine::{AclGroup, GroupLook};

/// The group as the view has it.
pub(super) fn shown(group: &api::AclGroupInfo) -> AclGroup {
    AclGroup {
        name: group.name.clone().into(),
        inherited: group.inherited_members.clone(),
        added: group.add.clone(),
        removed: group.remove.clone(),
        from_parent: group.inherited,
        inherit: group.inherit,
        inheritable: group.inheritable,
        look: GroupLook {
            color: group.color.clone().map(Into::into),
            icon: group.icon.as_deref().map(Into::into),
            style: group.style_preset.clone().map(Into::into),
            metadata: group
                .metadata
                .iter()
                .map(|(key, value)| (key.clone().into(), value.clone().into()))
                .collect(),
        },
    }
}

/// The group as the engine sends it.
pub(super) fn sent(group: AclGroup) -> api::AclGroupInfo {
    api::AclGroupInfo {
        name: group.name.to_string(),
        inherited: group.from_parent,
        inherit: group.inherit,
        inheritable: group.inheritable,
        add: group.added,
        remove: group.removed,
        inherited_members: group.inherited,
        color: group.look.color.map(|color| color.to_string()),
        icon: group.look.icon.map(|icon| icon.to_vec()),
        style_preset: group.look.style.map(|style| style.to_string()),
        metadata: group
            .look
            .metadata
            .into_iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect::<HashMap<_, _>>(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_group_goes_back_as_it_came() {
        let read = api::AclGroupInfo {
            name: "wardens".to_owned(),
            inherited: false,
            inherit: false,
            inheritable: true,
            add: vec![7],
            remove: vec![9],
            inherited_members: vec![3],
            color: Some("#3f9fd8".to_owned()),
            icon: Some(vec![1, 2, 3]),
            style_preset: Some("neon".to_owned()),
            metadata: HashMap::from([("motto".to_owned(), "watch".to_owned())]),
        };
        assert_eq!(sent(shown(&read)), read);
    }
}
