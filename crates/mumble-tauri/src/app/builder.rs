//! Construct the base Tauri builder with all plugins registered (the
//! per-platform plugin set: store/opener/notification/dialog/deep-link
//! everywhere, plus Android service plugins or the desktop window-state /
//! global-shortcut / updater plugins).

#[cfg(target_os = "android")]
use tauri::Manager;

pub(crate) fn create_base_builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("connection-service")
            .setup(|app, api| {
                let handle = api.register_android_plugin(
                    "com.fancymumble.app",
                    "ConnectionServicePlugin",
                )?;
                let cs_handle = crate::platform::android::connection_service::ConnectionServiceHandle(handle);
                crate::platform::android::connection_service::register_disconnect_listener(&cs_handle, app.clone());
                crate::platform::android::connection_service::register_navigate_listener(&cs_handle, app.clone());
                let _ = app.manage(cs_handle);
                Ok(())
            })
            .build(),
    );

    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("fcm-service")
            .setup(|app, api| {
                let handle = api.register_android_plugin(
                    "com.fancymumble.app",
                    "FcmPlugin",
                )?;
                let fcm_handle = crate::platform::android::fcm_service::FcmPluginHandle(handle);
                let _ = app.manage(fcm_handle);
                Ok(())
            })
            .build(),
    );

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            // Restore size/position/maximised state, but NEVER restore
            // visibility. The updater module decides whether the main
            // window should appear on launch.
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::all()
                    & !tauri_plugin_window_state::StateFlags::VISIBLE,
            )
            // Don't track the updater window - it has a fixed size set
            // in window.rs that must not be overridden by stale state.
            .with_denylist(&[crate::updater::UPDATER_WINDOW_LABEL])
            .build(),
    );

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(not(target_os = "android"))]
    let builder = crate::updater::register_plugins(builder);

    builder
}
