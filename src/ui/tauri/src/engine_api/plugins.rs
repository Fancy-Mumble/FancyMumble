//! What a server runs as plugins, and the Signal bridge this client may
//! load, for a view that is not the web page: what the web client's Plugins
//! page reads from `plugin-registry` and `signal_bridge_status`.
//!
//! Only reading. Trusting a plugin and its settings panels belong to the
//! web client's plugin runtime, which a view without it has no use for.

use super::EngineHandle;

/// One plugin the server on show says it runs.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerPlugin {
    /// Its name.
    pub name: String,
    /// Its version, as it says it.
    pub version: String,
    /// What it says it does.
    pub description: Option<String>,
    /// What it would ask a client to let it do (its manifest's
    /// `capabilities`); empty when it asks nothing.
    pub capabilities: Vec<String>,
}

impl ServerPlugin {
    /// The plugin as the registry names it, with what its JSON says of it.
    fn read(name: String, version: String, info: Option<&str>) -> Self {
        let info: Option<serde_json::Value> = info.and_then(|json| serde_json::from_str(json).ok());
        let description = info
            .as_ref()
            .and_then(|info| info.get("description")?.as_str())
            .map(str::to_owned);
        let capabilities = info
            .as_ref()
            .and_then(|info| info.get("client_manifest")?.get("capabilities")?.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|capability| capability.as_str().map(str::to_owned))
            .collect();
        Self {
            name,
            version,
            description,
            capabilities,
        }
    }
}

/// Where the Signal bridge stands for this client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignalBridge {
    /// A bridge library is where the loader looks.
    pub installed: bool,
    /// It is the add-on downloaded, not one that came with the app.
    pub addon: bool,
    /// The bridge version this client loads.
    pub version: &'static str,
}

/// Where the Signal bridge stands. This build fetches no add-on: one comes
/// with a package, or is put beside the program.
#[must_use]
pub fn signal_bridge() -> SignalBridge {
    #[cfg(not(target_os = "android"))]
    {
        let found = crate::state::pchat::find_bridge_library();
        let addon = crate::state::pchat::signal_bridge_addon_dir();
        SignalBridge {
            installed: found.is_some(),
            addon: found
                .as_ref()
                .is_some_and(|path| addon.is_some_and(|dir| path.starts_with(dir))),
            version: env!("SIGNAL_BRIDGE_VERSION"),
        }
    }
    #[cfg(target_os = "android")]
    {
        SignalBridge {
            installed: true,
            addon: false,
            version: env!("SIGNAL_BRIDGE_VERSION"),
        }
    }
}

impl EngineHandle {
    /// The plugins the server on show says it runs, in its order; none
    /// before it has said.
    #[must_use]
    pub fn server_plugins(&self) -> Vec<ServerPlugin> {
        self.state
            .get_plugin_registry()
            .into_iter()
            .map(|entry| ServerPlugin::read(entry.plugin_name, entry.version, entry.info_json.as_deref()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plugin_is_read_from_what_its_json_says() {
        let json = r#"{"description":"Shared notes","client_manifest":{"capabilities":["slash_commands","modals"]}}"#;
        let plugin = ServerPlugin::read("fancy-live-doc".into(), "1.2.0".into(), Some(json));
        assert_eq!(plugin.description.as_deref(), Some("Shared notes"));
        assert_eq!(plugin.capabilities, ["slash_commands", "modals"]);
        let bare = ServerPlugin::read("x".into(), "1".into(), Some("not json"));
        assert_eq!(bare.description, None);
        assert!(bare.capabilities.is_empty());
    }
}
